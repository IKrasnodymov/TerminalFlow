import * as pty from 'node-pty';
import { TerminalSession, TerminalOptions } from '../types';
import { createSafeEnvironment, getDefaultShell, getDefaultWorkingDirectory } from '../utils/environment';
import { validateTerminalDimensions, ValidationError } from '../utils/validation';
import { logger } from '../utils/logger';

export class TerminalManager {
  private terminals = new Map<string, TerminalSession>(); // key: userId-terminalId
  private socketTerminals = new Map<string, Set<string>>(); // socketId -> Set of terminal keys
  private sessionsByUserId = new Map<string, Map<string, string>>(); // userId -> Map<terminalId, sessionId>
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
    clientTerminalId: string,
    sessionId?: string,
    options: Partial<TerminalOptions> = {}
  ): Promise<{ session: TerminalSession; sessionId: string; isNew: boolean }> {
    try {
      // Get user's terminal sessions map
      let userSessions = this.sessionsByUserId.get(userId);
      if (!userSessions) {
        userSessions = new Map<string, string>();
        this.sessionsByUserId.set(userId, userSessions);
      }
      
      // Check if user has an existing session for this terminalId
      const existingSessionId = sessionId || userSessions.get(clientTerminalId);
      
      if (existingSessionId) {
        // Try to find existing terminal session
        for (const [terminalKey, session] of this.terminals.entries()) {
          if ((session as any).sessionId === existingSessionId && 
              session.userId === userId &&
              (session as any).clientTerminalId === clientTerminalId) {
            // Found existing session, update socket ID
            logger.info('Reusing existing terminal session', {
              sessionId: existingSessionId,
              clientTerminalId,
              oldSocketId: terminalKey,
              newSocketId: socketId,
              userId
            });
            
            // Update socket mapping
            const oldSocketId = (session as any).socketId;
            if (oldSocketId && this.socketTerminals.has(oldSocketId)) {
              const socketKeys = this.socketTerminals.get(oldSocketId)!;
              socketKeys.delete(terminalKey);
              if (socketKeys.size === 0) {
                this.socketTerminals.delete(oldSocketId);
              }
            }
            
            // Update session with new socket
            (session as any).socketId = socketId;
            session.lastActivity = new Date();
            
            // Add to new socket mapping
            if (!this.socketTerminals.has(socketId)) {
              this.socketTerminals.set(socketId, new Set());
            }
            this.socketTerminals.get(socketId)!.add(terminalKey);
            
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
      return await this.createTerminal(socketId, userId, clientTerminalId, options);
    } catch (error) {
      logger.error('Failed to create or reuse terminal', {
        socketId,
        userId,
        clientTerminalId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async createTerminal(
    socketId: string, 
    userId: string,
    clientTerminalId: string,
    options: Partial<TerminalOptions> = {}
  ): Promise<{ session: TerminalSession; sessionId: string; isNew: boolean }> {
    try {
      // Validate dimensions
      const { cols, rows } = validateTerminalDimensions(
        options.cols || 80, 
        options.rows || 24
      );

      // Generate terminal key
      const terminalKey = `${userId}-${clientTerminalId}`;

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
        lastActivity: new Date(),
        currentDirectory: cwd
      };
      
      // Set initial directory explicitly
      logger.debug('Setting initial directory for terminal', {
        terminalKey: `${userId}-${clientTerminalId}`,
        cwd
      });
      
      // Add session ID and terminal ID to the session object
      (session as any).sessionId = sessionId;
      (session as any).socketId = socketId;
      (session as any).clientTerminalId = clientTerminalId;

      // Store terminal with unique key
      this.terminals.set(terminalKey, session);
      
      // Update socket mapping
      if (!this.socketTerminals.has(socketId)) {
        this.socketTerminals.set(socketId, new Set());
      }
      this.socketTerminals.get(socketId)!.add(terminalKey);
      
      // Update user sessions map
      let userSessions = this.sessionsByUserId.get(userId);
      if (!userSessions) {
        userSessions = new Map<string, string>();
        this.sessionsByUserId.set(userId, userSessions);
      }
      userSessions.set(clientTerminalId, sessionId);

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

  getTerminalByKey(terminalKey: string): TerminalSession | undefined {
    const session = this.terminals.get(terminalKey);
    if (session) {
      session.lastActivity = new Date();
    }
    return session;
  }
  
  getTerminal(socketId: string, clientTerminalId: string, userId: string): TerminalSession | undefined {
    const terminalKey = `${userId}-${clientTerminalId}`;
    return this.getTerminalByKey(terminalKey);
  }
  
  async getCurrentDirectory(terminalKey: string): Promise<string> {
    const session = this.getTerminalByKey(terminalKey);
    if (!session) {
      throw new ValidationError('Terminal not found');
    }
    
    return new Promise((resolve, reject) => {
      // Create a unique marker to identify our pwd response
      const marker = `__PWD_MARKER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}__`;
      const timeout = setTimeout(() => {
        if (dataListener && dataListener.dispose) {
          dataListener.dispose();
        }
        logger.debug('Timeout getting current directory, using cached or default', { terminalKey });
        // Fall back to cached directory or project directory
        resolve(session.currentDirectory || getDefaultWorkingDirectory());
      }, 1000); // Reduced timeout
      
      let buffer = '';
      let dataListener: any;
      const dataHandler = (data: string) => {
        buffer += data;
        
        // Look for our marker and the path after it
        if (buffer.includes(marker)) {
          const afterMarker = buffer.substring(buffer.indexOf(marker) + marker.length);
          const lines = afterMarker.split('\n');
          
          for (const line of lines) {
            const trimmed = line.trim();
            // Match absolute paths - be more specific
            const pathMatch = trimmed.match(/^(\/[^\s\r\n]+)/);
            if (pathMatch && pathMatch[1].length > 1) {
              clearTimeout(timeout);
              if (dataListener && dataListener.dispose) {
                dataListener.dispose();
              }
              session.currentDirectory = pathMatch[1];
              logger.debug('Got current directory from terminal', { 
                terminalKey, 
                directory: pathMatch[1] 
              });
              resolve(pathMatch[1]);
              return;
            }
          }
        }
      };
      
      dataListener = session.pty.onData(dataHandler);
      // Send pwd command with marker - use a simpler approach
      session.pty.write(`echo "${marker}"; pwd\r`);
    });
  }

  clearCurrentDirectory(terminalKey: string): void {
    const session = this.getTerminalByKey(terminalKey);
    if (session) {
      session.currentDirectory = undefined;
    }
  }

  async disconnectTerminal(socketId: string): Promise<void> {
    // Get all terminals for this socket
    const terminalKeys = this.socketTerminals.get(socketId);
    if (!terminalKeys) {
      return;
    }

    // Mark all terminals as disconnected but don't destroy immediately
    for (const terminalKey of terminalKeys) {
      const session = this.terminals.get(terminalKey);
      if (session) {
        logger.info('Disconnecting terminal (keeping alive for reconnection)', {
          socketId,
          terminalKey,
          sessionId: (session as any).sessionId,
          userId: session.userId
        });

        // Update last activity
        session.lastActivity = new Date();
        
        // Clear socket ID to mark as disconnected
        (session as any).socketId = undefined;
      }
    }
    
    // Remove socket mapping
    this.socketTerminals.delete(socketId);
  }

  async destroyTerminalByKey(terminalKey: string, force: boolean = false): Promise<void> {
    const session = this.terminals.get(terminalKey);
    if (!session) {
      return;
    }

    // If not forcing and session has a sessionId, just disconnect
    if (!force && (session as any).sessionId) {
      const socketId = (session as any).socketId;
      if (socketId) {
        return this.disconnectTerminal(socketId);
      }
    }

    try {
      const socketId = (session as any).socketId;
      logger.info('Destroying terminal', {
        terminalKey,
        socketId,
        sessionId: (session as any).sessionId,
        userId: session.userId,
        pid: session.pty.pid
      });

      // Kill the PTY process
      session.pty.kill();
      
      // Remove from terminals map
      this.terminals.delete(terminalKey);
      
      // Remove from socket mapping
      if (socketId && this.socketTerminals.has(socketId)) {
        const socketKeys = this.socketTerminals.get(socketId)!;
        socketKeys.delete(terminalKey);
        if (socketKeys.size === 0) {
          this.socketTerminals.delete(socketId);
        }
      }
      
      // Remove user session mapping
      const sessionId = (session as any).sessionId;
      const clientTerminalId = (session as any).clientTerminalId;
      if (sessionId && clientTerminalId) {
        const userSessions = this.sessionsByUserId.get(session.userId);
        if (userSessions) {
          userSessions.delete(clientTerminalId);
          if (userSessions.size === 0) {
            this.sessionsByUserId.delete(session.userId);
          }
        }
      }

      logger.info('Terminal destroyed successfully', {
        terminalKey,
        socketId,
        sessionId,
        userId: session.userId
      });
    } catch (error) {
      logger.error('Failed to destroy terminal', {
        terminalKey,
        userId: session.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async resizeTerminalByKey(terminalKey: string, cols: number, rows: number): Promise<void> {
    const session = this.getTerminalByKey(terminalKey);
    if (!session) {
      throw new ValidationError('Terminal not found');
    }

    const dimensions = validateTerminalDimensions(cols, rows);
    
    try {
      session.pty.resize(dimensions.cols, dimensions.rows);
      logger.debug('Terminal resized', {
        terminalKey,
        userId: session.userId,
        cols: dimensions.cols,
        rows: dimensions.rows
      });
    } catch (error) {
      logger.error('Failed to resize terminal', {
        terminalKey,
        userId: session.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  async writeToTerminalByKey(terminalKey: string, data: string): Promise<void> {
    const session = this.getTerminalByKey(terminalKey);
    if (!session) {
      throw new ValidationError('Terminal not found');
    }

    try {
      session.pty.write(data);
    } catch (error) {
      logger.error('Failed to write to terminal', {
        terminalKey,
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
    
    const promises = Array.from(this.terminals.keys()).map(terminalKey => 
      this.destroyTerminalByKey(terminalKey, true)
    );
    
    await Promise.allSettled(promises);
    
    logger.info('All terminals destroyed');
  }

  private cleanupInactiveTerminals(): void {
    const now = new Date();
    
    for (const [terminalKey, session] of this.terminals.entries()) {
      const inactiveTime = now.getTime() - session.lastActivity.getTime();
      const isDisconnected = !(session as any).socketId;
      
      // Only cleanup disconnected sessions after timeout
      if (isDisconnected && inactiveTime > this.SESSION_TIMEOUT) {
        logger.info('Cleaning up inactive terminal session', {
          terminalKey,
          sessionId: (session as any).sessionId,
          userId: session.userId,
          inactiveTime: Math.floor(inactiveTime / 1000 / 60) + ' minutes'
        });
        
        this.destroyTerminalByKey(terminalKey, true).catch((error: unknown) => {
          logger.error('Failed to cleanup inactive terminal', {
            terminalKey,
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