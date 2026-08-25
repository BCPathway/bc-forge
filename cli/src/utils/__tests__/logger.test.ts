import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import logger, { enableDebugMode, setLogLevel, isDebugEnabled } from '../logger.js';

describe('Logger & Debug Mode Setup (#687)', () => {
  beforeEach(() => {
    // Reset log level
    enableDebugMode(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should expose standard logging functions (info, success, warn, error, debug)', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.success).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('should toggle debug mode correctly with enableDebugMode', () => {
    expect(isDebugEnabled()).toBe(false);

    enableDebugMode(true);
    expect(isDebugEnabled()).toBe(true);

    enableDebugMode(false);
    expect(isDebugEnabled()).toBe(false);
  });

  it('should set custom log level using setLogLevel', () => {
    setLogLevel('verbose');
    expect(isDebugEnabled()).toBe(true);

    setLogLevel('error');
    expect(isDebugEnabled()).toBe(false);
  });

  it('should format logs with chalk colors without throwing errors', () => {
    expect(() => {
      logger.info('Test info message');
      logger.success('Test success message');
      logger.warn('Test warning message');
      logger.error('Test error message');
      logger.debug('Test debug message');
    }).not.toThrow();
  });
});
