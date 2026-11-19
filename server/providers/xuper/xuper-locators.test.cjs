'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRegistry } = require('./adapters.cjs');
const { XuperLocators, idFor } = require('./xuper-locators.cjs');

const config = { id: 'authorized_demo', name: 'Demo', format: 'xuper-http', authorized: true,
  baseUrl: 'https://catalog.example/api/', streamHosts: ['media.example'], authorization: 'Bearer testing-account-one' };
const siteKey = 'local test key '.repeat(4);
function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidaa-locators-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('favorites and playback resume with a fresh adapter without reopening the catalog', async t => {
  const dir = tmp(t);
  const calls = [];
  let availableEpisode = true;
  const movie = { id: 'm1', title: 'Local movie', type: 'movie', poster: 'https://images.example/m1.jpg' };
  const series = { id: 's1', title: 'Local series', type: 'teleplay' };
  const season = { id: 's2', title: 'Local series II', type: 'teleplay' };
  const episode = { id: 'e4', title: 'Local episode', number: 4 };
  function start(c = config) {
    return createRegistry({ M3U_CACHE_DIR: dir, MEDIA_TOKEN_SECRET: siteKey, XUPER_PROVIDERS_JSON: JSON.stringify([c]) }, {
      fetchText: async url => {
        const u = new URL(url);
        const id = u.searchParams.get('contentId');
        const op = u.pathname.split('/').pop();
        calls.push([op, id, u.searchParams.get('seriesContentId')]);
        let data;
        if (op === 'home') data = { items: u.searchParams.get('root') === 'movies' ? [movie] : [series] };
        if (op === 'detail' && id === 's1') data = { item: series, seasons: [{ id: 's2', number: 2 }] };
        if (op === 'detail' && id === 's2') data = { item: season, episodes: availableEpisode ? [episode] : [] };
        if (op === 'detail' && id === 'm1') data = { item: movie };
        if (op === 'resolve') data = { url: 'https://media.example/clip.mp4?sig=demo-signature', mime: 'video/mp4' };
        assert.ok(data, 'Unknown fixture request');
        return JSON.stringify({ returnValue: true, ...data });
      }
    }).find(provider => provider.id === c.id);
  }
  const first = start();
  const catalog = await first.load();
  const filmId = catalog.movies[0].id, seriesId = catalog.series[0].id;
  const episodeId = (await first.getItem(seriesId)).seasons[0].episodes[0].id;
  calls.length = 0;
  const second = start();
  assert.equal((await second.getItem(filmId)).title, movie.title);
  assert.equal((await second.resolve(filmId)).found, true);
  assert.equal((await second.getItem(episodeId)).season, 2);
  assert.equal((await second.resolve(episodeId)).found, true);
  assert.equal((await second.getItem(seriesId)).title, series.title);
  assert.ok(calls.some(([op, id, parent]) => op === 'resolve' && id === 'e4' && parent === 's2'));
  assert.ok(calls.every(([op]) => op !== 'home'));
  const bytes = fs.readFileSync(path.join(dir, 'xuper-authorized_demo-locators.sqlite')).toString('latin1');
  for (const value of [siteKey, config.authorization, 'testing-account-one', 'https:', 'media.example', 'demo-signature', movie.title, 'images.example']) {
    assert.equal(bytes.includes(value), false, 'Only catalog locators may be persisted');
  }
  calls.length = 0;
  assert.equal(await start({ ...config, authorization: 'Bearer testing-account-two' }).getItem(episodeId), null);
  assert.equal(await start({ ...config, baseUrl: 'https://other.example/' }).getItem(filmId), null);
  assert.equal(calls.length, 0);
  availableEpisode = false;
  assert.equal(await start().resolve(episodeId), null);
  assert.equal(calls.at(-1)[0], 'detail');
});

test('cache is bounded, skips secret-like IDs and respects cache off', t => {
  const dir = tmp(t);
  const locators = new XuperLocators(dir, siteKey, config, config.streamHosts, ['testing-account-one'], 2);
  const entry = source => ({ source, parent: '', item: { id: idFor('movie', '', source) } });
  const a = entry('a'), b = entry('b'), c = entry('c'), sensitive = entry('prefix-testing-account-one');
  locators.remember([a, b, c, sensitive]);
  assert.equal(locators.get(a.item.id), null);
  assert.equal(locators.get(b.item.id).source, 'b');
  assert.equal(locators.get(c.item.id).source, 'c');
  assert.equal(locators.get(sensitive.item.id), null);
  assert.equal(locators.get('movie-invalid'), null);
  const off = new XuperLocators(false, siteKey, config, config.streamHosts, []);
  off.remember([a]);
  assert.equal(off.get(a.item.id), null);
});
