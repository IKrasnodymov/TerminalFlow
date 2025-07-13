import { config } from '../config';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export function validateTerminalDimensions(cols: any, rows: any): TerminalDimensions {
  // Convert to numbers
  const colsNum = Number(cols);
  const rowsNum = Number(rows);
  
  // Check if they are valid numbers
  if (!Number.isInteger(colsNum) || !Number.isInteger(rowsNum)) {
    throw new ValidationError('Terminal dimensions must be integers');
  }
  
  // Check bounds
  if (colsNum < 1 || colsNum > config.maxTerminalCols) {
    throw new ValidationError(`Columns must be between 1 and ${config.maxTerminalCols}`);
  }
  
  if (rowsNum < 1 || rowsNum > config.maxTerminalRows) {
    throw new ValidationError(`Rows must be between 1 and ${config.maxTerminalRows}`);
  }
  
  return { cols: colsNum, rows: rowsNum };
}

export function validateTerminalData(data: any): string {
  if (typeof data !== 'string') {
    throw new ValidationError('Terminal data must be a string');
  }
  
  // Limit data size to prevent DoS
  if (data.length > 10000) {
    throw new ValidationError('Terminal data too large');
  }
  
  return data;
}

export function validatePassword(password: any): string {
  if (typeof password !== 'string') {
    throw new ValidationError('Password must be a string');
  }
  
  if (password.length === 0) {
    throw new ValidationError('Password cannot be empty');
  }
  
  if (password.length > 1000) {
    throw new ValidationError('Password too long');
  }
  
  return password;
}

export function sanitizeForHTML(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function validateCommandName(name: any): string {
  if (typeof name !== 'string') {
    throw new ValidationError('Command name must be a string');
  }
  
  if (name.length > 50) {
    throw new ValidationError('Command name too long');
  }
  
  return name.trim();
}

export function validateCommand(command: any): string {
  if (typeof command !== 'string') {
    throw new ValidationError('Command must be a string');
  }
  
  if (command.length === 0) {
    throw new ValidationError('Command cannot be empty');
  }
  
  if (command.length > 1000) {
    throw new ValidationError('Command too long');
  }
  
  return command.trim();
}