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
        const session = await terminalManager.createTerminal(
          socket.id,
          userId,
          {
            cols: options.cols,
            rows: options.rows
          }
        );

        // Set up data handler
        session.pty.onData((data: string) => {
          // Send data as-is without filtering
          socket.emit('terminal:data', data);
        });

        // Set up exit handler
        session.pty.onExit((e) => {
          logger.info('Terminal process exited', {
            socketId: socket.id,
            userId,
            exitCode: e.exitCode,
            signal: e.signal
          });
          
          socket.emit('terminal:exit');
          terminalManager.destroyTerminal(socket.id);
        });

        socket.emit('terminal:ready');
        
        logger.info('Terminal session established', {
          socketId: socket.id,
          userId,
          pid: session.pty.pid
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
    socket.on('terminal:data', async (data: string) => {
      try {
        const validatedData = validateTerminalData(data);
        await terminalManager.writeToTerminal(socket.id, validatedData);
        
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
    socket.on('terminal:resize', async (options: TerminalResizeEvent) => {
      try {
        await terminalManager.resizeTerminal(socket.id, options.cols, options.rows);
        
        logger.debug('Terminal resized', {
          socketId: socket.id,
          userId,
          cols: options.cols,
          rows: options.rows
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
        await terminalManager.destroyTerminal(socket.id);
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