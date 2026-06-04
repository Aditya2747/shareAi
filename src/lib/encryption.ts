import * as nacl from 'tweetnacl';
import { randomBytes } from 'crypto';
import * as utils from 'tweetnacl-util';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY environment variable is required (not present in process.env)');
}

let keyBuffer: Buffer;
try {
  keyBuffer = Buffer.from(ENCRYPTION_KEY, 'base64');
} catch (err) {
  throw new Error(`ENCRYPTION_KEY is not valid base64 (error: ${err instanceof Error ? err.message : 'unknown'})`);
}

if (keyBuffer.length !== 32) {
  throw new Error(
    `ENCRYPTION_KEY must decode to 32 bytes. Got ENCRYPTION_KEY length=${ENCRYPTION_KEY.length} chars, decodedBytes=${keyBuffer.length}. Raw=${ENCRYPTION_KEY}`
  );
}



export function encryptToken(token: string): string {
  const nonce = randomBytes(24);
  const message = new Uint8Array(Buffer.from(token, 'utf-8'));
  const ciphertext = nacl.secretbox(
    message,
    new Uint8Array(nonce),
    new Uint8Array(keyBuffer)
  );
  
  const combined = Buffer.concat([nonce, Buffer.from(ciphertext)]);
  return utils.encodeBase64(combined);
}

export function decryptToken(encryptedToken: string): string {
  try {
    const combined = Buffer.from(utils.decodeBase64(encryptedToken));
    const nonce = new Uint8Array(combined.subarray(0, 24));
    const ciphertext = new Uint8Array(combined.subarray(24));
    
    const decrypted = nacl.secretbox.open(
      ciphertext,
      nonce,
      new Uint8Array(keyBuffer)
    );
    
    if (!decrypted) {
      throw new Error('Decryption failed: unable to open sealed box');
    }
    
    return Buffer.from(decrypted).toString('utf-8');
  } catch (error) {
    throw new Error(`Token decryption error: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}
