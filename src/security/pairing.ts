import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { type SecretStore } from './secrets.js';
import { createLogger } from '../logging.js';

const log = createLogger('pairing');

const CODE_LENGTH = 6;
const LOCKOUT_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

interface PendingPairing {
  code: string;
  codeHash: Buffer;
  createdAt: number;
  attempts: number;
  lockedUntil: number;
}

interface TokenEntry {
  tokenHash: string;
  createdAt: string;
  label?: string;
}

export class PairingGuard {
  private pending = new Map<string, PendingPairing>();
  private tokens = new Map<string, TokenEntry>();
  private tokensPath: string;

  constructor(
    private configDir: string,
    private secretStore: SecretStore,
  ) {
    this.tokensPath = path.join(configDir, 'paired-tokens.json');
    this.loadTokens();
  }

  generateCode(sessionId: string): string {
    // CSPRNG with rejection sampling (no modulo bias)
    let code: string;
    do {
      const bytes = randomBytes(4);
      const num = bytes.readUInt32BE(0);
      // Reject values that would create modulo bias
      if (num >= 4294000000) continue;
      code = String(num % 1000000).padStart(CODE_LENGTH, '0');
      break;
    } while (true);

    const codeHash = createHash('sha256').update(code!).digest();

    this.pending.set(sessionId, {
      code: code!,
      codeHash,
      createdAt: Date.now(),
      attempts: 0,
      lockedUntil: 0,
    });

    return code!;
  }

  verifyCode(sessionId: string, submittedCode: string): { success: boolean; token?: string; reason?: string } {
    const pending = this.pending.get(sessionId);
    if (!pending) {
      return { success: false, reason: 'No pending pairing for this session' };
    }

    // Lockout check
    if (pending.lockedUntil > Date.now()) {
      const remaining = Math.ceil((pending.lockedUntil - Date.now()) / 1000);
      return { success: false, reason: `Locked out. Try again in ${remaining}s` };
    }

    // Constant-time comparison
    const submittedHash = createHash('sha256').update(submittedCode).digest();
    const match = timingSafeEqual(pending.codeHash, submittedHash);

    if (!match) {
      pending.attempts++;
      if (pending.attempts >= LOCKOUT_ATTEMPTS) {
        pending.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        log.warn('Pairing lockout', { sessionId, attempts: pending.attempts });
      }
      return { success: false, reason: 'Invalid code' };
    }

    // Generate token
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest().toString('hex');

    this.tokens.set(tokenHash, {
      tokenHash,
      createdAt: new Date().toISOString(),
      label: sessionId,
    });

    this.pending.delete(sessionId);
    this.saveTokens();

    return { success: true, token };
  }

  verifyToken(token: string): boolean {
    const tokenHash = createHash('sha256').update(token).digest().toString('hex');
    return this.tokens.has(tokenHash);
  }

  private loadTokens(): void {
    try {
      const raw = fs.readFileSync(this.tokensPath, 'utf8');
      const decrypted = this.secretStore.decrypt(raw);
      const entries: TokenEntry[] = JSON.parse(decrypted);
      for (const entry of entries) {
        this.tokens.set(entry.tokenHash, entry);
      }
      log.info('Loaded paired tokens', { count: this.tokens.size });
    } catch {
      // No tokens file yet
    }
  }

  private saveTokens(): void {
    const entries = [...this.tokens.values()];
    const json = JSON.stringify(entries, null, 2);
    const encrypted = this.secretStore.encrypt(json);
    fs.mkdirSync(this.configDir, { recursive: true });
    fs.writeFileSync(this.tokensPath, encrypted);
  }
}
