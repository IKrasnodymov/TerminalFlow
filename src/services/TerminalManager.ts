import * as pty from 'node-pty';
import { TerminalSession, TerminalOptions } from '../types';
import { createSafeEnvironment, getDefaultShell, getDefaultWorkingDirectory } from '../utils/environment';
import { validateTerminalDimensions, ValidationError } from '../utils/validation';
import { logger } from '../utils/logger';

export class TerminalManager {
  private terminals = new Map<string, TerminalSession>();
  private sessionsByUserId = new Map<string, string>(); // userId -> sessionId mapping
  private readonly cleanupInterval: NodeJS.Timeout;
  private readonly SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

  constructor() {
    // Clean up inactive terminals every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveTerminals();
    }, 60 * 1000);
  }
  
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async createOrReuseTerminal(
    socketId: string, 
    userId: string, 
    sessionId?: string,
    options: Partial<TerminalOptions> = {}
  ): Promise<{ session: TerminalSession; sessionId: string; isNew: boolean }> {
    try {
      // Check if user has an existing session
      const existingSessionId = sessionId || this.sessionsByUserId.get(userId);
      
      if (existingSessionId) {
        // Try to find existing terminal session
        for (const [terminalId, session] of this.terminals.entries()) {
          if ((session as any).sessionId === existingSessionId && session.userId === userId) {
            // Found existing session, update socket ID
            logger.info('Reusing existing terminal session', {
              sessionId: existingSessionId,
              oldSocketId: terminalId,
              newSocketId: socketId,
              userId
            });
            
            // Move session to new socket ID
            this.terminals.delete(terminalId);
            (session as any).socketId = socketId;
            session.lastActivity = new Date();
            this.terminals.set(socketId, session);
            
            // Resize if needed
            if (options.cols && options.rows) {
              const { cols, rows } = validateTerminalDimensions(options.cols, options.rows);
              session.pty.resize(cols, rows);
            }
            
            return { session, sessionId: existingSessionId, isNew: false };
          }
        }
      }
      
      // No existing session found, create new one
      return await this.createTerminal(socketId, userId, options);
    } catch (error) {
      logger.error('Failed to create or reuse terminal', {
        socketId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async createTerminal(
    socketId: string, 
    userId: string, 
    options: Partial<TerminalOptions> = {}
  ): Promise<{ session: TerminalSession; sessionId: string; isNew: boolean }> {
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

      const sessionId = this.generateSessionId();
      const session: TerminalSession = {
        pty: terminal,
        userId,
        createdAt: new Date(),
        lastActivity: new Date()
      };
      
      // Add session ID to the session object
      (session as any).sessionId = sessionId;
      (session as any).socketId = socketId;

      this.terminals.set(socketId, session);
      this.sessionsByUserId.set(userId, sessionId);

      logger.info('Terminal created successfully', {
        socketId,
        sessionId,
        userId,
        pid: terminal.pid
      });

      return { session, sessionId, isNew: true };
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

  async disconnectTerminal(socketId: string): Promise<void> {
    const session = this.terminals.get(socketId);
    if (!session) {
      return;
    }

    // Mark as disconnected but don't destroy immediately
    logger.info('Disconnecting terminal (keeping alive for reconnection)', {
      socketId,
      sessionId: (session as any).sessionId,
      userId: session.userId
    });

    // Update last activity
    session.lastActivity = new Date();
    
    // Clear socket ID to mark as disconnected
    (session as any).socketId = undefined;
  }

  async destroyTerminal(socketId: string, force: boolean = false): Promise<void> {
    const session = this.terminals.get(socketId);
    if (!session) {
      return;
    }

    // If not forcing and session has a sessionId, just disconnect
    if (!force && (session as any).sessionId) {
      return this.disconnectTerminal(socketId);
    }

    try {
      logger.info('Destroying terminal', {
        socketId,
        sessionId: (session as any).sessionId,
        userId: session.userId,
        pid: session.pty.pid
      });

      // Kill the PTY process
      session.pty.kill();
      
      // Remove from maps
      this.terminals.delete(socketId);
      
      // Remove user session mapping if this was the active session
      const sessionId = (session as any).sessionId;
      if (sessionId && this.sessionsByUserId.get(session.userId) === sessionId) {
        this.sessionsByUserId.delete(session.userId);
      }

      logger.info('Terminal destroyed successfully', {
        socketId,
        sessionId,
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
    
    for (const [socketId, session] of this.terminals.entries()) {
      const inactiveTime = now.getTime() - session.lastActivity.getTime();
      const isDisconnected = !(session as any).socketId;
      
      // Only cleanup disconnected sessions after timeout
      if (isDisconnected && inactiveTime > this.SESSION_TIMEOUT) {
        logger.info('Cleaning up inactive terminal session', {
          socketId,
          sessionId: (session as any).sessionId,
          userId: session.userId,
          inactiveTime: Math.floor(inactiveTime / 1000 / 60) + ' minutes'
        });
        
        this.destroyTerminal(socketId, true).catch(error => {
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
    const allowedVars = ['TERM', 'LANG', 'LC_ALL', 'EDITOR', 'PAGER', 'NO_COLOR', 'FORCE_COLOR', 'CI', 'DEBIAN_FRONTEND', 'NO_TTY', 'NONINTERACTIVE', 'CLAUDE_CLI_DISABLE_FANCY_UI', 'CLAUDE_CLI_SIMPLE_MODE'];
    
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