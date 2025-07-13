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

// Authentication endpoint with improved validation
app.post('/auth/token', rateLimiter.middleware, asyncHandler(async (req, res) => {
  const { password }: AuthRequest = req.body;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  // Validate input
  const validatedPassword = validatePassword(password);
  
  if (validatedPassword !== config.accessPassword) {
    recordFailedAttempt(ip);
    
    logger.warn('Invalid authentication attempt', {
      ip,
      userAgent: req.get('User-Agent'),
      remainingAttempts: rateLimiter.getRemainingAttempts(ip)
    });
    
    return res.status(401).json({ 
      error: 'Invalid password',
      code: 'INVALID_PASSWORD'
    });
  }
  
  clearFailedAttempts(ip);
  
  const payload: JWTPayload = {
    userId: 'user-' + Date.now()
  };
  
  const token = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
  
  logger.info('Successful authentication', {
    ip,
    userId: payload.userId,
    userAgent: req.get('User-Agent')
  });
  
  const response: AuthResponse = { token };
  res.json(response);
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
httpServer.listen(config.port, () => {
  logger.info('Server started', {
    port: config.port,
    environment: config.nodeEnv,
    nodeVersion: process.version
  });
});