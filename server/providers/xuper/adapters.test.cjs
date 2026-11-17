'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { M3uAdapter, JsonAdapter, parseJsonCatalog, createRegistry } = require('./adapters.cjs');

const fixture = {
  movies: [{ id: 'film1', title: 'Película real', url: 'https://media.example/movie/private-user/private-pass/1.mp4' }],
  series: [{ id: 'show1', title: 'Serie real', seasons: [{ number: 1, episodes: [{ id: 'ep1', title: 'Piloto', url: 'https://media.example/ep1.mp4' }] }] }],
  live: [{ id: 'live1', title: 'Canal real', signals: [{ url: 'https://media.example/live.m3u8' }, { url: 'https://alt.example/live.m3u8' }] }],
  radio: [{ id: 'radio1', title: 'Emisora real', country: 'Colombia', url: 'https://media.example/radio.mp3' }],
  music: [{ id: 'track1', title: 'Pista autorizada', url: 'https://media.example/track.mp3' }]
};

test('JSON adapter preserves separate catalogs, episodes and multiple live signals', async () => {
  let calls = 0;
  const provider = new JsonAdapter({ id: 'owned', name: 'Propio', url: 'https://catalog.example/catalog', authorization: 'Bearer secret' }, { fetchText: async (url, options) => {
    ++calls; assert.equal(options.headers.Authorization, 'Bearer secret'); return JSON.stringify(fixture);
  } });
  const data = await provider.load();
  assert.equal(data.movies[0].type, 'movie');
  assert.equal(data.series[0].seasons[0].episodes[0].type, 'episode');
  assert.equal(data.radio[0].type, 'radio');
  assert.equal((await provider.resolve('ep1')).streamUrl, 'https://media.example/ep1.mp4');
  assert.equal((await provider.resolve('live1', 1)).streamUrl, 'https://alt.example/live.m3u8');
  assert.equal(await provider.resolve('does-not-exist'), null);
  await provider.load();
  assert.equal(calls, 1);
  assert.equal(provider.status, 'connected');
});

test('failed refresh preserves real JSON catalog and reports stale state', async () => {
  let fail = false;
  let calls = 0;
  const provider = new JsonAdapter({ id: 'owned', name: 'Propio', url: 'https://catalog.example/catalog' }, { fetchText: async () => {
    ++calls;
    if (fail) throw new Error('sensitive server path');
    return JSON.stringify(fixture);
  } });
  await provider.load(); fail = true;
  const data = await provider.load(true);
  assert.equal(data.movies[0].id, 'film1');
  assert.equal(data.stale, true);
  assert.equal(provider.status, 'stale');
  assert.equal(provider.message.includes('sensitive'), false);
  assert.equal((await provider.load()).stale, true);
  assert.equal(calls, 2, 'failed providers back off rather than refetch per request');
});

test('M3U stale fallback observes backoff even when the underlying provider does not throw', async () => {
  let calls = 0;
  const provider = new M3uAdapter({ id: 'owned', name: 'M3U', url: 'https://catalog.example/list.m3u', cacheDir: false }, {
    provider: { async refresh() { ++calls; return { movies: [{ id: 'cached', title: 'Catálogo guardado' }], stale: true }; } }
  });
  assert.equal((await provider.load()).stale, true);
  assert.equal((await provider.load()).movies[0].id, 'cached');
  assert.equal(calls, 1);
  await provider.load(true);
  assert.equal(calls, 2, 'explicit refresh can validate again');
});

test('JSON parser rejects ambiguous IDs and bounded malformed shapes', () => {
  assert.throws(() => parseJsonCatalog({ movies: [{ id: 'http://localhost/secret', title: 'x' }] }));
  assert.throws(() => parseJsonCatalog({ movies: [{ id: 'same', title: 'x' }], radio: [{ id: 'same', title: 'y' }] }));
  assert.throws(() => parseJsonCatalog({ movies: {} }));
  assert.throws(() => parseJsonCatalog({ series: [{ id: 'show', title: 'x', seasons: [{ episodes: [{ id: 'show' }] }] }] }));
  assert.throws(() => parseJsonCatalog({ series: [{ id: 'show', title: 'x', seasons: [{ id: 'https://private.example/?token=secret', episodes: [] }] }] }));
});

test('M3U adapter reuses parser for movies, seasons, private live TV and audio', async () => {
  const m3u = '#EXTM3U\n#EXTINF:-1 group-title="Peliculas",Cine\nhttps://media.example/movie/user/pass/1.mp4\n' +
    '#EXTINF:-1 group-title="Series",Programa S01E01\nhttps://media.example/series/user/pass/2.mp4\n' +
    '#EXTINF:-1 group-title="TV en vivo",Canal\nhttps://media.example/live/user/pass/3.m3u8\n' +
    '#EXTINF:-1 group-title="Radio" tvg-logo="https://images.example/logo.png",Emisora\nhttps://media.example/radio.mp3\n' +
    '#EXTINF:-1 group-title="Musica",Pista\nhttps://media.example/music.mp3\n';
  const provider = new M3uAdapter({ id: 'm3u1', name: 'M3U', format: 'm3u', url: 'https://catalog.example/list.m3u', cacheDir: false }, { fetchText: async () => m3u });
  const data = await provider.load();
  assert.equal(data.movies.length, 1);
  assert.equal(data.series.length, 1);
  assert.equal(data.live.length, 1);
  assert.equal(data.radio.length, 1);
  assert.equal(data.radio[0].poster, 'https://images.example/logo.png');
  assert.equal(data.music.length, 1);
  assert.equal((await provider.resolve(data.live[0].id)).isHls, true);
  assert.equal((await provider.resolve(data.radio[0].id)).live, true);
  assert.equal(await provider.resolve('unknown'), null);
  assert.equal(provider.provider.cacheFile, null);
});

test('provider registry requires explicit authorization and never enables unverified Xuper access', () => {
  const common = { M3U_CACHE_DIR: 'off' };
  const registry = createRegistry({ ...common, XUPER_PROVIDERS_JSON: JSON.stringify([{ id: 'owned', name: 'Mi catálogo', format: 'json', authorized: true, url: 'https://catalog.example/api' }]) });
  assert.deepEqual(registry.map((provider) => provider.id), ['existing_private_m3u', 'owned', 'radio_browser', 'internet_archive', 'iptv_org', 'xuper_premium', 'lamovie', 'youtube_music']);
  assert.equal(registry.find((provider) => provider.id === 'xuper_premium').configured, false);
  assert.equal(registry.find((provider) => provider.id === 'internet_archive').configured, false);
  assert.equal(registry.find((provider) => provider.id === 'internet_archive').status, 'not_configured');
  assert.equal(registry.find((provider) => provider.id === 'internet_archive').role, 'legacy');
  assert.equal(registry.find((provider) => provider.id === 'iptv_org').role, 'supplementary');
  assert.equal(registry.find((provider) => provider.id === 'radio_browser').role, 'original');
  const explicitArchive = createRegistry({ ...common, XUPER_ENABLE_ARCHIVE: 'true' });
  assert.equal(explicitArchive.find((provider) => provider.id === 'internet_archive').configured, true);
  assert.equal(explicitArchive.find((provider) => provider.id === 'internet_archive').name, 'Internet Archive · Fuente heredada');
  for (const config of [
    [{ id: 'owned', name: 'Mi catálogo', format: 'json', url: 'https://catalog.example/api' }],
    [{ id: 'owned', name: 'Mi catálogo', format: 'json', authorized: true, url: 'http://catalog.example/api' }],
    [{ id: 'xuper_premium', name: 'Mi catálogo', format: 'json', authorized: true, url: 'https://catalog.example/api' }]
  ]) {
    const invalid = createRegistry({ ...common, XUPER_PROVIDERS_JSON: JSON.stringify(config) });
    assert.equal(invalid.some((provider) => provider.id === 'provider_configuration'), true);
    assert.equal(invalid.some((provider) => provider.id === 'owned'), false);
  }
});
