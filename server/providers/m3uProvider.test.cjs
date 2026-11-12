'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { M3uProvider, parseExtInfLine, sanitizeUrlForLogs } = require('./m3uProvider.cjs');
const { parseEpisodeInfo, groupEpisodesIntoSeries } = require('../services/seriesParser.cjs');

function createSampleM3u() {
  return `#EXTM3U
#EXTINF:-1 tvg-id="mov1" tvg-name="Inception" tvg-logo="https://img.example/inception.jpg" group-title="PELICULAS | CINE",Inception (2010)
http://mock-provider.example/movie/fakeuser/fakepassword/1001.mp4

#EXTINF:-1 tvg-id="mov2" tvg-name="Interstellar" tvg-logo="https://img.example/interstellar.jpg" group-title="PELICULAS | CINE",Interstellar (2014)
http://mock-provider.example/movie/fakeuser/fakepassword/1002.mp4

#EXTINF:-1 tvg-id="mov-dup" tvg-name="Inception" tvg-logo="https://img.example/inception2.jpg" group-title="PELICULAS",Inception (2010)
http://mock-provider.example/movie/fakeuser/fakepassword/1003.mp4

#EXTINF:-1 tvg-id="bb-s1e1" tvg-name="Breaking Bad S01E01" tvg-logo="https://img.example/bb.jpg" group-title="SERIES | DRAMA",Breaking Bad S01E01 Pilot
http://mock-provider.example/series/fakeuser/fakepassword/2001.mp4

#EXTINF:-1 tvg-id="bb-s1e2" tvg-name="Breaking Bad S01E02" tvg-logo="https://img.example/bb.jpg" group-title="SERIES | DRAMA",Breaking Bad S01E02 Cat's in the Bag
http://mock-provider.example/series/fakeuser/fakepassword/2002.mp4

#EXTINF:-1 tvg-id="bb-s2e1" tvg-name="Breaking Bad S02E01" tvg-logo="https://img.example/bb.jpg" group-title="SERIES | DRAMA",Breaking Bad S02E01 Seven Thirty-Seven
http://mock-provider.example/series/fakeuser/fakepassword/2003.mp4

#EXTINF:-1 tvg-id="st-1x01" tvg-name="Stranger Things 1x01" tvg-logo="https://img.example/st.jpg" group-title="SERIES",Stranger Things 1x01 Chapter One
http://mock-provider.example/series/fakeuser/fakepassword/3001.mp4

#EXTINF:-1 tvg-id="st-1x02" tvg-name="Stranger Things 1x02" tvg-logo="https://img.example/st.jpg" group-title="SERIES",Stranger Things 1x02 Chapter Two
http://mock-provider.example/series/fakeuser/fakepassword/3002.mp4

#EXTINF:-1 tvg-id="tf-1" tvg-name="The Flash S01E01" tvg-logo="https://img.example/flash.jpg" group-title="SERIES",The Flash S01E01
http://mock-provider.example/series/fakeuser/fakepassword/4001.mp4

#EXTINF:-1 tvg-id="tf90-1" tvg-name="The Flash (1990) S01E01" tvg-logo="https://img.example/flash90.jpg" group-title="SERIES",The Flash (1990) S01E01
http://mock-provider.example/series/fakeuser/fakepassword/4002.mp4

#EXTINF:-1 tvg-id="live1" tvg-name="Noticias 24/7" tvg-logo="https://img.example/news.jpg" group-title="EN VIVO | COLOMBIA",Canal Noticias 24/7
http://mock-provider.example/live/fakeuser/fakepassword/5001.m3u8

#EXTINF:-1 tvg-id="ambig1" group-title="MISC",Documento Especial
http://mock-provider.example/special/fakeuser/fakepassword/6001.bin
`;
}

// -------------------------------------------------------------
// 1. Tests del Parser M3U & EXTINF
// -------------------------------------------------------------
test('Parser: M3U válido y EXTINF con múltiples atributos', () => {
  const provider = new M3uProvider();
  const parsed = provider.parseM3u(createSampleM3u());

  assert.ok(parsed.movies.length >= 2);
  assert.ok(parsed.series.length >= 3);
  assert.equal(parsed.stats.liveCount, 1);
  assert.equal(parsed.stats.unknownCount, 1);
  assert.equal(parsed.stats.duplicatesCount, 1);
});

test('Parser: guarda deportes con ruta relativa y excluye la categoría adulta', () => {
  const provider = new M3uProvider({baseUrl:'https://provider.example',username:'user',password:'pass'});
  const catalog = provider.parseM3u(`#EXTM3U
#EXTINF:-1 group-title="Deportes",ESPN
https://provider.example/live/user/pass/101.ts
#EXTINF:-1 group-title="Fútbol",LaLiga Inside
https://provider.example/live/user/pass/102.m3u8
#EXTINF:-1 group-title="Adult HD",Canal Adulto
https://provider.example/live/user/pass/103.m3u8
`);
  assert.equal(catalog.liveChannels.length,2);
  assert.deepEqual(catalog.liveChannels.map(channel=>channel.category),['Deportes','Deportes']);
  assert.deepEqual(catalog.liveChannels.map(channel=>channel.hasStream),[true,true]);
  assert.ok(catalog.liveChannels.every(channel=>/^priv-[a-f0-9]{16}$/.test(channel.id)));
  assert.doesNotMatch(JSON.stringify(catalog.liveChannels),/provider\.example|\/live\/user\/pass\//);
});

test('Parser: atributos faltantes y en diferente orden', () => {
  const lineNoTvg = '#EXTINF:-1,Película Simple (2020)';
  const res1 = parseExtInfLine(lineNoTvg);
  assert.equal(res1.title, 'Película Simple (2020)');
  assert.equal(res1.groupTitle, '');

  const lineDiffOrder = '#EXTINF:120 group-title="Cine" tvg-logo="http://test/logo.png" tvg-name="Alien" tvg-id="al-1",Alien El Octavo Pasajero';
  const res2 = parseExtInfLine(lineDiffOrder);
  assert.equal(res2.tvgId, 'al-1');
  assert.equal(res2.tvgName, 'Alien');
  assert.equal(res2.tvgLogo, 'http://test/logo.png');
  assert.equal(res2.groupTitle, 'Cine');
  assert.equal(res2.title, 'Alien El Octavo Pasajero');
});

test('Parser: Unicode y caracteres en español', () => {
  const line = '#EXTINF:-1 tvg-name="Año Bisiesto" group-title="PELÍCULAS EN ESPAÑOL",El Niño y la Garza (2023) - 1080p';
  const res = parseExtInfLine(line);
  assert.equal(res.tvgName, 'Año Bisiesto');
  assert.equal(res.groupTitle, 'PELÍCULAS EN ESPAÑOL');
  assert.equal(res.title, 'El Niño y la Garza (2023) - 1080p');
});

test('Parser: líneas inválidas o sin URL no hacen colapsar la importación', () => {
  const provider = new M3uProvider();
  const brokenM3u = `#EXTM3U
#EXTINF:-1,Película Válida
http://test/movie/u/p/1.mp4

Línea basura sin sentido
#EXTINF:-1,Película Sin URL

#EXTINF:-1,Otra Película Válida
http://test/movie/u/p/2.mp4
`;
  const res = provider.parseM3u(brokenM3u);
  assert.equal(res.movies.length, 2);
  assert.ok(res.stats.invalidCount >= 1);
});

test('Parser: lista vacía o sin cabecera lanza error controlado', () => {
  const provider = new M3uProvider();
  assert.throws(() => provider.parseM3u(''), /vacío/);
  assert.throws(() => provider.parseM3u('<html><body>404 Not Found</body></html>'), /#EXTM3U ausente/);
});

// -------------------------------------------------------------
// 2. Tests de Clasificación
// -------------------------------------------------------------
test('Clasificación: Películas', () => {
  const provider = new M3uProvider();
  assert.equal(provider.classifyEntry({ title: 'Avatar (2009)', groupTitle: 'PELICULAS | ACCION', url: 'http://test/vod/1.mp4' }), 'movie');
  assert.equal(provider.classifyEntry({ title: 'Titanic', groupTitle: 'Cine Clásico', url: 'http://test/movie/u/p/2.mkv' }), 'movie');
});

test('Clasificación: TV en vivo', () => {
  const provider = new M3uProvider();
  assert.equal(provider.classifyEntry({ title: 'Caracol TV', groupTitle: 'EN VIVO | COLOMBIA', url: 'http://test/live/u/p/3.m3u8' }), 'live');
  assert.equal(provider.classifyEntry({ title: 'ESPN', groupTitle: 'DEPORTES TV', url: 'http://test/4.ts' }), 'live');
});

test('Clasificación: Patrones de Serie (S01E01, S1E1, 1x01, Temporada)', () => {
  const provider = new M3uProvider();
  assert.equal(provider.classifyEntry({ title: 'The Office S01E01', groupTitle: 'Series', url: 'http://test/s/1.mp4' }), 'episode');
  assert.equal(provider.classifyEntry({ title: 'The Office S1E1', groupTitle: 'Series', url: 'http://test/s/2.mp4' }), 'episode');
  assert.equal(provider.classifyEntry({ title: 'The Office 1x01', groupTitle: 'Series', url: 'http://test/s/3.mp4' }), 'episode');
  assert.equal(provider.classifyEntry({ title: 'The Office Temporada 1 Episodio 4', groupTitle: 'Series', url: 'http://test/s/4.mp4' }), 'episode');
  assert.equal(provider.classifyEntry({ title: 'The Office T01E05', groupTitle: 'Series', url: 'http://test/s/5.mp4' }), 'episode');
});

test('Clasificación: Elemento ambiguo clasifica como unknown', () => {
  const provider = new M3uProvider();
  const ambiguous = provider.classifyEntry({ title: 'Archivo Extraño 2024', groupTitle: 'Varios', url: 'http://test/stream.bin' });
  assert.equal(ambiguous, 'unknown');
});

// -------------------------------------------------------------
// 3. Tests de Series y Agrupación
// -------------------------------------------------------------
test('Series: agrupación correcta por serie y temporadas múltiples', () => {
  const rawEpisodes = [
    { id: '1', title: 'Breaking Bad S01E01 Pilot', groupTitle: 'Series', url: 'http://test/1.mp4' },
    { id: '2', title: 'Breaking Bad S01E02 Cat', groupTitle: 'Series', url: 'http://test/2.mp4' },
    { id: '3', title: 'Breaking Bad S02E01 Seven', groupTitle: 'Series', url: 'http://test/3.mp4' }
  ];

  const series = groupEpisodesIntoSeries(rawEpisodes);
  assert.equal(series.length, 1);
  assert.equal(series[0].title, 'Breaking Bad');
  assert.equal(series[0].seasonCount, 2);
  assert.equal(series[0].episodeCount, 3);
  assert.equal(series[0].seasons[0].number, 1);
  assert.equal(series[0].seasons[0].episodeCount, 2);
  assert.equal(series[0].seasons[1].number, 2);
  assert.equal(series[0].seasons[1].episodeCount, 1);
});

test('Series: orden numérico ascendente de episodios y temporadas', () => {
  const rawEpisodes = [
    { id: '1', title: 'Dark S02E03', groupTitle: 'Series', url: 'http://test/3.mp4' },
    { id: '2', title: 'Dark S01E02', groupTitle: 'Series', url: 'http://test/2.mp4' },
    { id: '3', title: 'Dark S01E01', groupTitle: 'Series', url: 'http://test/1.mp4' },
    { id: '4', title: 'Dark S02E01', groupTitle: 'Series', url: 'http://test/4.mp4' }
  ];

  const series = groupEpisodesIntoSeries(rawEpisodes);
  assert.equal(series[0].seasons[0].number, 1);
  assert.equal(series[0].seasons[0].episodes[0].number, 1);
  assert.equal(series[0].seasons[0].episodes[1].number, 2);
  assert.equal(series[0].seasons[1].number, 2);
  assert.equal(series[0].seasons[1].episodes[0].number, 1);
  assert.equal(series[0].seasons[1].episodes[1].number, 3);
});

test('Series: series con nombres similares NO se fusionan erróneamente', () => {
  const rawEpisodes = [
    { id: '1', title: 'The Flash S01E01 Pilot', groupTitle: 'Series', url: 'http://test/1.mp4' },
    { id: '2', title: 'The Flash (1990) S01E01 Pilot', groupTitle: 'Series', url: 'http://test/2.mp4' }
  ];

  const series = groupEpisodesIntoSeries(rawEpisodes);
  assert.equal(series.length, 2, 'The Flash y The Flash (1990) deben ser 2 series independientes');
  assert.notEqual(series[0].id, series[1].id);
});

// -------------------------------------------------------------
// 4. Tests de Seguridad y Ausencia de Credenciales
// -------------------------------------------------------------
test('Seguridad: credenciales no aparecen en respuesta de la API', async () => {
  const provider = new M3uProvider({
    cacheDir: false,
    baseUrl: 'http://private.example:8080',
    username: 'supersecretuser',
    password: 'supersecretpassword',
    fetchM3uContent: async () => createSampleM3u()
  });

  const movies = await provider.getMovies();
  const series = await provider.getSeries();
  const detail = await provider.getDetail(movies.items[0].id);

  const serialized = JSON.stringify({ movies, series, detail });
  assert.ok(!serialized.includes('supersecretuser'), 'Usuario no debe aparecer en respuesta');
  assert.ok(!serialized.includes('supersecretpassword'), 'Contraseña no debe aparecer en respuesta');
  assert.ok(!serialized.includes('fakeuser'), 'Usuario sintético de streams no debe filtrarse');
  assert.ok(!serialized.includes('fakepassword'), 'Contraseña sintética no debe filtrarse');
});

test('Seguridad: credenciales no aparecen en archivo de caché en disco', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3u-sec-'));
  const provider = new M3uProvider({
    cacheDir: tmpDir,
    fetchM3uContent: async () => createSampleM3u()
  });

  await provider.refresh(true);
  const cacheFile = path.join(tmpDir, 'm3u-catalog.json');
  assert.ok(fs.existsSync(cacheFile));

  const content = fs.readFileSync(cacheFile, 'utf8');
  assert.ok(!content.includes('fakeuser'));
  assert.ok(!content.includes('fakepassword'));
});

test('Seguridad: sanitizeUrlForLogs oculta contraseñas de URLs', () => {
  const raw = 'http://provider.com/get.php?username=testuser&password=mysecretpassword&type=m3u';
  const clean = sanitizeUrlForLogs(raw);
  assert.ok(!clean.includes('mysecretpassword'));
  assert.ok(clean.includes('***'));
});

// -------------------------------------------------------------
// 5. Tests de Caché y Resiliencia
// -------------------------------------------------------------
test('Caché: guardado correcto y recuperación rápida', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3u-cache-'));
  let fetches = 0;
  const provider = new M3uProvider({
    cacheDir: tmpDir,
    fetchM3uContent: async () => {
      fetches++;
      return createSampleM3u();
    }
  });

  // Primer llamado descarga y guarda
  const r1 = await provider.getMovies();
  assert.equal(fetches, 1);
  assert.ok(r1.items.length > 0);

  // Segundo llamado usa caché en memoria
  const r2 = await provider.getMovies();
  assert.equal(fetches, 1);

  // Nueva instancia lee caché en disco sin llamar a la red
  const provider2 = new M3uProvider({
    cacheDir: tmpDir,
    fetchM3uContent: async () => {
      fetches++;
      return createSampleM3u();
    }
  });
  const r3 = await provider2.getMovies();
  assert.equal(fetches, 1, 'Debe reutilizar la caché en disco');
  assert.equal(r3.items.length, r1.items.length);
});

test('Caché: fallback a último catálogo válido ante fallo de red o respuesta vacía', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3u-fallback-'));
  let shouldFail = false;

  const provider = new M3uProvider({
    cacheDir: tmpDir,
    fetchM3uContent: async () => {
      if (shouldFail) {
        throw new Error('500 Internal Server Error en proveedor M3U');
      }
      return createSampleM3u();
    }
  });

  // Carga inicial exitosa
  await provider.refresh(true);
  const initialMovieCount = provider.inMemoryCatalog.movies.length;

  // Intento de actualización con fallo de red
  shouldFail = true;
  const fallback = await provider.refresh(true);

  assert.equal(fallback.movies.length, initialMovieCount, 'Debe preservar el catálogo anterior');
  assert.equal(fallback.stale, true);
});



test('VOD: prefers MP4 or HLS over duplicate MKV without changing unrelated titles', () => {
  const provider = new M3uProvider();
  const playlist = [
    '#EXTM3U',
    '#EXTINF:-1 group-title="Películas",Ejemplo (2021)',
    'https://provider.example/movie/u/p/1.mkv',
    '#EXTINF:-1 group-title="Películas",Ejemplo (2021)',
    'https://provider.example/movie/u/p/2.mp4',
    '#EXTINF:-1 group-title="Películas",Otra (2022)',
    'https://provider.example/movie/u/p/3.mkv'
  ].join('\n');
  const parsed = provider.parseM3u(playlist);
  assert.equal(parsed.movies.length, 2);
  assert.equal(parsed.stats.duplicatesCount, 1);
  assert.match(parsed.movies.find(x => x.title === 'Ejemplo (2021)').streamUrl, /2\.mp4$/);
  assert.match(parsed.movies.find(x => x.title === 'Otra (2022)').streamUrl, /3\.mkv$/);
});
