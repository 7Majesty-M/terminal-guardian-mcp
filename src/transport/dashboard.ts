// ============================================================
// Terminal Guardian MCP — Web Dashboard
// Served at GET / when running in WebSocket transport mode
// ============================================================

export interface DashboardData {
  version: string;
  workspace: string;
  uptime: number;
  activeConnections: number;
  totalConnections: number;
  totalRequests: number;
  blockedRequests: number;
  wsPort: number;
  authEnabled: boolean;
  startedAt: string;
}

export function renderDashboard(data: DashboardData): string {
  const uptimeStr = formatUptime(data.uptime);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Terminal Guardian MCP</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0d0f14;
      --surface: #161920;
      --surface2: #1e2130;
      --border: #2a2d3d;
      --text: #e2e4f0;
      --muted: #6b7094;
      --green: #4ade80;
      --yellow: #fbbf24;
      --red: #f87171;
      --blue: #60a5fa;
      --purple: #a78bfa;
      --accent: #7c3aed;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 14px;
      min-height: 100vh;
      padding: 32px 24px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 40px;
    }

    .logo {
      width: 44px; height: 44px;
      background: var(--accent);
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px;
    }

    .title h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
    .title p  { color: var(--muted); font-size: 12px; margin-top: 2px; }

    .badge {
      margin-left: auto;
      background: color-mix(in srgb, var(--green) 15%, transparent);
      color: var(--green);
      border: 1px solid color-mix(in srgb, var(--green) 30%, transparent);
      border-radius: 20px;
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 600;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }

    .card-label {
      font-size: 11px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 8px;
    }

    .card-value {
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
    }

    .card-sub {
      font-size: 11px;
      color: var(--muted);
      margin-top: 6px;
    }

    .green  { color: var(--green); }
    .yellow { color: var(--yellow); }
    .red    { color: var(--red); }
    .blue   { color: var(--blue); }
    .purple { color: var(--purple); }

    .section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 16px;
      overflow: hidden;
    }

    .section-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .section-body {
      padding: 20px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
    }

    .row:last-child { border-bottom: none; }
    .row-label { color: var(--muted); }
    .row-value { font-weight: 500; }

    .connect-block {
      background: var(--surface2);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
    }

    .connect-label {
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .connect-code {
      font-family: inherit;
      font-size: 13px;
      color: var(--blue);
      word-break: break-all;
    }

    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--green);
      display: inline-block;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .footer {
      margin-top: 40px;
      text-align: center;
      color: var(--muted);
      font-size: 12px;
    }

    .footer a { color: var(--purple); text-decoration: none; }
  </style>
</head>
<body>

<div class="header">
  <div class="logo">🛡️</div>
  <div class="title">
    <h1>Terminal Guardian MCP</h1>
    <p>v${data.version} · WebSocket Transport · ${data.workspace} (Workplace)</p>
  </div>
  <div class="badge"><span class="dot"></span> Running</div>
</div>

<div class="grid">
  <div class="card">
    <div class="card-label">Active Connections</div>
    <div class="card-value green">${data.activeConnections}</div>
    <div class="card-sub">${data.totalConnections} total since start</div>
  </div>
  <div class="card">
    <div class="card-label">Total Requests</div>
    <div class="card-value blue">${data.totalRequests}</div>
    <div class="card-sub">tool calls processed</div>
  </div>
  <div class="card">
    <div class="card-label">Blocked Requests</div>
    <div class="card-value ${data.blockedRequests > 0 ? 'red' : 'green'}">${data.blockedRequests}</div>
    <div class="card-sub">security events</div>
  </div>
  <div class="card">
    <div class="card-label">Uptime</div>
    <div class="card-value purple">${uptimeStr}</div>
    <div class="card-sub">since ${data.startedAt}</div>
  </div>
</div>

<div class="section">
  <div class="section-header">🔌 Connect</div>
  <div class="section-body">
    <div class="connect-block">
      <div class="connect-label">WebSocket endpoint</div>
      <div class="connect-code">ws://localhost:${data.wsPort}</div>
    </div>
    <div class="connect-block">
      <div class="connect-label">Claude Desktop config</div>
      <div class="connect-code">{
  "mcpServers": {
    "terminal-guardian": {
      "url": "ws://localhost:${data.wsPort}"${data.authEnabled ? `,
      "headers": { "Authorization": "Bearer &lt;your-token&gt;" }` : ''}
    }
  }
}</div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-header">⚙️ Server Info</div>
  <div class="section-body">
    <div class="row">
      <span class="row-label">Transport</span>
      <span class="row-value blue">WebSocket</span>
    </div>
    <div class="row">
      <span class="row-label">Port</span>
      <span class="row-value">${data.wsPort}</span>
    </div>
    <div class="row">
      <span class="row-label">Authentication</span>
      <span class="row-value ${data.authEnabled ? 'green' : 'yellow'}">${data.authEnabled ? '✓ Token required' : '⚠ No auth (dev only)'}</span>
    </div>
    <div class="row">
      <span class="row-label">Workspace</span>
      <span class="row-value">${data.workspace}</span>
    </div>
    <div class="row">
      <span class="row-label">Version</span>
      <span class="row-value">${data.version}</span>
    </div>
  </div>
</div>

<div class="footer">
  <a href="https://github.com/7Majesty-M/terminal-guardian-mcp" target="_blank">
    terminal-guardian-mcp
  </a>
  · Page auto-refreshes every 10s
</div>

<script>
  setTimeout(() => location.reload(), 10_000);
</script>
</body>
</html>`;
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}