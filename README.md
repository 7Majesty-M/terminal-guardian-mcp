<div align="center">

<img src="https://raw.githubusercontent.com/7Majesty-M/terminal-guardian-mcp/main/docs/assets/banner.png" alt="Terminal Guardian MCP" width="100%" />

# Terminal Guardian MCP

**Secure, sandboxed terminal access for AI assistants via the Model Context Protocol**

[![CI](https://github.com/7Majesty-M/terminal-guardian-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/7Majesty-M/terminal-guardian-mcp/actions)
[![npm version](https://img.shields.io/npm/v/terminal-guardian-mcp?label=npm)](https://www.npmjs.com/package/terminal-guardian-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)

[Features](#features) · [Quick Start](#quick-start) · [Claude Desktop](#claude-desktop-integration) · [Tools](#mcp-tools) · [Security](#security-philosophy) · [Configuration](#configuration) · [Windows](#windows-support) · [Roadmap](#roadmap)

</div>

---

## Overview

**Terminal Guardian MCP** is a production-grade [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI assistants like Claude **safe, controlled, and auditable access to your terminal**. Every command is analyzed for risk, logged with full context, and executed inside configurable safety boundaries.

Built for developers who want to leverage AI in their workflows without compromising system integrity.

```
AI Assistant → Terminal Guardian MCP → Risk Analysis → Sandboxed Execution → Structured Result
```

> ⚠️ **This server provides real terminal access.** Configure it carefully. Review the [Security Philosophy](#security-philosophy) before deploying.

---

## Features

### 🛡️ Risk Analysis Engine
Every command passes through a multi-layer safety analysis before execution:

| Risk Level | Example Commands | Behavior |
|------------|-----------------|----------|
| `SAFE` | `ls`, `git status`, `npm list` | Executed immediately |
| `WARNING` | `rm -rf ./dist`, `docker stop app` | Requires explicit confirmation |
| `DANGEROUS` | `sudo apt-get`, `curl \| bash` | Blocked by default |
| `BLOCKED` | `rm -rf /`, `shutdown`, fork bombs | Always blocked, always logged |

### ⚡ Secure Terminal Execution
- Shell command execution with full `stdout`/`stderr` capture
- Configurable per-command timeouts (default: 30s, max: 5m)
- SIGTERM → SIGKILL escalation for hanging processes
- Working directory isolation within workspace root
- Output size limits to prevent memory exhaustion
- Cross-platform: auto-detects bash, sh, PowerShell, or cmd

### 🔎 Process Management
- List all running processes with CPU, memory, PID, and command
- Filter by name or command substring, sort by CPU / memory / PID / name
- Terminate processes by PID with signal control (SIGTERM / SIGKILL / SIGINT / SIGHUP)
- Protected PID list — system processes (init, systemd, launchd, PID 0/1) can never be killed
- SIGKILL requires `confirmed: true` as an additional safety gate

### 🔐 Environment Variables
- Inspect environment variables with **automatic secret masking**
- Secrets are never revealed in full — shown as `sk**...xy` format
- Auto-detects secrets by key name (`API_KEY`, `TOKEN`, `PASSWORD`, `DATABASE_URL`, `SECRET`, ...)
- Auto-detects secrets by value shape (base64 blobs, JWTs, GitHub/Stripe/Slack/OpenAI tokens)
- Filter by key name, category (`secret`, `path`, `system`, `runtime`, `unknown`), or fetch specific keys
- Safe to use even in projects with `.env` files loaded at runtime

### 📁 Filesystem Access
- File listing, reading, and content search
- Configurable workspace root with path traversal prevention
- Glob pattern matching for targeted file searches
- Project structure analysis with language detection

### 🐳 Docker Integration *(optional)*
- List and inspect containers
- Read container logs with timestamp support
- Real-time resource stats (CPU, memory, network, block I/O)
- Container restart with confirmation gate
- Disabled by default — opt-in via config

### 🌿 Git Repository Analysis
- Full `git status` with staged/unstaged/untracked breakdown
- Diff viewer with per-file additions/deletions
- Commit history with author, date, and refs
- Branch listing (local + remote)
- Read-only by default (push/commit require explicit opt-in)

### 📊 Session Logging
- Structured JSON logs via [pino](https://getpino.io)
- Every command, tool call, and security event is recorded
- Configurable log levels and output destinations
- Optional output logging (disabled by default for privacy)

### 🔒 Rate Limiting
- Per-minute and per-hour request limits
- In-memory bucket algorithm with automatic reset
- Clear error messages with retry-after hints

---

## Quick Start

### Prerequisites

- Node.js ≥ 18.0.0
- npm or yarn

### Install from npm

```bash
npm install -g terminal-guardian-mcp
```

### Install from source

```bash
git clone https://github.com/7Majesty-M/terminal-guardian-mcp.git
cd terminal-guardian-mcp
npm install
npm run build
```

### Run directly

```bash
terminal-guardian-mcp
# or from source:
node dist/index.js
```

---

## Claude Desktop Integration

Add Terminal Guardian to your Claude Desktop configuration:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "terminal-guardian": {
      "command": "npx",
      "args": ["terminal-guardian-mcp"],
      "env": {
        "GUARDIAN_CONFIG": "/path/to/your/terminal-guardian.config.json"
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "terminal-guardian": {
      "command": "terminal-guardian-mcp",
      "env": {
        "GUARDIAN_CONFIG": "/absolute/path/to/terminal-guardian.config.json"
      }
    }
  }
}
```

After saving, **restart Claude Desktop**. You should see Terminal Guardian appear in the tools list.

---

## MCP Tools

Terminal Guardian exposes **14 tools** across 5 domains.

### Terminal

#### `run_command`
Execute a shell command with full safety analysis.

```json
{
  "command": "npm run build",
  "cwd": "./my-project",
  "timeout": 60000,
  "confirmed": false
}
```

**Returns:**
```json
{
  "success": true,
  "data": {
    "command": "npm run build",
    "exitCode": 0,
    "stdout": "...",
    "stderr": "",
    "duration": 4230,
    "timedOut": false,
    "workingDir": "/workspace/my-project",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "riskAssessment": {
      "level": "SAFE",
      "score": 5,
      "reasons": ["No dangerous patterns detected"],
      "blocked": false
    }
  }
}
```

#### `analyze_command`
Analyze a command without running it.

```json
{ "command": "rm -rf ./old-build" }
```

**Returns:**
```json
{
  "level": "WARNING",
  "score": 40,
  "reasons": ["Recursive deletion — verify target path carefully"],
  "requiresConfirmation": true,
  "blocked": false,
  "recommendation": "Review this command carefully before proceeding."
}
```

### Processes

#### `list_processes`
List running system processes sorted by CPU, memory, PID, or name.

```json
{
  "filter": "node",
  "sortBy": "memory",
  "limit": 20
}
```

**Returns:**
```json
{
  "success": true,
  "data": [
    {
      "pid": 12345,
      "ppid": 1,
      "name": "node",
      "command": "node dist/index.js",
      "cpu": 2.4,
      "memory": 52428800,
      "status": "S",
      "user": "dev",
      "started": "10:30"
    }
  ],
  "metadata": { "count": 3, "platform": "linux" }
}
```

#### `kill_process`
Terminate a process by PID. System processes are always protected.

```json
{
  "pid": 12345,
  "signal": "SIGTERM"
}
```

> Use `"signal": "SIGKILL"` with `"confirmed": true` for force kill.

**Returns:**
```json
{
  "success": true,
  "data": { "pid": 12345, "signal": "SIGTERM", "success": true }
}
```

### Environment

#### `get_env`
Read environment variables with automatic secret masking.

```json
{ "filter": "NODE" }
```

Fetch specific keys:
```json
{ "keys": ["NODE_ENV", "PORT", "DATABASE_URL"] }
```

**Returns:**
```json
{
  "success": true,
  "data": {
    "total": 3,
    "masked": 1,
    "visible": 2,
    "categories": { "runtime": 2, "secret": 1, "path": 0, "system": 0, "app": 0, "unknown": 0 },
    "variables": [
      { "key": "NODE_ENV",     "value": "production", "masked": false, "category": "runtime" },
      { "key": "PORT",         "value": "3000",        "masked": false, "category": "unknown" },
      { "key": "DATABASE_URL", "value": "po**...db",   "masked": true,  "category": "secret"  }
    ]
  }
}
```

Secret masking examples:

| Original value | Shown as |
|----------------|----------|
| `sk-proj-abc123...xyz` | `sk**...yz` |
| `postgres://user:pass@host/db` | `po**...db` |
| `eyJhbGci...` (JWT) | `ey**...` |
| `ab` (too short) | `****` |

### Filesystem

#### `list_files`
```json
{ "path": "./src", "recursive": true }
```

#### `read_file`
```json
{ "path": "./src/index.ts" }
```

#### `search_files`
```json
{ "query": "TODO", "path": "./src", "pattern": "**/*.ts" }
```

### Docker *(requires `docker.enabled: true`)*

#### `docker_ps`
```json
{ "all": true }
```

#### `docker_logs`
```json
{ "container": "my-app", "tail": 200, "timestamps": true }
```

#### `docker_stats`
```json
{ "container": "my-app" }
```

### Git

#### `git_status`
```json
{ "path": "." }
```

#### `git_diff`
```json
{ "staged": false, "file": "src/api.ts" }
```

#### `git_log`
```json
{ "limit": 20 }
```

---

## Architecture

```
terminal-guardian-mcp/
├── src/
│   ├── index.ts              # MCP server entrypoint & tool routing (14 tools)
│   ├── types/
│   │   └── index.ts          # Shared TypeScript types
│   ├── config/
│   │   └── loader.ts         # Config file loading with deep merge
│   ├── security/
│   │   ├── riskAnalyzer.ts   # Multi-layer command risk analysis engine
│   │   └── rateLimiter.ts    # Per-minute/hour request throttling
│   ├── tools/
│   │   ├── executor.ts       # Cross-platform shell execution engine
│   │   ├── processManager.ts # Process listing and safe termination
│   │   └── schemas.ts        # Zod input validation schemas
│   ├── system/
│   │   └── envManager.ts     # Env vars with automatic secret masking
│   ├── filesystem/
│   │   └── manager.ts        # Safe file access with path enforcement
│   ├── docker/
│   │   └── manager.ts        # Dockerode integration (optional)
│   ├── git/
│   │   └── manager.ts        # Git operations via child_process
│   └── logging/
│       └── logger.ts         # Pino-based structured logging
├── tests/                    # Vitest unit tests (79 tests)
├── .github/workflows/        # CI/CD pipeline (Node 18/20/22)
├── Dockerfile                # Multi-stage build, non-root user
├── docker-compose.yml
├── terminal-guardian.config.json
└── README.md
```

### Design Principles

- **Security First**: Risk analysis runs before every command, not as an afterthought
- **Least Privilege**: Docker disabled, git write-operations disabled, sudo blocked by default
- **Never Reveal Secrets**: Env vars masked at read time — raw values never reach the AI context
- **Transparency**: Every action is logged with full context
- **Defense in Depth**: Multiple independent safety layers (blocklist → pattern analysis → rate limit → output limits)
- **Type Safety**: Strict TypeScript + Zod runtime validation on all tool inputs
- **Cross-Platform**: Auto-detects the right shell on Linux, macOS, and Windows

---

## Configuration

Create `terminal-guardian.config.json` in your project root (or specify via `GUARDIAN_CONFIG` env var):

```json
{
  "workspace": {
    "rootDir": "/home/user/projects",
    "allowedPaths": ["/home/user/projects", "/home/user/projects/src"],
    "maxFileSize": 10485760,
    "maxFilesPerOperation": 100
  },
  "execution": {
    "timeout": 30000,
    "maxOutputSize": 1048576,
    "maxConcurrentProcesses": 5,
    "shell": "auto"
  },
  "security": {
    "enableRiskAnalysis": true,
    "blockDangerousCommands": true,
    "requireConfirmationForWarnings": true,
    "allowSudo": false,
    "allowNetworkCommands": true,
    "customBlocklist": ["curl.*my-internal-secret.*"],
    "customAllowlist": ["sudo systemctl restart nginx"]
  },
  "rateLimit": {
    "enabled": true,
    "maxRequestsPerMinute": 60,
    "maxRequestsPerHour": 500
  },
  "docker": {
    "enabled": false,
    "socketPath": "/var/run/docker.sock",
    "allowContainerRestart": false,
    "allowLogAccess": true
  },
  "git": {
    "enabled": true,
    "allowPush": false,
    "allowCommit": false,
    "maxLogEntries": 50
  },
  "logging": {
    "enabled": true,
    "level": "info",
    "logDir": "./logs",
    "logCommands": true,
    "logOutputs": false,
    "logSecurityEvents": true,
    "prettyPrint": false
  }
}
```

### Configuration Reference

| Key | Default | Description |
|-----|---------|-------------|
| `workspace.rootDir` | `"."` | Absolute root for all filesystem operations |
| `workspace.maxFileSize` | `10485760` | Max readable file size in bytes (10MB) |
| `execution.timeout` | `30000` | Default command timeout in ms |
| `execution.maxOutputSize` | `1048576` | Max stdout+stderr size in bytes (1MB) |
| `execution.shell` | `"auto"` | Shell — `"auto"` detects bash/pwsh/sh automatically |
| `security.allowSudo` | `false` | Whether sudo commands are permitted |
| `security.customBlocklist` | `[]` | Additional regex patterns to always block |
| `security.customAllowlist` | `[]` | Patterns that bypass risk analysis |
| `docker.enabled` | `false` | Enable Docker tool integration |
| `docker.allowContainerRestart` | `false` | Allow restarting containers |
| `git.allowPush` | `false` | Allow `git push` via run_command |
| `logging.logOutputs` | `false` | Log stdout/stderr (may contain secrets!) |

---

## Security Philosophy

Terminal Guardian operates on a **deny-by-default** model with explicit allowlisting:

### What is always blocked
- Recursive filesystem deletion targeting system paths (`rm -rf /`)
- Fork bombs (`:(){:|:&};:`)
- System power management (`shutdown`, `reboot`, `halt`)
- Filesystem formatting (`mkfs`, `wipefs`, `dd of=/dev/`)
- Reverse shells and TCP redirections
- `chmod 777 /` and similar root-level permission changes

### What requires confirmation
- Recursive deletions of any path
- Docker container stop/kill/remove
- Force kills (`kill -9`, `killall`)
- `kill_process` with `SIGKILL` signal
- Permission modifications (`chmod`, `chown`)
- Git destructive operations (`reset --hard`, `push`)
- Service management (`systemctl stop`)

### What is always safe
- Read-only commands: `ls`, `cat`, `grep`, `find`
- Git inspection: `status`, `log`, `diff`, `branch`
- Docker read operations: `ps`, `images`, `inspect`
- npm read operations: `list`, `outdated`, `audit`
- System info: `whoami`, `uptime`, `df`, `uname`
- `list_processes` — read-only, never modifies state
- `get_env` — secrets masked before they leave the module

### Threat model
- **AI hallucination safety**: Blocks commands that an AI might suggest incorrectly
- **Prompt injection defense**: Rate limiting and explicit confirmation prevent automation abuse
- **Supply chain protection**: Blocks pipe-to-shell patterns (`curl | bash`)
- **Privilege escalation**: sudo blocked by default, must be explicitly allowed per-deployment
- **Data exfiltration**: Output size limits, no secret logging by default
- **Secret leakage**: Env vars masked at read time — raw values never reach the AI context

---

## Windows Support

Terminal Guardian auto-detects the available shell at startup — no manual configuration needed.

| Platform | Default Shell | Fallback |
|----------|--------------|---------|
| Linux / macOS | `/bin/bash` | `/bin/sh` |
| Windows | `pwsh` (PowerShell Core) | `cmd.exe` |

### Windows quick start

```bash
# Option 1: PowerShell Core (recommended)
winget install Microsoft.PowerShell

# Option 2: WSL — shell auto-detects, no config change needed

# Option 3: Git Bash — set path explicitly
```

```json
{
  "execution": {
    "shell": "C:\\Program Files\\Git\\bin\\bash.exe"
  }
}
```

> **Note**: On Windows without WSL, Unix commands like `ls`, `grep`, `cat` require PowerShell equivalents (`Get-ChildItem`, `Select-String`, `Get-Content`) or Git Bash.

---

## Docker Usage

Build and run the server in Docker:

```bash
# Build image
docker build -t terminal-guardian-mcp .

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f terminal-guardian
```

The container runs as a non-root user (`guardian:guardian`) with a read-only root filesystem.

---

## Development

```bash
npm install          # Install dependencies
npm run dev          # Start in watch mode
npm test             # Run tests
npm run test:coverage
npm run typecheck
npm run lint
npm run format
npm run build
```

---

## Usage Examples

### With Claude Desktop

> "Check the git status of my project and tell me what files have changed"

> "Which process is eating the most CPU right now?"

> "Show me all environment variables related to Node — but keep secrets masked"

> "Run the test suite and show me any failures"

> "There's a hung process using 4GB of RAM — find it and kill it gracefully"

> "List Docker containers and check if the database is healthy"

### Tool call examples

**Safe command:**
```
User: Run `ls -la` in the src directory
Claude: [calls run_command {"command": "ls -la", "cwd": "src"}]
→ Returns file listing immediately (SAFE level)
```

**Command requiring confirmation:**
```
User: Clean up the dist directory
Claude: [calls analyze_command, sees WARNING]
        "rm -rf ./dist requires confirmation — it will recursively delete dist/. Proceed?"
User: Yes
Claude: [calls run_command with confirmed: true]
```

**Blocked command:**
```
User: Run rm -rf /
Claude: [run_command returns BLOCKED]
        "Terminal Guardian has blocked this — it would delete the entire root filesystem."
```

**Process management:**
```
User: Something is using all my memory
Claude: [calls list_processes {"sortBy": "memory", "limit": 5}]
        "Top consumer: 'chrome' at PID 8821, using 2.1GB. Want me to kill it?"
User: Yes
Claude: [calls kill_process {"pid": 8821, "signal": "SIGTERM"}]
        "Sent SIGTERM to PID 8821 — chrome terminated."
```

**Environment inspection:**
```
User: What's my Node version and runtime environment?
Claude: [calls get_env {"filter": "NODE"}]
        "NODE_ENV=production, NODE_VERSION=20.11.0.
         DATABASE_URL and API_KEY are also present — values masked for security."
```

---

## Roadmap

### Released

- [x] **v1.0** — Secure terminal execution with risk analysis engine
- [x] **v1.0** — Filesystem access with path traversal protection
- [x] **v1.0** — Git repository analysis (status, diff, log, branches)
- [x] **v1.0** — Docker integration (ps, logs, stats, restart)
- [x] **v1.0** — Session logging, rate limiting, configurable security
- [x] **v1.0** — Cross-platform shell auto-detection (Linux / macOS / Windows)
- [x] **v1.1** — Process management (`list_processes`, `kill_process`)
- [x] **v1.1** — Environment variable inspection with automatic secret masking

### Planned

- [ ] **v1.2** — Docker container exec with sandbox isolation
- [ ] **v1.2** — Network diagnostics (`ping`, `curl` with output limits)
- [ ] **v1.3** — AI-powered commit message generation via git diff analysis
- [ ] **v1.3** — Workspace templates for common project types
- [ ] **v1.4** — WebSocket transport support (alongside stdio)
- [ ] **v1.5** — Remote SSH execution with key-based auth
- [ ] **v2.0** — Full gVisor/nsjail sandbox integration
- [ ] **v2.0** — Per-session permission scoping
- [ ] **v2.0** — Audit log export (JSON/CSV/SIEM formats)

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m 'feat: add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

Please ensure all tests pass, TypeScript compiles, and new security patterns have test coverage.

---

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io) — The protocol specification
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — Official SDK
- [Claude Desktop](https://claude.ai/download) — The AI assistant this was built for

---

## License

MIT © [Terminal Guardian Contributors](LICENSE)

---

<div align="center">

Built with ❤️ for the AI infrastructure community

**[⭐ Star this project](https://github.com/7Majesty-M/terminal-guardian-mcp)** if it's useful to you

</div>