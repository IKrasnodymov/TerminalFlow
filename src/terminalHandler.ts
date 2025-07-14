import { Server } from 'socket.io';
import { TerminalManager } from './services/TerminalManager';
import { logger } from './utils/logger';
import { validateTerminalData, ValidationError } from './utils/validation';
import { 
  AuthenticatedTypedSocket, 
  TerminalCreateEvent, 
  TerminalResizeEvent,
  ServerToClientEvents,
  ClientToServerEvents
} from './types';
import { promises as fs } from 'fs';
import path from 'path';

// Create global terminal manager instance
const terminalManager = new TerminalManager();

// Map to track which terminalId belongs to which socket
const terminalSocketMap = new Map<string, string>(); // terminalId -> socketId



export function setupTerminalHandlers(io: Server<ClientToServerEvents, ServerToClientEvents>) {
  io.on('connection', (socket) => {
    const userId = (socket as any).userId;
    
    logger.info('Client connected', {
      socketId: socket.id,
      userId,
      remoteAddress: socket.handshake.address
    });

    // Handle terminal creation
    socket.on('terminal:create', async (options: TerminalCreateEvent = {}) => {
      try {
        // Extract terminalId and sessionId from options
        const terminalId = (options as any).terminalId;
        const sessionId = (options as any).sessionId;
        
        if (!terminalId) {
          throw new ValidationError('Terminal ID is required');
        }
        
        const result = await terminalManager.createOrReuseTerminal(
          socket.id,
          userId,
          terminalId,
          sessionId,
          {
            cols: options.cols,
            rows: options.rows
          }
        );

        // Store terminal mapping
        const fullTerminalId = `${userId}-${terminalId}`;
        terminalSocketMap.set(fullTerminalId, socket.id);
        
        // Set up data handler (only for new sessions, existing ones already have it)
        if (result.isNew) {
          result.session.pty.onData((data: string) => {
            // Send data as-is without filtering
            (socket as any).emit('terminal:data', {
              terminalId,
              data
            });
          });

          // Set up exit handler
          result.session.pty.onExit((e) => {
            logger.info('Terminal process exited', {
              socketId: socket.id,
              terminalId,
              userId,
              exitCode: e.exitCode,
              signal: e.signal
            });
            
            (socket as any).emit('terminal:exit', { terminalId });
            
            const terminalKey = `${userId}-${terminalId}`;
            terminalManager.destroyTerminalByKey(terminalKey, true); // Force destroy on exit
            terminalSocketMap.delete(fullTerminalId);
          });
        } else {
          // For reconnected sessions, we need to re-attach the data handler
          result.session.pty.onData((data: string) => {
            (socket as any).emit('terminal:data', {
              terminalId,
              data
            });
          });
        }

        // Send session info to client (cast to any since we're extending the API)
        (socket as any).emit('terminal:ready', {
          terminalId,
          sessionId: result.sessionId,
          isNew: result.isNew
        });
        
        logger.info(result.isNew ? 'Terminal session established' : 'Terminal session reconnected', {
          socketId: socket.id,
          sessionId: result.sessionId,
          userId,
          pid: result.session.pty.pid,
          isNew: result.isNew
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create terminal';
        
        logger.error('Terminal creation failed', {
          socketId: socket.id,
          userId,
          error: errorMessage
        });
        
        socket.emit('terminal:error', errorMessage);
      }
    });

    // Handle terminal data input
    socket.on('terminal:data', async (input: any) => {
      try {
        // Extract terminalId and data
        const { terminalId, data } = input;
        if (!terminalId || !data) {
          throw new ValidationError('Terminal ID and data are required');
        }
        
        const validatedData = validateTerminalData(data);
        const terminalKey = `${userId}-${terminalId}`;
        await terminalManager.writeToTerminalByKey(terminalKey, validatedData);
        
      } catch (error) {
        if (error instanceof ValidationError) {
          logger.warn('Invalid terminal data', {
            socketId: socket.id,
            userId,
            error: error.message
          });
          socket.emit('terminal:error', 'Invalid input data');
        } else {
          logger.error('Failed to write to terminal', {
            socketId: socket.id,
            userId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          socket.emit('terminal:error', 'Failed to write to terminal');
        }
      }
    });

    // Handle terminal resize
    socket.on('terminal:resize', async (input: any) => {
      try {
        // Extract terminalId and dimensions
        const { terminalId, cols, rows } = input;
        if (!terminalId) {
          throw new ValidationError('Terminal ID is required');
        }
        
        const terminalKey = `${userId}-${terminalId}`;
        await terminalManager.resizeTerminalByKey(terminalKey, cols, rows);
        
        logger.debug('Terminal resized', {
          socketId: socket.id,
          userId,
          terminalId,
          cols,
          rows
        });
        
      } catch (error) {
        if (error instanceof ValidationError) {
          logger.warn('Invalid terminal resize', {
            socketId: socket.id,
            userId,
            error: error.message
          });
          socket.emit('terminal:error', 'Invalid terminal dimensions');
        } else {
          logger.error('Failed to resize terminal', {
            socketId: socket.id,
            userId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          socket.emit('terminal:error', 'Failed to resize terminal');
        }
      }
    });

    // Handle file listing
    socket.on('files:list' as any, async (requestPath: string = '/') => {
      try {
        const basePath = process.cwd();
        const files = await getFileList(basePath, '');
        socket.emit('files:list' as any, files);
      } catch (error) {
        logger.error('Failed to list files', {
          socketId: socket.id,
          userId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        socket.emit('files:error' as any, 'Failed to list files');
      }
    });

    // Handle terminal close
    socket.on('terminal:close' as any, async (input: any) => {
      try {
        const { terminalId } = input;
        if (!terminalId) {
          throw new ValidationError('Terminal ID is required');
        }
        
        const fullTerminalId = `${userId}-${terminalId}`;
        
        logger.info('Closing terminal', {
          socketId: socket.id,
          terminalId,
          userId
        });
        
        // Destroy the terminal
        const terminalKey = `${userId}-${terminalId}`;
        await terminalManager.destroyTerminalByKey(terminalKey, true);
        
        // Remove from mapping
        terminalSocketMap.delete(fullTerminalId);
        
      } catch (error) {
        logger.error('Failed to close terminal', {
          socketId: socket.id,
          userId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
    
    // Handle file reading
    socket.on('file:read' as any, async (filePath: string) => {
      try {
        // Security check - ensure path is within project directory
        const basePath = process.cwd();
        const fullPath = path.join(basePath, filePath.startsWith('/') ? filePath.slice(1) : filePath);
        const resolvedPath = path.resolve(fullPath);
        
        if (!resolvedPath.startsWith(basePath)) {
          throw new Error('Access denied: Path outside project directory');
        }
        
        // Read file content
        const content = await fs.readFile(resolvedPath, 'utf-8');
        
        // Limit file size for browser
        const maxSize = 1024 * 1024; // 1MB
        const truncatedContent = content.length > maxSize 
          ? content.substring(0, maxSize) + '\n\n... File truncated (too large) ...'
          : content;
        
        socket.emit('file:content' as any, {
          path: filePath,
          content: truncatedContent
        });
      } catch (error) {
        logger.error('Failed to read file', {
          socketId: socket.id,
          userId,
          filePath,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        socket.emit('file:error' as any, 'Failed to read file');
      }
    });

    // Handle client disconnect
    socket.on('disconnect', async (reason) => {
      logger.info('Client disconnected', {
        socketId: socket.id,
        userId,
        reason
      });

      try {
        // Use disconnectTerminal instead of destroyTerminal to keep session alive
        await terminalManager.disconnectTerminal(socket.id);
        
        // Clean up terminal mappings for this user
        terminalSocketMap.forEach((sockId, fullTerminalId) => {
          if (sockId === socket.id && fullTerminalId.startsWith(userId)) {
            terminalSocketMap.delete(fullTerminalId);
          }
        });
      } catch (error) {
        logger.error('Failed to cleanup terminal on disconnect', {
          socketId: socket.id,
          userId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  });

  // Cleanup on server shutdown
  process.on('SIGTERM', () => {
    logger.info('Destroying all terminal sessions due to SIGTERM');
    terminalManager.destroy();
  });

  process.on('SIGINT', () => {
    logger.info('Destroying all terminal sessions due to SIGINT');
    terminalManager.destroy();
  });
}

// Helper function to get file list
async function getFileList(basePath: string, relativePath: string, depth = 0, maxDepth = 3): Promise<Array<{path: string}>> {
  const files: Array<{path: string}> = [];
  
  if (depth > maxDepth) return files;
  
  try {
    const fullPath = path.join(basePath, relativePath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(relativePath, entry.name);
      
      // Skip hidden files, node_modules, and common build directories
      if (entry.name.startsWith('.') || 
          entry.name === 'node_modules' || 
          entry.name === 'dist' ||
          entry.name === 'build' ||
          entry.name === '.git') {
        continue;
      }
      
      if (entry.isDirectory()) {
        const subFiles = await getFileList(basePath, entryPath, depth + 1, maxDepth);
        files.push(...subFiles);
      } else {
        files.push({ path: '/' + entryPath.replace(/\\/g, '/') });
      }
    }
  } catch (error) {
    logger.error('Error reading directory', { error, path: relativePath });
  }
  
  return files;
}

// Export terminal manager for health checks or admin endpoints
export { terminalManager };