import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SecretStore } from '../../src/security/secrets.js';
import { PairingGuard } from '../../src/security/pairing.js';

describe('PairingGuard', () => {
  let tmpDir: string;
  let secrets: SecretStore;
  let pairing: PairingGuard;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bearclaw-pairing-'));
    secrets = new SecretStore(tmpDir, true);
    pairing = new PairingGuard(tmpDir, secrets);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('existing pairing flow', () => {
    it('generates a 6-digit code and verifies it', () => {
      const code = pairing.generateCode('session-1');
      expect(code).toMatch(/^\d{6}$/);

      const result = pairing.verifyCode('session-1', code);
      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token!.length).toBe(64); // 32 bytes hex
    });

    it('rejects an invalid code', () => {
      pairing.generateCode('session-1');
      const result = pairing.verifyCode('session-1', '000000');
      expect(result.success).toBe(false);
      expect(result.reason).toBe('Invalid code');
    });

    it('verifies a paired token', () => {
      const code = pairing.generateCode('session-1');
      const result = pairing.verifyCode('session-1', code);
      expect(pairing.verifyToken(result.token!)).toBe(true);
    });

    it('rejects an unknown token', () => {
      expect(pairing.verifyToken('not-a-real-token')).toBe(false);
    });
  });

  describe('createToken', () => {
    it('creates a token that passes verifyToken', () => {
      const token = pairing.createToken('my-ui');
      expect(token.length).toBe(64); // 32 bytes hex
      expect(pairing.verifyToken(token)).toBe(true);
    });

    it('persists tokens to disk', () => {
      const token = pairing.createToken('persist-test');

      // Load a fresh PairingGuard from the same dir
      const pairing2 = new PairingGuard(tmpDir, secrets);
      expect(pairing2.verifyToken(token)).toBe(true);
    });

    it('shows created token in listTokens', () => {
      pairing.createToken('labeled-token');
      const list = pairing.listTokens();
      expect(list.some(t => t.label === 'labeled-token')).toBe(true);
    });
  });

  describe('addStaticKey', () => {
    it('adds a key that passes verifyToken', () => {
      pairing.addStaticKey('web-ui', 'my-secret-key');
      expect(pairing.verifyToken('my-secret-key')).toBe(true);
    });

    it('does not write to disk', () => {
      pairing.addStaticKey('no-disk', 'ephemeral-key');

      // Load a fresh PairingGuard — static key should NOT be there
      const pairing2 = new PairingGuard(tmpDir, secrets);
      expect(pairing2.verifyToken('ephemeral-key')).toBe(false);
    });

    it('labels with [static] prefix', () => {
      pairing.addStaticKey('my-app', 'the-key');
      const list = pairing.listTokens();
      expect(list.some(t => t.label === '[static] my-app')).toBe(true);
    });

    it('is idempotent — adding the same key twice does not duplicate', () => {
      pairing.addStaticKey('dup', 'same-key');
      pairing.addStaticKey('dup', 'same-key');
      const list = pairing.listTokens();
      const matches = list.filter(t => t.label === '[static] dup');
      expect(matches.length).toBe(1);
    });
  });

  describe('listTokens', () => {
    it('returns empty array when no tokens exist', () => {
      expect(pairing.listTokens()).toEqual([]);
    });

    it('lists tokens from all sources', () => {
      // Create a CLI token
      pairing.createToken('cli-token');
      // Add a static key
      pairing.addStaticKey('static-key', 'the-key');
      // Pair a session
      const code = pairing.generateCode('session-1');
      pairing.verifyCode('session-1', code);

      const list = pairing.listTokens();
      expect(list.length).toBe(3);
      expect(list.some(t => t.label === 'cli-token')).toBe(true);
      expect(list.some(t => t.label === '[static] static-key')).toBe(true);
      expect(list.some(t => t.label === 'session-1')).toBe(true);
    });
  });

  describe('revokeByLabel', () => {
    it('revokes a token by label and returns true', () => {
      const token = pairing.createToken('to-revoke');
      expect(pairing.verifyToken(token)).toBe(true);

      const revoked = pairing.revokeByLabel('to-revoke');
      expect(revoked).toBe(true);
      expect(pairing.verifyToken(token)).toBe(false);
    });

    it('returns false when label does not exist', () => {
      expect(pairing.revokeByLabel('nonexistent')).toBe(false);
    });

    it('persists revocation to disk', () => {
      const token = pairing.createToken('revoke-persist');
      pairing.revokeByLabel('revoke-persist');

      const pairing2 = new PairingGuard(tmpDir, secrets);
      expect(pairing2.verifyToken(token)).toBe(false);
    });

    it('does not revoke static keys (different label format)', () => {
      pairing.addStaticKey('my-key', 'secret');
      // Trying to revoke by the base label won't match the [static] prefix
      const revoked = pairing.revokeByLabel('my-key');
      expect(revoked).toBe(false);
      expect(pairing.verifyToken('secret')).toBe(true);
    });
  });
});
