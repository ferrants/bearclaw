import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const METADATA_HOSTS = [
  '169.254.169.254',
  'metadata.google.internal',
];

export async function validateUrl(url: string): Promise<{ allowed: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { allowed: false, reason: 'Only HTTP(S) allowed' };
  }

  const hostname = parsed.hostname;
  let ip: string;

  if (isIP(hostname)) {
    ip = hostname;
  } else {
    if (METADATA_HOSTS.includes(hostname)) {
      return { allowed: false, reason: 'Metadata endpoint blocked' };
    }
    try {
      const result = await lookup(hostname);
      ip = result.address;
    } catch {
      return { allowed: false, reason: 'DNS resolution failed' };
    }
  }

  if (isPrivateIP(ip)) {
    return { allowed: false, reason: `Private IP blocked: ${ip}` };
  }

  return { allowed: true };
}

function isPrivateIP(ip: string): boolean {
  // IPv6
  if (ip === '::1') return true;
  if (ip.startsWith('fe80:')) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

export function matchesCidr(ip: string, cidr: string): boolean {
  const [network, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1) >>> 0;
  return ipToUint32(ip) !== null &&
    (ipToUint32(ip)! & mask) === (ipToUint32(network)! & mask);
}

function ipToUint32(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}
