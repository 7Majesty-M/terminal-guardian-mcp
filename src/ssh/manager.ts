// ============================================================
// Terminal Guardian MCP — SSH Connection Manager
// Manages a pool of reusable SSH connections per profile
// ============================================================

import { Client, type ConnectConfig } from 'ssh2';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getLogger } from '../logging/logger.js';
import type { SshProfile, SshTestResult } from '../types/index.js';

export interface SshManagerConfig {
  enabled: boolean;
  timeout: number;
  keepaliveInterval: number;
  maxConnections: number;
  profiles: Record<string, SshProfile>;
}

interface PooledConnection {
  client: Client;
  profile: string;
  createdAt: number;
  lastUsedAt: number;
  busy: boolean;
}

export class SshManager {
  private readonly config: SshManagerConfig;
  private readonly pool: Map<string, PooledConnection> = new Map();

  constructor(config: SshManagerConfig) {
    this.config = config;
  }

  // ── Public API ─────────────────────────────────────────────

  isEnabled(): boolean {
    return this.config.enabled;
  }

  listProfiles(): Array<{
    name: string;
    host: string;
    port: number;
    username: string;
    authMethod: 'key' | 'password';
    connected: boolean;
  }> {
    return Object.entries(this.config.profiles).map(([name, p]) => ({
      name,
      host: p.host,
      port: p.port ?? 22,
      username: p.username,
      authMethod: p.privateKeyPath ? 'key' : 'password',
      connected: this.pool.has(name),
    }));
  }

  getProfile(name: string): SshProfile {
    const profile = this.config.profiles[name];
    if (!profile) {
      const available = Object.keys(this.config.profiles).join(', ') || 'none configured';
      throw new Error(`SSH profile "${name}" not found. Available profiles: ${available}`);
    }
    return profile;
  }

  async testConnection(profileName: string): Promise<SshTestResult> {
    this.assertEnabled();
    const profile = this.getProfile(profileName);
    const start = Date.now();

    return new Promise((resolve) => {
      const client = new Client();
      let serverVersion: string | undefined;

      const timer = setTimeout(() => {
        client.destroy();
        resolve({
          profile: profileName,
          host: profile.host,
          port: profile.port ?? 22,
          username: profile.username,
          connected: false,
          error: `Connection timed out after ${this.config.timeout}ms`,
        });
      }, this.config.timeout);

      client.on('ready', () => {
        clearTimeout(timer);
        const latencyMs = Date.now() - start;
        client.end();
        resolve({
          profile: profileName,
          host: profile.host,
          port: profile.port ?? 22,
          username: profile.username,
          connected: true,
          latencyMs,
          serverVersion,
        });
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          profile: profileName,
          host: profile.host,
          port: profile.port ?? 22,
          username: profile.username,
          connected: false,
          error: this.friendlyError(err),
        });
      });

      client.connect(this.buildConnectConfig(profile));
    });
  }

  async getConnection(profileName: string): Promise<Client> {
    this.assertEnabled();
    const profile = this.getProfile(profileName);
    const logger = getLogger();

    const existing = this.pool.get(profileName);
    if (existing && !existing.busy) {
      const isAlive = await this.checkAlive(existing.client);
      if (isAlive) {
        existing.lastUsedAt = Date.now();
        existing.busy = true;
        return existing.client;
      } else {
        this.pool.delete(profileName);
        logger.debug({ profileName }, 'SSH: removed dead connection from pool');
      }
    }

    if (this.pool.size >= this.config.maxConnections) {
      this.evictLRU();
    }

    const client = await this.connect(profileName, profile);
    this.pool.set(profileName, {
      client,
      profile: profileName,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      busy: true,
    });

    logger.debug({ profileName, host: profile.host }, 'SSH: new connection established');
    return client;
  }

  releaseConnection(profileName: string): void {
    const conn = this.pool.get(profileName);
    if (conn) conn.busy = false;
  }

  async closeAll(): Promise<void> {
    for (const [name, conn] of this.pool) {
      conn.client.end();
      this.pool.delete(name);
    }
  }

  // ── Private helpers ────────────────────────────────────────

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new Error('SSH integration is disabled. Set ssh.enabled: true in terminal-guardian.config.json');
    }
  }

  private async connect(profileName: string, profile: SshProfile): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();

      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error(`SSH connection to "${profileName}" timed out after ${this.config.timeout}ms`));
      }, this.config.timeout);

      client.on('ready', () => {
        clearTimeout(timer);
        resolve(client);
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`SSH connection failed for "${profileName}": ${this.friendlyError(err)}`));
      });

      client.on('close', () => {
        this.pool.delete(profileName);
      });

      client.connect(this.buildConnectConfig(profile));
    });
  }

  private buildConnectConfig(profile: SshProfile): ConnectConfig {
    const cfg: ConnectConfig = {
      host: profile.host,
      port: profile.port ?? 22,
      username: profile.username,
      readyTimeout: this.config.timeout,
      keepaliveInterval: this.config.keepaliveInterval,
    };

    if (profile.privateKeyPath) {
      const keyPath = resolve(profile.privateKeyPath.replace(/^~/, process.env['HOME'] ?? ''));
      if (!existsSync(keyPath)) {
        throw new Error(`SSH private key not found: ${keyPath}`);
      }
      cfg.privateKey = readFileSync(keyPath);
      if (profile.passphrase) cfg.passphrase = profile.passphrase;
    } else if (profile.password) {
      cfg.password = profile.password;
    }

    if (profile.fingerprint) {
      const expectedFingerprint = profile.fingerprint;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cfg.hostVerifier = (hashedKey: any) => {
        const actual = typeof hashedKey === 'string' ? hashedKey : (hashedKey as Buffer).toString('hex');
        return actual === expectedFingerprint;
      };
    }

    return cfg;
  }

  private checkAlive(client: Client): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        client.exec('true', (err) => {
          resolve(!err);
        });
      } catch {
        resolve(false);
      }
    });
  }

  private evictLRU(): void {
    let oldest: [string, PooledConnection] | null = null;
    for (const entry of this.pool.entries()) {
      if (!entry[1].busy) {
        if (!oldest || entry[1].lastUsedAt < oldest[1].lastUsedAt) {
          oldest = entry;
        }
      }
    }
    if (oldest) {
      oldest[1].client.end();
      this.pool.delete(oldest[0]);
    }
  }

  private friendlyError(err: Error): string {
    const msg = err.message ?? String(err);
    if (msg.includes('ECONNREFUSED')) return `Connection refused — is SSH running on this host/port?`;
    if (msg.includes('ENOTFOUND')) return `Host not found — check the hostname in your SSH profile`;
    if (msg.includes('ETIMEDOUT') || msg.includes('timed out')) return `Connection timed out`;
    if (msg.includes('Authentication')) return `Authentication failed — check your key/password`;
    if (msg.includes('EHOSTUNREACH')) return `Host unreachable — check network connectivity`;
    return msg;
  }
}