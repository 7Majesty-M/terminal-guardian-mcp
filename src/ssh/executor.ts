// ============================================================
// Terminal Guardian MCP — SSH Remote Executor
// Runs commands on remote servers via SSH with the same
// risk analysis and safety guarantees as local execution
// ============================================================

import { analyzeCommand, isBlocked } from '../security/riskAnalyzer.js';
import { logSecurityEvent, logCommand } from '../logging/logger.js';
import { SshManager } from './manager.js';
import type { SshCommandResult, GuardianConfig } from '../types/index.js';

export interface SshExecOptions {
  profileName: string;
  command: string;
  timeout?: number | undefined;
  confirmed?: boolean | undefined;
  cwd?: string | undefined;
}

export class SshExecutor {
  private readonly manager: SshManager;
  private readonly securityConfig: GuardianConfig['security'];
  private readonly defaultTimeout: number;

  constructor(manager: SshManager, config: GuardianConfig) {
    this.manager = manager;
    this.securityConfig = config.security;
    this.defaultTimeout = config.ssh?.timeout ?? 30_000;
  }

  async execute(opts: SshExecOptions): Promise<SshCommandResult> {
    const {
      profileName,
      command,
      timeout = this.defaultTimeout,
      confirmed = false,
      cwd,
    } = opts;

    const startTime = Date.now();
    const profile = this.manager.getProfile(profileName);
    const host = profile.host;

    const riskAssessment = analyzeCommand(command, {
      customBlocklist: this.securityConfig.customBlocklist,
      customAllowlist: this.securityConfig.customAllowlist,
      allowSudo: this.securityConfig.allowSudo,
    });

    if (this.securityConfig.blockDangerousCommands && isBlocked(riskAssessment)) {
      logSecurityEvent(
        `Blocked remote SSH command: ${command}`,
        { profileName, host, command, riskAssessment },
        riskAssessment.level,
        true,
      );
      return {
        profile: profileName,
        host,
        command,
        exitCode: -1,
        stdout: '',
        stderr: `[Terminal Guardian] Remote command blocked: ${riskAssessment.level}\n${riskAssessment.reasons.join('\n')}`,
        duration: Date.now() - startTime,
        timedOut: false,
        timestamp: new Date().toISOString(),
        riskAssessment,
      };
    }

    if (
      this.securityConfig.requireConfirmationForWarnings &&
      riskAssessment.level === 'WARNING' &&
      !confirmed
    ) {
      logSecurityEvent(
        `Unconfirmed remote WARNING command: ${command}`,
        { profileName, host, command, riskAssessment },
        riskAssessment.level,
        false,
      );
      return {
        profile: profileName,
        host,
        command,
        exitCode: -2,
        stdout: '',
        stderr: `[Terminal Guardian] Remote command requires confirmation.\nRisk: ${riskAssessment.level}\nReasons:\n${riskAssessment.reasons.map((r) => `  • ${r}`).join('\n')}\n\nRe-run with confirmed: true to proceed.`,
        duration: Date.now() - startTime,
        timedOut: false,
        timestamp: new Date().toISOString(),
        riskAssessment,
      };
    }

    const fullCommand = cwd ? `cd ${JSON.stringify(cwd)} && ${command}` : command;

    let client;
    try {
      client = await this.manager.getConnection(profileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        profile: profileName,
        host,
        command,
        exitCode: -1,
        stdout: '',
        stderr: `SSH connection failed: ${msg}`,
        duration: Date.now() - startTime,
        timedOut: false,
        timestamp: new Date().toISOString(),
        riskAssessment,
      };
    }

    try {
      const result = await this.runRemote(client, fullCommand, timeout);
      const duration = Date.now() - startTime;

      logCommand(`[ssh:${profileName}] ${command}`, {
        profileName,
        host,
        exitCode: result.exitCode,
        duration,
        timedOut: result.timedOut,
        riskLevel: riskAssessment.level,
      });

      return {
        profile: profileName,
        host,
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration,
        timedOut: result.timedOut,
        timestamp: new Date().toISOString(),
        riskAssessment,
      };
    } finally {
      this.manager.releaseConnection(profileName);
    }
  }

  private runRemote(
    client: import('ssh2').Client,
    command: string,
    timeout: number,
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const MAX_OUTPUT = 512_000;

      client.exec(command, (err, stream) => {
        if (err) {
          resolve({ exitCode: -1, stdout: '', stderr: err.message, timedOut: false });
          return;
        }

        const timer = setTimeout(() => {
          timedOut = true;
          stream.close();
          stream.destroy();
        }, timeout);

        stream.on('data', (chunk: Buffer) => {
          if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf-8');
        });

        stream.stderr?.on('data', (chunk: Buffer) => {
          if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf-8');
        });

        stream.on('close', (code: number | null) => {
          clearTimeout(timer);
          resolve({
            exitCode: code ?? -1,
            stdout: stdout.slice(0, MAX_OUTPUT),
            stderr: stderr.slice(0, MAX_OUTPUT),
            timedOut,
          });
        });

        stream.on('error', (streamErr: Error) => {
          clearTimeout(timer);
          resolve({ exitCode: -1, stdout, stderr: streamErr.message, timedOut });
        });
      });
    });
  }
}