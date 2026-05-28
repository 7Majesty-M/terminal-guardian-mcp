import { z } from 'zod';

// ============================================================
// MCP Tool Input Schemas
// ============================================================

export const RunCommandSchema = z.object({
  command: z.string().min(1).max(4096).describe('Shell command to execute'),
  cwd: z
    .string()
    .optional()
    .describe('Working directory relative to workspace root'),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(300_000)
    .optional()
    .describe('Execution timeout in milliseconds (default: 30000)'),
  confirmed: z
    .boolean()
    .optional()
    .default(false)
    .describe('Set to true to confirm execution of WARNING-level commands'),
});

export const AnalyzeCommandSchema = z.object({
  command: z.string().min(1).max(4096).describe('Shell command to analyze for safety'),
});

export const ListFilesSchema = z.object({
  path: z
    .string()
    .optional()
    .default('.')
    .describe('Directory path relative to workspace root'),
  recursive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to list files recursively'),
});

export const ReadFileSchema = z.object({
  path: z.string().min(1).describe('File path relative to workspace root'),
});

export const SearchFilesSchema = z.object({
  query: z.string().min(1).max(256).describe('Text to search for'),
  path: z
    .string()
    .optional()
    .default('.')
    .describe('Directory to search in (relative to workspace root)'),
  pattern: z
    .string()
    .optional()
    .default('**/*')
    .describe('Glob pattern to match files (e.g., "**/*.ts")'),
});

export const DockerPsSchema = z.object({
  all: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include stopped containers'),
});

export const DockerLogsSchema = z.object({
  container: z.string().min(1).describe('Container ID or name'),
  tail: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional()
    .default(100)
    .describe('Number of log lines to return'),
  timestamps: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include timestamps in log output'),
});

export const DockerStatsSchema = z.object({
  container: z.string().min(1).describe('Container ID or name'),
});

export const DockerRestartSchema = z.object({
  container: z.string().min(1).describe('Container ID or name'),
  confirmed: z
    .boolean()
    .optional()
    .default(false)
    .describe('Confirm container restart (required)'),
});

export const GitStatusSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Repository path relative to workspace root'),
});

export const GitDiffSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Repository path relative to workspace root'),
  staged: z
    .boolean()
    .optional()
    .default(false)
    .describe('Show staged changes instead of working tree diff'),
  file: z.string().optional().describe('Limit diff to a specific file'),
});

export const GitLogSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Repository path relative to workspace root'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Maximum number of commits to return'),
});

export type RunCommandInput = z.infer<typeof RunCommandSchema>;
export type AnalyzeCommandInput = z.infer<typeof AnalyzeCommandSchema>;
export type ListFilesInput = z.infer<typeof ListFilesSchema>;
export type ReadFileInput = z.infer<typeof ReadFileSchema>;
export type SearchFilesInput = z.infer<typeof SearchFilesSchema>;
export type DockerPsInput = z.infer<typeof DockerPsSchema>;
export type DockerLogsInput = z.infer<typeof DockerLogsSchema>;
export type DockerStatsInput = z.infer<typeof DockerStatsSchema>;
export type DockerRestartInput = z.infer<typeof DockerRestartSchema>;
export type GitStatusInput = z.infer<typeof GitStatusSchema>;
export type GitDiffInput = z.infer<typeof GitDiffSchema>;
export type GitLogInput = z.infer<typeof GitLogSchema>;

// ── Process Management ────────────────────────────────────────

export const ListProcessesSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe('Filter processes by name or command substring'),
  sortBy: z
    .enum(['cpu', 'memory', 'pid', 'name'])
    .optional()
    .default('cpu')
    .describe('Sort order (default: cpu)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe('Max number of processes to return (default: 50)'),
});

export const KillProcessSchema = z.object({
  pid: z
    .number()
    .int()
    .min(1)
    .describe('PID of the process to terminate'),
  signal: z
    .enum(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP'])
    .optional()
    .default('SIGTERM')
    .describe('Signal to send (default: SIGTERM — graceful shutdown)'),
  confirmed: z
    .boolean()
    .optional()
    .default(false)
    .describe('Required for SIGKILL — force kill without cleanup'),
});

// ── Environment Variables ─────────────────────────────────────

export const GetEnvSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe('Filter variables by key name substring (e.g. "NODE")'),
  category: z
    .enum(['secret', 'path', 'system', 'runtime', 'app', 'unknown'])
    .optional()
    .describe('Filter by variable category'),
  keys: z
    .array(z.string())
    .optional()
    .describe('Fetch specific variables by exact key name'),
  includeMasked: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include secret variables (shown masked). Default: true'),
});

export type ListProcessesInput = z.infer<typeof ListProcessesSchema>;
export type KillProcessInput = z.infer<typeof KillProcessSchema>;
export type GetEnvInput = z.infer<typeof GetEnvSchema>;

// ── Network Diagnostics ───────────────────────────────────────

export const PingSchema = z.object({
  host: z
    .string()
    .min(1)
    .max(253)
    .describe('Hostname or IP address to ping'),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(4)
    .describe('Number of ping packets (default: 4, max: 10)'),
  allowPrivate: z
    .boolean()
    .optional()
    .default(false)
    .describe('Allow pinging private/loopback addresses'),
});

export const HttpRequestSchema = z.object({
  url: z
    .string()
    .url()
    .describe('Target URL (http:// or https:// only)'),
  method: z
    .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
    .optional()
    .default('GET')
    .describe('HTTP method (default: GET)'),
  headers: z
    .record(z.string())
    .optional()
    .describe('Request headers as key-value pairs'),
  body: z
    .string()
    .optional()
    .describe('Request body (for POST, PUT, PATCH)'),
  followRedirects: z
    .boolean()
    .optional()
    .default(true)
    .describe('Follow HTTP redirects (default: true)'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30_000)
    .optional()
    .default(15_000)
    .describe('Request timeout in ms (default: 15000)'),
});

export const DnsLookupSchema = z.object({
  host: z
    .string()
    .min(1)
    .max(253)
    .describe('Hostname to resolve'),
});

// ── Docker Exec ───────────────────────────────────────────────

export const DockerExecSchema = z.object({
  container: z
    .string()
    .min(1)
    .describe('Container ID or name'),
  command: z
    .array(z.string())
    .min(1)
    .describe('Command to execute as array, e.g. ["ls", "-la", "/app"]'),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(120_000)
    .optional()
    .default(30_000)
    .describe('Execution timeout in ms (default: 30000)'),
  confirmed: z
    .boolean()
    .optional()
    .default(false)
    .describe('Required — exec inside a container requires explicit confirmation'),
});

export type PingInput = z.infer<typeof PingSchema>;
export type HttpRequestInput = z.infer<typeof HttpRequestSchema>;
export type DnsLookupInput = z.infer<typeof DnsLookupSchema>;
export type DockerExecInput = z.infer<typeof DockerExecSchema>;

// ── AI Commit Generator ───────────────────────────────────────

export const GitSuggestCommitSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Repository path relative to workspace root'),
  staged: z
    .boolean()
    .optional()
    .default(true)
    .describe('Use staged diff (default: true). False = working tree diff'),
  count: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .default(3)
    .describe('Number of suggestions to generate (default: 3)'),
  style: z
    .enum(['conventional', 'simple', 'detailed'])
    .optional()
    .default('conventional')
    .describe('Commit message style (default: conventional)'),
});

// ── Workspace Templates ───────────────────────────────────────

export const ListTemplatesSchema = z.object({
  tag: z
    .string()
    .optional()
    .describe('Filter templates by tag (e.g. "python", "frontend", "mcp")'),
});

export const ApplyTemplateSchema = z.object({
  templateId: z
    .enum([
      'node-typescript',
      'node-javascript',
      'python-fastapi',
      'python-cli',
      'react-vite',
      'nextjs',
      'express-api',
      'mcp-server',
    ])
    .describe('Template ID to apply'),
  projectName: z
    .string()
    .min(1)
    .max(128)
    .describe('Project name (used in package.json, README, etc.)'),
  targetDir: z
    .string()
    .optional()
    .default('.')
    .describe('Target directory relative to workspace root (default: ".")'),
  overwrite: z
    .boolean()
    .optional()
    .default(false)
    .describe('Overwrite existing files (default: false)'),
});

export type GitSuggestCommitInput = z.infer<typeof GitSuggestCommitSchema>;
export type ListTemplatesInput = z.infer<typeof ListTemplatesSchema>;
export type ApplyTemplateInput = z.infer<typeof ApplyTemplateSchema>;

// ── SSH ───────────────────────────────────────────────────────

export const SshExecSchema = z.object({
  profile: z
    .string()
    .min(1)
    .describe('SSH profile name from config (e.g. "prod", "staging")'),
  command: z
    .string()
    .min(1)
    .max(4096)
    .describe('Shell command to execute on the remote host'),
  cwd: z
    .string()
    .optional()
    .describe('Working directory on the remote host'),
  timeout: z
    .number()
    .int()
    .min(1000)
    .max(300_000)
    .optional()
    .describe('Execution timeout in ms (default: 30000)'),
  confirmed: z
    .boolean()
    .optional()
    .default(false)
    .describe('Confirm execution of WARNING-level commands'),
});

export const SshTestSchema = z.object({
  profile: z
    .string()
    .min(1)
    .describe('SSH profile name to test connectivity for'),
});

export const SshListProfilesSchema = z.object({});

export type SshExecInput = z.infer<typeof SshExecSchema>;
export type SshTestInput = z.infer<typeof SshTestSchema>;
export type SshListProfilesInput = z.infer<typeof SshListProfilesSchema>;