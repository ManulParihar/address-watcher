import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SignatureError, verifySignature } from '../src/alchemy/signature.js';

const body = Buffer.from('{"type":"ADDRESS_ACTIVITY"}');
const sign = (key: string) => createHmac('sha256', key).update(body).digest('hex');

describe('verifySignature', () => {
  it('accepts the HMAC of the raw body', () => {
    expect(() => verifySignature(body, sign('key'), 'key')).not.toThrow();
  });

  it('rejects a signature made with another key, a malformed one, or none', () => {
    expect(() => verifySignature(body, sign('other'), 'key')).toThrow(SignatureError);
    expect(() => verifySignature(body, 'zz', 'key')).toThrow(SignatureError);
    expect(() => verifySignature(body, undefined, 'key')).toThrow(SignatureError);
  });
});
