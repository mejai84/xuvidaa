'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./http-server.cjs');

const ORIGIN = 'https://xuper.example.com';

async function fixture(t, settings = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuper-http-test-'));
  for (const directory of ['js', 'api/lib', 'assets/original', 'config', 'css', 'data']) await fs.mkdir(path.join(root, directory), { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Xuper</title>');
  await fs.writeFile(path.join(root, 'js/app.js'), 'window.app=true;');
  await fs.writeFile(path.join(root, 'config/api.js'), 'window.config=true;');
  await fs.writeFile(path.join(root, 'config/api.production.js'), 'PRIVATE');
  await fs.writeFile(path.join(root, 'api/lib/magis.js'), 'PRIVATE');
  await fs.writeFile(path.join(root, 'assets/original/poster.png'), 'IMAGE');
  const calls = [];
  const server = createServer({
    root, publicOrigin: ORIGIN, backendToken: settings.backendToken,
    apiHandler(req, res) {
      calls.push({ method: req.query.method, query: req.query, body: req.body, forwarded: req.headers['x-forwarded-for'], runtime: req.headers['x-xuper-runtime'] });
      res.status(200).json({ returnValue: true });
    },
    mediaHandler(req, res) {
      calls.push({ media: true, query: req.query });
      // Return undefined, as the actual streaming handler does.
      res.writeHead(206, { 'Content-Type': 'video/mp2t', 'Content-Range': 'bytes 0-5/6' });
      res.write('VID');
      setImmediate(() => res.end('EO!'));
    }
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  function request(url, options = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: server.address().port, path: url,
        method: options.method || 'GET',
        headers: Object.assign({ Host: 'xuper.example.com' }, options.headers)
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      req.end(options.body);
    });
  }
  return { root, calls, request };
}

test('serves the original allowlisted assets and preserves HEAD/cache behavior', async (t) => {
  const f = await fixture(t);
  const page = await f.request('/?screen=detail&vod=3');
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Xuper<\/title>/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.match(page.headers['content-security-policy'], /object-src 'none'/);
  const image = await f.request('/assets/original/poster.png');
  assert.equal(image.text, 'IMAGE');
  assert.equal(image.headers['content-type'], 'image/png');
  const head = await f.request('/js/app.js', { method: 'HEAD' });
  assert.equal(head.text, '');
  assert.equal(head.headers['content-length'], '16');
  const cached = await f.request('/assets/original/poster.png', { headers: { 'If-None-Match': image.headers.etag } });
  assert.equal(cached.status, 304);
});

test('never serves private source, config variants, dotfiles or traversal paths', async (t) => {
  const f = await fixture(t);
  for (const url of ['/api/lib/magis.js', '/config/api.production.js', '/AGENTS.md', '/.git/config', '/server/http-server.cjs', '/data/catalog.js']) {
    const result = await f.request(url);
    assert.equal(result.status, 404, url);
    assert.doesNotMatch(result.text, /PRIVATE/);
  }
  for (const url of ['/assets/../config/api.production.js', '/assets/%2e%2e/config/api.production.js', '/assets/%2f../config/api.production.js', '/assets/%5c..%5cconfig/api.production.js', '/assets/%00.png', '/assets/%ZZ.png']) {
    assert.equal((await f.request(url)).status, 400, url);
  }
});

test('rejects symlinks even when they masquerade as a public image', async (t) => {
  const f = await fixture(t);
  try { await fs.symlink(path.join(f.root, 'api/lib/magis.js'), path.join(f.root, 'assets/original/leak.png')); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Windows does not permit this process to create symlinks'); return; } throw error; }
  const result = await f.request('/assets/original/leak.png');
  assert.equal(result.status, 404);
  assert.doesNotMatch(result.text, /PRIVATE/);
});

test('uses API path as method and parses bounded JSON input', async (t) => {
  const f = await fixture(t);
  const result = await f.request('/api/search?method=resolve', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: '{"value":"dragon"}' });
  assert.equal(result.status, 200);
  assert.equal(f.calls[0].method, 'search');
  assert.deepEqual(f.calls[0].body, { value: 'dragon' });
  for (const body of ['[]', 'null', 'bad json']) {
    assert.equal((await f.request('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 400);
  }
  assert.equal((await f.request('/api/search', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await f.request('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 40000 }, body: '{}' })).status, 413);
});

test('rejects hostile host/origin and forged runtime headers', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/ping', { headers: { Host: 'evil.example' } })).status, 421);
  assert.equal((await f.request('/api/ping', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request('/api/ping', { headers: { Origin: 'http://xuper.example.com' } })).status, 403);
  assert.equal((await f.request('/api/ping', { headers: { 'X-Xuper-Runtime': 'persistent', 'X-Forwarded-For': '203.0.113.2, 203.0.113.3' } })).status, 200);
  assert.equal(f.calls[0].runtime, undefined);
  assert.equal(f.calls[0].forwarded, '127.0.0.1');
});

test('gateway mode requires Bearer for JSON while signed media streams without it', async (t) => {
  const token = 'a-secure-test-token-with-more-than-32-characters';
  const f = await fixture(t, { backendToken: token });
  assert.equal((await f.request('/api/ping')).status, 401);
  assert.equal((await f.request('/api/ping', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await f.request('/api/ping', { headers: { Authorization: 'Bearer ' + token } })).status, 200);
  const media = await f.request('/api/media?token=test&child=part');
  assert.equal(media.status, 206);
  assert.equal(media.text, 'VIDEO!');
  assert.equal(f.calls[1].query.token, 'test');
  assert.equal((await f.request('/healthz', { headers: { Host: '127.0.0.1' } })).status, 200);
});

test('configuration refuses invalid public origins and short shared tokens', async (t) => {
  const f = await fixture(t);
  const options = { root: f.root, apiHandler() {}, mediaHandler() {} };
  for (const publicOrigin of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/api', 'https://example.com/?secret=x']) {
    assert.throws(() => createServer({ ...options, publicOrigin }));
  }
  assert.throws(() => createServer({ ...options, publicOrigin: ORIGIN, backendToken: 'short' }));
});
