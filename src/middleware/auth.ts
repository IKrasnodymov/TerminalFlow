import jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';
import { config } from '../config';
import { logger } from '../utils/logger';
import { JWTPayload, ClientToServerEvents, ServerToClientEvents } from '../types';

export const authMiddleware = (
  socket: Socket<ClientToServerEvents, ServerToClientEvents>, 
  next: (err?: Error) => void
) => {
  const token = socket.handshake.auth.token;
  const ip = socket.handshake.address;
  
  if (!token) {
    logger.warn('WebSocket connection attempt without token', { 
      socketId: socket.id, 
      ip 
    });
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JWTPayload;
    
    // Add user info to socket
    (socket as any).userId = decoded.userId;
    
    logger.info('WebSocket authentication successful', {
      socketId: socket.id,
      userId: decoded.userId,
      ip
    });
    
    next();
  } catch (err) {
    logger.warn('WebSocket authentication failed', {
      socketId: socket.id,
      ip,
      error: err instanceof Error ? err.message : 'Unknown error'
    });
    
    if (err instanceof jwt.TokenExpiredError) {
      next(new Error('Token expired'));
    } else if (err instanceof jwt.JsonWebTokenError) {
      next(new Error('Invalid token'));
    } else {
      next(new Error('Authentication failed'));
    }
  }
};