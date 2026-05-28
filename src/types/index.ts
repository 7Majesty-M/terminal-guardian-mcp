// ============================================================
// Terminal Guardian MCP — Core Types
// ============================================================

export type RiskLevel = 'SAFE' | 'WARNING' | 'DANGEROUS' | 'BLOCKED';

export interface RiskAssessment {
  level: RiskLevel;
  score: number; // 0-100
  reasons: string[];
  patterns: string[];
  requiresConfirmation: boolean;
  blocked: boolean;
  recommendation: string;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number; // ms
  timedOut: boolean;
  workingDir: string;
  timestamp: string;
  riskAssessment: RiskAssessment;
}

export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'unknown';
  size: number;
  modified: string;
  permissions: string;
  extension?: string | undefined;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  lines: number;
  encoding: string;
  mimeType?: string | undefined;
}

export interface SearchResult {
  path: string;
  line?: number | undefined;
  column?: number | undefined;
  match: string;
  context?: string | undefined;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
  ports: Array<{
    privatePort: number;
    publicPort?: number | undefined;
    type: string;
  }>;
  labels: Record<string, string>;
}

export interface DockerStats {
  containerId: string;
  name: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkIn: number;
  networkOut: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
  timestamp: string;
}

export interface GitStatus {
  branch: string;
  upstream?: string | undefined;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
  conflicted: string[];
  isClean: boolean;
}

export interface GitFileChange {
  path: string;
  status: string;
  statusLabel: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  email: string;
  date: string;
  refs: string[];
}

export interface GitDiff {
  file: string;
  additions: number;
  deletions: number;
  chunks: GitDiffChunk[];
}

export interface GitDiffChunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface SessionLogEntry {
  id: string;
  timestamp: string;
  type: 'command' | 'file_access' | 'docker' | 'git' | 'security_event' | 'tool_call';
  action: string;
  details: Record<string, unknown>;
  riskLevel?: RiskLevel | undefined;
  blocked?: boolean | undefined;
  duration?: number | undefined;
}

export interface GuardianConfig {
  workspace: {
    rootDir: string;
    allowedPaths: string[];
    maxFileSize: number;
    maxFilesPerOperation: number;
  };
  execution: {
    timeout: number;
    maxOutputSize: number;
    maxConcurrentProcesses: number;
    shell: string;
  };
  security: {
    enableRiskAnalysis: boolean;
    blockDangerousCommands: boolean;
    requireConfirmationForWarnings: boolean;
    allowSudo: boolean;
    allowNetworkCommands: boolean;
    customBlocklist: string[];
    customAllowlist: string[];
  };
  rateLimit: {
    enabled: boolean;
    maxRequestsPerMinute: number;
    maxRequestsPerHour: number;
  };
  docker: {
    enabled: boolean;
    socketPath: string;
    allowContainerRestart: boolean;
    allowLogAccess: boolean;
  };
  git: {
    enabled: boolean;
    allowPush: boolean;
    allowCommit: boolean;
    maxLogEntries: number;
  };
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
    logDir: string;
    logCommands: boolean;
    logOutputs: boolean;
    logSecurityEvents: boolean;
    prettyPrint: boolean;
  };
  ssh: {
    enabled: boolean;
    timeout: number;
    keepaliveInterval: number;
    maxConnections: number;
    profiles: Record<string, SshProfile>;
  };
}

export interface ToolResponse<T = unknown> {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

// ── SSH ──────────────────────────────────────────────────────

export interface SshProfile {
  host: string;
  port?: number | undefined;
  username: string;
  privateKeyPath?: string | undefined;
  password?: string | undefined;
  passphrase?: string | undefined;
  fingerprint?: string | undefined;
}

export interface SshCommandResult {
  profile: string;
  host: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
  timestamp: string;
  riskAssessment: import('./index.js').RiskAssessment;
}

export interface SshTestResult {
  profile: string;
  host: string;
  port: number;
  username: string;
  connected: boolean;
  latencyMs?: number | undefined;
  serverVersion?: string | undefined;
  error?: string | undefined;
}