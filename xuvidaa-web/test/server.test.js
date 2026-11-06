'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const { test } = require('node:test');
const { prepareProxySource, prepareMagisSource } = require('../server/prepare-upstream');

test('portal adapter stops retrying a region block', () => {
  const source = "function tryFallbackSeed(origErr) {\n    console.log('retry');\n  }";
  const prepared = prepareMagisSource(source);
  assert.match(prepared, /portal100024/);
  assert.throws(() => prepareMagisSource('function changed() {}'), /portal client changed/);
});

const serviceDir = path.resolve(__dirname, '../../webos/services/com.webosflux.xuptertv.fidelity.service');

function loadModule(filename, overrides, extra = {}, source) {
  const mod = { exports: {} };
  const sandbox = {
    module: mod, exports: mod.exports, __dirname: path.dirname(filename),
    Buffer, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    console: { ...console }, process,
    require(name) {
      return Object.hasOwn(overrides, name) ? overrides[name]
        : require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name);
    },
    ...extra
  };
  vm.runInNewContext(source || fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return mod.exports;
}

async function fixture(t, failSession = false) {
  const servers = [];
  const hits = [];
  const origin = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/master.m3u8') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant/list.m3u8\n');
    } else if (req.url === '/variant/list.m3u8') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/key.bin"\n#EXTINF:10,\nsegment.ts\n');
    } else if (req.url === '/poster.jpg') {
      res.setHeader('Content-Type', 'image/jpeg');
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    } else if (req.url === '/subtitle.srt') {
      res.setHeader('Content-Type', 'application/x-subrip');
      res.end('1\n00:00:00,000 --> 00:00:01,000\nSubtitle fixture\n');
    } else {
      const body = Buffer.from('0123456789');
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      if (range) {
        res.statusCode = 206;
        const start = Number(range[1]);
        const end = Number(range[2]);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
        res.setHeader('Content-Length', end - start + 1);
        res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
      } else {
        res.setHeader('Content-Length', body.length);
        res.end(req.method === 'HEAD' ? undefined : body);
      }
    }
  });
  origin.listen(0, '127.0.0.1');
  await once(origin, 'listening');
  servers.push(origin);
  const base = `http://127.0.0.1:${origin.address().port}`;
  let api;
  const trackedHttp = {
    ...http,
    createServer(handler) {
      const server = http.createServer(handler);
      servers.push(server);
      return server;
    },
    request(options, callback) {
      if (options.hostname === '93.184.216.34') {
        return http.request({ ...options, hostname: '127.0.0.1', port: origin.address().port }, callback);
      }
      return http.request(options, callback);
    }
  };
  const dnsx = {
    isIpv4: (value) => net.isIP(value) === 4,
    cached: () => null,
    dial: (_host, ips) => ips[0],
    resolve: (_host, done) => done(null, { ips: ['127.0.0.1'] })
  };
  const proxyFile = path.join(serviceDir, 'proxy.js');
  const proxy = loadModule(proxyFile, { http: trackedHttp, './dnsx': dnsx }, {}, prepareProxySource(fs.readFileSync(proxyFile, 'utf8')));
  const guardedHttps = { ...https };
  const magis = {
    ensureSession(done) {
      if (!failSession) { done(null, {}); return; }
      // Exercise the real adapter contract used by the upstream seed fallback.
      const request = guardedHttps.request({ path: '/xuper-plugin/kino-plugin-xuper/seeds/seeds.json' });
      request.on('error', done);
      request.setTimeout(10000, () => request.abort());
      request.end();
    },
    home(_root, done) {
      done(null, { items: [{ id: 'vod-1', title: 'Title fixture', poster: 'http://artwork.example/poster.jpg',
        backdrop: 'http://private.example/secret', logo: 'http://127.0.0.1/private',
        synopsis: 'Description fixture', genres: ['Drama'], director: 'Director fixture',
        actors: 'Actor fixture', index: 7, streamUrl: `${base}/secret`, headers: { secret: 'hidden' } }] });
    },
    resolve(_id, _seriesId, _options, done) { done(null, { url: `${base}/movie.mp4`, mime: 'video/mp4' }); },
    resolveLive(_code, done) { done(null, { url: `${base}/master.m3u8`, mime: 'application/x-mpegurl' }); },
    mediaInfo(_id, _seriesId, done) { done(null, { subtitles: [{ url: `${base}/subtitle.srt`, lang: 'es', format: 'srt' }] }); }
  };
  const password = crypto.randomBytes(10).toString('base64url').slice(0, 14);
  const apiHttp = {
    ...trackedHttp,
    createServer(handler) {
      api = http.createServer(handler);
      servers.push(api);
      const listen = api.listen;
      api.listen = () => listen.call(api, 0, '127.0.0.1');
      return api;
    }
  };
  const apiDir = path.resolve(__dirname, '../server');
  loadModule(path.join(apiDir, 'index.js'), {
    'node:http': apiHttp, 'node:https': guardedHttps,
    'node:dns': { promises: { lookup: async (host) => [{ address: host === 'private.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }] } },
    [`${apiDir}/upstream/dnsx`]: dnsx,
    [`${apiDir}/upstream/magis`]: magis,
    [`${apiDir}/upstream/proxy`]: proxy
  }, { process: { env: { XUVIDAA_WEB_PASSWORD: password }, nextTick: process.nextTick.bind(process), stderr: process.stderr, exit: (code) => { throw new Error(`unexpected exit ${code}`); } } });
  await once(api, 'listening');
  t.after(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    })));
  });
  const request = (pathname, { body, cookie, headers = {}, method } = {}) => fetch(`http://127.0.0.1:${api.address().port}${pathname}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    redirect: 'manual',
    headers: { Origin: 'https://tv.rfcsas.com', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}), 'X-Xuvidaa-Client-IP': '203.0.113.1', ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  async function login() {
    const response = await request('/api/login', { body: { password } });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  return { request, login, hits, base, password };
}

test('actual upstream proxy accepts 24-character media tokens, byte ranges and HEAD', async (t) => {
  const app = await fixture(t);
  const cookie = await app.login();
  const stream = await (await app.request('/api/resolve', { cookie, body: { contentId: 'vod-1' } })).json();
  assert.match(stream.playbackUrl, /^\/api\/media\/[a-f0-9]{24}\/stream.mp4$/);
  const response = await app.request(stream.playbackUrl, { cookie, headers: { Range: 'bytes=2-5', 'If-Range': 'fixture' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await response.text(), '2345');
  const head = await app.request(stream.playbackUrl, { cookie, method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  assert.equal((await app.request(stream.playbackUrl)).status, 401);
  assert.equal((await app.request(`/api/media/${'a'.repeat(24)}/stream.mp4`, { cookie })).status, 410);
});

test('actual HLS proxy supports nested playlists, key URIs and segments without allowing forged targets', async (t) => {
  const app = await fixture(t);
  const cookie = await app.login();
  const stream = await (await app.request('/api/live/resolve', { cookie, body: { channelCode: 'live-1' } })).json();
  assert.equal(stream.isHls, true);
  assert.ok(stream.playbackUrl.endsWith('.m3u8'));
  const master = await (await app.request(stream.playbackUrl, { cookie })).text();
  assert.ok(!master.includes('127.0.0.1'));
  const child = master.match(/\/api\/hls\/[a-f0-9]{24}\/[A-Za-z0-9_-]+/)[0];
  const playlistResponse = await app.request(child, { cookie });
  assert.equal(playlistResponse.status, 200);
  const playlist = await playlistResponse.text();
  const paths = [...playlist.matchAll(/\/api\/hls\/[a-f0-9]{24}\/[A-Za-z0-9_-]+/g)].map((match) => match[0]);
  assert.equal(paths.length, 2);
  for (const target of paths) {
    const response = await app.request(target, { cookie });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '0123456789');
  }
  const token = stream.playbackUrl.split('/')[3];
  const forged = Buffer.from('http://127.0.0.1:8081/api/session').toString('base64url');
  assert.equal((await app.request(`/api/hls/${token}/${forged}`, { cookie })).status, 404);
  assert.equal((await app.request(child)).status, 401);
});

test('catalog retains metadata and serves only registered public artwork without exposing source URLs', async (t) => {
  const app = await fixture(t);
  const cookie = await app.login();
  const catalog = await (await app.request('/api/home', { cookie, body: { root: 'movies' } })).json();
  const item = catalog.items[0];
  assert.equal(item.synopsis, 'Description fixture');
  assert.deepEqual(item.genres, ['Drama']);
  assert.equal(item.index, 7);
  assert.match(item.poster, /^\/api\/image\/[a-f0-9]{24}$/);
  assert.equal(item.logo, '');
  assert.ok(!JSON.stringify(catalog).includes('artwork.example'));
  assert.equal(item.streamUrl, undefined);
  assert.equal(item.headers, undefined);
  const image = await app.request(item.poster, { cookie });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal((await image.arrayBuffer()).byteLength, 4);
  assert.equal((await app.request(item.poster)).status, 401);
  assert.equal((await app.request(item.backdrop, { cookie })).status, 502);
  assert.ok(!app.hits.includes('/secret'));
});

test('login throttling separates verified client addresses', async (t) => {
  const app = await fixture(t);
  for (let i = 0; i < 10; i++) {
    assert.equal((await app.request('/api/login', { body: { password: 'wrong' } })).status, 401);
  }
  assert.equal((await app.request('/api/login', { body: { password: 'wrong' } })).status, 429);
  const other = await app.request('/api/login', { body: { password: app.password }, headers: { 'X-Xuvidaa-Client-IP': '203.0.113.2' } });
  assert.equal(other.status, 200);
});

test('browser bridge mirrors Luna result envelopes and states unsupported M3U limits', async (t) => {
  const app = await fixture(t);
  const cookie = await app.login();
  const ping = await (await app.request('/api/ping', { cookie, body: {} })).json();
  assert.equal(ping.returnValue, true);
  assert.equal(ping.alive, true);

  const diag = await (await app.request('/api/netdiag', { cookie, body: {} })).json();
  assert.equal(diag.returnValue, true);
  assert.equal(diag.partial, true);
  assert.match(diag.note, /no mide DNS ni códecs/);

  const m3u = await app.request('/api/live/m3u', { cookie, body: { url: 'https://example.invalid/list.m3u' } });
  assert.equal(m3u.status, 501);
  const failure = await m3u.json();
  assert.equal(failure.returnValue, false);
  assert.equal(failure.error, 'M3U_IMPORT_UNAVAILABLE');
});

test('native form login posts credentials and redirects without putting them in the URL', async (t) => {
  const app = await fixture(t);
  const response = await app.request('/api/login', {
    body: `password=${encodeURIComponent(app.password)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
  assert.match(response.headers.get('set-cookie'), /^xuvidaa_session=/);
});

test('blocked seed fallback returns a controlled session failure and API stays alive', async (t) => {
  const app = await fixture(t, true);
  const cookie = await app.login();
  for (let i = 0; i < 2; i++) {
    const response = await app.request('/api/home', { cookie, body: { root: 'movies' } });
    assert.equal(response.status, 502);
    const failure = await response.json();
    assert.equal(failure.returnValue, false);
    assert.equal(failure.error, 'PORTAL_SESSION_UNAVAILABLE');
    assert.equal(failure.errorCode, 'PORTAL_SESSION_UNAVAILABLE');
    assert.match(failure.errorText, /sesión/);
  }
  assert.equal((await app.request('/api/session', { cookie })).status, 200);
});

test('subtitles use authenticated opaque paths with the actual upstream subtitle proxy', async (t) => {
  const app = await fixture(t);
  const cookie = await app.login();
  const media = await (await app.request('/api/media-info', { cookie, body: { contentId: 'vod-1' } })).json();
  const response = await app.request(media.subtitles[0].url, { cookie });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Subtitle fixture/);
  assert.equal((await app.request(media.subtitles[0].url)).status, 401);
});
