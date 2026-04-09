type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  level: LogLevel;
  prefix: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'key', 'auth', 'credential', 'apikey'];

function sanitizeValue(key: string, value: unknown): unknown {
  if (typeof key === 'string') {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some(sk => lowerKey.includes(sk))) {
      return '[REDACTED]';
    }
  }
  return value;
}

function sanitizeObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => sanitizeObject(item));
  
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeValue(key, sanitizeObject(value));
    } else {
      result[key] = sanitizeValue(key, value);
    }
  }
  return result;
}

class Logger {
  private config: LoggerConfig = {
    level: 'info',
    prefix: '',
  };

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  setPrefix(prefix: string): void {
    this.config.prefix = prefix;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    const prefix = this.config.prefix ? `[${this.config.prefix}] ` : '';
    return `${timestamp} [${level.toUpperCase()}] ${prefix}${message}`;
  }

  private sanitizeArgs(args: unknown[]): unknown[] {
    return args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        return sanitizeObject(arg);
      }
      return arg;
    });
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), ...this.sanitizeArgs(args));
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message), ...this.sanitizeArgs(args));
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...this.sanitizeArgs(args));
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...this.sanitizeArgs(args));
    }
  }

  createChild(prefix: string): Logger {
    const child = new Logger();
    child.config = {
      ...this.config,
      prefix: this.config.prefix ? `${this.config.prefix}:${prefix}` : prefix,
    };
    return child;
  }
}

// Global logger instance
export const logger = new Logger();

// Pre-configured loggers for different modules
export const schedulerLogger = logger.createChild('SCHEDULER');
export const databaseLogger = logger.createChild('DATABASE');
export const authLogger = logger.createChild('AUTH');
export const ipcLogger = logger.createChild('IPC');
export const budgetLogger = logger.createChild('BUDGET');
