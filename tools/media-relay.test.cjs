'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const source = fs.readFileSync(path.join(__dirname, '../webos/fidelity/api/media.js'), 'utf8');
const secret = crypto.randomBytes(32).toString('hex');

async function request({ entry = {}, query = {}, method = 'GET', headers = {}, body = '', status = 200, type = 'application/vnd.apple.mpegurl', env = {}, abort = false } = {}) {
  const payload = Buffer.from(JSON.stringify({
    url: 'https://cdn.example/live/master.m3u8', hosts: ['cdn.example'],
    headers: {}, mime: 'application/x-mpegurl', exp: Date.now() + 60000, ...entry
  })).toString('base64url');
  const token = payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  let connections = 0;
  const module = { exports: {} };
  const response = new EventEmitter();
  const upstream = new EventEmitter();
  upstream.destroy = () => {};
  upstream.end = () => {};
  const remote = new EventEmitter();
  remote.statusCode = status;
  remote.headers = { 'content-type': type };
  remote.resume = () => {};
  remote.pipe = res => res.end(body);
  function connect(options, done) {
    connections++;
    queueMicrotask(() => {
      done(remote);
      if (abort) remote.emit('aborted');
      else {
        remote.emit('data', Buffer.from(body));
        remote.emit('end');
      }
    });
    return upstream;
  }
  const context = {
    module, Buffer, URL, process: { env: { MEDIA_TOKEN_SECRET: secret, ...env } },
    require: name => {
      if (name === 'crypto') return crypto;
      if (name === 'http' || name === 'https') return { request: connect, get: connect };
      if (name === './lib/dnsx') return { prepare: (options, done) => done(null, options) };
      throw new Error('Unexpected dependency');
    }
  };
  vm.runInNewContext(source, context, { filename: 'media.js' });
  response.headers = {};
  response.setHeader = (name, value) => { response.headers[name.toLowerCase()] = value; return response; };
  response.status = code => { response.statusCode = code; return response; };
  response.writeHead = (code, headers) => {
    response.statusCode = code;
    for (const [key, value] of Object.entries(headers || {})) response.setHeader(key, value);
    response.headersSent = true;
  };
  let finish;
  const ended = new Promise(resolve => { finish = resolve; });
  response.end = value => { response.body = value || ''; response.writableEnded = true; finish(); };
  response.send = value => response.end(value);
  response.json = value => { response.jsonBody = value; response.end(JSON.stringify(value)); };
  response.destroy = () => { response.destroyed = true; finish(); };
  module.exports({ method, headers, query: { token, ...query } }, response);
  await ended;
  return { response, connections };
}

test('live HLS fetches and rewrites the real playlist instead of a synthetic ENDLIST', async () => {
  const run = await request({ query: { manifest: '1' }, body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\n720p/index.m3u8\n' });
  assert.equal(run.connections, 1);
  assert.equal(run.response.statusCode, 200);
  assert.match(run.response.body, /#EXT-X-STREAM-INF/);
  assert.doesNotMatch(run.response.body, /#EXT-X-ENDLIST/);
  const ref = run.response.body.trim().split('\n').at(-1);
  assert.equal(new URL(ref, 'https://app.example').searchParams.get('child'), 'https://cdn.example/live/720p/index.m3u8');
});

test('nested playlists and encryption keys stay on the configured backend origin', async () => {
  const run = await request({
    query: { child: 'https://cdn.example/live/720p/index.m3u8' },
    body: '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin"\n#EXTINF:4,\nsegment.ts\n',
    env: { PUBLIC_BASE_URL: 'https://api.example' }
  });
  assert.equal(run.response.statusCode, 200);
  const refs = [run.response.body.match(/URI="([^"]+)"/)[1], run.response.body.trim().split('\n').at(-1)];
  assert.deepEqual(refs.map(ref => new URL(ref).origin), ['https://api.example', 'https://api.example']);
  assert.equal(new URL(refs[0]).searchParams.get('child'), 'https://cdn.example/live/key.bin');
  assert.equal(new URL(refs[1]).searchParams.get('child'), 'https://cdn.example/live/720p/segment.ts');
});

test('whole TS VOD uses its real signed duration in the synthetic playlist', async () => {
  const run = await request({ entry: { url: 'https://cdn.example/movie.ts', mime: 'video/mp2t', duration: 5700 }, query: { manifest: '1' } });
  assert.equal(run.connections, 0);
  assert.match(run.response.body, /#EXTINF:5700,/);
  assert.match(run.response.body, /#EXT-X-ENDLIST/);
});

test('expired media tokens also refuse subtitle downloads before network access', async () => {
  const run = await request({ entry: { exp: Date.now() - 1000, subtitles: [{ url: 'https://cdn.example/sub.srt' }] }, query: { subtitle: '0' } });
  assert.equal(run.response.statusCode, 410);
  assert.equal(run.connections, 0);
});

test('HEAD on a remote playlist returns headers without parsing an empty body', async () => {
  const run = await request({ method: 'HEAD' });
  assert.equal(run.response.statusCode, 200);
  assert.equal(run.response.body, '');
});

test('truncated, oversized and non-playlist upstream responses fail clearly', async t => {
  for (const fixture of [{ abort: true }, { body: 'x'.repeat(2 * 1024 * 1024 + 1) }, { body: '<html>not a playlist</html>' }, { status: 403 }]) {
    await t.test(JSON.stringify({ abort: fixture.abort, bytes: fixture.body?.length, status: fixture.status }), async () => {
      const run = await request(fixture);
      assert.equal(run.response.statusCode, 502);
      assert.ok(run.response.jsonBody.error);
    });
  }
});

test('invalid public backend URL is rejected without opening a connection', async () => {
  const run = await request({ env: { PUBLIC_BASE_URL: 'http://api.example/private' } });
  assert.equal(run.response.statusCode, 503);
  assert.equal(run.connections, 0);
});

test('same-origin media works and cross-origin media is rejected without CORS', async () => {
  const settings = { headers: { host: 'api.example', origin: 'https://api.example' }, body: '#EXTM3U\nsegment.ts\n' };
  const sameOrigin = await request(settings);
  assert.equal(sameOrigin.response.statusCode, 200);
  assert.equal(sameOrigin.connections, 1);
  assert.equal(sameOrigin.response.headers['access-control-allow-origin'], undefined);
  const crossOrigin = await request({ ...settings, headers: { host: 'api.example', origin: 'https://outside.example' } });
  assert.equal(crossOrigin.response.statusCode, 403);
  assert.equal(crossOrigin.connections, 0);
});

test('media preflight is not exposed because the app uses same-origin requests', async () => {
  const run = await request({ method: 'OPTIONS', headers: { host: 'api.example', origin: 'https://api.example' } });
  assert.equal(run.response.statusCode, 405);
  assert.equal(run.connections, 0);
});
