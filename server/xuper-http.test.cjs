'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./http-server.cjs');

async function fixture(t, authenticated = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuvidaa-premium-'));
  const premiumRoot = path.join(root, 'premium');
  await fs.mkdir(premiumRoot);
  await fs.writeFile(path.join(root, 'index.html'), 'TVVIDAA');
  await fs.writeFile(path.join(premiumRoot, 'index.html'), 'Xuper Premium');
  await fs.writeFile(path.join(premiumRoot, 'app.js'), 'window.premium=true;');
  await fs.writeFile(path.join(premiumRoot, '.private'), 'SECRET');
  const calls = [];
  const server = createServer({
    root, xuperRoot: premiumRoot, publicOrigin: 'https://tv.example.test',
    accessPassword: authenticated ? 'test-password-only-12345' : '',
    sessionSecret: authenticated ? 'test-session-secret-'.repeat(3) : '',
    apiHandler(req, res) { res.json({ existing: true }); },
    mediaHandler(req, res) { res.end('media'); },
    xuperHandler(req, res) {
      calls.push({ action: req.query.action, body: req.body });
      res.json({ returnValue: true, action: req.query.action });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  function request(url, options = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url,
        method: options.method || 'GET', headers: { Host: 'tv.example.test', ...options.headers } }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end(options.body);
    });
  }
  const login = authenticated ? await request('/api/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password-only-12345' }) }) : null;
  const cookie = login ? login.headers['set-cookie'][0].split(';')[0] : '';
  return { request, headers: { Cookie: cookie }, calls };
}

test('premium page and all module assets require the existing signed session', async (t) => {
  const f = await fixture(t);
  for (const route of ['/xuper', '/xuper/', '/xuper/app.js']) {
    const result = await f.request(route);
    assert.equal(result.status, 303);
    assert.equal(result.headers.location, '/?next=/xuper/');
  }
  assert.equal((await f.request('/api/xuper/bootstrap')).status, 401);
  assert.equal((await f.request('/')).body, 'TVVIDAA');
  const start = await f.request('/', { headers: f.headers });
  assert.equal(start.status, 303);
  assert.equal(start.headers.location, '/xuper/');
  assert.match(start.headers['cache-control'], /no-store/);
  const classic = await f.request('/tv/', { headers: f.headers });
  assert.equal(classic.status, 200);
  assert.equal(classic.body, 'TVVIDAA');
  assert.equal((await f.request('/xuper', { headers: f.headers })).status, 308);
  const page = await f.request('/xuper/', { headers: f.headers });
  assert.equal(page.body, 'Xuper Premium');
  assert.match(page.headers['cache-control'], /no-store/);
  const head = await f.request('/xuper/app.js', { method: 'HEAD', headers: f.headers });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  for (const route of ['/xuper/.private', '/xuper/index.cjs', '/xuper/api/lib/keys.js']) {
    assert.equal((await f.request(route, { headers: f.headers })).status, 404);
  }
  assert.equal((await f.request('/xuper/%2e%2e/.private', { headers: f.headers })).status, 400);
});

test('premium API binds action to route, bounds JSON, verifies origin and preserves existing API', async (t) => {
  const f = await fixture(t);
  const bootstrap = await f.request('/api/xuper/bootstrap?action=resolve', { headers: f.headers });
  assert.equal(bootstrap.status, 200);
  assert.equal(JSON.parse(bootstrap.body).action, 'bootstrap');
  assert.equal((await f.request('/api/xuper/catalog', { headers: { ...f.headers, Origin: 'https://hostile.test' } })).status, 403);
  assert.equal((await f.request('/api/xuper/refresh', { method: 'POST', headers: { ...f.headers, 'Content-Type': 'application/json' }, body: '[]' })).status, 400);
  assert.equal((await f.request('/api/xuper/catalog', { method: 'DELETE', headers: f.headers })).status, 405);
  assert.equal((await f.request('/api/xuper/refresh', { method: 'POST', headers: { ...f.headers, 'Content-Type': 'application/json' }, body: '{"providerId":"example"}' })).status, 200);
  assert.deepEqual(f.calls.at(-1).body, { providerId: 'example' });
  assert.equal(JSON.parse((await f.request('/api/ping', { headers: f.headers })).body).existing, true);
  assert.equal((await f.request('/api/media?token=example', { headers: f.headers })).body, 'media');
});

test('premium module follows the explicit passwordless mode of the existing server', async (t) => {
  const f = await fixture(t, false);
  assert.equal((await f.request('/api/xuper/bootstrap')).status, 200);
  assert.equal((await f.request('/xuper/')).status, 200);
});
