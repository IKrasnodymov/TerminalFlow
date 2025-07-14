import os from 'os';

// List of sensitive environment variables to exclude from PTY
const SENSITIVE_VARS = [
  'JWT_SECRET',
  'ACCESS_PASSWORD',
  'API_KEY',
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'PRIVATE_KEY',
  'CERT',
  'KEY',
  'DATABASE_URL',
  'MONGODB_URI',
  'REDIS_URL',
  'SESSION_SECRET'
];

// List of safe environment variables to always include
const SAFE_VARS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'PWD',
  'TMPDIR',
  'EDITOR',
  'PAGER'
];

export function createSafeEnvironment(): Record<string, string> {
  const safeEnv: Record<string, string> = {};
  
  // First, add all safe variables
  for (const varName of SAFE_VARS) {
    const value = process.env[varName];
    if (value) {
      safeEnv[varName] = value;
    }
  }
  
  // Then, add other variables that don't contain sensitive patterns
  for (const [key, value] of Object.entries(process.env)) {
    if (value && !isSensitiveVariable(key) && !safeEnv[key]) {
      safeEnv[key] = value;
    }
  }
  
  // Ensure minimum required environment
  if (!safeEnv.PATH) {
    safeEnv.PATH = '/usr/local/bin:/usr/bin:/bin';
  }
  
  if (!safeEnv.HOME) {
    safeEnv.HOME = os.homedir();
  }
  
  if (!safeEnv.SHELL) {
    safeEnv.SHELL = os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash';
  }
  
  if (!safeEnv.TERM) {
    safeEnv.TERM = 'xterm-color';
  }
  
  return safeEnv;
}

function isSensitiveVariable(varName: string): boolean {
  const upperName = varName.toUpperCase();
  
  // Check exact matches
  if (SENSITIVE_VARS.includes(upperName)) {
    return true;
  }
  
  // Check patterns
  for (const pattern of SENSITIVE_VARS) {
    if (upperName.includes(pattern)) {
      return true;
    }
  }
  
  // Check for patterns like VAR_SECRET, SECRET_VAR, etc.
  if (upperName.includes('SECRET') || 
      upperName.includes('PASSWORD') || 
      upperName.includes('TOKEN') || 
      upperName.includes('KEY')) {
    return true;
  }
  
  return false;
}

export function getDefaultShell(): string {
  if (os.platform() === 'win32') {
    return 'powershell.exe';
  }
  
  return process.env.SHELL || '/bin/bash';
}

export function getDefaultWorkingDirectory(): string {
  // Use the current working directory of the Node.js process (project directory)
  return process.cwd();
}