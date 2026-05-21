// ============================================================
// Terminal Guardian MCP — Network Diagnostics
// Safe ping, HTTP requests, and DNS lookups with output limits
// ============================================================

import { execSync, spawn } from 'child_process';
import { URL } from 'url';

const IS_WINDOWS = process.platform === 'win32';

const MAX_RESPONSE_BYTES = 512_000;
const MAX_PING_COUNT = 10;
const DEFAULT_PING_COUNT = 4;
const REQUEST_TIMEOUT_MS = 15_000;

// ── Allowlist / Blocklist ─────────────────────────────────────

const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^169\.254\.\d+\.\d+$/, // link-local
  /^fd[0-9a-f]{2}:/i,     // ULA IPv6
];

// Blocked schemes and dangerous URL patterns
const BLOCKED_URL_PATTERNS = [
  /^file:\/\//i,
  /^ftp:\/\//i,
  /^sftp:\/\//i,
  /^ldap:\/\//i,
  /^gopher:\/\//i,
  /^dict:\/\//i,
  /\/(etc\/passwd|etc\/shadow|proc\/self)/i,
];

export interface NetworkSafetyResult {
  allowed: boolean;
  reason?: string;
}

export function checkHostSafety(
  host: string,
  allowPrivate = false,
): NetworkSafetyResult {
  if (!allowPrivate && BLOCKED_HOSTS.some((p) => p.test(host))) {
    return {
      allowed: false,
      reason: `Access to private/loopback address "${host}" is blocked. Set allowPrivate: true in config to override.`,
    };
  }
  return { allowed: true };
}

export function checkUrlSafety(rawUrl: string): NetworkSafetyResult {
  for (const p of BLOCKED_URL_PATTERNS) {
    if (p.test(rawUrl)) {
      return { allowed: false, reason: `URL scheme or path is not permitted: ${rawUrl}` };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: `Invalid URL: ${rawUrl}` };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      allowed: false,
      reason: `Only http:// and https:// are allowed. Got: ${parsed.protocol}`,
    };
  }

  const hostCheck = checkHostSafety(parsed.hostname);
  if (!hostCheck.allowed) return hostCheck;

  return { allowed: true };
}

// ── Ping ──────────────────────────────────────────────────────

export interface PingResult {
  host: string;
  count: number;
  transmitted: number;
  received: number;
  packetLoss: number;
  minMs?: number;
  avgMs?: number;
  maxMs?: number;
  raw: string;
  reachable: boolean;
}

export async function ping(
  host: string,
  count: number = DEFAULT_PING_COUNT,
  allowPrivate = false,
): Promise<PingResult> {
  const safety = checkHostSafety(host, allowPrivate);
  if (!safety.allowed) {
    throw new Error(safety.reason);
  }

  const safeCount = Math.min(Math.max(1, count), MAX_PING_COUNT);

  const args = IS_WINDOWS
    ? ['ping', '-n', String(safeCount), host]
    : ['ping', '-c', String(safeCount), '-W', '3', host];

  const raw = await runWithTimeout(args[0]!, args.slice(1), REQUEST_TIMEOUT_MS);

  return parsePingOutput(host, safeCount, raw);
}

function parsePingOutput(host: string, count: number, raw: string): PingResult {
  const base: PingResult = {
    host,
    count,
    transmitted: count,
    received: 0,
    packetLoss: 100,
    raw: raw.slice(0, 2000),
    reachable: false,
  };

  const unixStats = raw.match(/(\d+) packets transmitted,\s*(\d+)\s+received,\s*([\d.]+)%/);
  if (unixStats) {
    base.transmitted = parseInt(unixStats[1]!, 10);
    base.received = parseInt(unixStats[2]!, 10);
    base.packetLoss = parseFloat(unixStats[3]!);
    base.reachable = base.received > 0;
  }

  const winStats = raw.match(/Sent\s*=\s*(\d+),\s*Received\s*=\s*(\d+)/i);
  if (winStats) {
    base.transmitted = parseInt(winStats[1]!, 10);
    base.received = parseInt(winStats[2]!, 10);
    base.packetLoss = base.transmitted > 0
      ? ((base.transmitted - base.received) / base.transmitted) * 100
      : 100;
    base.reachable = base.received > 0;
  }

  const rttUnix = raw.match(/rtt [^=]+=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/);
  if (rttUnix) {
    base.minMs = parseFloat(rttUnix[1]!);
    base.avgMs = parseFloat(rttUnix[2]!);
    base.maxMs = parseFloat(rttUnix[3]!);
  }

  const rttWin = raw.match(/Minimum\s*=\s*(\d+)ms,\s*Maximum\s*=\s*(\d+)ms,\s*Average\s*=\s*(\d+)ms/i);
  if (rttWin) {
    base.minMs = parseInt(rttWin[1]!, 10);
    base.maxMs = parseInt(rttWin[2]!, 10);
    base.avgMs = parseInt(rttWin[3]!, 10);
  }

  return base;
}

// ── HTTP Request ──────────────────────────────────────────────

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
  followRedirects?: boolean | undefined;
  timeoutMs?: number | undefined;
  allowPrivate?: boolean | undefined;
}

export interface HttpResult {
  url: string;
  method: string;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  durationMs: number;
  redirectCount: number;
  contentType?: string | undefined;
  contentLength?: number | undefined;
}

export async function httpRequest(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResult> {
  const safety = checkUrlSafety(url);
  if (!safety.allowed) throw new Error(safety.reason);

  const {
    method = 'GET',
    headers = {},
    body,
    followRedirects = true,
    timeoutMs = REQUEST_TIMEOUT_MS,
    allowPrivate = false,
  } = options;

  const parsed = new URL(url);
  const hostCheck = checkHostSafety(parsed.hostname, allowPrivate);
  if (!hostCheck.allowed) throw new Error(hostCheck.reason);

  const startTime = Date.now();

  const args: string[] = [
    '-s',                         
    '-S',                       
    '-L',                       
    '-w', '\n__STATUS__%{http_code}__REDIRECTS__%{num_redirects}__',
    '--max-time', String(Math.ceil(timeoutMs / 1000)),
    '--max-filesize', String(MAX_RESPONSE_BYTES),
    '-X', method,
  ];

  if (!followRedirects) {
    const lIdx = args.indexOf('-L');
    if (lIdx !== -1) args.splice(lIdx, 1);
  }

  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`);
  }

  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    args.push('-d', body);
  }

  args.push('-D', '-');
  args.push(url);

  let rawOutput: string;
  try {
    rawOutput = await runWithTimeout('curl', args, timeoutMs + 2000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error('curl is not installed or not in PATH. Install curl to use HTTP requests.');
    }
    throw new Error(`HTTP request failed: ${msg}`);
  }

  return parseHttpResponse(url, method, rawOutput, Date.now() - startTime);
}

function parseHttpResponse(
  url: string,
  method: string,
  raw: string,
  durationMs: number,
): HttpResult {
  const sentinelMatch = raw.match(/__STATUS__(\d+)__REDIRECTS__(\d+)__/);
  const statusCode = sentinelMatch ? parseInt(sentinelMatch[1]!, 10) : 0;
  const redirectCount = sentinelMatch ? parseInt(sentinelMatch[2]!, 10) : 0;

  const withoutSentinel = raw.replace(/__STATUS__\d+__REDIRECTS__\d+__/, '').trimEnd();
  const headerBodySplit = withoutSentinel.indexOf('\r\n\r\n');
  const headerSection = headerBodySplit !== -1 ? withoutSentinel.slice(0, headerBodySplit) : '';
  let body = headerBodySplit !== -1 ? withoutSentinel.slice(headerBodySplit + 4) : withoutSentinel;

  const responseHeaders: Record<string, string> = {};
  for (const line of headerSection.split('\r\n').slice(1)) {
    const colon = line.indexOf(':');
    if (colon !== -1) {
      const key = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      responseHeaders[key] = value;
    }
  }

  let bodyTruncated = false;
  if (body.length > MAX_RESPONSE_BYTES) {
    body = body.slice(0, MAX_RESPONSE_BYTES);
    bodyTruncated = true;
  }

  const statusTexts: Record<number, string> = {
    200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently',
    302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized',
    403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
    429: 'Too Many Requests', 500: 'Internal Server Error',
    502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
  };

  const contentType = responseHeaders['content-type'];
  const contentLengthStr = responseHeaders['content-length'];
  const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined;

  return {
    url,
    method,
    statusCode,
    statusText: statusTexts[statusCode] ?? `HTTP ${statusCode}`,
    headers: responseHeaders,
    body,
    bodyTruncated,
    durationMs,
    redirectCount,
    contentType,
    contentLength,
  };
}

// ── DNS Lookup ────────────────────────────────────────────────

export interface DnsResult {
  host: string;
  addresses: DnsRecord[];
  queryTimeMs: number;
}

export interface DnsRecord {
  type: string;
  value: string;
  ttl?: number;
}

export async function dnsLookup(host: string): Promise<DnsResult> {
  const start = Date.now();

  if (!/^[a-zA-Z0-9._-]+$/.test(host)) {
    throw new Error(`Invalid hostname: "${host}"`);
  }

  let raw: string;
  try {
    if (IS_WINDOWS) {
      raw = await runWithTimeout('nslookup', [host], 8000);
    } else {
      raw = await runWithTimeout('dig', ['+short', '+time=3', '+tries=2', host], 8000);
      if (!raw.trim()) {
        raw = await runWithTimeout('nslookup', [host], 8000);
      }
    }
  } catch {
    const { lookup } = await import('dns/promises');
    try {
      const result = await lookup(host, { all: true });
      return {
        host,
        addresses: result.map((r) => ({ type: r.family === 6 ? 'AAAA' : 'A', value: r.address })),
        queryTimeMs: Date.now() - start,
      };
    } catch (dnsErr) {
      const msg = dnsErr instanceof Error ? dnsErr.message : String(dnsErr);
      throw new Error(`DNS lookup failed for "${host}": ${msg}`);
    }
  }

  return {
    host,
    addresses: parseDnsOutput(raw),
    queryTimeMs: Date.now() - start,
  };
}

function parseDnsOutput(raw: string): DnsRecord[] {
  const records: DnsRecord[] = [];
  const seen = new Set<string>();

  for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const ipv4 = line.match(/^(\d{1,3}\.){3}\d{1,3}$/);
    const ipv6 = line.match(/^[0-9a-f:]+$/i);
    const cname = line.match(/^[a-zA-Z0-9._-]+\.$/);

    let record: DnsRecord | null = null;

    if (ipv4) record = { type: 'A', value: line };
    else if (ipv6 && line.includes(':')) record = { type: 'AAAA', value: line };
    else if (cname) record = { type: 'CNAME', value: line.replace(/\.$/, '') };

    const nsMatch = line.match(/^Address:\s*(.+)$/i);
    if (nsMatch) {
      const val = nsMatch[1]!.trim();
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(val)) record = { type: 'A', value: val };
      else if (val.includes(':')) record = { type: 'AAAA', value: val };
    }

    if (record && !seen.has(record.value)) {
      seen.add(record.value);
      records.push(record);
    }
  }

  return records;
}

// ── Shared utilities ──────────────────────────────────────────

function runWithTimeout(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    let errOutput = '';

    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd}`));
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (output.length < MAX_RESPONSE_BYTES) output += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      errOutput += chunk.toString().slice(0, 1000);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !output.trim()) {
        reject(new Error(errOutput || `${cmd} exited with code ${code}`));
      } else {
        resolve(output);
      }
    });
  });
}

export function quickReachabilityCheck(host: string): boolean {
  try {
    const cmd = IS_WINDOWS
      ? `ping -n 1 -w 1000 ${host}`
      : `ping -c 1 -W 1 ${host}`;
    execSync(cmd, { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}