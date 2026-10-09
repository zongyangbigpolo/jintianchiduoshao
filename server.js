import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchNutrition } from './lib/mcp.js';
import { demoNutrition } from './lib/demo.js';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/planner.js': ['planner.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8']
};

export function validatePublicOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN must be an http(s) origin without credentials, path, query or fragment.');
  }
  return url.origin;
}

export function createApp({
  demo = false,
  publicOrigin = null,
  loadNutrition = () => fetchNutrition(process.env.MCD_MCP_TOKEN),
  now = Date.now
} = {}) {
  const origin = validatePublicOrigin(publicOrigin);
  let cache;
  let pending;
  let retryAt = 0;
  let windowStart = now();
  let totalRequests = 0;
  const clients = new Map();
  const limited = address => {
    if (now() - windowStart >= 60_000) {
      windowStart = now();
      totalRequests = 0;
      clients.clear();
    }
    // Bound both aggregate work and map size; never trust client-supplied proxy headers.
    if (totalRequests >= 120) return true;
    totalRequests++;
    const count = clients.get(address) || 0;
    if (count >= 30) return true;
    clients.set(address, count + 1);
    return false;
  };
  const getNutrition = async () => {
    if (demo) return demoNutrition();
    if (cache && now() - cache.loadedAt < 5 * 60_000) return cache.data;
    if (now() < retryAt) throw new Error('Upstream cooling down');
    if (!pending) {
      pending = loadNutrition().then(data => {
        cache = { loadedAt: now(), data };
        return data;
      }).catch(error => {
        retryAt = now() + 30_000;
        console.error('Nutrition refresh failed; cooling down for 30 seconds. Check MCP credentials and network.');
        throw error;
      }).finally(() => { pending = undefined; });
    }
    return pending;
  };
  const server = http.createServer({ maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 15_000 }, async (req, res) => {
    const host = `127.0.0.1:${res.socket.localPort}`;
    const localhost = `localhost:${res.socket.localPort}`;
    const allowedOrigins = [`http://${host}`, `http://${localhost}`, ...(origin ? [origin] : [])];
    const allowedHosts = allowedOrigins.map(value => new URL(value).host);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (!allowedHosts.includes(req.headers.host) ||
        (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end('Method not allowed');
      return;
    }
    let path;
    try {
      path = new URL(req.url, `http://${host}`).pathname;
    } catch {
      res.writeHead(400).end('Invalid request URL');
      return;
    }
    if (path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({
        status: 'ok', mode: demo ? 'demo' : 'live'
      }));
      return;
    }
    if (path === '/api/nutrition') {
      if (limited(req.socket.remoteAddress)) {
        res.writeHead(429, {
          'Content-Type': 'application/json; charset=utf-8',
          'Retry-After': String(Math.max(1, Math.ceil((windowStart + 60_000 - now()) / 1000)))
        }).end(JSON.stringify({ error: '请求过于频繁，请稍后再试。' }));
        return;
      }
      try {
        const data = await getNutrition();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
      } catch {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '30' }).end(JSON.stringify({
          error: '官方营养数据暂不可用，请 30 秒后重试；持续失败请联系运营者检查 MCP 凭证及网络。不会用演示数据冒充实时结果。'
        }));
      }
      return;
    }
    const asset = Object.hasOwn(assets, path) ? assets[path] : null;
    if (!asset) {
      res.writeHead(404).end('Not found');
      return;
    }
    try {
      const body = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': asset[1] }).end(body);
    } catch {
      console.error('Static asset unavailable:', asset[0]);
      res.writeHead(500).end('Application asset unavailable');
    }
  });
  server.maxConnections = 256;
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const demo = process.argv.includes('--demo');
  const publicOrigin = validatePublicOrigin(process.env.PUBLIC_ORIGIN);
  const bind = publicOrigin ? '0.0.0.0' : '127.0.0.1';
  if (publicOrigin && !demo && !process.env.MCD_MCP_TOKEN?.trim()) {
    throw new Error('MCD_MCP_TOKEN is required for public live mode.');
  }
  const server = createApp({ demo, publicOrigin });
  server.listen(port, bind, () => {
    console.log(`今天吃多少 ${publicOrigin || `http://127.0.0.1:${port}`} (${demo ? 'DEMO / 虚构数据' : 'LIVE / 官方 MCP'})`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
