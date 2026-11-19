'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LaMovieAdapter } = require('./lamovie.cjs');
const { createRegistry } = require('./adapters.cjs');

function provider(respond) {
  return new LaMovieAdapter({ id: 'lamovie', baseUrl: 'https://catalog.example.com' }, {
    fetchText: async (raw, options) => {
      const url = new URL(raw);
      assert.equal(url.origin, 'https://catalog.example.com');
      assert.deepEqual(options.allowedHosts, ['catalog.example.com']);
      return JSON.stringify(await respond(url));
    }
  });
}

test('LaMovie stays opt-in and catalog queries preserve remote pages and search', async () => {
  assert.equal(createRegistry({}).find(p => p.id === 'lamovie').configured, false);
  const calls = [];
  const p = provider(url => {
    calls.push(url);
    return { page: 2, total_results: 100, next_page_url: '/generos/peliculas/suspense?page=3',
      items: [{ slug: 'title', title: 'Title', type: 'movies', year: '2021', stream_url: 'PRIVATE_NOT_METADATA' }] };
  });
  const catalog = await p.load(false, { section: 'movies', page: 2 });
  assert.equal(calls[0].searchParams.get('page'), '2');
  assert.equal(catalog.pagination.hasMore, true);
  assert.equal(catalog.pagination.total, 100);
  assert.ok(!JSON.stringify(catalog).includes('PRIVATE_NOT_METADATA'));
  await p.load(false, { section: 'movies', q: 'spider man', page: 1 });
  assert.equal(calls[1].pathname, '/buscar');
  assert.equal(calls[1].searchParams.get('q'), 'spider man');
});

test('LaMovie resolves only a known title and an exact HTTPS direct-media family', async () => {
  let source = 'https://cdn.vimeos.net/video.m3u8';
  const calls = [];
  const row = { slug: 'a-film', title: 'A film', type: 'movies', embeds: { video: [
    { name: 'HD', stream_url: 'https://catalog.example.com/streamurl?url=reference' }
  ] } };
  const p = provider(url => {
    calls.push(url.pathname);
    if (url.pathname === '/streamurl') return { qualities: [{ url: source }] };
    if (url.pathname.startsWith('/pelicula/')) return row;
    return { items: [row] };
  });
  assert.equal(await p.resolve('unrecognized'), null);
  const { movies: [item] } = await p.load(false, { section: 'movies' });
  assert.equal(calls.includes('/streamurl'), false);
  const detail = await p.getItem(item.id);
  assert.equal(detail.signals[1].label, 'HD');
  assert.ok(!JSON.stringify(detail).includes('streamurl'));
  assert.equal((await p.resolve(item.id)).mime, 'application/vnd.apple.mpegurl');
  for (source of ['http://cdn.vimeos.net/video.m3u8', 'https://vimeos.net.attacker.example/video.m3u8',
    'https://127.0.0.1/video.m3u8', 'https://u:p@cdn.vimeos.net/video.m3u8']) {
    assert.equal(await p.resolve(item.id), null);
  }
  assert.equal(await p.resolve(item.id, 16), null);
});

test('LaMovie seasons retain their own episode references and reject an unrelated episode reply', async () => {
  let episodeSeries = 'show';
  const series = { slug: 'show', title: 'Show', type: 'tvshows', temporadas: [
    { season_number: 2, episodios: [{ name: 'E1', episode_number: 1 }] },
    { season_number: 1, episodios: [{ name: 'E1', episode_number: 1 }] }
  ] };
  const p = provider(url => {
    if (url.pathname === '/serie/show') return series;
    if (url.pathname === '/serie/show/1/1') return { title: 'E1', serie_slug: episodeSeries, season: 1, episode: 1 };
    return { items: [series] };
  });
  const { series: [card] } = await p.load(false, { section: 'series' });
  const detail = await p.getItem(card.id);
  assert.deepEqual(detail.seasons.map(s => s.number), [1, 2]);
  assert.notEqual(detail.seasons[0].episodes[0].id, detail.seasons[1].episodes[0].id);
  const id = detail.seasons[0].episodes[0].id;
  assert.equal((await p.getItem(id)).number, 1);
  episodeSeries = 'other';
  p.cache.clear();
  assert.equal(await p.getItem(id), null);
});
