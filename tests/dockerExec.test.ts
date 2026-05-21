import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerManager } from '../src/docker/manager.js';

// Mock dockerode so tests run without Docker installed
vi.mock('dockerode', () => {
  const mockExec = {
    start: vi.fn((opts: unknown, cb: (err: null, stream: NodeJS.EventEmitter & { on: ReturnType<typeof vi.fn> }) => void) => {
      const { EventEmitter } = require('events');
      const stream = new EventEmitter() as NodeJS.EventEmitter & { on: ReturnType<typeof vi.fn> };

      const payload = Buffer.from('hello\n');
      const header = Buffer.alloc(8);
      header[0] = 1; // stdout
      header.writeUInt32BE(payload.length, 4);
      const frame = Buffer.concat([header, payload]);

      cb(null, stream);
      setTimeout(() => {
        stream.emit('data', frame);
        stream.emit('end');
      }, 10);
    }),
    inspect: vi.fn((cb: (err: null, data: { ExitCode: number }) => void) => {
      cb(null, { ExitCode: 0 });
    }),
  };

  const mockContainer = {
    exec: vi.fn(async () => mockExec),
    logs: vi.fn(async () => Buffer.from('')),
    inspect: vi.fn(async () => ({})),
    restart: vi.fn(async () => undefined),
    stats: vi.fn(),
  };

  const MockDocker = vi.fn(() => ({
    getContainer: vi.fn(() => mockContainer),
    listContainers: vi.fn(async () => []),
  }));

  return { default: MockDocker };
});

describe('DockerManager — execContainer', () => {
  let manager: DockerManager;

  beforeEach(() => {
    manager = new DockerManager({
      enabled: true,
      socketPath: '/var/run/docker.sock',
      allowContainerRestart: true,
      allowLogAccess: true,
    });
  });

  it('should exec a command and return stdout', async () => {
    const result = await manager.execContainer('my-app', ['echo', 'hello']);
    expect(result.stdout).toContain('hello');
    expect(result.exitCode).toBe(0);
  });

  it('should return exitCode 0 on success', async () => {
    const result = await manager.execContainer('my-app', ['ls', '-la']);
    expect(result.exitCode).toBe(0);
  });

  it('should accept multi-word commands as arrays', async () => {
    const result = await manager.execContainer('my-app', ['node', '--version']);
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('exitCode');
  });

  it('should throw when Docker is disabled', async () => {
    const disabledManager = new DockerManager({
      enabled: false,
      socketPath: '/var/run/docker.sock',
      allowContainerRestart: false,
      allowLogAccess: false,
    });
    await expect(
      disabledManager.execContainer('my-app', ['ls']),
    ).rejects.toThrow(/disabled/i);
  });
});

describe('DockerManager — isEnabled / isInitialized', () => {
  it('should report disabled when configured as such', () => {
    const m = new DockerManager({
      enabled: false,
      socketPath: '/var/run/docker.sock',
      allowContainerRestart: false,
      allowLogAccess: false,
    });
    expect(m.isEnabled()).toBe(false);
    expect(m.isInitialized()).toBe(false);
  });

  it('should report enabled when configured', () => {
    const m = new DockerManager({
      enabled: true,
      socketPath: '/var/run/docker.sock',
      allowContainerRestart: false,
      allowLogAccess: true,
    });
    expect(m.isEnabled()).toBe(true);
  });
});