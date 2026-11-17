'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RadioBrowserAdapter, IptvOrgAdapter } = require('./public-providers.cjs');
const { createXuperApi } = require('../../api/xuper/index.cjs');
const codec = require('../../api/lib/media-token.js');

const UUID = '01234567-89ab-cdef-0123-456789abcdef';
const radioRecord = () => ({ stationuuid: UUID, name: 'Emisora pública', url_resolved: 'https://radio.example/live.mp3',
  country: 'Colombia', countrycode: 'CO', tags: 'jazz,cultura', codec: 'MP3', lastcheckok: 1, favicon: 'https://images.example/radio.png' });

function radioOptions(records = [radioRecord()]) {
  const calls = [];
  return { calls, options: {
    resolveSrv: async () => [{ name: 'de1.api.radio-browser.info', port: 443 }, { name: 'not-authorized.example', port: 443 }],
    fetchText: async (raw, settings) => {
      const url = new URL(raw); calls.push(url);
      assert.deepEqual(settings.allowedHosts, ['de1.api.radio-browser.info']);
      assert.match(settings.headers['User-Agent'], /TVVIDAA/);
      if (url.pathname === '/json/countrycodes') return JSON.stringify([{ name: 'CO' }, { name: 'US' }]);
      if (url.pathname.startsWith('/json/url/')) return JSON.stringify({ ok: true });
      return JSON.stringify(records);
    }
  } };
}

async function request(handler, action, input = {}) {
  const response = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await handler({ method: 'GET', query: { action, ...input }, headers: {}, socket: { remoteAddress: '8.8.8.8' } }, response);
  return response;
}

test('original Radio Browser provider discovers authorized mirrors and queries country/search over HTTPS', async () => {
  const { options, calls } = radioOptions();
  const provider = new RadioBrowserAdapter({}, options);
  const result = await provider.load(false, { country: 'CO', q: 'Jazz', category: 'jazz' });
  assert.equal(result.radio[0].id, UUID);
  assert.equal(result.radio[0].country, 'CO');
  assert.deepEqual(result.countries, ['CO', 'US']);
  const query = calls.find((url) => url.pathname === '/json/stations/search');
  assert.equal(query.protocol, 'https:');
  assert.equal(query.searchParams.get('countrycode'), 'CO');
  assert.equal(query.searchParams.get('name'), 'Jazz');
  assert.equal(query.searchParams.get('tag'), 'jazz');
  assert.equal(query.searchParams.get('is_https'), 'true');
  assert.equal(query.searchParams.get('hidebroken'), 'true');
  await provider.load(false, { country: 'CO', q: 'Jazz', category: 'jazz' });
  assert.equal(calls.filter((url) => url.pathname === '/json/stations/search').length, 1);
  const stream = await provider.resolve(UUID);
  assert.equal(stream.streamUrl, 'https://radio.example/live.mp3');
  assert.equal(stream.mime, 'audio/mpeg');
  assert.equal(calls.filter((url) => url.pathname === '/json/url/' + UUID).length, 1);
});

test('Radio Browser rejects unsafe and incompatible stations and uses UUID for saved items', async () => {
  const broken = { ...radioRecord(), stationuuid: '11111111-1111-1111-1111-111111111111', url_resolved: 'https://127.0.0.1/private' };
  const http = { ...radioRecord(), stationuuid: '22222222-2222-2222-2222-222222222222', url_resolved: 'http://radio.example/plain' };
  const unchecked = { ...radioRecord(), stationuuid: '33333333-3333-3333-3333-333333333333', lastcheckok: 0 };
  const { options, calls } = radioOptions([radioRecord(), broken, http, unchecked]);
  const provider = new RadioBrowserAdapter({}, options);
  assert.equal((await provider.load(false, { country: 'CO' })).radio.length, 1);
  assert.equal(await provider.getItem('http://localhost/private'), null);
  assert.equal(calls.some((url) => url.href.includes('localhost')), false);
  const cold = new RadioBrowserAdapter({}, options);
  assert.equal((await cold.getItem(UUID)).id, UUID);
  assert.equal(calls.some((url) => url.pathname === '/json/stations/byuuid/' + UUID), true);
});

test('Radio Browser mirror failures preserve source identity and back off', async () => {
  let calls = 0;
  const provider = new RadioBrowserAdapter({}, { resolveSrv: async () => [{ name: 'de1.api.radio-browser.info' }], fetchText: async () => { ++calls; throw new Error('private diagnostics'); } });
  await assert.rejects(provider.load(false, { country: 'CO' }));
  const count = calls;
  await assert.rejects(provider.load(false, { country: 'CO' }));
  assert.equal(calls, count);
  assert.equal(provider.status, 'unavailable');
  assert.equal(provider.message.includes('private diagnostics'), false);
});

test('Radio Browser failed manual refresh retains an explicit stale catalog during backoff', async () => {
  const { options } = radioOptions();
  let failed = false;
  const fetch = options.fetchText;
  options.fetchText = async (...args) => { if (failed) throw new Error('unavailable'); return fetch(...args); };
  const provider = new RadioBrowserAdapter({}, options);
  await provider.load(false, { country: 'CO' });
  failed = true;
  assert.equal((await provider.load(true, { country: 'CO' })).stale, true);
  assert.equal((await provider.load(false, { country: 'CO' })).stale, true);
});

test('TVVIDAA IPTV-org supplementary adapter reuses live catalog and multiple compatible signals', async () => {
  const provider = new IptvOrgAdapter({}, { iptvProvider: { country: 'CO', async refresh() { return { fetchedAt: Date.now(), channels: [
    { id: 'Canal.co', name: 'Canal público', hasStream: true, country: 'CO', category: 'Noticias', streams: [
      { url: 'https://cdn.example/first.m3u8', quality: '720p', referrer: 'https://channel.example/', user_agent: 'ChannelPlayer/1.0' },
      { url: 'https://alt.example/second.m3u8', quality: '480p' },
      { url: 'http://cdn.example/insecure.m3u8' }
    ] }, { id: 'None.co', name: 'Sin señal', hasStream: false } ] }; } } });
  const result = await provider.load();
  assert.equal(provider.name, 'IPTV-org · TVVIDAA');
  assert.equal(result.live.length, 1);
  assert.equal(result.live[0].signals.length, 2);
  const stream = await provider.resolve('Canal.co', 1);
  assert.equal(stream.streamUrl, 'https://alt.example/second.m3u8');
  assert.equal(await provider.resolve('Unknown.co'), null);
});

test('public provider catalog and relay API never expose upstream stream addresses', async () => {
  const { options } = radioOptions();
  const provider = new RadioBrowserAdapter({}, options);
  const secret = 'a-public-provider-test-media-key-32-bytes';
  const entries = new Map();
  const mediaRegistry = { register(entry, exp) {
    const ref = require('node:crypto').randomBytes(20).toString('hex');
    const token = codec.encode({ ref, exp }, secret);
    entries.set(ref, entry);
    return { token, exp };
  } };
  const handler = createXuperApi({ env: { MEDIA_TOKEN_SECRET: secret }, providers: [provider], mediaRegistry });
  const catalog = await request(handler, 'catalog', { section: 'radio', country: 'CO' });
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.body.items[0].providerId, 'radio_browser');
  assert.deepEqual(catalog.body.countries, ['CO', 'US']);
  assert.equal(JSON.stringify(catalog.body).includes('radio.example'), false);
  const resolved = await request(handler, 'resolve', { providerId: 'radio_browser', id: UUID });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.body.mime, 'audio/mpeg');
  const token = new URL(resolved.body.mediaUrl, 'https://tv.example').searchParams.get('token');
  assert.equal(entries.get(codec.decode(token, secret).ref).url, 'https://radio.example/live.mp3');
  assert.equal(JSON.stringify(resolved.body).includes('radio.example'), false);
});

test('home does not eagerly contact public directory providers', async () => {
  let calls = 0;
  const provider = new RadioBrowserAdapter({}, { fetchText: async () => { ++calls; throw new Error('must not run'); } });
  const handler = createXuperApi({ env: {}, providers: [provider] });
  const result = await request(handler, 'catalog', { section: 'home' });
  assert.equal(result.statusCode, 200);
  assert.equal(calls, 0);
});

test('remote-paged Videoteca is not sliced a second time by the API', async () => {
  const provider = { id: 'internet_archive', name: 'Internet Archive', format: 'internet-archive', configured: true, sections: ['movies'],
    includeOnHome: false, async load(force, query) {
      assert.equal(query.page, 2);
      return { movies: [{ id: 'ia:actual-item', title: 'Registro real', type: 'movie' }], pagination: { page: 2, pageSize: 20, total: 80, hasMore: true } };
    } };
  const handler = createXuperApi({ env: {}, providers: [provider] });
  const result = await request(handler, 'catalog', { section: 'videoteca', page: '2', pageSize: '20' });
  assert.equal(result.body.items[0].id, 'ia:actual-item');
  assert.equal(result.body.total, 80);
  assert.equal(result.body.hasMore, true);
});
