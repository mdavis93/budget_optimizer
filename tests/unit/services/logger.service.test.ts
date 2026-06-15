import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../electron/services/logger.service';

describe('logger.service', () => {
  beforeEach(() => {
    logger.setLevel('info');
    logger.setPrefix('');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs info and suppresses debug at default level', () => {
    logger.debug('hidden');
    logger.info('visible');

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/\[INFO\].*visible/));
  });

  it('logs debug when level is debug', () => {
    logger.setLevel('debug');
    logger.debug('trace', { nested: { password: 'secret' } });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[DEBUG\].*trace/),
      { nested: { password: '[REDACTED]' } }
    );
  });

  it('logs warn and error at appropriate levels', () => {
    logger.setLevel('warn');
    logger.info('hidden');
    logger.warn('careful');
    logger.error('broken', 'token-value');

    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/\[WARN\].*careful/));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/\[ERROR\].*broken/),
      'token-value'
    );
  });

  it('redacts sensitive keys in nested arrays and objects', () => {
    logger.setLevel('debug');
    logger.debug('payload', {
      apiKey: 'abc',
      items: [{ secretCode: '123' }, 'plain'],
      token: 'xyz',
    });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[DEBUG\].*payload/),
      {
        apiKey: '[REDACTED]',
        items: [{ secretCode: '[REDACTED]' }, 'plain'],
        token: '[REDACTED]',
      }
    );
  });

  it('creates child loggers with chained prefixes', () => {
    logger.setPrefix('ROOT');
    const child = logger.createChild('CHILD');
    child.setLevel('info');
    child.info('nested message');

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[INFO\] \[ROOT:CHILD\] nested message/)
    );
  });
});
