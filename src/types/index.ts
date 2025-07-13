import { Socket } from 'socket.io';
import { IPty } from 'node-pty';

// Authentication interfaces
export interface AuthenticatedSocket extends Socket {
  userId: string;
}

export interface AuthRequest {
  password: string;
}

export interface AuthResponse {
  token: string;
}

export interface JWTPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

// Terminal interfaces
export interface TerminalSession {
  pty: IPty;
  userId: string;
  createdAt: Date;
  lastActivity: Date;
}

export interface TerminalOptions {
  cols: number;
  rows: number;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface TerminalCreateEvent {
  cols?: number;
  rows?: number;
}

export interface TerminalResizeEvent {
  cols: number;
  rows: number;
}

export interface TerminalDataEvent {
  data: string;
}

// Rate limiting interfaces
export interface RateLimitRecord {
  count: number;
  firstAttempt: number;
  lastAttempt: number;
}

export interface SecurityConfig {
  maxAttempts: number;
  lockoutTime: number;
}

// Error interfaces
export interface ApiError {
  error: string;
  code?: string;
  details?: any;
}

// Health check interface
export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime?: number;
  version?: string;
  environment?: string;
}

// Command interfaces (for frontend)
export interface QuickCommand {
  id: number;
  name: string;
  command: string;
  createdAt?: Date;
}

// Server events
export type ServerToClientEvents = {
  'terminal:ready': () => void;
  'terminal:data': (data: string) => void;
  'terminal:exit': () => void;
  'terminal:error': (error: string) => void;
};

export type ClientToServerEvents = {
  'terminal:create': (options?: TerminalCreateEvent) => void;
  'terminal:data': (data: string) => void;
  'terminal:resize': (options: TerminalResizeEvent) => void;
};

// Socket.IO types
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
export type AuthenticatedTypedSocket = Socket<ClientToServerEvents, ServerToClientEvents> & {
  userId: string;
};