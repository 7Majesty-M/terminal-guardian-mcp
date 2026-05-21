import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import {
  checkHostSafety,
  checkUrlSafety,
  ping,
  dnsLookup,
} from '../src/network/diagnostics.js';

function hasBinary(bin: string): boolean {
  try { execSync(`which ${bin} || where ${bin}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}
const hasPing = hasBinary('ping');
const hasDig = hasBinary('dig') || hasBinary('nslookup');

describe('Network — Safety checks', () => {
  describe('checkHostSafety', () => {
    const blocked = [
      'localhost',
      '127.0.0.1',
      '127.0.0.2',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '0.0.0.0',
      '169.254.0.1',
      '::1',
    ];

    for (const host of blocked) {
      it(`should block private/loopback host: ${host}`, () => {
        const result = checkHostSafety(host);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBeTruthy();
      });
    }

    it('should allow public hosts by default', () => {
      expect(checkHostSafety('google.com').allowed).toBe(true);
      expect(checkHostSafety('8.8.8.8').allowed).toBe(true);
      expect(checkHostSafety('1.1.1.1').allowed).toBe(true);
    });

    it('should allow private hosts when allowPrivate=true', () => {
      expect(checkHostSafety('192.168.1.1', true).allowed).toBe(true);
      expect(checkHostSafety('localhost', true).allowed).toBe(true);
    });
  });

  describe('checkUrlSafety', () => {
    const blockedUrls = [
      'file:///etc/passwd',
      'ftp://example.com/file',
      'ldap://internal/',
      'http://localhost/api',
      'http://127.0.0.1/',
      'https://192.168.1.1/admin',
      'not-a-url',
    ];

    for (const url of blockedUrls) {
      it(`should block: ${url}`, () => {
        const result = checkUrlSafety(url);
        expect(result.allowed).toBe(false);
      });
    }

    it('should allow valid public HTTPS URLs', () => {
      expect(checkUrlSafety('https://api.github.com').allowed).toBe(true);
      expect(checkUrlSafety('https://example.com/path?q=1').allowed).toBe(true);
    });

    it('should allow valid public HTTP URLs', () => {
      expect(checkUrlSafety('http://example.com').allowed).toBe(true);
    });

    it('should block invalid URLs', () => {
      expect(checkUrlSafety('not a url at all').allowed).toBe(false);
      expect(checkUrlSafety('').allowed).toBe(false);
    });
  });
});

describe.skipIf(!hasDig)('Network — DNS Lookup', () => {
  it('should resolve a well-known hostname', async () => {
    const result = await dnsLookup('google.com');
    expect(result.host).toBe('google.com');
    expect(result.addresses.length).toBeGreaterThan(0);
    expect(result.queryTimeMs).toBeGreaterThanOrEqual(0);
  }, 10_000);

  it('should return A or AAAA records', async () => {
    const result = await dnsLookup('cloudflare.com');
    const types = result.addresses.map((r) => r.type);
    expect(types.some((t) => t === 'A' || t === 'AAAA')).toBe(true);
  }, 10_000);

  it('should reject invalid hostnames', async () => {
    await expect(dnsLookup('invalid host with spaces')).rejects.toThrow();
  });

  it('should fail gracefully for non-existent domain', async () => {
    await expect(
      dnsLookup('this-domain-definitely-does-not-exist-xyz-123456.com'),
    ).rejects.toThrow();
  }, 10_000);

  it('should return queryTimeMs', async () => {
    const result = await dnsLookup('example.com');
    expect(typeof result.queryTimeMs).toBe('number');
    expect(result.queryTimeMs).toBeGreaterThanOrEqual(0);
  }, 10_000);
});

describe.skipIf(!hasPing)('Network — Ping', () => {
  it('should ping a reachable public host', async () => {
    const result = await ping('8.8.8.8', 2);
    expect(result.host).toBe('8.8.8.8');
    expect(result.count).toBe(2);
    expect(result.reachable).toBe(true);
    expect(result.received).toBeGreaterThan(0);
    expect(result.packetLoss).toBeLessThan(100);
  }, 15_000);

  it('should block private addresses', async () => {
    await expect(ping('192.168.1.1', 1)).rejects.toThrow(/private|loopback/i);
  });

  it('should allow private when allowPrivate=true', async () => {
    const result = await ping('127.0.0.1', 1, true);
    expect(result.host).toBe('127.0.0.1');
  }, 10_000);

  it('should cap count at 10', async () => {
    const result = await ping('1.1.1.1', 50);
    expect(result.count).toBeLessThanOrEqual(10);
  }, 20_000);

  it('should include raw output', async () => {
    const result = await ping('8.8.8.8', 1);
    expect(typeof result.raw).toBe('string');
    expect(result.raw.length).toBeGreaterThan(0);
  }, 10_000);

  it('should populate RTT stats on success', async () => {
    const result = await ping('1.1.1.1', 2);
    if (result.reachable) {
      expect(result.avgMs).toBeDefined();
      expect(result.avgMs!).toBeGreaterThan(0);
    }
  }, 15_000);
});