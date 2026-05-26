import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { WsTransportServer } from '../src/transport/wsServer.js';
import { renderDashboard } from '../src/transport/dashboard.js';
import { DEFAULT_CONFIG } from '../src/config/loader.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// ── Dashboard tests (no network needed) ───────────────────────

describe('Dashboard', () => {
  const data = {
    version: '1.0.0',
    workspace: '/home/user/projects',
    uptime: 3_600_000,
    activeConnections: 2,
    totalConnections: 10,
    totalRequests: 150,
    blockedRequests: 3,
    wsPort: 3000,
    authEnabled: true,
    startedAt: '2024-01-15T10:00:00.000Z',
  };

  it('should render valid HTML', () => {
    const html = renderDashboard(data);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Terminal Guardian MCP');
  });

  it('should include connection stats', () => {
    const html = renderDashboard(data);
    expect(html).toContain('2');   // activeConnections
    expect(html).toContain('150'); // totalRequests
    expect(html).toContain('3');   // blockedRequests
  });

  it('should show auth warning when disabled', () => {
    const html = renderDashboard({ ...data, authEnabled: false });
    expect(html).toContain('No auth');
  });

  it('should show auth enabled when token set', () => {
    const html = renderDashboard({ ...data, authEnabled: true });
    expect(html).toContain('Token required');
  });

  it('should include ws port in connect block', () => {
    const html = renderDashboard({ ...data, wsPort: 8080 });
    expect(html).toContain('8080');
  });

  it('should include auto-refresh script', () => {
    const html = renderDashboard(data);
    expect(html).toContain('location.reload()');
  });
});

// ── WsTransportServer unit tests ──────────────────────────────

function makeServerFactory(): () => Server {
  return () => {
    const s = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    return s;
  };
}

describe('WsTransportServer — stats', () => {
  it('should initialize with zero stats', () => {
    const srv = new WsTransportServer(
      { port: 0, token: 'test' },
      DEFAULT_CONFIG,
      makeServerFactory(),
    );
    const stats = srv.getStats();
    expect(stats.activeConnections).toBe(0);
    expect(stats.totalConnections).toBe(0);
    expect(stats.totalRequests).toBe(0);
    expect(stats.blockedRequests).toBe(0);
  });

  it('should return uptime as number', () => {
    const srv = new WsTransportServer(
      { port: 0 },
      DEFAULT_CONFIG,
      makeServerFactory(),
    );
    expect(typeof srv.getStats().uptime).toBe('number');
  });
});

describe('WsTransportServer — integration', () => {
  let srv: WsTransportServer;
  const TEST_PORT = 13_781;
  const TEST_TOKEN = 'test-secret-token';

  beforeAll(async () => {
    srv = new WsTransportServer(
      { port: TEST_PORT, token: TEST_TOKEN, host: '127.0.0.1' },
      DEFAULT_CONFIG,
      makeServerFactory(),
    );
    await srv.start();
  }, 10_000);

  afterAll(async () => {
  });

  it('should serve dashboard at GET /', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Terminal Guardian MCP');
  });

  it('should serve health at GET /health', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('should serve stats at GET /stats', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json() as { activeConnections: number };
    expect(typeof body.activeConnections).toBe('number');
  });

  it('should return 404 for unknown routes', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/unknown`);
    expect(res.status).toBe(404);
  });

  it('should reject WebSocket connection with wrong token', async () => {
    const { WebSocket } = await import('ws');
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      ws.on('close', (code) => {
        expect(code).toBe(4001);
        resolve();
      });
      ws.on('error', () => resolve());
    });
  }, 5_000);

  it('should accept WebSocket connection with correct token', async () => {
    const { WebSocket } = await import('ws');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`, {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 3000);
      ws.on('open', () => {
        clearTimeout(timer);
        ws.close();
        resolve();
      });
      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }, 5_000);

  it('should accept token via query string', async () => {
    const { WebSocket } = await import('ws');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?token=${TEST_TOKEN}`);
      const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 3000);
      ws.on('open', () => { clearTimeout(timer); ws.close(); resolve(); });
      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }, 5_000);

  it('should increment totalConnections after connections', async () => {
    const before = srv.getStats().totalConnections;
    expect(before).toBeGreaterThan(0); // from previous tests
  });
});

describe('WsTransportServer — no auth mode', () => {
  let srv: WsTransportServer;
  const TEST_PORT = 13_782;

  beforeAll(async () => {
    srv = new WsTransportServer(
      { port: TEST_PORT, host: '127.0.0.1' },
      DEFAULT_CONFIG,
      makeServerFactory(),
    );
    await srv.start();
  }, 10_000);

  it('should accept connection without auth header', async () => {
    const { WebSocket } = await import('ws');
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 3000);
      ws.on('open', () => { clearTimeout(timer); ws.close(); resolve(); });
      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }, 5_000);
});