'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMagisMetadata } = require('./magis-metadata.cjs');
const { JsonAdapter, createRegistry } = require('./adapters.cjs');

const source = {
  home: { recommendList: [{ name: 'Drama', assetList: [
    { contentId: 'series-1', name: 'Serie de prueba', programType: 'teleplay',
      posterList: [{ fileType: 'icon', fileUrl: 'https://images.example/series.jpg' }],
      description: 'Sinopsis sin acceso a contenidos' },
    { contentId: 'film-1', name: 'Película de prueba', programType: 'movie', releaseDate: '2026-10-01' }
  ] }] },
  search: { searchItemList: [{ itemList: [
    { contentId: 'film-1', name: 'Duplicado' },
    { contentId: 'unsafe id / path', name: 'No publicar' }
  ] }] },
  details: [{ assetData: {
    contentId: 'series-1', programType: 'teleplay', name: 'Serie de prueba',
    simpleProgramList: [
      { contentId: 'episode-1', name: 'Piloto', seriesNumber: 1, url: 'https://private.example/one.mp4?token=secret' },
      { contentId: 'episode-2', name: 'Segundo episodio', seriesNumber: 2 },
      { contentId: 'episode-2', name: 'Duplicado' }
    ]
  } }]
};

test('Magis metadata parser preserves film, series and episode order without playback URLs', () => {
  const result = normalizeMagisMetadata(source);
  assert.deepEqual(result.movies.map((item) => item.id), ['film-1']);
  assert.deepEqual(result.series.map((item) => item.id), ['series-1']);
  assert.deepEqual(result.series[0].seasons[0].episodes.map((ep) => ep.id), ['episode-1', 'episode-2']);
  assert.equal(result.movies[0].year, '2026');
  assert.equal(result.series[0].poster, 'https://images.example/series.jpg');
  assert.equal(result.movies[0].catalogOnly, true);
  assert.equal(result.series[0].seasons[0].episodes[0].catalogOnly, true);
  assert.equal(JSON.stringify(result).includes('private.example'), false);
  assert.equal(JSON.stringify(result).includes('token=secret'), false);
  assert.deepEqual(result.live, []);
});

test('Magis metadata adapter can load only an authorized HTTPS export and cannot resolve video', async () => {
  let requests = 0;
  const adapter = new JsonAdapter({
    id: 'magis-metadata', name: 'Metadatos autorizados', format: 'magis-metadata',
    authorized: true, url: 'https://catalog.example/magis-export.json',
    authorization: 'Bearer test-secret'
  }, { fetchText: async (url, options) => {
    requests += 1;
    assert.equal(url, 'https://catalog.example/magis-export.json');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return JSON.stringify(source);
  } });
  const catalog = await adapter.load();
  assert.equal(adapter.format, 'magis-metadata');
  assert.deepEqual(adapter.sections, ['movies', 'series']);
  assert.equal(catalog.series[0].seasons[0].episodes.length, 2);
  assert.equal(await adapter.resolve('film-1'), null);
  assert.equal(await adapter.resolve('episode-1'), null);
  assert.equal(JSON.stringify(catalog).includes('test-secret'), false);
  await adapter.load();
  assert.equal(requests, 1);
});

test('catalog integration requires explicit authorized flag and leaves Magis runtime connector disabled', () => {
  const env = {
    M3U_CACHE_DIR: 'off',
    XUPER_PROVIDERS_JSON: JSON.stringify([{
      id: 'magis_export', name: 'Exportación de metadatos',
      format: 'magis-metadata', authorized: true,
      url: 'https://catalog.example/data.json'
    }])
  };
  const providers = createRegistry(env);
  const metadata = providers.find((provider) => provider.id === 'magis_export');
  assert.equal(metadata.format, 'magis-metadata');
  assert.equal(metadata.configured, true);
  assert.equal(providers.find((provider) => provider.id === 'xuper_premium').configured, false);

  const denied = createRegistry({ ...env, XUPER_PROVIDERS_JSON: env.XUPER_PROVIDERS_JSON.replace('"authorized":true', '"authorized":false') });
  assert.equal(denied.some((provider) => provider.id === 'magis_export'), false);
});

test('metadata adapter redacts reflected credentials before shortening titles and episode names', async () => {
  const credential = 'fixture/credential=' + 'x'.repeat(400);
  const payload = structuredClone(source);
  payload.home.recommendList[0].assetList[1].name = 'Película ' + credential;
  payload.details[0].assetData.simpleProgramList[0].name = 'Piloto ' + encodeURIComponent(credential);
  const adapter = new JsonAdapter({
    id: 'metadata-test', name: 'Metadatos', format: 'magis-metadata',
    authorized: true, url: 'https://catalog.example/mock.json', authorization: 'Bearer ' + credential
  }, { fetchText: async () => JSON.stringify(payload) });

  const catalog = await adapter.load();
  assert.equal(catalog.movies[0].title, 'Película [privado]');
  assert.equal(catalog.series[0].seasons[0].episodes[0].title, 'Piloto [privado]');
});
