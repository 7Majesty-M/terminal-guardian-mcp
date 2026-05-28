import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SshManager } from '../src/ssh/manager.js';
import { SshExecutor } from '../src/ssh/executor.ts';
import { DEFAULT_CONFIG } from '../src/config/loader.js';

// ── Mock ssh2 ─────────────────────────────────────────────────
vi.mock('ssh2', () => {
  const { EventEmitter } = require('events');

  class MockClient extends EventEmitter {
    connected = false;
    _sock = { destroyed: false };

    connect(_cfg: unknown) {
      // Simulate async connection
      setTimeout(() => {
        this.connected = true;
        this.emit('ready');
      }, 10);
    }

    exec(cmd: string, cb: (err: null, stream: NodeJS.EventEmitter) => void) {
      const stream = new EventEmitter() as NodeJS.EventEmitter & {
        stderr: NodeJS.EventEmitter;
        close: () => void;
        destroy: () => void;
      };
      stream.stderr = new EventEmitter();
      stream.close = () => stream.emit('close', 0);
      stream.destroy = () => stream.emit('close', null);

      cb(null, stream);

      setTimeout(() => {
        stream.emit('data', Buffer.from(`output of: ${cmd}\n`));
        stream.emit('close', 0);
      }, 5);
    }

    end() { this.connected = false; this.emit('close'); }
    destroy() { this.end(); }
  }

  return { Client: MockClient };
});

// ── Test config helpers ───────────────────────────────────────

function makeConfig(profiles: Record<string, unknown> = {}) {
  return {
    enabled: true,
    timeout: 5_000,
    keepaliveInterval: 1_000,
    maxConnections: 3,
    profiles: profiles as Record<string, import('../src/ssh/manager.js').SshManagerConfig['profiles'][string]>,
  };
}

const PROFILE_KEY = {
  host: 'example.com',
  port: 22,
  username: 'deploy',
  privateKeyPath: '/dev/null', // will fail existsSync but we test the happy path via mock
};

const PROFILE_PASS = {
  host: 'example.com',
  port: 22,
  username: 'deploy',
  password: 'secret',
};

// ── SshManager tests ──────────────────────────────────────────

describe('SshManager — disabled', () => {
  it('should throw when disabled', () => {
    const mgr = new SshManager({ ...makeConfig(), enabled: false });
    expect(() => mgr.getProfile('prod')).toThrow(); // throws because no profiles configured
    expect(mgr.isEnabled()).toBe(false);
  });

  it('should throw on testConnection when disabled', async () => {
    const mgr = new SshManager({ ...makeConfig({ prod: PROFILE_PASS }), enabled: false });
    await expect(mgr.testConnection('prod')).rejects.toThrow(/disabled/i);
  });
});

describe('SshManager — profiles', () => {
  it('should list configured profiles', () => {
    const mgr = new SshManager(makeConfig({ prod: PROFILE_PASS, staging: PROFILE_PASS }));
    const list = mgr.listProfiles();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name)).toContain('prod');
    expect(list.map((p) => p.name)).toContain('staging');
  });

  it('should report key auth method when privateKeyPath is set', () => {
    const mgr = new SshManager(makeConfig({ prod: PROFILE_KEY }));
    const list = mgr.listProfiles();
    expect(list[0]!.authMethod).toBe('key');
  });

  it('should report password auth method when password is set', () => {
    const mgr = new SshManager(makeConfig({ prod: PROFILE_PASS }));
    const list = mgr.listProfiles();
    expect(list[0]!.authMethod).toBe('password');
  });

  it('should return profile by name', () => {
    const mgr = new SshManager(makeConfig({ prod: PROFILE_PASS }));
    const p = mgr.getProfile('prod');
    expect(p.host).toBe('example.com');
    expect(p.username).toBe('deploy');
  });

  it('should throw for unknown profile', () => {
    const mgr = new SshManager(makeConfig({ prod: PROFILE_PASS }));
    expect(() => mgr.getProfile('unknown')).toThrow(/not found/i);
    expect(() => mgr.getProfile('unknown')).toThrow(/prod/); // hints at available profiles
  });

  it('should show default port 22', () => {
    const mgr = new SshManager(makeConfig({ prod: { ...PROFILE_PASS, port: undefined } }));
    const list = mgr.listProfiles();
    expect(list[0]!.port).toBe(22);
  });

  it('should return empty list when no profiles configured', () => {
    const mgr = new SshManager(makeConfig({}));
    expect(mgr.listProfiles()).toHaveLength(0);
  });
});

// ── SshExecutor tests ─────────────────────────────────────────

describe('SshExecutor — risk analysis', () => {
  function makeExecutor(profiles = { prod: PROFILE_PASS }) {
    const mgr = new SshManager(makeConfig(profiles));
    const config = {
      ...DEFAULT_CONFIG,
      ssh: makeConfig(profiles),
    };
    return new SshExecutor(mgr, config);
  }

  it('should block dangerous commands remotely', async () => {
    const exec = makeExecutor();
    const result = await exec.execute({ profileName: 'prod', command: 'rm -rf /' });
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('blocked');
    expect(result.riskAssessment.level).toBe('BLOCKED');
  });

  it('should block reboot command', async () => {
    const exec = makeExecutor();
    const result = await exec.execute({ profileName: 'prod', command: 'reboot' });
    expect(result.exitCode).toBe(-1);
    expect(result.riskAssessment.blocked).toBe(true);
  });

  it('should require confirmation for WARNING commands', async () => {
    const exec = makeExecutor();
    const result = await exec.execute({ profileName: 'prod', command: 'rm -rf ./old-logs' });
    expect(result.exitCode).toBe(-2);
    expect(result.stderr).toContain('confirmation');
  });

  it('should execute WARNING commands when confirmed', async () => {
    const exec = makeExecutor();
    const result = await exec.execute({
      profileName: 'prod',
      command: 'rm -rf ./old-logs',
      confirmed: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.profile).toBe('prod');
    expect(result.host).toBe('example.com');
  });

  it('should execute safe commands without confirmation', async () => {
    const exec = makeExecutor();
    const result = await exec.execute({ profileName: 'prod', command: 'ls -la' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ls -la');
    expect(result.riskAssessment.level).toBe('SAFE');
  });

  it('should return correct metadata', async () => {
    const exec = makeExecutor();
    const result = await exec.execute({ profileName: 'prod', command: 'pwd' });
    expect(result.profile).toBe('prod');
    expect(result.host).toBe('example.com');
    expect(typeof result.duration).toBe('number');
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('should prepend cd when cwd is provided', async () => {
    const exec = makeExecutor();
    const result = await exec.execute({
      profileName: 'prod',
      command: 'ls',
      cwd: '/var/app',
    });
    expect(result.stdout).toContain('/var/app');
  });

  it('should return error when profile does not exist', async () => {
    const exec = makeExecutor();
    await expect(
      exec.execute({ profileName: 'nonexistent', command: 'ls' }),
    ).rejects.toThrow(/not found/i);
  });
});