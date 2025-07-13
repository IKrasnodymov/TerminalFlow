import { logger } from '../utils/logger';
import { config } from '../config';

interface AccessCodeData {
  code: string;
  email: string;
  createdAt: Date;
  usedAt?: Date;
  ip: string;
  userAgent?: string;
}

export class AccessCodeService {
  private static instance: AccessCodeService;
  private activeCodes = new Map<string, AccessCodeData>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Очистка истекших кодов каждые 2 минуты
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredCodes();
    }, 2 * 60 * 1000);
  }

  static getInstance(): AccessCodeService {
    if (!AccessCodeService.instance) {
      AccessCodeService.instance = new AccessCodeService();
    }
    return AccessCodeService.instance;
  }

  generateAccessCode(): string {
    // Генерируем 6-значный код
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    return code;
  }

  async createAccessCode(email: string, ip: string, userAgent?: string): Promise<string> {
    const code = this.generateAccessCode();
    
    // Проверяем, есть ли уже активный код для этого email
    const existingCode = this.findActiveCodeByEmail(email);
    if (existingCode) {
      logger.info('Replacing existing access code for email', {
        email,
        oldCode: existingCode.substring(0, 2) + '****',
        newCode: code.substring(0, 2) + '****',
        ip
      });
      this.activeCodes.delete(existingCode);
    }

    const codeData: AccessCodeData = {
      code,
      email,
      createdAt: new Date(),
      ip,
      userAgent
    };

    this.activeCodes.set(code, codeData);

    logger.info('Access code created', {
      email,
      code: code.substring(0, 2) + '****',
      ip,
      totalActiveCodes: this.activeCodes.size
    });

    return code;
  }

  validateAccessCode(code: string, ip: string): { isValid: boolean; email?: string; reason?: string } {
    const codeData = this.activeCodes.get(code);

    if (!codeData) {
      logger.warn('Access code validation failed - code not found', {
        code: code.substring(0, 2) + '****',
        ip
      });
      return { isValid: false, reason: 'Код не найден или уже использован' };
    }

    // Проверяем, не использован ли код
    if (codeData.usedAt) {
      logger.warn('Access code validation failed - code already used', {
        code: code.substring(0, 2) + '****',
        email: codeData.email,
        usedAt: codeData.usedAt,
        ip
      });
      return { isValid: false, reason: 'Код уже был использован' };
    }

    // Проверяем время истечения (10 минут)
    const now = new Date();
    const expirationTime = new Date(codeData.createdAt.getTime() + config.accessCodeExpiryMinutes * 60 * 1000);
    
    if (now > expirationTime) {
      logger.warn('Access code validation failed - code expired', {
        code: code.substring(0, 2) + '****',
        email: codeData.email,
        createdAt: codeData.createdAt,
        expirationTime,
        ip
      });
      this.activeCodes.delete(code);
      return { isValid: false, reason: 'Код истек. Запросите новый код.' };
    }

    // Опционально: проверяем IP (можно отключить для мобильных сетей)
    if (config.strictIpValidation && codeData.ip !== ip) {
      logger.warn('Access code validation failed - IP mismatch', {
        code: code.substring(0, 2) + '****',
        email: codeData.email,
        originalIp: codeData.ip,
        currentIp: ip
      });
      return { isValid: false, reason: 'Код можно использовать только с того же IP адреса' };
    }

    // Код валиден - отмечаем как использованный
    codeData.usedAt = now;
    
    logger.info('Access code validated successfully', {
      code: code.substring(0, 2) + '****',
      email: codeData.email,
      ip
    });

    return { isValid: true, email: codeData.email };
  }

  private findActiveCodeByEmail(email: string): string | undefined {
    for (const [code, data] of this.activeCodes.entries()) {
      if (data.email === email && !data.usedAt) {
        const now = new Date();
        const expirationTime = new Date(data.createdAt.getTime() + config.accessCodeExpiryMinutes * 60 * 1000);
        
        if (now <= expirationTime) {
          return code;
        }
      }
    }
    return undefined;
  }

  private cleanupExpiredCodes(): void {
    const now = new Date();
    let cleanedCount = 0;

    for (const [code, data] of this.activeCodes.entries()) {
      const expirationTime = new Date(data.createdAt.getTime() + config.accessCodeExpiryMinutes * 60 * 1000);
      
      if (now > expirationTime) {
        this.activeCodes.delete(code);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cleaned up expired access codes', {
        cleanedCount,
        remainingCodes: this.activeCodes.size
      });
    }
  }

  getStats(): { totalCodes: number; activeCodes: number; usedCodes: number } {
    let activeCodes = 0;
    let usedCodes = 0;
    const now = new Date();

    for (const [, data] of this.activeCodes.entries()) {
      const expirationTime = new Date(data.createdAt.getTime() + config.accessCodeExpiryMinutes * 60 * 1000);
      
      if (data.usedAt) {
        usedCodes++;
      } else if (now <= expirationTime) {
        activeCodes++;
      }
    }

    return {
      totalCodes: this.activeCodes.size,
      activeCodes,
      usedCodes
    };
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.activeCodes.clear();
  }
}