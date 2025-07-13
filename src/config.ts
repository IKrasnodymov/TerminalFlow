import dotenv from 'dotenv';

dotenv.config();

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  // Server configuration
  port: parseInt(getOptionalEnv('PORT', '3000'), 10),
  nodeEnv: getOptionalEnv('NODE_ENV', 'development'),
  
  // Security configuration
  jwtSecret: getRequiredEnv('JWT_SECRET'),
  accessPassword: getRequiredEnv('ACCESS_PASSWORD'),
  
  // Rate limiting configuration
  maxAttempts: parseInt(getOptionalEnv('MAX_LOGIN_ATTEMPTS', '5'), 10),
  lockoutTime: parseInt(getOptionalEnv('LOCKOUT_TIME_MINUTES', '15'), 10) * 60 * 1000,
  
  // JWT configuration
  jwtExpiresIn: getOptionalEnv('JWT_EXPIRES_IN', '24h'),
  
  // Terminal configuration
  maxTerminalCols: parseInt(getOptionalEnv('MAX_TERMINAL_COLS', '300'), 10),
  maxTerminalRows: parseInt(getOptionalEnv('MAX_TERMINAL_ROWS', '100'), 10),
  
  // Logging configuration
  logLevel: getOptionalEnv('LOG_LEVEL', 'info'),
  logConnections: getOptionalEnv('LOG_CONNECTIONS', 'false') === 'true',
  
  // CORS configuration
  corsOrigin: process.env.NODE_ENV === 'production' 
    ? (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : false)
    : '*',
  
  // Email configuration
  emailUser: getRequiredEnv('EMAIL_USER'),
  emailPassword: getRequiredEnv('EMAIL_PASSWORD'),
  notificationEmail: getRequiredEnv('NOTIFICATION_EMAIL'),
  
  // Access code configuration
  accessCodeExpiryMinutes: parseInt(getOptionalEnv('ACCESS_CODE_EXPIRY_MINUTES', '10'), 10),
  strictIpValidation: getOptionalEnv('STRICT_IP_VALIDATION', 'false') === 'true'
};

// Validate configuration
if (config.port < 1 || config.port > 65535) {
  throw new Error('PORT must be between 1 and 65535');
}

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}

if (config.accessPassword.length < 8) {
  throw new Error('ACCESS_PASSWORD must be at least 8 characters long');
}

// Log configuration in development
if (config.nodeEnv === 'development') {
  console.log('Configuration loaded:', {
    port: config.port,
    nodeEnv: config.nodeEnv,
    maxAttempts: config.maxAttempts,
    lockoutTime: config.lockoutTime,
    corsOrigin: config.corsOrigin
  });
}