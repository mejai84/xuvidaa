'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRegistry } = require('./adapters.cjs');

function registry(overrides, responder) {
  const config = { id: 'prueba', name: 'Integración de prueba', format: 'xuper-http', authorized: true,
    baseUrl: 'https://control.example.com/api/', streamHosts: ['media.example.com'], ...overrides };
  return createRegistry({ M3U_CACHE_DIR: 'off', XUPER_PROVIDERS_JSON: JSON.stringify([config]) }, {
    fetchText: async (raw, options) => {
      const uri = new URL(raw);
      assert.equal(uri.origin, 'https://control.example.com');
      assert.deepEqual(options.allowedHosts, [uri.hostname]);
      return JSON.stringify({ returnValue: true, ...await responder(uri, options) });
    }
  });
}

test('el contrato HTTPS requiere autorización expresa, destino de control válido y hosts de reproducción', () => {
  for (const invalid of [{ authorized: false }, { baseUrl: 'https://127.0.0.1' }, { streamHosts: [] },
    { baseUrl: 'https://control.example.com/api/?firma=123' }, { streamHosts: ['*.example.com'] }]) {
    assert.ok(!registry(invalid).some(p => p.format === 'xuper-http'));
  }
});

test('la resolución usa el archivo directo y el formato correspondiente sin reenviar credenciales', async () => {
  const origin = 'https://media.example.com';
  const clip = { id: 'internal-movie-id', title: 'Ejemplo', duration: '00:01:20' };
  let next;
  const [adapter] = registry({ authorization: 'Bearer prueba-local' }, (url, options) => {
    assert.deepEqual(options.headers, { Authorization: 'Bearer prueba-local' });
    if (url.pathname.endsWith('/resolve')) return next;
    return { items: [clip] };
  }).filter(p => p.id === 'prueba');
  const { movies: [movie] } = await adapter.load(false, { section: 'movies' });
  assert.equal(movie.duration, 80);
  assert.notEqual(movie.id, clip.id);
  for (const [path, mime, expected] of [
    ['/v.mp4', 'video/mp4', 'video/mp4'], ['/v.m3u8', '', 'application/vnd.apple.mpegurl'],
    ['/v.ts', 'application/vnd.apple.mpegurl', 'video/mp2t'], ['/v.m2ts', 'video/mp2t', 'video/mp2t'],
    ['/v.mp4', 'application/vnd.apple.mpegurl', null], ['/v.mkv', 'video/mp4', null],
    ['/opaque', 'application/vnd.apple.mpegurl', null]
  ]) {
    next = { url: origin + path, proxyPath: 'http://127.0.0.1/media/test', mime, duration: 12 };
    const value = await adapter.resolve(movie.id);
    assert.equal(value?.mime || null, expected, path);
    if (value) {
      assert.equal(value.streamUrl, next.url);
      assert.equal(value.duration, 12);
      assert.equal(value.headers, undefined);
    }
  }
  for (const unsafe of [{ url: 'https://unlisted.example.com/movie.mp4' }, { url: 'http://127.0.0.1/x.mp4' },
    { url: origin + '/movie.mp4', headers: { Cookie: 'ficticia=1' } }]) {
    next = unsafe;
    assert.equal(await adapter.resolve(movie.id), null);
  }
  assert.equal(await adapter.resolve('desconocido'), null);
  assert.equal(await adapter.resolve(movie.id, 1), null);
});

test('la ficha separa episodios con el mismo ID por temporada y preserva el orden y los campos del port', async () => {
  const show = { type: 'teleplay', id: 'season2', title: 'Serie T2' };
  const episode = { id: 'ep1', number: 1, title: 'Episodio 1', picture: 'https://art.example.com/poster.jpg', description: 'Primera parte' };
  const calls = [];
  const [adapter] = registry({}, url => {
    calls.push(url);
    const source = url.searchParams.get('contentId');
    if (url.pathname === '/api/home') return { items: [show] };
    if (url.pathname === '/api/resolve') return { url: 'https://media.example.com/video.mp4' };
    if (source === 'season2') return { item: show, seasons: [{ id: 'season2', number: 2 }, { id: 'season1', number: 1 }], episodes: [episode] };
    return { item: { ...show, id: 'season1' }, episodes: [episode] };
  }).filter(p => p.id === 'prueba');
  const { series: [card] } = await adapter.load(false, { section: 'series' });
  const { seasons } = await adapter.getItem(card.id);
  assert.deepEqual(seasons.map(s => s.number), [1, 2]);
  assert.notEqual(seasons[0].episodes[0].id, seasons[1].episodes[0].id);
  for (const s of seasons) {
    const ep = s.episodes[0];
    assert.equal(ep.poster, episode.picture);
    assert.equal(ep.synopsis, episode.description);
    await adapter.resolve(ep.id);
    assert.equal(calls.at(-1).searchParams.get('seriesContentId'), 'season' + s.number);
    assert.equal(calls.at(-1).searchParams.get('contentId'), 'ep1');
  }
});
