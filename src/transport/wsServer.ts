// ============================================================
// Terminal Guardian MCP — WebSocket Transport
// Runs an HTTP + WebSocket server so multiple clients can
// connect to the MCP server simultaneously over the network.
// ============================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { renderDashboard } from './dashboard.js';
import { getLogger } from '../logging/logger.js';
import type { GuardianConfig } from '../types/index.js';

export interface WsTransportOptions {
  port: number;
  host?: string | undefined;
  token?: string | undefined;
  maxConnections?: number | undefined;
  pingIntervalMs?: number | undefined;
}

export interface WsServerStats {
  activeConnections: number;
  totalConnections: number;
  totalRequests: number;
  blockedRequests: number;
  startedAt: Date;
  uptime: number;
}

export type ServerFactory = () => Server;

export class WsTransportServer {
  private readonly opts: Required<WsTransportOptions>;
  private readonly config: GuardianConfig;
  private readonly createServer: ServerFactory;

  private stats: WsServerStats = {
    activeConnections: 0,
    totalConnections: 0,
    totalRequests: 0,
    blockedRequests: 0,
    startedAt: new Date(),
    uptime: 0,
  };

  constructor(
    opts: WsTransportOptions,
    config: GuardianConfig,
    serverFactory: ServerFactory,
  ) {
    this.opts = {
      host: '127.0.0.1',
      token: undefined,
      maxConnections: 10,
      pingIntervalMs: 30_000,
      ...opts,
    };
    this.config = config;
    this.createServer = serverFactory;
  }

  async start(): Promise<void> {
    const logger = getLogger();
    const { port, host, token, maxConnections, pingIntervalMs } = this.opts;

    // ── HTTP server (dashboard + health) ──────────────────────
    const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
        const html = renderDashboard({
          version: '1.0.0',
          workspace: this.config.workspace.rootDir,
          uptime: Date.now() - this.stats.startedAt.getTime(),
          activeConnections: this.stats.activeConnections,
          totalConnections: this.stats.totalConnections,
          totalRequests: this.stats.totalRequests,
          blockedRequests: this.stats.blockedRequests,
          wsPort: port,
          authEnabled: Boolean(token),
          startedAt: this.stats.startedAt.toISOString(),
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          activeConnections: this.stats.activeConnections,
          uptime: Date.now() - this.stats.startedAt.getTime(),
        }));
        return;
      }

      if (req.url === '/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...this.stats,
          uptime: Date.now() - this.stats.startedAt.getTime(),
        }));
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    // ── WebSocket server ───────────────────────────────────────
    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      if (this.stats.activeConnections >= (maxConnections ?? 10)) {
        ws.close(1013, 'Maximum connections reached');
        logger.warn('WebSocket connection rejected: max connections reached');
        return;
      }

      // Token authentication
      if (token) {
        const authHeader = req.headers['authorization'] ?? '';
        const queryToken = new URL(req.url ?? '/', `http://localhost`).searchParams.get('token') ?? '';
        const providedToken = authHeader.replace(/^Bearer\s+/i, '') || queryToken;

        if (providedToken !== token) {
          ws.close(4001, 'Unauthorized: invalid or missing token');
          logger.warn({ ip: req.socket.remoteAddress }, 'WebSocket auth failed');
          this.stats.blockedRequests++;
          return;
        }
      }

      const clientIp = req.socket.remoteAddress ?? 'unknown';
      const connectionId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      this.stats.activeConnections++;
      this.stats.totalConnections++;

      logger.info({ connectionId, ip: clientIp, activeConnections: this.stats.activeConnections }, 'WebSocket client connected');

      const mcpServer = this.createServer();

      // ── MCP WebSocket Transport ──────────────────────────────
      // Implements the Transport interface manually since MCP SDK
      // doesn't ship a WebSocket transport out of the box.
      const transport = {
        onmessage: undefined as ((msg: unknown) => void) | undefined,
        onclose: undefined as (() => void) | undefined,
        onerror: undefined as ((err: Error) => void) | undefined,

        async start(): Promise<void> { /* already connected */ },

        async send(message: unknown): Promise<void> {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
          }
        },

        async close(): Promise<void> {
          ws.close(1000, 'Server closed');
        },
      };

      ws.on('message', (data: Buffer) => {
        this.stats.totalRequests++;
        try {
          const parsed = JSON.parse(data.toString('utf-8')) as unknown;
          transport.onmessage?.(parsed);
        } catch (err) {
          logger.warn({ connectionId, err }, 'Failed to parse WebSocket message');
        }
      });

      ws.on('close', (code, reason) => {
        this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);
        logger.info(
          { connectionId, code, reason: reason.toString(), activeConnections: this.stats.activeConnections },
          'WebSocket client disconnected',
        );
        transport.onclose?.();
      });

      ws.on('error', (err) => {
        logger.error({ connectionId, err }, 'WebSocket error');
        transport.onerror?.(err);
      });

      // Keepalive ping/pong
      let isAlive = true;
      ws.on('pong', () => { isAlive = true; });
      const pingInterval = setInterval(() => {
        if (!isAlive) {
          ws.terminate();
          clearInterval(pingInterval);
          return;
        }
        isAlive = false;
        ws.ping();
      }, pingIntervalMs);

      ws.on('close', () => clearInterval(pingInterval));

      mcpServer.connect(transport as Parameters<typeof mcpServer.connect>[0]).catch((err: unknown) => {
        logger.error({ connectionId, err }, 'MCP server connect error');
      });
    });

    // ── Start listening ────────────────────────────────────────
    await new Promise<void>((resolve, reject) => {
      httpServer.listen(port, host, () => resolve());
      httpServer.on('error', reject);
    });

    this.stats.startedAt = new Date();

    const authNote = token ? ' (token auth enabled)' : ' ⚠️  no auth — dev mode only';
    logger.info({ port, host }, 'Terminal Guardian MCP WebSocket server started');

    process.stderr.write(`\n✅ Terminal Guardian MCP — WebSocket mode\n`);
    process.stderr.write(`   Dashboard : http://${host}:${port}\n`);
    process.stderr.write(`   WebSocket : ws://${host}:${port}${authNote}\n`);
    process.stderr.write(`   Health    : http://${host}:${port}/health\n`);
    process.stderr.write(`   Workspace : ${this.config.workspace.rootDir}\n\n`);
  }

  getStats(): WsServerStats {
    return { ...this.stats, uptime: Date.now() - this.stats.startedAt.getTime() };
  }
}