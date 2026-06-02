import * as nacl from 'tweetnacl';
import { randomBytes } from 'crypto';
import * as utils from 'tweetnacl-util';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY environment variable is required');
}

const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'base64');
if (keyBuffer.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be 32 bytes (base64 encoded)');
}

export function encryptToken(token: string): string {
  const nonce = randomBytes(24);
  const box = new nacl.SecretBox(keyBuffer);
  const ciphertext = box.seal(
    new Uint8Array(Buffer.from(token, 'utf-8')),
    new Uint8Array(nonce)
  );
  
  const combined = Buffer.concat([nonce, Buffer.from(ciphertext)]);
  return utils.encodeBase64(combined);
}

export function decryptToken(encryptedToken: string): string {
  try {
    const combined = Buffer.from(utils.decodeBase64(encryptedToken));
    const nonce = new Uint8Array(combined.subarray(0, 24));
    const ciphertext = new Uint8Array(combined.subarray(24));
    
    const box = new nacl.SecretBox(keyBuffer);
    const decrypted = box.open(ciphertext, nonce);
    
    if (!decrypted) {
      throw new Error('Decryption failed: unable to open sealed box');
    }
    
    return Buffer.from(decrypted).toString('utf-8');
  } catch (error) {
    throw new Error(`Token decryption error: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}
