import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { GuardianConfig } from '../types/index.js';

const DEFAULT_CONFIG: GuardianConfig = {
  workspace: {
    rootDir: '.',
    allowedPaths: ['.'],
    maxFileSize: 10_485_760,
    maxFilesPerOperation: 100,
  },
  execution: {
    timeout: 30_000,
    maxOutputSize: 1_048_576,
    maxConcurrentProcesses: 5,
    shell: 'auto',
  },
  security: {
    enableRiskAnalysis: true,
    blockDangerousCommands: true,
    requireConfirmationForWarnings: true,
    allowSudo: false,
    allowNetworkCommands: true,
    customBlocklist: [],
    customAllowlist: [],
  },
  rateLimit: {
    enabled: true,
    maxRequestsPerMinute: 60,
    maxRequestsPerHour: 500,
  },
  docker: {
    enabled: false,
    socketPath: '/var/run/docker.sock',
    allowContainerRestart: false,
    allowLogAccess: true,
  },
  git: {
    enabled: true,
    allowPush: false,
    allowCommit: false,
    maxLogEntries: 50,
  },
  logging: {
    enabled: true,
    level: 'info',
    logDir: './logs',
    logCommands: true,
    logOutputs: false,
    logSecurityEvents: true,
    prettyPrint: false,
  },
  ssh: {
    enabled: false,
    timeout: 30_000,
    keepaliveInterval: 10_000,
    maxConnections: 5,
    profiles: {},
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result;
}

export function loadConfig(configPath?: string): GuardianConfig {
  const searchPaths = [
    configPath,
    './terminal-guardian.config.json',
    '../terminal-guardian.config.json',
    process.env['GUARDIAN_CONFIG'],
  ].filter(Boolean) as string[];

  for (const p of searchPaths) {
    const resolved = resolve(p);
    if (existsSync(resolved)) {
      try {
        const raw = readFileSync(resolved, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<GuardianConfig>;
        return deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, parsed as Record<string, unknown>) as unknown as GuardianConfig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse config at ${resolved}: ${msg}`);
      }
    }
  }

  return DEFAULT_CONFIG;
}

export { DEFAULT_CONFIG };
