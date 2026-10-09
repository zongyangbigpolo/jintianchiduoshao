import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createApp, validatePublicOrigin } from '../server.js';
import { demoNutrition } from '../lib/demo.js';

async function serve(t, options) {
  const app = createApp(options);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  return `http://127.0.0.1:${app.address().port}`;
}

test('demo mode is explicit and never invokes MCP', async t => {
  const url = await serve(t, { demo: true, loadNutrition: () => { throw new Error('must not call'); } });
  const response = await fetch(`${url}/api/nutrition`);
  const data = await response.json();
  assert.equal(data.demo, true);
  assert.equal(data.fetchedAt, null);
  assert.ok(data.foods.every(food => food.name.startsWith('演示')));
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await (await fetch(url)).text(), /今天吃多少/);
});

test('live reads coalesce and cache; health information is never sent to loader', async t => {
  let calls = 0;
  const url = await serve(t, { loadNutrition: async (...args) => {
    assert.equal(args.length, 0);
    calls++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return { ...demoNutrition(), demo: false };
  } });
  const responses = await Promise.all([fetch(`${url}/api/nutrition`), fetch(`${url}/api/nutrition`)]);
  assert.ok(responses.every(response => response.ok));
  assert.equal((await (await fetch(`${url}/api/nutrition`)).json()).demo, false);
  assert.equal(calls, 1);
});

test('upstream failure does not leak details or masquerade as demo; retry succeeds', async t => {
  let calls = 0;
  let time = 0;
  const url = await serve(t, { now: () => time, loadNutrition: async () => {
    if (++calls === 1) throw new Error('SENSITIVE-UPSTREAM-DETAIL');
    return { ...demoNutrition(), demo: false };
  } });
  const failed = await fetch(`${url}/api/nutrition`);
  assert.equal(failed.status, 502);
  const body = await failed.text();
  assert.ok(!body.includes('SENSITIVE-UPSTREAM-DETAIL'));
  assert.match(body, /不会用演示数据/);
  assert.equal((await fetch(`${url}/api/nutrition`)).status, 502);
  assert.equal(calls, 1);
  time = 30_001;
  assert.equal((await fetch(`${url}/api/nutrition`)).status, 200);
});

test('public origin must be explicitly configured and must not contain paths or credentials', async t => {
  for (const origin of ['file:///tmp', 'https://user:secret@example.com', 'https://example.com/app', 'https://example.com/?q=1', 'https://example.com/#x']) {
    assert.throws(() => validatePublicOrigin(origin));
  }
  const url = await serve(t, { demo: true, publicOrigin: 'http://example.com:18085' });
  const status = await new Promise((resolve, reject) => {
    http.get(url, { headers: { Host: 'example.com:18085', Origin: 'http://example.com:18085' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(status, 200);
  assert.equal((await fetch(url, { headers: { Origin: 'http://wrong.example:18085' } })).status, 403);
});

test('API limits requests per client without trusting spoofed forwarding headers', async t => {
  let time = 0;
  const url = await serve(t, { demo: true, now: () => time });
  for (let i = 0; i < 30; i++) assert.equal((await fetch(`${url}/api/nutrition`)).status, 200);
  const limited = await fetch(`${url}/api/nutrition`, { headers: { 'X-Forwarded-For': '192.0.2.1' } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
  time = 60_001;
  assert.equal((await fetch(`${url}/api/nutrition`)).status, 200);
});

test('expired cache is refreshed and is not served as live data on upstream failure', async t => {
  let time = 0;
  let calls = 0;
  const url = await serve(t, { now: () => time, loadNutrition: async () => {
    calls++;
    if (calls > 1) throw new Error('Unavailable');
    return { ...demoNutrition(), demo: false };
  } });
  assert.equal((await fetch(`${url}/api/nutrition`)).status, 200);
  time = 299_999;
  assert.equal((await fetch(`${url}/api/nutrition`)).status, 200);
  assert.equal(calls, 1);
  time = 300_000;
  assert.equal((await fetch(`${url}/api/nutrition`)).status, 502);
  assert.equal(calls, 2);
});

test('blocks foreign origins, DNS rebinding hosts, mutating requests and file traversal', async t => {
  const url = await serve(t, { demo: true });
  assert.equal((await fetch(url, { headers: { Origin: 'https://example.com' } })).status, 403);
  const reboundStatus = await new Promise((resolve, reject) => {
    http.get(url, { headers: { Host: 'attacker.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(reboundStatus, 403);
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await fetch(`${url}/.env`)).status, 404);
  assert.equal((await fetch(`${url}/%2e%2e/package.json`)).status, 404);
  assert.equal((await fetch(`${url}/constructor`)).status, 404);
});

test('malformed request targets return 400 without terminating the public server', async t => {
  const url = await serve(t, { demo: true });
  const status = await new Promise((resolve, reject) => {
    const target = new URL(url);
    http.get({ hostname: target.hostname, port: target.port, path: 'http://[' }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(status, 400);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
});
