import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ECHOWAVE_API_VERSION, HealthResponseSchema } from '../dist/index.js';

describe('HealthResponseSchema', () => {
  const response = {
    name: 'EchoWave',
    service: 'echowave-api',
    version: '0.1.0',
    apiVersion: ECHOWAVE_API_VERSION,
    status: 'ok',
    capabilities: { remotePush: false },
  };

  it('accepts the public self-hosted health response', () => {
    assert.deepEqual(HealthResponseSchema.parse(response), response);
  });

  it('rejects incompatible services and API versions', () => {
    assert.equal(
      HealthResponseSchema.safeParse({ ...response, service: 'other-api' }).success,
      false,
    );
    assert.equal(HealthResponseSchema.safeParse({ ...response, apiVersion: 2 }).success, false);
  });
});
