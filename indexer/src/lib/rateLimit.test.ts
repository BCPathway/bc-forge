import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  getRateLimitMax,
  getRateLimitWindowMs,
} from './rateLimit';

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const saved = {
    INDEXER_RATE_LIMIT_WINDOW_MS: process.env.INDEXER_RATE_LIMIT_WINDOW_MS,
    INDEXER_RATE_LIMIT_MAX: process.env.INDEXER_RATE_LIMIT_MAX,
  };

  for (const key of Object.keys(saved) as Array<keyof typeof saved>) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const key of Object.keys(saved) as Array<keyof typeof saved>) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('defaults to 60 requests per minute', () => {
  withEnv({ INDEXER_RATE_LIMIT_WINDOW_MS: undefined, INDEXER_RATE_LIMIT_MAX: undefined }, () => {
    assert.equal(DEFAULT_RATE_LIMIT_MAX, 60);
    assert.equal(DEFAULT_RATE_LIMIT_WINDOW_MS, 60_000);
    assert.equal(getRateLimitMax(), 60);
    assert.equal(getRateLimitWindowMs(), 60_000);
  });
});

test('reads overrides from the environment', () => {
  withEnv({ INDEXER_RATE_LIMIT_WINDOW_MS: '30000', INDEXER_RATE_LIMIT_MAX: '120' }, () => {
    assert.equal(getRateLimitMax(), 120);
    assert.equal(getRateLimitWindowMs(), 30_000);
  });
});

test('falls back to the defaults for missing or invalid values', () => {
  withEnv({ INDEXER_RATE_LIMIT_WINDOW_MS: 'not-a-number', INDEXER_RATE_LIMIT_MAX: '-5' }, () => {
    assert.equal(getRateLimitMax(), DEFAULT_RATE_LIMIT_MAX);
    assert.equal(getRateLimitWindowMs(), DEFAULT_RATE_LIMIT_WINDOW_MS);
  });

  withEnv({ INDEXER_RATE_LIMIT_WINDOW_MS: '', INDEXER_RATE_LIMIT_MAX: '0' }, () => {
    assert.equal(getRateLimitMax(), DEFAULT_RATE_LIMIT_MAX);
    assert.equal(getRateLimitWindowMs(), DEFAULT_RATE_LIMIT_WINDOW_MS);
  });
});
