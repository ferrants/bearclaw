import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SecretStore } from '../../src/security/secrets.js';

describe('SecretStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('encrypts and decrypts a string', () => {
    const store = new SecretStore(tmpDir, true);
    const plaintext = 'my-secret-api-key';
    const encrypted = store.encrypt(plaintext);

    expect(encrypted).toMatch(/^enc2:/);
    expect(encrypted).not.toContain(plaintext);

    const decrypted = store.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('returns plaintext when encryption is disabled', () => {
    const store = new SecretStore(tmpDir, false);
    const plaintext = 'my-secret-api-key';
    const result = store.encrypt(plaintext);
    expect(result).toBe(plaintext);
  });

  it('returns unencrypted strings as-is from decrypt', () => {
    const store = new SecretStore(tmpDir, true);
    expect(store.decrypt('not-encrypted')).toBe('not-encrypted');
  });

  it('detects encrypted values', () => {
    expect(SecretStore.isEncrypted('enc2:abc123')).toBe(true);
    expect(SecretStore.isEncrypted('plaintext')).toBe(false);
  });

  it('creates key file with restricted permissions', () => {
    new SecretStore(tmpDir, true);
    const keyPath = path.join(tmpDir, '.secret_key');
    expect(fs.existsSync(keyPath)).toBe(true);
    const stat = fs.statSync(keyPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('reuses existing key file', () => {
    const store1 = new SecretStore(tmpDir, true);
    const encrypted = store1.encrypt('test');

    const store2 = new SecretStore(tmpDir, true);
    expect(store2.decrypt(encrypted)).toBe('test');
  });

  it('fails to decrypt with wrong key (tamper detection)', () => {
    const store = new SecretStore(tmpDir, true);
    const encrypted = store.encrypt('test');

    // Tamper with the ciphertext
    const tampered = encrypted.slice(0, -4) + 'ffff';
    expect(() => store.decrypt(tampered)).toThrow();
  });

  it('handles unicode strings', () => {
    const store = new SecretStore(tmpDir, true);
    const plaintext = '🔑 secret key with émojis and ünîcödé';
    const encrypted = store.encrypt(plaintext);
    expect(store.decrypt(encrypted)).toBe(plaintext);
  });

  it('handles empty strings', () => {
    const store = new SecretStore(tmpDir, true);
    const encrypted = store.encrypt('');
    expect(store.decrypt(encrypted)).toBe('');
  });
});
