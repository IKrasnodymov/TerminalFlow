import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import jwt from 'jsonwebtoken';

import { config } from './config';
import { logger } from './utils/logger';
import { setupTerminalHandlers } from './terminalHandler';
import { authMiddleware } from './middleware/auth';
import { errorHandler, notFoundHandler, asyncHandler } from './middleware/errorHandler';
import { rateLimiter, recordFailedAttempt, clearFailedAttempts } from './utils/security';
import { validatePassword } from './utils/validation';
import { AuthRequest, AuthResponse, HealthResponse, JWTPayload } from './types';
import { ResendEmailService } from './services/ResendEmailService';
import { AccessCodeService } from './services/AccessCodeService';

const app = express();
const httpServer = createServer(app);

// Configure Socket.IO with proper CORS
const io = new Server(httpServer, {
  cors: {
    origin: config.corsOrigin,
    credentials: true
  }
});

// Trust proxy if behind reverse proxy
if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(cors({
  origin: config.corsOrigin,
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint
app.get('/health', asyncHandler(async (req, res) => {
  const response: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv
  };
  
  res.json(response);
}));

// Token validation endpoint
app.post('/auth/validate-token', asyncHandler(async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ 
      error: 'Token is required',
      valid: false 
    });
  }
  
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JWTPayload;
    res.json({ 
      valid: true, 
      decoded: {
        ip: decoded.ip,
        exp: decoded.exp,
        iat: decoded.iat
      }
    });
  } catch (error) {
    logger.warn('Invalid token validation attempt', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      ip: req.ip 
    });
    res.status(401).json({ 
      error: 'Invalid or expired token',
      valid: false 
    });
  }
}));

// Email access code request endpoint
app.post('/auth/request-code', rateLimiter.middleware, asyncHandler(async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.get('User-Agent');
  
  try {
    const emailService = ResendEmailService.getInstance();
    const accessCodeService = AccessCodeService.getInstance();
    
    // Генерируем код доступа
    const accessCode = await accessCodeService.createAccessCode(
      config.notificationEmail,
      ip,
      userAgent
    );
    
    // Отправляем код на email
    await emailService.sendAccessCode(
      config.notificationEmail,
      accessCode,
      userAgent,
      ip
    );
    
    logger.info('Access code requested and sent', {
      ip,
      userAgent: userAgent?.substring(0, 50)
    });
    
    res.json({ 
      message: 'Код доступа отправлен на ваш email',
      email: config.notificationEmail.replace(/(.{2}).*(@.*)/, '$1****$2') // Маскируем email
    });
    
  } catch (error) {
    logger.error('Failed to send access code', {
      ip,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    res.status(500).json({
      error: 'Не удалось отправить код доступа',
      code: 'EMAIL_SEND_FAILED'
    });
  }
}));

// Authentication endpoint with access code
app.post('/auth/token', rateLimiter.middleware, asyncHandler(async (req, res) => {
  const { accessCode } = req.body;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  if (!accessCode) {
    recordFailedAttempt(ip);
    return res.status(400).json({ 
      error: 'Код доступа обязателен',
      code: 'ACCESS_CODE_REQUIRED'
    });
  }
  
  try {
    const accessCodeService = AccessCodeService.getInstance();
    const validation = accessCodeService.validateAccessCode(accessCode, ip);
    
    if (!validation.isValid) {
      recordFailedAttempt(ip);
      
      logger.warn('Invalid access code attempt', {
        ip,
        reason: validation.reason,
        userAgent: req.get('User-Agent'),
        remainingAttempts: rateLimiter.getRemainingAttempts(ip)
      });
      
      return res.status(401).json({ 
        error: validation.reason || 'Неверный код доступа',
        code: 'INVALID_ACCESS_CODE'
      });
    }
    
    clearFailedAttempts(ip);
    
    const payload: JWTPayload = {
      userId: 'user-' + Date.now()
    };
    
    const token = jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
    });
    
    logger.info('Successful authentication with access code', {
      ip,
      email: validation.email,
      userId: payload.userId,
      userAgent: req.get('User-Agent')
    });
    
    const response: AuthResponse = { token };
    res.json(response);
    
  } catch (error) {
    logger.error('Access code validation error', {
      ip,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    res.status(500).json({
      error: 'Ошибка при проверке кода доступа',
      code: 'VALIDATION_ERROR'
    });
  }
}));

// Rate limiting stats endpoint (for monitoring)
app.get('/admin/stats', asyncHandler(async (req, res) => {
  // Simple admin authentication - in production, use proper auth
  const adminToken = req.get('X-Admin-Token');
  if (adminToken !== config.jwtSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const stats = rateLimiter.getStats();
  res.json(stats);
}));


// Socket.IO authentication middleware
io.use(authMiddleware);

// Setup terminal handlers
setupTerminalHandlers(io);

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown handling
let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }
  
  isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown`);
  
  // Stop accepting new connections
  httpServer.close((err) => {
    if (err) {
      logger.error('Error during server shutdown', err);
      process.exit(1);
    }
    
    logger.info('HTTP server closed');
    
    // Close Socket.IO server
    io.close(() => {
      logger.info('Socket.IO server closed');
      
      // Cleanup rate limiter
      rateLimiter.destroy();
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    });
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Force shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  gracefulShutdown('unhandledRejection');
});

// Start server
httpServer.listen(config.port, async () => {
  logger.info('Server started', {
    port: config.port,
    environment: config.nodeEnv,
    nodeVersion: process.version
  });
  
  // Test email service connection
  try {
    const emailService = ResendEmailService.getInstance();
    const isConnected = await emailService.testConnection();
    if (isConnected) {
      logger.info('Email service initialized successfully');
    } else {
      logger.warn('Email service connection failed - access codes will not be sent');
    }
  } catch (error) {
    logger.error('Email service initialization error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});