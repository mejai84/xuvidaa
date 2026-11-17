'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InternetArchiveAdapter, licenseOf, mediaFrom } = require('./internet-archive.cjs');

const license = 'https://creativecommons.org/publicdomain/zero/1.0/';
const metadata = (patch = {}) => ({
  identifier: 'authorized-classic', title: 'Una película de archivo', mediatype: 'movies',
  collection: ['feature_films'], licenseurl: license, year: '1930',
  description: '<p>Sinopsis real del registro.</p>', creator: ['Autor del registro'], ...patch
});
const record = (patch = {}) => ({
  d1: 'ia800308.us.archive.org', d2: 'ia600308.us.archive.org',
  dir: '/21/items/authorized-classic', metadata: metadata(),
  files: [
    { name: 'original.mkv', size: '100', format: 'Matroska' },
    { name: 'movie big.mp4', size: '900000', format: 'MPEG4', length: '5400' },
    { name: 'movie h264.mp4', size: '700000', format: 'h.264', length: '01:30:00' }
  ], ...patch
});
const search = (docs = [metadata()], total = docs.length) => ({ response: { docs, numFound: total } });

function fixture(settings = {}) {
  const calls = [];
  let clock = 1000000;
  const adapter = new InternetArchiveAdapter({ now: () => clock, fetchText: async (raw, options) => {
    const url = new URL(raw);
    calls.push({ url, options });
    assert.equal(url.origin, 'https://archive.org');
    assert.deepEqual(options.allowedHosts, ['archive.org']);
    assert.equal(options.timeout, 15000);
    return JSON.stringify(await (settings.response || ((u) => u.pathname.startsWith('/metadata/') ? record() : search()))(url, calls.length));
  } });
  return { adapter, calls, advance(ms) { clock += ms; } };
}

test('Internet Archive searches original classic collections and filters licensed real records', async () => {
  const f = fixture({ response: () => search([
    metadata(), metadata({ identifier: 'copyright', licenseurl: 'https://example.com/copyright' }),
    metadata({ identifier: 'missing-license', licenseurl: '' }),
    metadata({ identifier: 'restricted', 'access-restricted-item': 'true' }),
    metadata({ identifier: 'other', collection: ['inlibrary'] })
  ]) });
  const result = await f.adapter.load(false, { q: 'space" OR *:*', page: 2, pageSize: 20 });
  assert.equal(result.movies.length, 1);
  assert.equal(result.movies[0].id, 'ia:authorized-classic');
  assert.equal(result.movies[0].title, 'Una película de archivo');
  assert.equal(result.movies[0].synopsis, 'Sinopsis real del registro.');
  assert.equal(result.movies[0].poster, '');
  assert.ok(result.categories.includes('Cine negro'));
  assert.equal(result.pagination.page, 2);
  assert.equal(f.calls[0].url.searchParams.get('rows'), '20');
  assert.match(f.calls[0].url.searchParams.get('q'), /licenseurl:\*publicdomain\*/);
  assert.ok(f.calls[0].url.searchParams.get('q').includes('space\\" OR \\*\\:\\*'));
  assert.equal(f.adapter.includeOnHome, false);
  assert.equal(f.adapter.status, 'connected');
});

test('metadata selects an actual compatible MP4 and pins its documented Archive storage host', async () => {
  const f = fixture();
  const item = await f.adapter.getItem('ia:authorized-classic');
  assert.equal(item.duration, 5400);
  assert.equal(item.licenseUrl, license);
  const stream = await f.adapter.resolve(item.id);
  assert.equal(stream.streamUrl, 'https://ia800308.us.archive.org/21/items/authorized-classic/movie%20h264.mp4');
  assert.equal(stream.mime, 'video/mp4');
  assert.equal(stream.found, true);
  assert.equal(stream.live, false);
  assert.ok(f.adapter.streamHosts.includes('ia600308.us.archive.org'));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.maxBytes, 2 * 1024 * 1024);
  assert.equal(await f.adapter.resolve(item.id, 1), null);
});

test('saved IDs may refresh metadata but arbitrary URLs and unindexed resolve IDs cannot fetch', async () => {
  const f = fixture();
  for (const id of ['https://archive.org/metadata/x', 'ia:../x', 'ia:user/password', 'ia:x?secret=1', 'm3u:123']) {
    assert.equal(await f.adapter.getItem(id), null);
  }
  assert.equal(await f.adapter.resolve('ia:authorized-classic'), null);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.adapter.getItem('ia:authorized-classic')).type, 'movie');
  assert.equal(f.calls.length, 1);
});

test('metadata rejects restricted, unlicensed and hostile storage or file references', async () => {
  const cases = [
    record({ metadata: metadata({ licenseurl: 'https://creativecommons.org/licenses/by-nc/4.0/' }) }),
    record({ metadata: metadata({ identifier: 'different-item' }) }),
    record({ metadata: metadata({ mediatype: 'texts' }) }),
    record({ is_dark: true }), record({ metadata: metadata({ 'access-restricted-item': true }) }),
    record({ d1: '127.0.0.1', d2: 'ia800308.us.archive.org.attacker.example' }),
    record({ dir: '/21/items/other' }), record({ dir: '/21/items/authorized-classic/../secret' }),
    record({ files: [{ name: '../movie.mp4', format: 'h.264', size: '10' }] }),
    record({ files: [{ name: 'movie.mp4', format: 'h.264', size: '10', private: true }] }),
    record({ files: [{ name: 'movie.mp4', format: 'QuickTime', size: '10' }] }),
    record({ files: [{ name: 'movie.mp4', format: 'h.264', size: '10', height: '2160' }] })
  ];
  for (const value of cases) {
    assert.equal(mediaFrom(value, 'authorized-classic'), null);
    const f = fixture({ response: () => value });
    assert.equal(await f.adapter.getItem('ia:authorized-classic'), null);
    assert.equal(await f.adapter.resolve('ia:authorized-classic'), null);
  }
});

test('public-domain license URLs are exact allowlisted declarations, not loose text matches', () => {
  assert.equal(licenseOf('http://creativecommons.org/publicdomain/mark/1.0'), 'https://creativecommons.org/publicdomain/mark/1.0/');
  assert.equal(licenseOf('http://creativecommons.org/licenses/publicdomain/'), 'https://creativecommons.org/licenses/publicdomain/');
  for (const value of ['Public Domain', 'https://creativecommons.org.attacker.example/publicdomain/zero/1.0/',
    'https://creativecommons.org/publicdomain/zero/1.0/?token=x', 'https://user@creativecommons.org/publicdomain/zero/1.0/',
    [license, 'https://example.com/rights'], 'https://creativecommons.org/licenses/by/4.0/']) assert.equal(licenseOf(value), '');
});

test('search caching coalesces requests and keeps stale state plus bounded retry backoff', async () => {
  let fail = false;
  const f = fixture({ response: () => { if (fail) throw new Error('private-provider-error'); return search(); } });
  await Promise.all([f.adapter.load(), f.adapter.load()]);
  assert.equal(f.calls.length, 1);
  fail = true;
  assert.equal((await f.adapter.load(true)).stale, true);
  assert.equal((await f.adapter.load()).stale, true);
  assert.equal(f.calls.length, 2);
  await assert.rejects(f.adapter.load(false, { q: 'uncached' }), /ARCHIVE_UNAVAILABLE/);
  assert.equal(f.calls.length, 2);
  f.advance(16 * 60 * 1000);
  assert.equal((await f.adapter.load()).stale, true);
  assert.equal(f.calls.length, 3);
  assert.doesNotMatch(f.adapter.message, /private-provider-error/);
});

test('expired metadata is revalidated and a removed license prevents later playback', async () => {
  let removed = false;
  const f = fixture({ response: () => record({ metadata: metadata({ licenseurl: removed ? '' : license }) }) });
  await f.adapter.getItem('ia:authorized-classic');
  assert.equal((await f.adapter.resolve('ia:authorized-classic')).found, true);
  removed = true; f.advance(16 * 60 * 1000);
  assert.equal(await f.adapter.resolve('ia:authorized-classic'), null);
  assert.equal(f.calls.length, 2);
});

test('search and metadata response sizes, result counts and paging remain bounded', async () => {
  const oversized = new InternetArchiveAdapter({ fetchText: async () => 'x'.repeat(2 * 1024 * 1024 + 1) });
  assert.equal(await oversized.getItem('ia:authorized-classic'), null);
  const tooMany = fixture({ response: () => search(Array.from({ length: 41 }, () => metadata())) });
  await assert.rejects(tooMany.adapter.load(), /ARCHIVE_UNAVAILABLE/);
  const f = fixture();
  const result = await f.adapter.load(false, { pageSize: 1000, page: 1000000 });
  assert.equal(f.calls[0].url.searchParams.get('rows'), '40');
  assert.equal(f.calls[0].url.searchParams.get('page'), '250');
  assert.equal(result.pagination.pageSize, 40);
});

test('distinct searches cannot create an unbounded queue of upstream requests', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const adapter = new InternetArchiveAdapter({ fetchText: async () => {
    ++calls; await gate; return JSON.stringify(search());
  } });
  const pending = ['one', 'two', 'three', 'four'].map((q) => adapter.load(false, { q }));
  await assert.rejects(adapter.load(false, { q: 'five' }), /ARCHIVE_BUSY/);
  assert.equal(calls, 4);
  release();
  await Promise.all(pending);
  assert.equal(adapter.pending.size, 0);
});
