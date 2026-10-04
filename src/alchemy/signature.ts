import { createHmac, timingSafeEqual } from 'node:crypto';

export class SignatureError extends Error {}

/** Throws SignatureError unless `signature` is the hex HMAC-SHA256 of the raw body under `signingKey`. */
export const verifySignature = (rawBody: Buffer, signature: string | undefined, signingKey: string): void => {
  const expected = createHmac('sha256', signingKey).update(rawBody).digest();
  const given = Buffer.from(signature ?? '', 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new SignatureError('Invalid x-alchemy-signature');
  }
};
