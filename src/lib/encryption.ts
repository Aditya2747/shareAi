import * as nacl from 'tweetnacl';
import { randomBytes } from 'crypto';
import * as utils from 'tweetnacl-util';

let keyBuffer: Buffer | null = null;

function getKeyBuffer(): Buffer {
  if (keyBuffer) return keyBuffer;

  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
  if (!ENCRYPTION_KEY) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required (not present in process.env)'
    );
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(ENCRYPTION_KEY, 'base64');
  } catch (err) {
    throw new Error(
      `ENCRYPTION_KEY is not valid base64 (error: ${err instanceof Error ? err.message : 'unknown'})`
    );
  }

  if (decoded.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes. Got ENCRYPTION_KEY length=${ENCRYPTION_KEY.length} chars, decodedBytes=${decoded.length}.`
    );
  }

  keyBuffer = decoded;
  return keyBuffer;
}

export function encryptToken(token: string): string {
  const key = getKeyBuffer();
  const nonce = randomBytes(24);
  const message = new Uint8Array(Buffer.from(token, 'utf-8'));
  const ciphertext = nacl.secretbox(
    message,
    new Uint8Array(nonce),
    new Uint8Array(key)
  );

  const combined = Buffer.concat([nonce, Buffer.from(ciphertext)]);
  return utils.encodeBase64(combined);
}

export function decryptToken(encryptedToken: string): string {
  try {
    const key = getKeyBuffer();
    const combined = Buffer.from(utils.decodeBase64(encryptedToken));
    const nonce = new Uint8Array(combined.subarray(0, 24));
    const ciphertext = new Uint8Array(combined.subarray(24));

    const decrypted = nacl.secretbox.open(
      ciphertext,
      nonce,
      new Uint8Array(key)
    );

    if (!decrypted) {
      throw new Error('Decryption failed: unable to open sealed box');
    }

    return Buffer.from(decrypted).toString('utf-8');
  } catch (error) {
    throw new Error(
      `Token decryption error: ${error instanceof Error ? error.message : 'unknown'}`
    );
  }
}
