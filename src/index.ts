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
} from './tools/schemas.js';

// ─── Bootstrap ───────────────────────────────────────────────
const config = loadConfig(process.env['GUARDIAN_CONFIG']);
const logger = initLogger(config.logging);

const executor = new TerminalExecutor(config);
const filesystem = new FilesystemManager(config.workspace);
const docker = new DockerManager(config.docker);
const git = new GitManager(config.git, config.workspace.rootDir);
const rateLimiter = new RateLimiter(config.rateLimit);

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
