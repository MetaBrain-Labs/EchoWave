import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLoggingConfig, LoggingEnvironmentSchema } from '../../dist/config/logging.js';

describe('logging environment', () => {
  it('defaults to info and json so existing .env files keep starting', () => {
    assert.deepEqual(createLoggingConfig(LoggingEnvironmentSchema.parse({})), {
      level: 'info',
      format: 'json',
    });
  });

  it('accepts an explicit local development configuration', () => {
    assert.deepEqual(
      createLoggingConfig(
        LoggingEnvironmentSchema.parse({ LOG_LEVEL: 'debug', LOG_FORMAT: 'pretty' }),
      ),
      { level: 'debug', format: 'pretty' },
    );
  });

  it('rejects unknown levels and formats instead of silently falling back', () => {
    assert.throws(() => LoggingEnvironmentSchema.parse({ LOG_LEVEL: 'verbose' }));
    assert.throws(() => LoggingEnvironmentSchema.parse({ LOG_FORMAT: 'text' }));
  });
});
