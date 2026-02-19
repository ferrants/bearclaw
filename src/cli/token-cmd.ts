import { getConfigDir } from '../config/config.js';
import { SecretStore } from '../security/secrets.js';
import { PairingGuard } from '../security/pairing.js';

export async function runTokenCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === '--help') {
    printUsage();
    return;
  }

  const configDir = getConfigDir();
  const secrets = new SecretStore(configDir, true);
  const pairing = new PairingGuard(configDir, secrets);

  switch (subcommand) {
    case 'create': {
      const label = args[1] ?? `token-${Date.now()}`;
      const token = pairing.createToken(label);
      console.log(`Token created for "${label}":\n`);
      console.log(`  ${token}\n`);
      console.log('Save this token — it cannot be shown again.');
      break;
    }

    case 'list': {
      const tokens = pairing.listTokens();
      if (tokens.length === 0) {
        console.log('No tokens found.');
        return;
      }
      console.log(`${'Label'.padEnd(40)} Created`);
      console.log(`${'─'.repeat(40)} ${'─'.repeat(24)}`);
      for (const t of tokens) {
        console.log(`${t.label.padEnd(40)} ${t.createdAt}`);
      }
      break;
    }

    case 'revoke': {
      const label = args[1];
      if (!label) {
        console.error('Usage: bearclaw token revoke <label>');
        process.exit(1);
      }
      const revoked = pairing.revokeByLabel(label);
      if (revoked) {
        console.log(`Token "${label}" revoked.`);
      } else {
        console.error(`No token found with label "${label}".`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

function printUsage(): void {
  console.log(`Usage: bearclaw token <command>

Commands:
  create [label]    Create a new auth token
  list              List all tokens
  revoke <label>    Revoke a token by label`);
}
