'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { IptvOrgProvider, scoreStream, sortStreams } = require('./iptvOrgProvider.cjs');

function createFixtureData() {
  const channels = [
    {
      id: 'CaracolTV.co',
      name: 'Caracol TV',
      country: 'CO',
      categories: ['general'],
      is_nsfw: false
    },
    {
      id: 'RCN.co',
      name: 'RCN Televisión',
      country: 'CO',
      categories: ['entertainment', 'news'],
      is_nsfw: false
    },
    {
      id: 'SenalColombia.co',
      name: 'Señal Colombia',
      country: 'CO',
      categories: ['culture', 'education'],
      is_nsfw: false
    },
    {
      id: 'Teleantioquia.co',
      name: 'Teleantioquia',
      country: 'CO',
      categories: ['general'],
      is_nsfw: false
    },
    {
      id: 'CanalSinStream.co',
      name: 'Canal Sin Transmisión',
      country: 'CO',
      categories: ['news'],
      is_nsfw: false
    },
    {
      id: 'AdultChannel.co',
      name: 'Canal Adulto',
      country: 'CO',
      categories: ['xxx'],
      is_nsfw: true
    },
    {
      id: 'OtherAdult.co',
      name: 'Otro Adulto',
      country: 'CO',
      categories: ['general'],
      is_nsfw: true
    },
    {
      id: 'TVEspagna.es',
      name: 'TVE 1 España',
      country: 'ES',
      categories: ['general'],
      is_nsfw: false
    },
    {
      id: 'ClaroSports.co',
      name: 'Claro Sports Colombia',
      country: 'CO',
      categories: ['sports'],
      is_nsfw: false
    }
  ];

  const streams = [
    // Caracol has multiple streams: http sd vs https 1080p hls vs geo-blocked
    {
      channel: 'CaracolTV.co',
      url: 'http://stream.caracol.co/live.m3u8',
      quality: '720p',
      labels: []
    },
    {
      channel: 'CaracolTV.co',
      url: 'https://stream.caracol.co/master.m3u8',
      quality: '1080p',
      labels: []
    },
    {
      channel: 'CaracolTV.co',
      url: 'https://backup.caracol.co/geo.m3u8',
      quality: '1080p',
      labels: ['Geo-blocked']
    },

    // RCN has single HLS stream
    {
      channel: 'RCN.co',
      url: 'https://rcn.cdn.co/live/stream.m3u8',
      quality: '720p',
      labels: []
    },

    // Señal Colombia has stream with Not 24/7 label
    {
      channel: 'SenalColombia.co',
      url: 'https://rtvc.cdn.co/senal.m3u8',
      quality: '720p',
      labels: ['Not 24/7']
    },

    // Teleantioquia has Geo-blocked stream
    {
      channel: 'Teleantioquia.co',
      url: 'https://teleantioquia.cdn.co/live.m3u8',
      quality: '720p',
      labels: ['Geo-blocked']
    },

    // ClaroSports has HLS stream
    {
      channel: 'ClaroSports.co',
      url: 'https://clarosports.cdn.co/live.m3u8',
      quality: '1080p',
      labels: []
    },

    // Foreign stream
    {
      channel: 'TVEspagna.es',
      url: 'https://rtve.es/live.m3u8',
      quality: '1080p',
      labels: []
    }
  ];

  const logos = [
    { channel: 'CaracolTV.co', url: 'https://cdn.example/caracol.png', in_use: true },
    { channel: 'RCN.co', url: 'https://cdn.example/rcn.png', in_use: true },
    { channel: 'SenalColombia.co', url: 'https://cdn.example/senal.png', in_use: true }
  ];

  const categories = [
    { id: 'general', name: 'General' },
    { id: 'entertainment', name: 'Entertainment' },
    { id: 'news', name: 'News' },
    { id: 'culture', name: 'Culture' },
    { id: 'education', name: 'Education' },
    { id: 'sports', name: 'Sports' }
  ];

  const countries = [
    { code: 'CO', name: 'Colombia', languages: ['spa'] },
    { code: 'ES', name: 'Spain', languages: ['spa'] }
  ];

  return { channels, streams, logos, categories, countries };
}

function createMockFetcher(dataMap) {
  return async function mockFetchJson(url) {
    if (dataMap[url] instanceof Error) {
      throw dataMap[url];
    }
    if (dataMap[url]) {
      return JSON.parse(JSON.stringify(dataMap[url]));
    }
    throw new Error('404 Not Found: ' + url);
  };
}

test('1. channels.json válido se procesa correctamente', async () => {
  const data = createFixtureData();
  const provider = new IptvOrgProvider({
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-test-')),
    fetchJson: createMockFetcher({
      [IptvOrgProvider.prototype.endpoints?.channels || 'https://iptv-org.github.io/api/channels.json']: data.channels,
      [IptvOrgProvider.prototype.endpoints?.streams || 'https://iptv-org.github.io/api/streams.json']: data.streams,
      [IptvOrgProvider.prototype.endpoints?.logos || 'https://iptv-org.github.io/api/logos.json']: data.logos,
      [IptvOrgProvider.prototype.endpoints?.categories || 'https://iptv-org.github.io/api/categories.json']: data.categories,
      [IptvOrgProvider.prototype.endpoints?.countries || 'https://iptv-org.github.io/api/countries.json']: data.countries
    })
  });

  const res = await provider.refresh(true);
  assert.equal(res.country, 'CO');
  assert.ok(Array.isArray(res.channels));
  assert.ok(res.channels.length > 0);
});

test('2. streams.json válido se procesa y asocia a canales', async () => {
  const data = createFixtureData();
  const provider = new IptvOrgProvider({
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-test-')),
    fetchJson: createMockFetcher({
      'https://iptv-org.github.io/api/channels.json': data.channels,
      'https://iptv-org.github.io/api/streams.json': data.streams,
      'https://iptv-org.github.io/api/logos.json': data.logos,
      'https://iptv-org.github.io/api/categories.json': data.categories,
      'https://iptv-org.github.io/api/countries.json': data.countries
    })
  });

  const res = await provider.refresh(true);
  const rcn = res.channels.find((c) => c.id === 'RCN.co');
  assert.ok(rcn);
  assert.equal(rcn.streamUrl, 'https://rcn.cdn.co/live/stream.m3u8');
  assert.equal(rcn.quality, '720p');
});

test('3. join channel -> streams relaciona correctamente por id', async () => {
  const data = createFixtureData();
  const provider = new IptvOrgProvider({
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-test-')),
    fetchJson: createMockFetcher({
      'https://iptv-org.github.io/api/channels.json': data.channels,
      'https://iptv-org.github.io/api/streams.json': data.streams,
      'https://iptv-org.github.io/api/logos.json': data.logos,
      'https://iptv-org.github.io/api/categories.json': data.categories,
      'https://iptv-org.github.io/api/countries.json': data.countries
    })
  });

  const res = await provider.refresh(true);
  const caracol = res.channels.find((c) => c.id === 'CaracolTV.co');
  assert.ok(caracol);
  assert.equal(caracol.streamCount, 3);
  assert.equal(caracol.streams.length, 3);
});

test('4. catálogo multipaís conserva países y filtra country=CO, ES y ALL al consultar', async () => {
  const data = createFixtureData();
  const provider = new IptvOrgProvider({
    country: 'CO',
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-test-')),
    fetchJson: createMockFetcher({
      'https://iptv-org.github.io/api/channels.json': data.channels,
      'https://iptv-org.github.io/api/streams.json': data.streams,
      'https://iptv-org.github.io/api/logos.json': data.logos,
      'https://iptv-org.github.io/api/categories.json': data.categories,
      'https://iptv-org.github.io/api/countries.json': data.countries
    })
  });

  const catalog = await provider.refresh(true);
  assert.ok(catalog.channels.some((c) => c.id === 'TVEspagna.es'), 'El catálogo debe conservar otros países');
  assert.ok(catalog.countries.some((c) => c.code === 'ES'), 'España debe estar disponible en el selector');
  assert.ok(catalog.countries.some((c) => c.code === 'CO'), 'Colombia debe estar disponible en el selector');

  const colombia = await provider.getChannels({country:'CO',pageSize:50});
  assert.ok(colombia.channels.length > 0);
  assert.ok(colombia.channels.every((c) => c.country === 'CO'));
  assert.ok(!colombia.channels.some((c) => c.id === 'TVEspagna.es'));

  const espana = await provider.getChannels({country:'ES',pageSize:50});
  assert.ok(espana.channels.some((c) => c.id === 'TVEspagna.es'));
  assert.ok(espana.channels.every((c) => c.country === 'ES'));

  const todos = await provider.getChannels({country:'ALL',pageSize:50});
  assert.ok(todos.channels.some((c) => c.id === 'TVEspagna.es'));
  assert.ok(todos.channels.some((c) => c.id === 'RCN.co'));

  const porDefecto = await provider.getChannels({pageSize:50});
  assert.ok(porDefecto.channels.every((c) => c.country === 'CO'), 'Sin país explícito debe mantenerse Colombia');
});

test('5. exclusión NSFW descarta canales para adultos e is_nsfw=true', async () => {
  const data = createFixtureData();
  const provider = new IptvOrgProvider({
    excludeNsfw: true,
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-test-')),
    fetchJson: createMockFetcher({
      'https://iptv-org.github.io/api/channels.json': data.channels,
      'https://iptv-org.github.io/api/streams.json': data.streams,
      'https://iptv-org.github.io/api/logos.json': data.logos,
      'https://iptv-org.github.io/api/categories.json': data.categories,
      'https://iptv-org.github.io/api/countries.json': data.countries
    })
  });

  const res = await provider.refresh(true);
  assert.ok(!res.channels.some((c) => c.id === 'AdultChannel.co'));
  assert.ok(!res.channels.some((c) => c.id === 'OtherAdult.co'));
});

test('6. selección de stream principal prioriza HTTPS y mejor calidad', () => {
  const streams = [
    { url: 'http://server.com/live.m3u8', quality: '720p', labels: [] },
    { url: 'https://server.com/backup.m3u8', quality: '720p', labels: ['Geo-blocked'] },
    { url: 'https://server.com/live.m3u8', quality: '1080p', labels: [] }
  ];

  const sorted = sortStreams(streams);
  assert.equal(sorted[0].url, 'https://server.com/live.m3u8', 'HTTPS + 1080p sin geobloqueo debe ganar');
});

test('7. múltiples streams no duplican visualmente el canal', async () => {
  const data = createFixtureData();
  const provider = new IptvOrgProvider({
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-test-')),
    fetchJson: createMockFetcher({
      'https://iptv-org.github.io/api/channels.json': data.channels,
      'https://iptv-org.github.io/api/streams.json': data.streams,
      'https://iptv-org.github.io/api/logos.json': data.logos,
      'https://iptv-org.github.io/api/categories.json': data.categories,
      'https://iptv-org.github.io/api/countries.json': data.countries
    })
  });

  const res = await provider.getChannels({ pageNum: 1, pageSize: 50 });
  const caracolOccurrences = res.channels.filter((c) => c.id === 'CaracolTV.co');
  assert.equal(caracolOccurrences.length, 1, 'Caracol TV debe aparecer exactamente una vez');
});

test('8. canal sin stream es detectado y diferenciado', async () => {
  const data = createFixtureData();
  const provider = new IptvOrgProvider({
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-test-')),
    fetchJson: createMockFetcher({
      'https://iptv-org.github.io/api/channels.json': data.channels,
      'https://iptv-org.github.io/api/streams.json': data.streams,
      'https://iptv-org.github.io/api/logos.json': data.logos,
      'https://iptv-org.github.io/api/categories.json': data.categories,
      'https://iptv-org.github.io/api/countries.json': data.countries
    })
  });

  // Por defecto getChannels devuelve solo canales con stream reproducible
  const playable = await provider.getChannels({ onlyWithStreams: true });
  assert.ok(!playable.channels.some((c) => c.id === 'CanalSinStream.co'));

  // Consultando con onlyWithStreams: false aparece con hasStream = false
  const all = await provider.getChannels({ onlyWithStreams: false });
  const sinStream = all.channels.find((c) => c.id === 'CanalSinStream.co');
  assert.ok(sinStream);
  assert.equal(sinStream.hasStream, false);
  assert.equal(sinStream.streamUrl, '');
});

test('9. stream Geo-blocked se identifica en labels y tiene menor prioridad', () => {
  const geoStream = { url: 'https://stream.com/live.m3u8', quality: '720p', labels: ['Geo-blocked'] };
  const openStream = { url: 'https://stream.com/live.m3u8', quality: '720p', labels: [] };

  assert.ok(scoreStream(openStream) > scoreStream(geoStream));
});

test('10. stream Not 24/7 se identifica y tiene menor prioridad', () => {
  const not247Stream = { url: 'https://stream.com/live.m3u8', quality: '720p', labels: ['Not 24/7'] };
  const continuousStream = { url: 'https://stream.com/live.m3u8', quality: '720p', labels: [] };

  assert.ok(scoreStream(continuousStream) > scoreStream(not247Stream));
});

test('11. paginación calcula hasMore, total y slices defensivos', async () => {
  const data = createFixtureData();
  const provider = new IptvOrgProvider({
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-test-')),
    fetchJson: createMockFetcher({
      'https://iptv-org.github.io/api/channels.json': data.channels,
      'https://iptv-org.github.io/api/streams.json': data.streams,
      'https://iptv-org.github.io/api/logos.json': data.logos,
      'https://iptv-org.github.io/api/categories.json': data.categories,
      'https://iptv-org.github.io/api/countries.json': data.countries
    })
  });

  const page1 = await provider.getChannels({ pageNum: 1, pageSize: 2 });
  assert.equal(page1.channels.length, 2);
  assert.equal(page1.pageNum, 1);
  assert.equal(page1.pageSize, 2);
  assert.equal(page1.hasMore, true);
  assert.ok(page1.total > 2);

  const page99 = await provider.getChannels({ pageNum: 99, pageSize: 2 });
  assert.equal(page99.channels.length, 0);
  assert.equal(page99.hasMore, false);
});

test('12. caché válida en disco se reutiliza sin llamar a la red', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-cache-'));
  const cachedData = {
    fetchedAt: Date.now(),
    country: 'CO',
    categories: [{ id: 'all', name: 'Todos' }],
    channels: [{ id: 'CachedChannel.co', channelCode: 'CachedChannel.co', name: 'Canal en Caché', country: 'CO', hasStream: true, streamUrl: 'https://test/live.m3u8' }]
  };
  fs.writeFileSync(path.join(tmpDir, 'iptv-org-co.json'), JSON.stringify(cachedData));

  let networkCalls = 0;
  const provider = new IptvOrgProvider({
    cacheDir: tmpDir,
    ttlMs: 60000,
    fetchJson: async () => { networkCalls++; return []; }
  });

  const res = await provider.getChannels();
  assert.equal(networkCalls, 0, 'No debe llamar a la red si hay caché válida reciente');
  assert.equal(res.channels[0].name, 'Canal en Caché');
});

test('13. respuesta remota inválida no corrompe la memoria ni el disco', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-corrupt-'));
  const initialData = createFixtureData();

  const provider = new IptvOrgProvider({
    cacheDir: tmpDir,
    fetchJson: createMockFetcher({
      'https://iptv-org.github.io/api/channels.json': initialData.channels,
      'https://iptv-org.github.io/api/streams.json': initialData.streams,
      'https://iptv-org.github.io/api/logos.json': initialData.logos,
      'https://iptv-org.github.io/api/categories.json': initialData.categories,
      'https://iptv-org.github.io/api/countries.json': initialData.countries
    })
  });

  // Primer fetch válido
  await provider.refresh(true);
  const validCount = provider.inMemoryData.channels.length;

  // Siguiente fetch con datos corruptos
  provider.fetchJson = async () => { throw new Error('Respuesta 500 del servidor remoto'); };

  // El refresh debe devolver la caché previa y no vaciarse
  const fallback = await provider.refresh(true);
  assert.equal(fallback.channels.length, validCount);
  assert.equal(fallback.stale, true);
});

test('14. timeout en descarga se maneja limpiamente', async () => {
  const provider = new IptvOrgProvider({
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-timeout-')),
    fetchJson: async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('Timeout de 25000ms al consultar endpoints');
    }
  });

  await assert.rejects(
    async () => { await provider.refresh(true); },
    /Timeout/
  );
});

test('15. fallback al último catálogo válido ante fallo de red', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-fallback-'));
  const cachedData = {
    fetchedAt: Date.now() - 3600000, // 1h ago
    country: 'CO',
    categories: [{ id: 'all', name: 'Todos' }],
    channels: [{ id: 'ResilientChannel.co', channelCode: 'ResilientChannel.co', name: 'Canal Resiliente', country: 'CO', hasStream: true, streamUrl: 'https://test/live.m3u8' }]
  };
  fs.writeFileSync(path.join(tmpDir, 'iptv-org-co.json'), JSON.stringify(cachedData));

  const provider = new IptvOrgProvider({
    cacheDir: tmpDir,
    ttlMs: 1000, // Forzar refresh porque expiró el TTL
    fetchJson: async () => { throw new Error('Conexión rehusada ECONNREFUSED'); }
  });

  const result = await provider.getChannels();
  assert.equal(result.channels.length, 1);
  assert.equal(result.channels[0].name, 'Canal Resiliente');
  assert.equal(result.stale, true);
});
