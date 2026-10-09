import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createApp } from '../server.js';
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
  const url = await serve(t, { loadNutrition: async () => {
    if (++calls === 1) throw new Error('SENSITIVE-UPSTREAM-DETAIL');
    return { ...demoNutrition(), demo: false };
  } });
  const failed = await fetch(`${url}/api/nutrition`);
  assert.equal(failed.status, 502);
  const body = await failed.text();
  assert.ok(!body.includes('SENSITIVE-UPSTREAM-DETAIL'));
  assert.match(body, /不会用演示数据/);
  assert.equal((await fetch(`${url}/api/nutrition`)).status, 200);
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
