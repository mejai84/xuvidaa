'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const api = require('./api/vidaa-api.cjs');
const { M3uProvider } = require('./providers/m3uProvider.cjs');
const { IptvOrgProvider } = require('./providers/iptvOrgProvider.cjs');

const M3U = '#EXTM3U\n#EXTINF:-1 group-title="Cine",Película primera\nhttps://cdn.example/movie/user-private/password-private/1.mp4\n';
function invoke(method, body = {}) {
  let response;
  const res = { setHeader() { return this; }, status(value) { this.code = value; return this; }, json(value) { response = { status: this.code, body: value }; return this; } };
  return Promise.resolve(api({ method: 'POST', query: { method }, body, headers: {}, socket: { remoteAddress: '192.0.2.88' } }, res)).then(() => response);
}

function replace(t, object, changes) {
  const saved = {};
  for (const [key, value] of Object.entries(changes)) { saved[key] = object[key]; object[key] = value; }
  t.after(() => Object.assign(object, saved));
}

test('catalog source failures become controlled metadata responses without repetitive HTTP 503', async (t) => {
  const unavailable = async () => { throw new Error('private upstream unavailable'); };
  replace(t, api.live, { getCategories: unavailable, getChannels: unavailable });
  replace(t, api.vod, { getMovies: unavailable, getSeries: unavailable, isConfigured: () => false });
  for (const method of ['liveCategories', 'liveChannels', 'm3uMovies', 'm3uSeries']) {
    const response = await invoke(method);
    assert.equal(response.status, 200, method);
    assert.equal(response.body.unavailable, true);
    assert.equal(response.body.total, 0);
    assert.equal(response.body.hasMore, false);
    assert.ok(response.body.warning);
    assert.doesNotMatch(JSON.stringify(response.body), /private upstream/);
  }
});

test('home compatibility selects M3U movies or series and prewarm never contacts a source', async (t) => {
  let movies = 0;
  let series = 0;
  replace(t, api.vod, {
    getMovies: async () => { movies++; return { items: [{ id: 'mov-12345', title: 'Mi película' }], total: 1 }; },
    getSeries: async () => { series++; return { items: [{ id: 'series-12345', title: 'Mi serie' }], total: 1 }; }
  });
  const startup = await invoke('prewarm');
  assert.equal(startup.status, 200);
  assert.deepEqual(startup.body.providers, { live: 'iptv-org', vod: 'm3u' });
  assert.equal(movies + series, 0);
  assert.equal((await invoke('home', { root: 'movies' })).body.items[0].kind, 'película');
  assert.equal((await invoke('home', { root: 'series' })).body.items[0].kind, 'serie');
  assert.equal((await invoke('home', { root: 'unknown' })).status, 400);
  assert.equal(movies, 1);
  assert.equal(series, 1);
});

test('live listings are independent of a missing private VOD configuration', async (t) => {
  let vodCalls = 0;
  replace(t, api.vod, { getMovies: async () => { vodCalls++; throw new Error('Missing configuration'); } });
  replace(t, api.live, {
    getCategories: async () => ({ categories: [{ id: 'news', name: 'Noticias' }], stale: true }),
    getChannels: async () => ({ channels: [{ id: 'News.co', name: 'Noticias', hasStream: true }], total: 1, stale: true })
  });
  const categories = await invoke('liveCategories');
  const channels = await invoke('liveChannels');
  assert.equal(categories.status, 200);
  assert.equal(categories.body.categories.length, 1);
  assert.equal(channels.body.channels.length, 1);
  assert.equal(channels.body.stale, true);
  assert.ok(channels.body.warning);
  assert.equal(vodCalls, 0);
});

test('HTTPS-only playback remains enforced for private titles and public channels', async (t) => {
  replace(t, api.vod, { isConfigured: () => true, resolveStream: async () => ({ found: true, streamUrl: 'http://cdn.example/movie/1.mp4', mime: 'video/mp4' }) });
  replace(t, api.live, { getChannel: async () => ({ hasStream: true, streamUrl: 'http://cdn.example/news.m3u8', streams: [{ url: 'http://cdn.example/news.m3u8' }] }) });
  assert.equal((await invoke('resolve', { contentId: 'mov-12345' })).status, 415);
  assert.equal((await invoke('resolveLive', { channelCode: 'News.co' })).status, 415);
});

test('injected M3U and IPTV-org downloads never use the application cache implicitly', async () => {
  const vod = new M3uProvider({ fetchM3uContent: async () => M3U });
  const live = new IptvOrgProvider({ fetchJson: async () => [] });
  assert.equal(vod.cacheFile, null);
  assert.equal(live.cacheFile, null);
  await vod.refresh(true);
  assert.equal((await vod.getMovies()).items.length, 1);
});

test('M3U refresh shares downloads, clears completed memory hits and backs off failures', async () => {
  let calls = 0;
  let fail = false;
  const provider = new M3uProvider({ fetchM3uContent: async () => { calls++; await new Promise(resolve => setImmediate(resolve)); if (fail) throw Error('network'); return M3U; } });
  await Promise.all([provider.refresh(true), provider.refresh(true)]);
  assert.equal(calls, 1);
  await provider.refresh(false);
  assert.equal(provider.refreshPromise, null);
  fail = true;
  const fallback = await provider.refresh(true);
  assert.equal(fallback.stale, true);
  await provider.refresh(false);
  assert.equal(calls, 2);
});

test('M3U cache replacements preserve a previous copy and reject empty downloads', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaa-source-cache-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let content = M3U;
  const provider = new M3uProvider({ cacheDir: directory, fetchM3uContent: async () => content });
  await provider.refresh(true);
  const first = fs.readFileSync(provider.cacheFile, 'utf8');
  content = '#EXTM3U\n';
  const invalid = await provider.refresh(true);
  assert.equal(invalid.stale, true);
  assert.equal(fs.readFileSync(provider.cacheFile, 'utf8'), first);
  content = M3U.replace('Película primera', 'Película segunda');
  await provider.refresh(true);
  assert.equal(fs.readFileSync(provider.cacheFile + '.previous', 'utf8'), first);
  assert.equal(JSON.parse(fs.readFileSync(provider.cacheFile, 'utf8')).movies[0].title, 'Película segunda');
});

test('M3U metadata stays available from an expired cache without credentials or writes', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaa-expired-cache-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'm3u-catalog.json');
  const raw = JSON.stringify({ fetchedAt: 1, movies: [{ id: 'mov-12345', title: 'Guardada' }], series: [] });
  fs.writeFileSync(filename, raw);
  const provider = new M3uProvider({ cacheDir: directory });
  provider.isConfigured = () => false;
  provider.fetchRemoteM3u = async () => { throw Error('Must not download'); };
  const listed = await provider.getMovies();
  assert.equal(listed.items.length, 1);
  assert.equal(listed.stale, true);
  assert.equal(fs.readFileSync(filename, 'utf8'), raw);
});

test('IPTV-org failures back off and a completed memory hit does not freeze refresh forever', async () => {
  let calls = 0;
  let failed = false;
  const data = { channels: [{ id: 'News.co', name: 'Noticias', country: 'CO', categories: ['news'] }], streams: [{ channel: 'News.co', url: 'https://cdn.example/news.m3u8' }], logos: [], categories: [], countries: [] };
  const provider = new IptvOrgProvider({ fetchJson: async url => { calls++; await new Promise(resolve => setImmediate(resolve)); if (failed) throw Error('network'); return data[new URL(url).pathname.split('/').at(-1).replace('.json', '')]; } });
  await Promise.all([provider.refresh(true), provider.refresh(true)]);
  assert.equal(calls, 5);
  await provider.refresh(false);
  assert.equal(provider.refreshPromise, null);
  failed = true;
  assert.equal((await provider.refresh(true)).stale, true);
  await provider.refresh(false);
  assert.equal(calls, 10);
});
