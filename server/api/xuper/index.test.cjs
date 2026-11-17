'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createXuperApi } = require('./index.cjs');
const { JsonAdapter } = require('../../providers/xuper/adapters.cjs');
const codec = require('../lib/media-token.js');

const SECRET = 'test-media-key-that-is-at-least-32-bytes';
const PRIVATE = 'private-provider-password';
function catalog() {
  return {
    movies: [{ id: 'movie1', title: 'Aventura real', year: 2025, category: 'Aventura', country: 'Colombia',
      synopsis: 'Historia autorizada ' + PRIVATE, poster: 'https://images.example/poster.jpg',
      url: 'https://media.example/movie/private-user/' + PRIVATE + '/1.mp4',
      subtitles: [{ url: 'https://media.example/subtitles/1.vtt?token=' + PRIVATE, label: 'Español', language: 'es' }] },
      { id: 'movie2', title: 'Comedia real', category: 'Comedia', poster: 'https://media.example/poster?password=' + PRIVATE, url: 'https://media.example/2.mkv' }],
    series: [{ id: 'series1', title: 'Serie real', category: 'Drama', seasons: [{ number: 2, episodes: [
      { id: 'episode1', title: 'Episodio real', number: 4, url: 'https://media.example/series/' + PRIVATE + '/4.mp4' }
    ] }] }],
    live: [{ id: 'channel1', title: 'Canal real', category: 'Noticias', signals: [
      { url: 'https://media.example/1.m3u8?token=' + PRIVATE }, { url: 'https://alternate.example/1.m3u8' }
    ], programmes: [{ title: 'Noticias', start: '2026-11-17T12:00:00Z', end: '2026-11-17T13:00:00Z' }] },
      { id: 'channel-ts', title: 'Canal TS', url: 'https://media.example/continuous.ts' }],
    radio: [{ id: 'radio1', title: 'Radio real', country: 'Colombia', url: 'https://media.example/radio.mp3?token=' + PRIVATE }],
    music: [{ id: 'track1', title: 'Canción autorizada', url: 'https://media.example/track.mp3' }]
  };
}

function setup(data = catalog(), options = {}) {
  const provider = new JsonAdapter({ id: 'owned', name: 'Proveedor autorizado', url: 'https://catalog.example/data?token=' + PRIVATE,
    password: PRIVATE, streamHosts: ['media.example', 'alternate.example'] }, { fetchText: async () => JSON.stringify(data) });
  const entries = new Map();
  const mediaRegistry = options.mediaRegistry || { register(entry, exp) {
    const ref = crypto.randomBytes(20).toString('hex');
    const token = codec.encode({ ref, exp }, SECRET);
    if (!token) return null;
    entries.set(ref, { ...entry, exp });
    return { token, exp };
  } };
  const handler = createXuperApi({ env: { MEDIA_TOKEN_SECRET: SECRET }, providers: [provider], ...options, mediaRegistry });
  return { handler, provider, entries };
}

async function request(handler, action, input = {}, method = 'GET', ip = '8.8.8.8') {
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; return this; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, query: { action, ...input }, body: input, headers: {}, socket: { remoteAddress: ip } }, res);
  return res;
}

test('bootstrap reports honest capabilities and unverified Xuper remains disabled', async () => {
  const handler = createXuperApi({ env: { M3U_CACHE_DIR: 'off' } });
  const result = await request(handler, 'bootstrap');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.capabilities.downloads, false);
  assert.equal(result.body.capabilities.transcode, false);
  assert.equal(result.body.providers.find((provider) => provider.id === 'xuper_premium').configured, false);
  assert.match(result.body.providers.find((provider) => provider.id === 'xuper_premium').message, /Pendiente/);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
});

test('catalog filters and pagination use real provider metadata without leaking credentials', async () => {
  const { handler } = setup();
  const result = await request(handler, 'catalog', { section: 'movies', pageSize: '1' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.total, 2);
  assert.equal(result.body.items.length, 1);
  assert.equal(result.body.hasMore, true);
  assert.deepEqual(result.body.categories, ['Aventura', 'Comedia']);
  assert.equal(result.body.items[0].providerId, 'owned');
  assert.equal(JSON.stringify(result.body).includes(PRIVATE), false);
  assert.equal(JSON.stringify(result.body).includes('private-user'), false);
  assert.equal(result.body.items[0].synopsis.includes('[privado]'), true);
  const filtered = await request(handler, 'catalog', { section: 'movies', q: 'AVENTURA', category: 'Aventura', country: 'Colombia' });
  assert.equal(filtered.body.total, 1);
  const page2 = await request(handler, 'catalog', { section: 'movies', pageSize: '1', page: '2' });
  assert.equal(page2.body.items[0].poster, '');
  assert.equal(page2.body.items[0].id, 'movie2');
});

test('detail exposes normalized seasons and episode progress identities without source URLs', async () => {
  const { handler } = setup();
  const result = await request(handler, 'detail', { providerId: 'owned', id: 'series1' });
  assert.equal(result.body.item.type, 'series');
  assert.equal(result.body.seasons[0].number, 2);
  assert.equal(result.body.seasons[0].episodes[0].id, 'episode1');
  assert.equal(result.body.seasons[0].episodes[0].number, 4);
  assert.equal(JSON.stringify(result.body).includes(PRIVATE), false);
  assert.equal(JSON.stringify(result.body).includes('streamUrl'), false);
});

test('resolve registers URLs server-side and mints opaque relay tokens including VTT subtitles', async () => {
  let currentTime = Date.now();
  const { handler, entries } = setup(catalog(), { now: () => currentTime });
  const result = await request(handler, 'resolve', { providerId: 'owned', id: 'movie1' });
  assert.equal(result.statusCode, 200);
  assert.match(result.body.mediaUrl, /^\/api\/media\?token=v1\./);
  assert.equal(result.body.mime, 'video/mp4');
  assert.equal(result.body.live, false);
  assert.equal(JSON.stringify(result.body).includes(PRIVATE), false);
  const token = new URL(result.body.mediaUrl, 'https://tv.example').searchParams.get('token');
  const decoded = codec.decode(token, SECRET);
  assert.equal(Object.keys(decoded).sort().join(','), 'exp,ref');
  assert.equal(decoded.exp, result.body.expiresAt);
  assert.ok(decoded.exp > currentTime && decoded.exp <= currentTime + 6 * 3600 * 1000);
  assert.equal(codec.decode(token + 'x', SECRET), null);
  assert.equal(codec.decode(token, 'a-different-test-secret-over-32-bytes'), null);
  assert.equal(entries.get(decoded.ref).url, catalog().movies[0].url);
  assert.equal(entries.get(decoded.ref).source, 'vod');
  assert.equal(result.body.subtitles.length, 1);
  assert.equal(result.body.subtitles[0].language, 'es');
  const subtitleToken = new URL(result.body.subtitles[0].url, 'https://tv.example').searchParams.get('token');
  const subtitleRef = codec.decode(subtitleToken, SECRET).ref;
  assert.equal(entries.get(subtitleRef).url, catalog().movies[0].subtitles[0].url);
  assert.equal(entries.get(subtitleRef).mime, 'text/vtt');
  currentTime += 7 * 3600 * 1000;
  assert.ok(decoded.exp < currentTime, 'relay receives an expiry that becomes stale');
});

test('series episodes, HLS live signals, radio and music use the same protected relay', async () => {
  const { handler } = setup();
  for (const id of ['episode1', 'channel1', 'radio1', 'track1']) {
    const result = await request(handler, 'resolve', { providerId: 'owned', id });
    assert.equal(result.statusCode, 200, id);
    assert.match(result.body.mediaUrl, /^\/api\/media\?token=/);
    if (id === 'channel1') assert.equal(result.body.isHls, true);
    if (id === 'radio1') { assert.equal(result.body.mime, 'audio/mpeg'); assert.equal(result.body.live, true); }
  }
  const alternate = await request(handler, 'resolve', { providerId: 'owned', id: 'channel1', signal: '1' });
  const decoded = codec.decode(new URL(alternate.body.mediaUrl, 'https://tv.example').searchParams.get('token'), SECRET);
  assert.equal(decoded.ref.length, 40);
});

test('unsupported and unsafe source formats are explicit failures', async () => {
  const data = catalog();
  data.movies.push({ id: 'unsafe', title: 'Unsafe', url: 'https://127.0.0.1/admin' });
  const { handler } = setup(data);
  for (const id of ['movie2', 'channel-ts', 'unsafe']) {
    const result = await request(handler, 'resolve', { providerId: 'owned', id });
    assert.equal(result.statusCode, 415, id);
    assert.equal(result.body.returnValue, false);
  }
});

test('guide reflects provider programmes and unavailable guide has truthful empty state', async () => {
  const { handler } = setup();
  const guide = await request(handler, 'guide', { providerId: 'owned', id: 'channel1' });
  assert.equal(guide.body.available, true);
  assert.equal(guide.body.programmes[0].title, 'Noticias');
  assert.equal(guide.body.programmes[0].start, Date.parse('2026-11-17T12:00:00Z'));
  const empty = await request(handler, 'guide', { providerId: 'owned', id: 'radio1' });
  assert.equal(empty.body.available, false);
  assert.deepEqual(empty.body.programmes, []);
});

test('boundary rejects arbitrary methods, malformed filters and unknown IDs', async () => {
  const { handler } = setup();
  assert.equal((await request(handler, 'catalog', {}, 'POST')).statusCode, 405);
  assert.equal((await request(handler, 'refresh')).statusCode, 405);
  assert.equal((await request(handler, 'unknown')).statusCode, 404);
  for (const input of [{ section: 'private' }, { q: 'x'.repeat(121) }, { page: '-1' }, { pageSize: '500' }, { provider: 'missing' }]) {
    assert.equal((await request(handler, 'catalog', input)).statusCode, 400);
  }
  assert.equal((await request(handler, 'resolve', { providerId: 'owned', id: 'http://localhost' })).statusCode, 400);
  assert.equal((await request(handler, 'resolve', { providerId: 'owned', id: 'missing' })).statusCode, 404);
  assert.equal((await request(handler, 'resolve', { providerId: 'owned', id: 'channel1', signal: '2.5' })).statusCode, 400);
  assert.equal((await request(handler, 'resolve', { providerId: 'unknown', id: 'movie1' })).statusCode, 404);
});

test('refresh is bounded per provider and general request rate is bounded per client', async () => {
  const { handler } = setup();
  assert.equal((await request(handler, 'refresh', { providerId: 'owned' }, 'POST')).statusCode, 200);
  assert.equal((await request(handler, 'refresh', { providerId: 'owned' }, 'POST')).body.errorCode, 'REFRESH_LIMIT');
  const isolated = setup().handler;
  for (let i = 0; i < 120; i++) assert.equal((await request(isolated, 'providers')).statusCode, 200);
  assert.equal((await request(isolated, 'providers')).statusCode, 429);
  assert.equal((await request(isolated, 'providers', {}, 'GET', '8.8.4.4')).statusCode, 200);
});

test('provider exceptions never expose private error content or fabricated items', async () => {
  const broken = { id: 'broken', name: 'Fallido', configured: true, status: 'unavailable', sections: ['movies'],
    async load() { throw new Error('https://secret.example?password=' + PRIVATE); } };
  const handler = createXuperApi({ env: {}, providers: [broken] });
  const empty = await request(handler, 'catalog', { section: 'movies' });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.body.items, []);
  assert.equal(JSON.stringify(empty.body).includes(PRIVATE), false);
  const detail = await request(handler, 'detail', { providerId: 'broken', id: 'movie1' });
  assert.equal(detail.statusCode, 503);
  assert.equal(JSON.stringify(detail.body).includes(PRIVATE), false);
});

test('secret-bearing IDs and unsafe season IDs cannot become public metadata', async () => {
  const data = catalog();
  data.movies.push({ id: PRIVATE, title: 'Secret ID', url: 'https://media.example/1.mp4' });
  data.series[0].seasons[0].episodes.push({ id: PRIVATE + '-episode', title: 'Secret episode', url: 'https://media.example/2.mp4' });
  const { handler } = setup(data);
  const result = await request(handler, 'catalog', { section: 'home' });
  assert.equal(JSON.stringify(result.body).includes(PRIVATE), false);
  const series = await request(handler, 'detail', { providerId: 'owned', id: 'series1' });
  assert.equal(series.body.seasons[0].episodes.length, 1);
  assert.equal(JSON.stringify(series.body).includes(PRIVATE), false);
  assert.equal((await request(handler, 'detail', { providerId: 'owned', id: PRIVATE })).statusCode, 404);
  const rawProvider = { id: 'owned', name: 'Propio', configured: true, sections: ['series'],
    async load() { return { series: [{ id: 'show', title: 'Real', type: 'series', seasons: [{ id: 'https://private.example/?token=' + PRIVATE, episodes: [] }] }] }; } };
  const rawHandler = createXuperApi({ env: {}, providers: [rawProvider] });
  const raw = await request(rawHandler, 'detail', { providerId: 'owned', id: 'show' });
  assert.equal(raw.body.seasons[0].id, 'season-1');
  assert.equal(JSON.stringify(raw.body).includes('private.example'), false);
});

test('metadata cannot expose a playback URL as an image or a bare authorization token', async () => {
  const token = 'bare-provider-authentication-token';
  const data = { movies: [
    { id: 'm1', title: 'Legítimo', url: 'https://cdn.example/private-stream.mp4', poster: 'https://cdn.example/private-stream.mp4' },
    { id: 'm2', title: 'Legítimo ' + token, url: 'https://cdn.example/private-stream.jpg', poster: 'https://cdn.example/private-stream.jpg',
      backdrop: 'https://images.example/' + token + '/poster.jpg' }
  ] };
  const provider = new JsonAdapter({ id: 'owned', name: 'Propio', url: 'https://catalog.example/catalog', authorization: 'Bearer ' + token }, { fetchText: async () => JSON.stringify(data) });
  const handler = createXuperApi({ env: {}, providers: [provider] });
  const result = await request(handler, 'catalog', { section: 'movies' });
  assert.equal(result.body.items[0].poster, '');
  assert.equal(result.body.items[1].poster, '');
  assert.equal(result.body.items[1].backdrop, '');
  assert.equal(JSON.stringify(result.body).includes(token), false);
  assert.equal(JSON.stringify(result.body).includes('private-stream'), false);
});

test('secrets are redacted before shortening display metadata', async () => {
  const token = 'long-private-' + 'x'.repeat(400);
  const provider = new JsonAdapter({ id: 'owned', name: 'Propio', url: 'https://catalog.example/catalog', password: token }, {
    fetchText: async () => JSON.stringify({ movies: [{ id: 'm1', title: token, url: 'https://media.example/1.mp4' }] })
  });
  const handler = createXuperApi({ env: {}, providers: [provider] });
  const result = await request(handler, 'catalog', { section: 'movies' });
  assert.equal(result.body.items[0].title, '[privado]');
  assert.equal(JSON.stringify(result.body).includes('long-private-'), false);
});

test('Infantil and Anime sections derive only matching real movie and series categories', async () => {
  const data = catalog();
  data.movies[0].category = 'Infantil';
  data.series[0].category = 'Anime';
  const { handler } = setup(data);
  const kids = await request(handler, 'catalog', { section: 'kids' });
  assert.deepEqual(kids.body.items.map((item) => item.id), ['movie1']);
  const anime = await request(handler, 'catalog', { section: 'anime' });
  assert.deepEqual(anime.body.items.map((item) => item.id), ['series1']);
  assert.equal(anime.body.items[0].type, 'series');
});
