import winston from 'winston';
import chalk from 'chalk';

export type LogLevel = 'error' | 'warn' | 'info' | 'success' | 'debug' | 'verbose';

const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    success: 2,
    info: 3,
    debug: 4,
    verbose: 5,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    success: 'green',
    info: 'cyan',
    debug: 'magenta',
    verbose: 'gray',
  },
};

const consoleFormat = winston.format.printf(({ level, message }) => {
  switch (level) {
    case 'error':
      return chalk.red(`✗ ${message}`);
    case 'success':
      return chalk.green(`✓ ${message}`);
    case 'warn':
      return chalk.yellow(`⚠ ${message}`);
    case 'debug':
      return chalk.magenta(`[DEBUG] ${message}`);
    case 'verbose':
      return chalk.gray(`[VERBOSE] ${message}`);
    case 'info':
    default:
      return chalk.cyan(message);
  }
});

const winstonLogger = winston.createLogger({
  levels: customLevels.levels,
  level: process.env.DEBUG === 'true' || process.env.DEBUG === '1' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.splat(),
    consoleFormat
  ),
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
    }),
  ],
});

export const logger = {
  info: (message: string, ...meta: any[]) => winstonLogger.info(message, ...meta),
  success: (message: string, ...meta: any[]) => winstonLogger.log('success', message, ...meta),
  warn: (message: string, ...meta: any[]) => winstonLogger.warn(message, ...meta),
  error: (message: string, ...meta: any[]) => winstonLogger.error(message, ...meta),
  debug: (message: string, ...meta: any[]) => winstonLogger.debug(message, ...meta),
  verbose: (message: string, ...meta: any[]) => winstonLogger.verbose(message, ...meta),
  
  // Expose winston instance if needed directly
  winston: winstonLogger
};

export function setLogLevel(level: LogLevel) {
  winstonLogger.level = level;
}

export function enableDebugMode(enabled = true) {
  if (enabled) {
    winstonLogger.level = 'debug';
    logger.debug('Debug mode enabled.');
  } else {
    winstonLogger.level = 'info';
  }
}

export function isDebugEnabled(): boolean {
  return winstonLogger.level === 'debug' || winstonLogger.level === 'verbose';
}

export default logger;
