import { describe, it, expect } from 'vitest';
import { matchesCidr } from '../../src/security/ssrf.js';

describe('SSRF Guard', () => {
  describe('matchesCidr', () => {
    it('matches IP within CIDR range', () => {
      expect(matchesCidr('10.0.0.1', '10.0.0.0/8')).toBe(true);
      expect(matchesCidr('10.255.255.255', '10.0.0.0/8')).toBe(true);
    });

    it('rejects IP outside CIDR range', () => {
      expect(matchesCidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
    });

    it('handles /16 ranges', () => {
      expect(matchesCidr('192.168.1.1', '192.168.0.0/16')).toBe(true);
      expect(matchesCidr('192.169.0.1', '192.168.0.0/16')).toBe(false);
    });

    it('handles /24 ranges', () => {
      expect(matchesCidr('10.0.1.5', '10.0.1.0/24')).toBe(true);
      expect(matchesCidr('10.0.2.5', '10.0.1.0/24')).toBe(false);
    });

    it('handles /32 (single host)', () => {
      expect(matchesCidr('10.0.0.1', '10.0.0.1/32')).toBe(true);
      expect(matchesCidr('10.0.0.2', '10.0.0.1/32')).toBe(false);
    });

    it('handles 172.16-31 private range correctly (fix #6)', () => {
      expect(matchesCidr('172.16.0.1', '172.16.0.0/12')).toBe(true);
      expect(matchesCidr('172.31.255.255', '172.16.0.0/12')).toBe(true);
      expect(matchesCidr('172.32.0.1', '172.16.0.0/12')).toBe(false);
    });

    it('handles CGNAT range (100.64.0.0/10)', () => {
      expect(matchesCidr('100.64.0.1', '100.64.0.0/10')).toBe(true);
      expect(matchesCidr('100.127.255.255', '100.64.0.0/10')).toBe(true);
      expect(matchesCidr('100.128.0.1', '100.64.0.0/10')).toBe(false);
    });

    it('returns false for invalid IPs', () => {
      expect(matchesCidr('not-an-ip', '10.0.0.0/8')).toBe(false);
      expect(matchesCidr('999.999.999.999', '10.0.0.0/8')).toBe(false);
    });
  });
});
