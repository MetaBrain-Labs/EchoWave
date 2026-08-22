import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HelloResponseSchema } from '../../dist/hello.js';

describe('HelloResponseSchema', () => {
  it('accepts the public HelloWorld response', () => {
    assert.deepEqual(
      HelloResponseSchema.parse({
        ok: true,
        service: 'echowave-api',
        message: 'HelloWorld',
      }),
      {
        ok: true,
        service: 'echowave-api',
        message: 'HelloWorld',
      },
    );
  });

  it('rejects missing or incompatible fields', () => {
    assert.throws(() => HelloResponseSchema.parse({ ok: true, message: 'HelloWorld' }));
    assert.throws(() =>
      HelloResponseSchema.parse({
        ok: false,
        service: 'echowave-api',
        message: 'HelloWorld',
      }),
    );
  });
});
