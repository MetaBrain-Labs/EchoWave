import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatServerStartError } from '../../dist/bootstrap/serverError.js';

describe('API listener errors', () => {
  it('explains how to resolve an occupied port', () => {
    const error = Object.assign(new Error('listen failed'), {
      code: 'EADDRINUSE',
    });

    assert.equal(
      formatServerStartError(error, 3101),
      'EchoWave API could not start: port 3101 is already in use. Stop the existing process or change PORT in apps/api/.env.',
    );
  });
});

