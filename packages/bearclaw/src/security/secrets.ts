import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chacha20poly1305 } from '@noble/ciphers/chacha';

const ENC2_PREFIX = 'enc2:';
const NONCE_LENGTH = 12;
const KEY_LENGTH = 32;

export class SecretStore {
  private key: Uint8Array;

  constructor(private configDir: string, private enabled: boolean) {
    this.key = enabled ? this.loadOrCreateKey() : new Uint8Array(KEY_LENGTH);
  }

  encrypt(plaintext: string): string {
    if (!this.enabled) return plaintext;
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = chacha20poly1305(this.key, nonce);
    const ciphertext = cipher.encrypt(Buffer.from(plaintext, 'utf8'));
    const blob = Buffer.concat([nonce, Buffer.from(ciphertext)]);
    return ENC2_PREFIX + blob.toString('hex');
  }

  decrypt(value: string): string {
    if (!value.startsWith(ENC2_PREFIX)) return value;
    const blob = Buffer.from(value.slice(ENC2_PREFIX.length), 'hex');
    const nonce = blob.subarray(0, NONCE_LENGTH);
    const ciphertext = blob.subarray(NONCE_LENGTH);
    const cipher = chacha20poly1305(this.key, nonce);
    const plaintext = cipher.decrypt(ciphertext);
    return Buffer.from(plaintext).toString('utf8');
  }

  static isEncrypted(value: string): boolean {
    return value.startsWith(ENC2_PREFIX);
  }

  private loadOrCreateKey(): Uint8Array {
    const keyPath = path.join(this.configDir, '.secret_key');
    try {
      const hex = fs.readFileSync(keyPath, 'utf8').trim();
      return Buffer.from(hex, 'hex');
    } catch {
      fs.mkdirSync(this.configDir, { recursive: true });
      const key = randomBytes(KEY_LENGTH);
      fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
      return key;
    }
  }
}
