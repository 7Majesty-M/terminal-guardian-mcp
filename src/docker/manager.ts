/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GuardianConfig, DockerContainer, DockerStats } from '../types/index.js';

export class DockerManager {
  private docker: any = null;
  private readonly config: GuardianConfig['docker'];
  private initialized = false;

  constructor(config: GuardianConfig['docker']) {
    this.config = config;
  }

  private async getDocker(): Promise<any> {
    if (!this.config.enabled) {
      throw new Error('Docker integration is disabled. Enable it in terminal-guardian.config.json');
    }
    if (!this.docker) {
      try {
        const { default: Dockerode } = await import('dockerode');
        this.docker = new Dockerode({ socketPath: this.config.socketPath });
        this.initialized = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to connect to Docker: ${msg}`);
      }
    }
    return this.docker;
  }

  async listContainers(all: boolean = true): Promise<DockerContainer[]> {
    const docker = await this.getDocker();
    const containers = await docker.listContainers({ all });
    return containers.map((c: any) => ({
      id: c.Id.substring(0, 12),
      name: (c.Names?.[0] ?? c.Id).replace(/^\//, ''),
      image: c.Image,
      status: c.Status,
      state: c.State,
      created: new Date(c.Created * 1000).toISOString(),
      ports: (c.Ports ?? []).map((p: any) => ({
        privatePort: p.PrivatePort,
        publicPort: p.PublicPort,
        type: p.Type,
      })),
      labels: c.Labels ?? {},
    }));
  }

  async inspectContainer(idOrName: string): Promise<Record<string, unknown>> {
    const docker = await this.getDocker();
    const container = docker.getContainer(idOrName);
    return container.inspect() as Promise<Record<string, unknown>>;
  }

  async getLogs(idOrName: string, tail: number = 100, timestamps: boolean = true): Promise<string> {
    if (!this.config.allowLogAccess) {
      throw new Error('Log access is disabled in configuration');
    }
    const docker = await this.getDocker();
    const container = docker.getContainer(idOrName);
    const logBuffer = await container.logs({ stdout: true, stderr: true, tail, timestamps });
    if (typeof logBuffer === 'string') return logBuffer;
    const buf = logBuffer as Buffer;
    const lines: string[] = [];
    let offset = 0;
    while (offset < buf.length) {
      const frameSize = buf.readUInt32BE(offset + 4);
      const frame = buf.slice(offset + 8, offset + 8 + frameSize);
      lines.push(frame.toString('utf-8'));
      offset += 8 + frameSize;
    }
    return lines.join('');
  }

  async restartContainer(idOrName: string): Promise<void> {
    if (!this.config.allowContainerRestart) {
      throw new Error('Container restart is disabled in configuration');
    }
    const docker = await this.getDocker();
    const container = docker.getContainer(idOrName);
    await container.restart();
  }

  async getStats(idOrName: string): Promise<DockerStats> {
    const docker = await this.getDocker();
    const container = docker.getContainer(idOrName);
    return new Promise((resolve, reject) => {
      container.stats({ stream: false }, (err: any, data: any) => {
        if (err ?? !data) { reject(err ?? new Error('No stats data')); return; }
        const cpuDelta = data.cpu_stats.cpu_usage.total_usage - data.precpu_stats.cpu_usage.total_usage;
        const systemDelta = data.cpu_stats.system_cpu_usage - data.precpu_stats.system_cpu_usage;
        const numCPUs = data.cpu_stats.online_cpus ?? 1;
        const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCPUs * 100 : 0;
        const memUsage = data.memory_stats.usage ?? 0;
        const memLimit = data.memory_stats.limit ?? 1;
        const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;
        const networks = data.networks ?? {};
        const networkIn = Object.values(networks).reduce((s: number, n: any) => s + (n.rx_bytes ?? 0), 0);
        const networkOut = Object.values(networks).reduce((s: number, n: any) => s + (n.tx_bytes ?? 0), 0);
        const blkio = data.blkio_stats?.io_service_bytes_recursive ?? [];
        const blockRead = blkio.filter((b: any) => b.op === 'Read').reduce((s: number, b: any) => s + b.value, 0);
        const blockWrite = blkio.filter((b: any) => b.op === 'Write').reduce((s: number, b: any) => s + b.value, 0);
        resolve({
          containerId: (data.id ?? idOrName).substring(0, 12),
          name: (data.name ?? idOrName).replace(/^\//, ''),
          cpuPercent: Math.round(cpuPercent * 100) / 100,
          memoryUsage: memUsage, memoryLimit: memLimit,
          memoryPercent: Math.round(memPercent * 100) / 100,
          networkIn, networkOut, blockRead, blockWrite,
          pids: data.pids_stats?.current ?? 0,
          timestamp: new Date().toISOString(),
        });
      });
    });
  }
  async execContainer(
    idOrName: string,
    command: string[],
    timeoutMs: number = 30_000,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const docker = await this.getDocker();
    const container = docker.getContainer(idOrName);

    const exec = await container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Container exec timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      exec.start({ hijack: true, stdin: false }, (err: any, stream: any) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (chunk: Buffer) => {
          let offset = 0;
          while (offset < chunk.length) {
            if (chunk.length < offset + 8) break;
            const streamType = chunk[offset];
            const frameSize = chunk.readUInt32BE(offset + 4);
            const frameData = chunk.slice(offset + 8, offset + 8 + frameSize).toString('utf-8');
            if (streamType === 2) stderr += frameData;
            else stdout += frameData;
            offset += 8 + frameSize;
          }
        });

        stream.on('end', () => {
          clearTimeout(timer);
          exec.inspect((inspectErr: any, data: any) => {
            resolve({
              stdout: stdout.slice(0, 512_000),
              stderr: stderr.slice(0, 512_000),
              exitCode: inspectErr ? -1 : (data?.ExitCode ?? 0),
            });
          });
        });

        stream.on('error', (streamErr: any) => {
          clearTimeout(timer);
          reject(streamErr);
        });
      });
    });
  }
  isEnabled(): boolean { return this.config.enabled; }
  isInitialized(): boolean { return this.initialized; }
}
