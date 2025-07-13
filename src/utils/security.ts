import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from './logger';
import { RateLimitRecord, ApiError } from '../types';

class RateLimiter {
  private attempts = new Map<string, RateLimitRecord>();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up old records every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);
  }

  middleware = (req: Request, res: Response, next: NextFunction): void => {
    const ip = this.getClientIP(req);
    const now = Date.now();
    
    const record = this.attempts.get(ip);
    
    if (record) {
      // Check if lockout period has expired
      if (now - record.firstAttempt > config.lockoutTime) {
        this.attempts.delete(ip);
      } else if (record.count >= config.maxAttempts) {
        const remainingTime = Math.ceil((config.lockoutTime - (now - record.firstAttempt)) / 1000 / 60);
        
        logger.warn('Rate limit exceeded', {
          ip,
          attempts: record.count,
          firstAttempt: new Date(record.firstAttempt),
          remainingMinutes: remainingTime
        });

        const error: ApiError = {
          error: `Too many attempts. Please try again in ${remainingTime} minutes.`,
          code: 'RATE_LIMIT_EXCEEDED',
          details: {
            retryAfter: remainingTime * 60
          }
        };

        res.status(429).json(error);
        return;
      }
    }
    
    next();
  };

  recordFailedAttempt(ip: string): void {
    const now = Date.now();
    const record = this.attempts.get(ip);
    
    if (record) {
      record.count++;
      record.lastAttempt = now;
    } else {
      this.attempts.set(ip, {
        count: 1,
        firstAttempt: now,
        lastAttempt: now
      });
    }

    logger.warn('Failed authentication attempt', {
      ip,
      attempts: this.attempts.get(ip)?.count
    });
  }

  clearFailedAttempts(ip: string): void {
    const record = this.attempts.get(ip);
    if (record) {
      logger.info('Clearing failed attempts for IP', {
        ip,
        previousAttempts: record.count
      });
      this.attempts.delete(ip);
    }
  }

  getRemainingAttempts(ip: string): number {
    const record = this.attempts.get(ip);
    if (!record) {
      return config.maxAttempts;
    }

    const now = Date.now();
    if (now - record.firstAttempt > config.lockoutTime) {
      this.attempts.delete(ip);
      return config.maxAttempts;
    }

    return Math.max(0, config.maxAttempts - record.count);
  }

  getStats(): { totalIPs: number; blockedIPs: number; totalAttempts: number } {
    let blockedIPs = 0;
    let totalAttempts = 0;

    for (const record of this.attempts.values()) {
      totalAttempts += record.count;
      if (record.count >= config.maxAttempts) {
        blockedIPs++;
      }
    }

    return {
      totalIPs: this.attempts.size,
      blockedIPs,
      totalAttempts
    };
  }

  private getClientIP(req: Request): string {
    // Try to get real IP from various headers (for proxy setups)
    const forwarded = req.get('X-Forwarded-For');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }

    const realIP = req.get('X-Real-IP');
    if (realIP) {
      return realIP;
    }

    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [ip, record] of this.attempts.entries()) {
      // Remove records older than lockout time
      if (now - record.lastAttempt > config.lockoutTime) {
        this.attempts.delete(ip);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up old rate limit records', { cleaned });
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.attempts.clear();
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();

// Export individual methods for backward compatibility
export function recordFailedAttempt(ip: string): void {
  rateLimiter.recordFailedAttempt(ip);
}

export function clearFailedAttempts(ip: string): void {
  rateLimiter.clearFailedAttempts(ip);
}