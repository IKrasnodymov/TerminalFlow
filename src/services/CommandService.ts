import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface Command {
  id: string;
  cmd: string;
  desc: string;
  userId?: string;
  createdAt: number;
  updatedAt: number;
}

export class CommandService {
  private dataFile: string;
  private commands: Map<string, Command[]> = new Map();

  constructor() {
    this.dataFile = path.join(process.cwd(), 'data', 'commands.json');
    this.loadCommands();
  }

  private async ensureDataDir(): Promise<void> {
    const dataDir = path.dirname(this.dataFile);
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create data directory', { error });
    }
  }

  private async loadCommands(): Promise<void> {
    try {
      await this.ensureDataDir();
      const data = await fs.readFile(this.dataFile, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Convert to Map structure
      Object.entries(parsed).forEach(([userId, commands]) => {
        this.commands.set(userId, commands as Command[]);
      });
      
      logger.info('Commands loaded successfully');
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        logger.error('Failed to load commands', { error });
      }
      // Initialize with empty data
      this.commands = new Map();
    }
  }

  private async saveCommands(): Promise<void> {
    try {
      await this.ensureDataDir();
      
      // Convert Map to object for JSON serialization
      const data: Record<string, Command[]> = {};
      this.commands.forEach((commands, userId) => {
        data[userId] = commands;
      });
      
      await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
      logger.debug('Commands saved successfully');
    } catch (error) {
      logger.error('Failed to save commands', { error });
      throw error;
    }
  }

  private getDefaultCommands(): Command[] {
    const now = Date.now();
    return [
      { id: 'default-1', cmd: 'ls -la', desc: 'List all files', userId: 'default', createdAt: now, updatedAt: now },
      { id: 'default-2', cmd: 'pwd', desc: 'Current directory', userId: 'default', createdAt: now, updatedAt: now },
      { id: 'default-3', cmd: 'git status', desc: 'Git status', userId: 'default', createdAt: now, updatedAt: now },
      { id: 'default-4', cmd: 'git log --oneline -10', desc: 'Recent commits', userId: 'default', createdAt: now, updatedAt: now },
      { id: 'default-5', cmd: 'npm run dev', desc: 'Start dev server', userId: 'default', createdAt: now, updatedAt: now },
      { id: 'default-6', cmd: 'npm test', desc: 'Run tests', userId: 'default', createdAt: now, updatedAt: now },
      { id: 'default-7', cmd: 'clear', desc: 'Clear terminal', userId: 'default', createdAt: now, updatedAt: now }
    ];
  }

  async getCommands(userId: string): Promise<Command[]> {
    let userCommands = this.commands.get(userId);
    
    // Initialize with default commands if user has no commands
    if (!userCommands || userCommands.length === 0) {
      userCommands = this.getDefaultCommands().map(cmd => ({
        ...cmd,
        userId,
        id: cmd.id.replace('default-', `${userId}-`)
      }));
      this.commands.set(userId, userCommands);
      await this.saveCommands();
    }
    
    return userCommands;
  }

  async addCommand(userId: string, cmd: string, desc: string): Promise<Command> {
    const userCommands = this.commands.get(userId) || [];
    
    const newCommand: Command = {
      id: `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      cmd,
      desc,
      userId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    userCommands.push(newCommand);
    this.commands.set(userId, userCommands);
    
    await this.saveCommands();
    return newCommand;
  }

  async updateCommand(userId: string, commandId: string, cmd: string, desc: string): Promise<Command | null> {
    const userCommands = this.commands.get(userId) || [];
    const index = userCommands.findIndex(c => c.id === commandId);
    
    if (index === -1) {
      return null;
    }
    
    userCommands[index] = {
      ...userCommands[index],
      cmd,
      desc,
      updatedAt: Date.now()
    };
    
    this.commands.set(userId, userCommands);
    await this.saveCommands();
    
    return userCommands[index];
  }

  async deleteCommand(userId: string, commandId: string): Promise<boolean> {
    const userCommands = this.commands.get(userId) || [];
    const filtered = userCommands.filter(c => c.id !== commandId);
    
    if (filtered.length === userCommands.length) {
      return false; // Command not found
    }
    
    this.commands.set(userId, filtered);
    await this.saveCommands();
    
    return true;
  }
}

// Singleton instance
export const commandService = new CommandService();