#!/usr/bin/env node
/**
 * Terminal Guardian MCP
 * Secure Model Context Protocol server for safe terminal access
 *
 * @license MIT
 * @see https://github.com/7Majesty-M/terminal-guardian-mcp
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config/loader.js';
import { initLogger, getLogger } from './logging/logger.js';
import { TerminalExecutor } from './tools/executor.js';
import { FilesystemManager } from './filesystem/manager.js';
import { DockerManager } from './docker/manager.js';
import { GitManager } from './git/manager.js';
import { RateLimiter } from './security/rateLimiter.js';
import { analyzeCommand } from './security/riskAnalyzer.js';
import { ping, httpRequest, dnsLookup } from './network/diagnostics.js';
import { generateCommitMessages } from './git/commitGenerator.js';
import { listTemplates, applyTemplate } from './workspace/templates.js';

import {
  RunCommandSchema,
  AnalyzeCommandSchema,
  ListFilesSchema,
  ReadFileSchema,
  SearchFilesSchema,
  DockerPsSchema,
  DockerLogsSchema,
  DockerStatsSchema,
  DockerRestartSchema,
  GitStatusSchema,
  GitDiffSchema,
  GitLogSchema,
  ListProcessesSchema,
  KillProcessSchema,
  GetEnvSchema,
  PingSchema,
  HttpRequestSchema,
  DnsLookupSchema,
  DockerExecSchema,
  GitSuggestCommitSchema,
  ListTemplatesSchema,
  ApplyTemplateSchema,
} from './tools/schemas.js';
import { listProcesses, killProcess } from './tools/processManager.js';
import { EnvManager } from './system/envManager.js';

// ─── Bootstrap ───────────────────────────────────────────────
const config = loadConfig(process.env['GUARDIAN_CONFIG']);
const logger = initLogger(config.logging);

const executor = new TerminalExecutor(config);
const filesystem = new FilesystemManager(config.workspace);
const docker = new DockerManager(config.docker);
const git = new GitManager(config.git, config.workspace.rootDir);
const rateLimiter = new RateLimiter(config.rateLimit);
const envManager = new EnvManager();

logger.info({ version: '1.0.0', workspace: config.workspace.rootDir }, 'Terminal Guardian MCP starting');

// ─── Tool Definitions ─────────────────────────────────────────
const TOOLS: Tool[] = [
  {
    name: 'run_command',
    description:
      'Execute a shell command in a secure sandboxed environment with risk analysis, timeout enforcement, and output capture. Commands are analyzed for safety before execution.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory relative to workspace root' },
        timeout: { type: 'number', description: 'Execution timeout in milliseconds (default: 30000)' },
        confirmed: { type: 'boolean', description: 'Set to true to confirm execution of WARNING-level commands' },
      },
      required: ['command'],
    },
  },
  {
    name: 'analyze_command',
    description:
      'Analyze a shell command for safety risks without executing it. Returns risk level (SAFE/WARNING/DANGEROUS/BLOCKED), reasons, and recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to analyze' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_files',
    description:
      'List files and directories within the workspace. Access is restricted to allowed paths.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to workspace root (default: ".")' },
        recursive: { type: 'boolean', description: 'Whether to list files recursively' },
      },
    },
  },
  {
    name: 'read_file',
    description:
      'Read the contents of a file within the workspace. Access is restricted to allowed paths and file size limits.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description:
      'Search for text across files in the workspace. Returns matching lines with context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        path: { type: 'string', description: 'Directory to search in' },
        pattern: { type: 'string', description: 'Glob file pattern (e.g., "**/*.ts")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'docker_ps',
    description: 'List Docker containers with their status, image, and port information.',
    inputSchema: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'Include stopped containers (default: true)' },
      },
    },
  },
  {
    name: 'docker_logs',
    description: 'Retrieve logs from a Docker container.',
    inputSchema: {
      type: 'object',
      properties: {
        container: { type: 'string', description: 'Container ID or name' },
        tail: { type: 'number', description: 'Number of log lines to return (default: 100)' },
        timestamps: { type: 'boolean', description: 'Include timestamps' },
      },
      required: ['container'],
    },
  },
  {
    name: 'docker_stats',
    description: 'Get real-time resource usage statistics for a Docker container.',
    inputSchema: {
      type: 'object',
      properties: {
        container: { type: 'string', description: 'Container ID or name' },
      },
      required: ['container'],
    },
  },
  {
    name: 'git_status',
    description:
      'Get the current Git repository status including staged, unstaged, and untracked files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository path relative to workspace root' },
      },
    },
  },
  {
    name: 'git_diff',
    description: 'Show Git diff for working tree or staged changes.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository path' },
        staged: { type: 'boolean', description: 'Show staged changes (default: false)' },
        file: { type: 'string', description: 'Limit diff to specific file' },
      },
    },
  },
  {
    name: 'git_log',
    description: 'Show Git commit history with author, date, and message.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository path' },
        limit: { type: 'number', description: 'Maximum commits to return (default: 20)' },
      },
    },
  },
  {
    name: 'list_processes',
    description:
      'List running system processes with CPU, memory usage, and command info. Supports filtering by name and sorting.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Filter by process name or command' },
        sortBy: { type: 'string', enum: ['cpu', 'memory', 'pid', 'name'], description: 'Sort order (default: cpu)' },
        limit: { type: 'number', description: 'Max results (default: 50)' },
      },
    },
  },
  {
    name: 'git_suggest_commit',
    description:
      'Generate AI-powered commit message suggestions from git diff using Claude. Returns conventional commit format suggestions with type, scope, and subject. Requires ANTHROPIC_API_KEY environment variable.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository path' },
        staged: { type: 'boolean', description: 'Use staged diff (default: true)' },
        count: { type: 'number', description: 'Number of suggestions (1-5, default: 3)' },
        style: { type: 'string', enum: ['conventional', 'simple', 'detailed'], description: 'Commit style' },
      },
    },
  },
  {
    name: 'list_templates',
    description:
      'List available workspace templates for scaffolding new projects. Includes Node.js, TypeScript, Python, FastAPI, React, Next.js, Express, and MCP server templates.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Filter by tag (e.g. "python", "frontend", "mcp")' },
      },
    },
  },
  {
    name: 'apply_template',
    description:
      'Scaffold a new project from a template. Creates files and directories in the target path within the workspace. Safe — cannot write outside workspace root.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          enum: ['node-typescript', 'node-javascript', 'python-fastapi', 'python-cli', 'react-vite', 'nextjs', 'express-api', 'mcp-server'],
          description: 'Template to use',
        },
        projectName: { type: 'string', description: 'Project name' },
        targetDir: { type: 'string', description: 'Target directory (default: ".")' },
        overwrite: { type: 'boolean', description: 'Overwrite existing files' },
      },
      required: ['templateId', 'projectName'],
    },
  },
  {
    name: 'kill_process',
    description:
      'Terminate a process by PID. Uses SIGTERM by default (graceful). SIGKILL requires confirmed=true. System processes are protected.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'PID of the process to terminate' },
        signal: { type: 'string', enum: ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP'], description: 'Signal (default: SIGTERM)' },
        confirmed: { type: 'boolean', description: 'Required for SIGKILL' },
      },
      required: ['pid'],
    },
  },
  {
    name: 'get_env',
    description:
      'Read environment variables with automatic secret masking. Secrets (tokens, passwords, keys) are shown as masked values like "sk**...xy". Never reveals raw secret values.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Filter by key name substring' },
        category: { type: 'string', enum: ['secret', 'path', 'system', 'runtime', 'app', 'unknown'] },
        keys: { type: 'array', items: { type: 'string' }, description: 'Fetch specific keys' },
        includeMasked: { type: 'boolean', description: 'Include masked secrets (default: true)' },
      },
    },
    
  },
  {
    name: 'ping',
    description:
      'Ping a host to check reachability and measure round-trip latency. Private/loopback addresses are blocked by default.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Hostname or IP address to ping' },
        count: { type: 'number', description: 'Number of packets (default: 4, max: 10)' },
        allowPrivate: { type: 'boolean', description: 'Allow private/loopback addresses' },
      },
      required: ['host'],
    },
  },
  {
    name: 'http_request',
    description:
      'Make an HTTP/HTTPS request and return status, headers, and body. Only http:// and https:// allowed. Response body capped at 512KB.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL (http:// or https:// only)' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], description: 'HTTP method' },
        headers: { type: 'object', description: 'Request headers' },
        body: { type: 'string', description: 'Request body for POST/PUT/PATCH' },
        followRedirects: { type: 'boolean', description: 'Follow redirects (default: true)' },
        timeoutMs: { type: 'number', description: 'Timeout in ms (default: 15000)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'dns_lookup',
    description: 'Resolve a hostname to IP addresses using DNS.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Hostname to resolve' },
      },
      required: ['host'],
    },
  },
  {
    name: 'docker_exec',
    description:
      'Execute a command inside a running Docker container. Requires confirmed: true. Output capped at 512KB.',
    inputSchema: {
      type: 'object',
      properties: {
        container: { type: 'string', description: 'Container ID or name' },
        command: { type: 'array', items: { type: 'string' }, description: 'Command as array, e.g. ["ls", "-la"]' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
        confirmed: { type: 'boolean', description: 'Must be true to execute' },
      },
      required: ['container', 'command'],
    },
  },
];

// ─── Server ───────────────────────────────────────────────────
const server = new Server(
  {
    name: 'terminal-guardian-mcp',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  },
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Rate limit check
  const rl = rateLimiter.check();
  if (!rl.allowed) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: rl.reason,
            retryAfter: rl.retryAfter,
          }),
        },
      ],
      isError: true,
    };
  }

  const safeArgs = args ?? {};

  try {
    let result: unknown;

    switch (name) {
      // ── Terminal ──────────────────────────────────────────
      case 'run_command': {
        const input = RunCommandSchema.parse(safeArgs);
        const cmdResult = await executor.execute(input.command, {
          cwd: input.cwd,
          timeout: input.timeout,
          confirmed: input.confirmed,
        });
        result = {
          success: cmdResult.exitCode === 0,
          data: cmdResult,
        };
        break;
      }

      case 'analyze_command': {
        const input = AnalyzeCommandSchema.parse(safeArgs);
        const assessment = analyzeCommand(input.command, {
          customBlocklist: config.security.customBlocklist,
          customAllowlist: config.security.customAllowlist,
          allowSudo: config.security.allowSudo,
        });
        result = { success: true, data: assessment };
        break;
      }

      // ── Filesystem ────────────────────────────────────────
      case 'list_files': {
        const input = ListFilesSchema.parse(safeArgs);
        const files = filesystem.listFiles(input.path, input.recursive);
        result = { success: true, data: files, metadata: { count: files.length } };
        break;
      }

      case 'read_file': {
        const input = ReadFileSchema.parse(safeArgs);
        const fileContent = filesystem.readFile(input.path);
        result = { success: true, data: fileContent };
        break;
      }

      case 'search_files': {
        const input = SearchFilesSchema.parse(safeArgs);
        const searchResults = await filesystem.searchFiles(input.query, input.path, input.pattern);
        result = { success: true, data: searchResults, metadata: { count: searchResults.length } };
        break;
      }

      // ── Docker ────────────────────────────────────────────
      case 'docker_ps': {
        const input = DockerPsSchema.parse(safeArgs);
        if (!docker.isEnabled()) {
          result = { success: false, error: 'Docker integration is disabled in configuration' };
        } else {
          const containers = await docker.listContainers(input.all);
          result = { success: true, data: containers, metadata: { count: containers.length } };
        }
        break;
      }

      case 'docker_logs': {
        const input = DockerLogsSchema.parse(safeArgs);
        if (!docker.isEnabled()) {
          result = { success: false, error: 'Docker integration is disabled in configuration' };
        } else {
          const logs = await docker.getLogs(input.container, input.tail, input.timestamps);
          result = { success: true, data: { logs, container: input.container } };
        }
        break;
      }

      case 'docker_stats': {
        const input = DockerStatsSchema.parse(safeArgs);
        if (!docker.isEnabled()) {
          result = { success: false, error: 'Docker integration is disabled in configuration' };
        } else {
          const stats = await docker.getStats(input.container);
          result = { success: true, data: stats };
        }
        break;
      }

      case 'list_processes': {
        const input = ListProcessesSchema.parse(safeArgs);
        const procs = listProcesses({
          filter: input.filter,
          sortBy: input.sortBy,
          limit: input.limit,
        });
        result = {
          success: true,
          data: procs,
          metadata: { count: procs.length, platform: process.platform },
        };
        break;
      }

      case 'kill_process': {
        const input = KillProcessSchema.parse(safeArgs);

        // SIGKILL requires explicit confirmation
        if (input.signal === 'SIGKILL' && !input.confirmed) {
          result = {
            success: false,
            error: 'SIGKILL requires confirmed=true — it forcefully kills the process without cleanup. Use SIGTERM first.',
          };
          break;
        }

        const killResult = killProcess(input.pid, input.signal);
        result = { success: killResult.success, data: killResult };
        break;
      }

      case 'get_env': {
        const input = GetEnvSchema.parse(safeArgs);
        const envResult = envManager.getVariables({
          filter: input.filter,
          category: input.category,
          keys: input.keys,
          includeMasked: input.includeMasked,
        });
        result = { success: true, data: envResult };
        break;
      }
      
      // ── Git ───────────────────────────────────────────────
      case 'git_status': {
        const input = GitStatusSchema.parse(safeArgs);
        const status = git.getStatus(input.path);
        result = { success: true, data: status };
        break;
      }

      case 'git_diff': {
        const input = GitDiffSchema.parse(safeArgs);
        const diffs = git.getDiff(input.staged, input.file, input.path);
        result = {
          success: true,
          data: diffs,
          metadata: {
            count: diffs.length,
            totalAdditions: diffs.reduce((s, d) => s + d.additions, 0),
            totalDeletions: diffs.reduce((s, d) => s + d.deletions, 0),
          },
        };
        break;
      }

      case 'git_log': {
        const input = GitLogSchema.parse(safeArgs);
        const entries = git.getLog(input.limit, input.path);
        result = { success: true, data: entries, metadata: { count: entries.length } };
        break;
      }
      
      case 'ping': {
        const input = PingSchema.parse(safeArgs);
        const pingResult = await ping(input.host, input.count, input.allowPrivate);
        result = { success: true, data: pingResult };
        break;
      }

      case 'http_request': {
        const input = HttpRequestSchema.parse(safeArgs);
        const httpResult = await httpRequest(input.url, {
          method: input.method,
          headers: input.headers,
          body: input.body,
          followRedirects: input.followRedirects,
          timeoutMs: input.timeoutMs,
        });
        result = { success: httpResult.statusCode >= 200 && httpResult.statusCode < 400, data: httpResult };
        break;
      }

      case 'dns_lookup': {
        const input = DnsLookupSchema.parse(safeArgs);
        const dnsResult = await dnsLookup(input.host);
        result = { success: true, data: dnsResult };
        break;
      }

      case 'git_suggest_commit': {
        const input = GitSuggestCommitSchema.parse(safeArgs);
        const repoPath = input.path
          ? `${config.workspace.rootDir}/${input.path}`
          : config.workspace.rootDir;

        const diffs = git.getDiff(input.staged ?? true, undefined, input.path);
        const status = git.getStatus(input.path);

        if (diffs.length === 0) {
          result = {
            success: false,
            error: input.staged
              ? 'No staged changes found. Run `git add` first, or set staged: false for working tree diff.'
              : 'No changes found in working tree.',
          };
          break;
        }

        const diffText = diffs.map((d) => {
          const chunks = d.chunks.map((c) => c.lines.join('\n')).join('\n');
          return `--- a/${d.file}\n+++ b/${d.file}\n${chunks}`;
        }).join('\n\n');

        const stagedFiles = input.staged
          ? status.staged.map((f) => f.path)
          : status.unstaged.map((f) => f.path);

        const commitResult = await generateCommitMessages({
          diff: diffText,
          stagedFiles,
          branch: status.branch,
          count: input.count,
          style: input.style,
        });

        result = { success: true, data: commitResult };
        break;
      }

      case 'list_templates': {
        const input = ListTemplatesSchema.parse(safeArgs);
        let templates = listTemplates();
        if (input.tag) {
          templates = templates.filter((t) =>
            t.tags.includes(input.tag!.toLowerCase()),
          );
        }
        result = {
          success: true,
          data: templates.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            tags: t.tags,
            fileCount: t.files.length,
            postInstall: t.postInstall ?? [],
          })),
          metadata: { count: templates.length },
        };
        break;
      }

      case 'apply_template': {
        const input = ApplyTemplateSchema.parse(safeArgs);
        const applyResult = applyTemplate({
          templateId: input.templateId as import('./workspace/templates.js').TemplateId,
          projectName: input.projectName,
          targetDir: input.targetDir ?? '.',
          rootDir: config.workspace.rootDir,
          overwrite: input.overwrite,
        });
        result = { success: true, data: applyResult };
        break;
      }

      case 'docker_exec': {
        const input = DockerExecSchema.parse(safeArgs);
        if (!docker.isEnabled()) {
          result = { success: false, error: 'Docker integration is disabled in configuration' };
          break;
        }
        if (!input.confirmed) {
          result = {
            success: false,
            error: 'docker_exec requires confirmed: true — executing commands inside containers can be destructive.',
          };
          break;
        }
        const execResult = await docker.execContainer(input.container, input.command, input.timeout);
        result = { success: execResult.exitCode === 0, data: execResult };
        break;
      }

      default:
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }) }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ tool: name, error: message }, 'Tool execution error');
    return {
      content: [
        { type: 'text', text: JSON.stringify({ success: false, error: message }) },
      ],
      isError: true,
    };
  }
});

// ─── Start ────────────────────────────────────────────────────
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('\n✅ Terminal Guardian MCP server started successfully\n');
  process.stderr.write(`   Workspace : ${config.workspace.rootDir}\n`);
  process.stderr.write(`   Log dir   : ${config.logging.logDir}\n`);
  process.stderr.write(`   Log level : ${config.logging.level}\n\n`);
  logger.info('Terminal Guardian MCP server ready');
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal error: ${message}\n`);
  process.stderr.write('   Server failed to start. Check your config.\n\n');
  process.exit(1);
});
