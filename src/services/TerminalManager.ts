import * as pty from 'node-pty';
import { TerminalSession, TerminalOptions } from '../types';
import { createSafeEnvironment, getDefaultShell, getDefaultWorkingDirectory } from '../utils/environment';
import { validateTerminalDimensions, ValidationError } from '../utils/validation';
import { logger } from '../utils/logger';

export class TerminalManager {
  private terminals = new Map<string, TerminalSession>();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up inactive terminals every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveTerminals();
    }, 5 * 60 * 1000);
  }

  async createTerminal(
    socketId: string, 
    userId: string, 
    options: Partial<TerminalOptions> = {}
  ): Promise<TerminalSession> {
    try {
      // Validate dimensions
      const { cols, rows } = validateTerminalDimensions(
        options.cols || 80, 
        options.rows || 24
      );

      // Check if terminal already exists for this socket
      if (this.terminals.has(socketId)) {
        throw new ValidationError('Terminal already exists for this socket');
      }

      // Create safe environment
      const safeEnv = createSafeEnvironment();
      
      // Merge with any custom environment variables (safely)
      const env = { ...safeEnv, ...this.sanitizeCustomEnv(options.env) };

      const shell = options.shell || getDefaultShell();
      const cwd = options.cwd || getDefaultWorkingDirectory();

      logger.info('Creating terminal', {
        socketId,
        userId,
        shell,
        cwd,
        cols,
        rows
      });

      const terminal = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols,
        rows,
        cwd,
        env
      });

      const session: TerminalSession = {
        pty: terminal,
        userId,
        createdAt: new Date(),
        lastActivity: new Date()
      };

      this.terminals.set(socketId, session);

      logger.info('Terminal created successfully', {
        socketId,
        userId,
        pid: terminal.pid
      });

      return session;
    } catch (error) {
      logger.error('Failed to create terminal', {
        socketId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  getTerminal(socketId: string): TerminalSession | undefined {
    const session = this.terminals.get(socketId);
    if (session) {
      session.lastActivity = new Date();
    }
    return session;
  }

  async destroyTerminal(socketId: string): Promise<void> {
    const session = this.terminals.get(socketId);
    if (!session) {
      return;
    }

    try {
      logger.info('Destroying terminal', {
        socketId,
        userId: session.userId,
        pid: session.pty.pid
      });

      // Kill the PTY process
      session.pty.kill();
      
      // Remove from map
      this.terminals.delete(socketId);

      logger.info('Terminal destroyed successfully', {
        socketId,
        userId: session.userId
      });
    } catch (error) {
      logger.error('Failed to destroy terminal', {
        socketId,
        userId: session.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async resizeTerminal(socketId: string, cols: number, rows: number): Promise<void> {
    const session = this.getTerminal(socketId);
    if (!session) {
      throw new ValidationError('Terminal not found');
    }

    const dimensions = validateTerminalDimensions(cols, rows);
    
    try {
      session.pty.resize(dimensions.cols, dimensions.rows);
      logger.debug('Terminal resized', {
        socketId,
        userId: session.userId,
        cols: dimensions.cols,
        rows: dimensions.rows
      });
    } catch (error) {
      logger.error('Failed to resize terminal', {
        socketId,
        userId: session.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async writeToTerminal(socketId: string, data: string): Promise<void> {
    const session = this.getTerminal(socketId);
    if (!session) {
      throw new ValidationError('Terminal not found');
    }

    try {
      session.pty.write(data);
    } catch (error) {
      logger.error('Failed to write to terminal', {
        socketId,
        userId: session.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  getActiveTerminals(): Array<{ socketId: string; userId: string; createdAt: Date; lastActivity: Date }> {
    return Array.from(this.terminals.entries()).map(([socketId, session]) => ({
      socketId,
      userId: session.userId,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity
    }));
  }

  getTerminalCount(): number {
    return this.terminals.size;
  }

  async destroyAllTerminals(): Promise<void> {
    logger.info('Destroying all terminals', { count: this.terminals.size });
    
    const promises = Array.from(this.terminals.keys()).map(socketId => 
      this.destroyTerminal(socketId)
    );
    
    await Promise.allSettled(promises);
    
    logger.info('All terminals destroyed');
  }

  private cleanupInactiveTerminals(): void {
    const now = new Date();
    const maxInactiveTime = 30 * 60 * 1000; // 30 minutes
    
    for (const [socketId, session] of this.terminals.entries()) {
      const inactiveTime = now.getTime() - session.lastActivity.getTime();
      
      if (inactiveTime > maxInactiveTime) {
        logger.info('Cleaning up inactive terminal', {
          socketId,
          userId: session.userId,
          inactiveTime: Math.floor(inactiveTime / 1000 / 60) + ' minutes'
        });
        
        this.destroyTerminal(socketId).catch(error => {
          logger.error('Failed to cleanup inactive terminal', {
            socketId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        });
      }
    }
  }

  private sanitizeCustomEnv(customEnv?: Record<string, string>): Record<string, string> {
    if (!customEnv) {
      return {};
    }

    const sanitized: Record<string, string> = {};
    
    // Only allow safe environment variables
    const allowedVars = ['TERM', 'LANG', 'LC_ALL', 'EDITOR', 'PAGER'];
    
    for (const [key, value] of Object.entries(customEnv)) {
      if (allowedVars.includes(key) && typeof value === 'string') {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.destroyAllTerminals();
  }
}