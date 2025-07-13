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

// Export terminal manager for health checks or admin endpoints
export { terminalManager };