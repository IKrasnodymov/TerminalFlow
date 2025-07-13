import { config } from '../config';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
  error?: string;
}

class Logger {
  private logLevel: LogLevel;

  constructor() {
    this.logLevel = config.logLevel as LogLevel || 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };

    return levels[level] <= levels[this.logLevel];
  }

  private formatLog(level: LogLevel, message: string, data?: any): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message
    };

    if (data) {
      if (data instanceof Error) {
        entry.error = data.message;
        entry.data = {
          name: data.name,
          stack: data.stack
        };
      } else {
        entry.data = this.sanitizeLogData(data);
      }
    }

    return entry;
  }

  private sanitizeLogData(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const sanitized: any = {};
    
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      
      // Skip sensitive data
      if (lowerKey.includes('password') || 
          lowerKey.includes('secret') || 
          lowerKey.includes('token') ||
          lowerKey.includes('key')) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  private output(entry: LogEntry): void {
    if (config.nodeEnv === 'production') {
      // In production, output JSON for structured logging
      console.log(JSON.stringify(entry));
    } else {
      // In development, output human-readable format
      const { timestamp, level, message, data, error } = entry;
      const prefix = `[${timestamp}] ${level.toUpperCase()}:`;
      
      if (error) {
        console.log(`${prefix} ${message} - Error: ${error}`);
        if (data && data.stack) {
          console.log(data.stack);
        }
      } else if (data) {
        console.log(`${prefix} ${message}`, data);
      } else {
        console.log(`${prefix} ${message}`);
      }
    }
  }

  error(message: string, data?: any): void {
    if (this.shouldLog('error')) {
      this.output(this.formatLog('error', message, data));
    }
  }

  warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      this.output(this.formatLog('warn', message, data));
    }
  }

  info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      this.output(this.formatLog('info', message, data));
    }
  }

  debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      this.output(this.formatLog('debug', message, data));
    }
  }
}

export const logger = new Logger();