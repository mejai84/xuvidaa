'use strict';
/**
 * FASE 2.6 — Tests formales: conciliación de catálogo y resolución interna
 *
 * Estos tests verifican:
 *  1. Que la conciliación de entradas M3U es matemáticamente exacta
 *  2. Que el índice en memoria resuelve correctamente sourceItemId → streamUrl
 *  3. Que IDs inexistentes producen error controlado (sin fallback silencioso)
 *  4. Que streamUrl no aparece en respuestas API, caché en disco ni logs
 *  5. Que los IDs son estables entre reinicios de Node
 *
 * NO toca componentes de reproducción.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const os     = require('node:os');
const fs     = require('node:fs');
const { M3uProvider, sanitizeUrlForLogs } = require('../providers/m3uProvider.cjs');
const { groupEpisodesIntoSeries } = require('../services/seriesParser.cjs');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeM3u(entries) {
  const lines = ['#EXTM3U'];
  for (const e of entries) {
    lines.push(`#EXTINF:-1 tvg-id="${e.id}" tvg-name="${e.name}" group-title="${e.group}",${e.title}`);
    lines.push(e.url);
    lines.push('');
  }
  return lines.join('\n');
}

const FIXTURE_M3U = makeM3u([
  // 3 películas: 2 únicas + 1 duplicado
  { id: 'mov1', name: 'Inception', group: 'PELICULAS', title: 'Inception (2010)', url: 'http://p.test/movie/user/pass/1001.mp4' },
  { id: 'mov2', name: 'Interstellar', group: 'PELICULAS', title: 'Interstellar (2014)', url: 'http://p.test/movie/user/pass/1002.mp4' },
  { id: 'mov1b', name: 'Inception', group: 'PELICULAS', title: 'Inception (2010)', url: 'http://p.test/movie/user/pass/1003.mp4' }, // DUPLICADO
  // 4 episodios de 2 series
  { id: 'bb-s1e1', name: 'Breaking Bad S01E01', group: 'SERIES', title: 'Breaking Bad S01E01 Pilot', url: 'http://p.test/series/user/pass/2001.mp4' },
  { id: 'bb-s1e2', name: 'Breaking Bad S01E02', group: 'SERIES', title: 'Breaking Bad S01E02 Cat\'s In The Bag', url: 'http://p.test/series/user/pass/2002.mp4' },
  { id: 'bb-s2e1', name: 'Breaking Bad S02E01', group: 'SERIES', title: 'Breaking Bad S02E01 Seven Thirty-Seven', url: 'http://p.test/series/user/pass/2003.mp4' },
  { id: 'st-1x01', name: 'Stranger Things 1x01', group: 'SERIES', title: 'Stranger Things 1x01 Chapter One', url: 'http://p.test/series/user/pass/3001.mp4' },
  // 1 canal live
  { id: 'live1', name: 'Canal Noticias', group: 'EN VIVO', title: 'Canal Noticias Live', url: 'http://p.test/live/user/pass/5001.m3u8' },
  // 1 unknown
  { id: 'unk1', name: 'Especial', group: 'MISC', title: 'Especial Misterioso', url: 'http://p.test/special/user/pass/9001.bin' },
  // 1 entrada inválida (URL sin http)
]);

// Entrada inválida al final (URL sin protocolo)
const FIXTURE_M3U_WITH_INVALID = FIXTURE_M3U + '\n#EXTINF:-1,Entrada sin URL\nftp://no-valida.example/file\n';

// Total esperado: 3 películas brutas + 4 episodios + 1 live + 1 unknown + 1 par inválido = 10
// Pero EXTINF con URL no-http → se cuenta como invalidCount
const TOTAL_BRUTO    = 10;  // pares #EXTINF + URL procesados (9 válidos + 1 inválido)
const TOTAL_PELICULAS_BRUTAS = 3;
const TOTAL_PELICULAS_UNICAS = 2;
const TOTAL_DUPLICADOS       = 1;
const TOTAL_EPISODIOS        = 4;
const TOTAL_LIVE             = 1;
const TOTAL_UNKNOWN          = 1;
const TOTAL_INVALIDOS        = 1;

// ─── Helper: provider con fixture ─────────────────────────────────────────────
function makeProvider(m3uContent) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3u-test-'));
  return new M3uProvider({
    baseUrl:  'http://fake.example:8080',
    username: 'fakeuser',
    password: 'fakepassword',
    type:     'm3u',
    cacheDir: tmpDir,
    cacheTtlMs: 60000,
    fetchM3uContent: async () => m3uContent,
  });
}

// ─── Clase índice en memoria (propuesta para Fase 3) ─────────────────────────
class ResolverIndex {
  constructor() {
    this._movies   = new Map();
    this._episodes = new Map();
  }
  buildFromCatalog(catalog) {
    this._movies.clear(); this._episodes.clear();
    for (const m of (catalog.movies || [])) {
      if (m.id && m.streamUrl) this._movies.set(m.id, m.streamUrl);
    }
    for (const s of (catalog.series || [])) {
      for (const season of (s.seasons || [])) {
        for (const ep of (season.episodes || [])) {
          if (ep.id && ep.streamUrl) this._episodes.set(ep.id, ep.streamUrl);
        }
      }
    }
  }
  resolveInternal(id) {
    if (!id) return { found: false, url: null, type: null };
    if (this._movies.has(id))   return { found: true, url: this._movies.get(id),   type: 'movie'   };
    if (this._episodes.has(id)) return { found: true, url: this._episodes.get(id), type: 'episode' };
    return { found: false, url: null, type: null };
  }
  get movieCount()   { return this._movies.size; }
  get episodeCount() { return this._episodes.size; }
}

// ─── TESTS DE CONCILIACIÓN ────────────────────────────────────────────────────

test('Conciliación: stats.totalEntries = películas_brutas + episodios + live + unknown + inválidos', () => {
  const provider = makeProvider(FIXTURE_M3U_WITH_INVALID);
  const catalog  = provider.parseM3u(FIXTURE_M3U_WITH_INVALID);
  const st = catalog.stats;

  assert.equal(st.moviesCount + st.duplicatesCount, TOTAL_PELICULAS_BRUTAS,
    `Películas brutas: ${st.moviesCount} únicas + ${st.duplicatesCount} dups debe ser ${TOTAL_PELICULAS_BRUTAS}`);

  const reconstructed = (st.moviesCount + st.duplicatesCount)
    + st.episodesCount + st.liveCount + st.unknownCount + st.invalidCount;

  assert.equal(reconstructed, st.totalEntries,
    `Conciliación: ${reconstructed} != ${st.totalEntries}. Ninguna entrada se pierde.`);
});

test('Conciliación: películas únicas = brutas - duplicados', () => {
  const provider = makeProvider(FIXTURE_M3U_WITH_INVALID);
  const catalog  = provider.parseM3u(FIXTURE_M3U_WITH_INVALID);
  const st = catalog.stats;

  assert.equal(st.duplicatesCount, TOTAL_DUPLICADOS);
  assert.equal(catalog.movies.length, TOTAL_PELICULAS_UNICAS);
  assert.equal(st.moviesCount, TOTAL_PELICULAS_UNICAS,
    'moviesCount debe ser películas únicas');
});

test('Conciliación: episodios raw = suma de episodios en todas las temporadas de todas las series', () => {
  const provider = makeProvider(FIXTURE_M3U);
  const catalog  = provider.parseM3u(FIXTURE_M3U);
  const st = catalog.stats;

  let epGrouped = 0;
  for (const s of catalog.series) {
    for (const season of (s.seasons || [])) {
      epGrouped += (season.episodes || []).length;
    }
  }

  assert.equal(epGrouped, st.episodesCount,
    `Episodios agrupados (${epGrouped}) debe coincidir con episodesCount (${st.episodesCount})`);
});

test('Conciliación: live y unknown se contabilizan correctamente', () => {
  const provider = makeProvider(FIXTURE_M3U);
  const catalog  = provider.parseM3u(FIXTURE_M3U);
  const st = catalog.stats;

  assert.equal(st.liveCount, TOTAL_LIVE, 'liveCount incorrecto');
  assert.equal(st.unknownCount, TOTAL_UNKNOWN, 'unknownCount incorrecto');
});

test('Conciliación: entradas inválidas (URL no-HTTP) se contabilizan sin perderse', () => {
  const provider = makeProvider(FIXTURE_M3U_WITH_INVALID);
  const catalog  = provider.parseM3u(FIXTURE_M3U_WITH_INVALID);
  const st = catalog.stats;

  assert.ok(st.invalidCount >= TOTAL_INVALIDOS,
    `invalidCount (${st.invalidCount}) debe ser >= ${TOTAL_INVALIDOS}`);

  // La conciliación debe ser exacta incluyendo inválidos
  const reconstructed = (st.moviesCount + st.duplicatesCount)
    + st.episodesCount + st.liveCount + st.unknownCount + st.invalidCount;
  assert.equal(reconstructed, st.totalEntries,
    `Con inválidos: ${reconstructed} != ${st.totalEntries}`);
});

// ─── TESTS DE RESOLUCIÓN INTERNA ─────────────────────────────────────────────

test('Resolución interna: película se resuelve a streamUrl válida', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  const catalog  = await provider.refresh(true);

  const index = new ResolverIndex();
  index.buildFromCatalog(catalog);

  assert.ok(index.movieCount > 0, 'El índice debe tener películas');

  const movie  = catalog.movies[0];
  assert.ok(movie, 'Debe haber al menos una película');

  const result = index.resolveInternal(movie.id);
  assert.ok(result.found, 'La película debe encontrarse en el índice');
  assert.equal(result.type, 'movie');
  assert.ok(result.url, 'Debe tener una URL');
  assert.match(result.url, /^https?:\/\//, 'URL debe ser HTTP válida');
});

test('Resolución interna: episodio se resuelve a streamUrl válida', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  const catalog  = await provider.refresh(true);

  const index = new ResolverIndex();
  index.buildFromCatalog(catalog);

  assert.ok(index.episodeCount > 0, 'El índice debe tener episodios');

  // Buscar el primer episodio de cualquier serie
  let testEp = null;
  for (const s of catalog.series) {
    for (const season of (s.seasons || [])) {
      if (season.episodes && season.episodes.length > 0) {
        testEp = season.episodes[0];
        break;
      }
    }
    if (testEp) break;
  }

  assert.ok(testEp, 'Debe haber al menos un episodio');

  const result = index.resolveInternal(testEp.id);
  assert.ok(result.found, `Episodio ${testEp.id} debe encontrarse`);
  assert.equal(result.type, 'episode');
  assert.ok(result.url, 'Debe tener URL');
  assert.match(result.url, /^https?:\/\//, 'URL debe ser HTTP válida');
});

test('Resolución interna: ID inexistente retorna found=false y url=null (sin fallback silencioso)', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  await provider.refresh(true);

  const index = new ResolverIndex();
  index.buildFromCatalog(provider.inMemoryCatalog);

  const fakeIds = [
    'mov-ffffffffffffffff',
    'ep-series-ffffffffffffffff-s1-e1-ffffff',
    '',
  ];

  for (const fakeId of fakeIds) {
    const result = index.resolveInternal(fakeId);
    assert.equal(result.found, false, `ID "${fakeId}" no debe encontrarse`);
    assert.equal(result.url, null, `URL debe ser null para ID inexistente`);
    assert.equal(result.type, null, `type debe ser null para ID inexistente`);
  }
});

test('Resolución interna: null/undefined como contentId retorna found=false', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  await provider.refresh(true);
  const index = new ResolverIndex();
  index.buildFromCatalog(provider.inMemoryCatalog);

  const r1 = index.resolveInternal(null);
  assert.equal(r1.found, false);
  assert.equal(r1.url, null);

  const r2 = index.resolveInternal(undefined);
  assert.equal(r2.found, false);
  assert.equal(r2.url, null);
});

// ─── TESTS DE ESTABILIDAD DE ID ENTRE REINICIOS ───────────────────────────────

test('Estabilidad de ID: mismo M3U produce los mismos IDs en dos instancias independientes', () => {
  // Instancia 1
  const p1 = makeProvider(FIXTURE_M3U);
  const c1 = p1.parseM3u(FIXTURE_M3U);

  // Instancia 2 — completamente independiente
  const p2 = makeProvider(FIXTURE_M3U);
  const c2 = p2.parseM3u(FIXTURE_M3U);

  // IDs de películas deben ser idénticos
  const ids1 = c1.movies.map(m => m.id).sort();
  const ids2 = c2.movies.map(m => m.id).sort();
  assert.deepEqual(ids1, ids2, 'IDs de películas deben ser idénticos entre instancias');

  // IDs de episodios deben ser idénticos
  const epIds1 = c1.series.flatMap(s => (s.seasons||[]).flatMap(se => (se.episodes||[]).map(e => e.id))).sort();
  const epIds2 = c2.series.flatMap(s => (s.seasons||[]).flatMap(se => (se.episodes||[]).map(e => e.id))).sort();
  assert.deepEqual(epIds1, epIds2, 'IDs de episodios deben ser idénticos entre instancias');
});

test('Estabilidad de ID: el caché en disco conserva los mismos IDs (sin streamUrl)', async () => {
  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'm3u-disk-test-'));
  const p1 = new M3uProvider({
    baseUrl: 'http://fake.example:8080', username: 'u', password: 'p',
    cacheDir: tmpDir, cacheTtlMs: 60000,
    fetchM3uContent: async () => FIXTURE_M3U,
  });

  const c1 = await p1.refresh(true); // descarga y escribe disco
  const ids1 = c1.movies.map(m => m.id).sort();

  // Segunda instancia — lee desde disco (TTL vigente)
  const p2 = new M3uProvider({
    baseUrl: 'http://fake.example:8080', username: 'u', password: 'p',
    cacheDir: tmpDir, cacheTtlMs: 60000,
    fetchM3uContent: async () => { throw new Error('NO debe descargar — debe usar disco'); },
  });

  const c2 = await p2.refresh(false);
  const ids2 = c2.movies.map(m => m.id).sort();

  assert.deepEqual(ids1, ids2, 'IDs en disco deben ser idénticos a los de memoria');

  // Verificar que streamUrl NO está en el disco
  for (const m of c2.movies) {
    assert.ok(!m.streamUrl, `streamUrl no debe estar en película cargada desde disco: ${m.id}`);
  }
  for (const s of c2.series) {
    for (const season of (s.seasons||[])) {
      for (const ep of (season.episodes||[])) {
        assert.ok(!ep.streamUrl, `streamUrl no debe estar en episodio cargado desde disco: ${ep.id}`);
      }
    }
  }
});

// ─── TESTS DE SEGURIDAD DE RESPUESTAS API ────────────────────────────────────

test('Seguridad: getMovies() no expone streamUrl ni credenciales', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  await provider.refresh(true);

  const res = await provider.getMovies({ page: 1, pageSize: 10 });
  const str = JSON.stringify(res);

  assert.ok(!/"streamUrl"\s*:/i.test(str), 'getMovies no debe contener streamUrl');
  assert.ok(!str.includes('fakepassword'), 'getMovies no debe contener password');
  assert.ok(!str.includes('fakeuser'), 'getMovies no debe contener username');
  assert.ok(!str.includes('get.php'), 'getMovies no debe contener get.php');
});

test('Seguridad: getSeries() no expone streamUrl ni credenciales', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  await provider.refresh(true);

  const res = await provider.getSeries({ page: 1, pageSize: 10 });
  const str = JSON.stringify(res);

  assert.ok(!/"streamUrl"\s*:/i.test(str), 'getSeries no debe contener streamUrl');
  assert.ok(!str.includes('fakepassword'), 'getSeries no debe contener password');
  assert.ok(!str.includes('fakeuser'), 'getSeries no debe contener username');
});

test('Seguridad: getDetail(película) no expone streamUrl', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  const catalog  = await provider.refresh(true);

  const movie = catalog.movies[0];
  assert.ok(movie, 'Debe haber una película');

  const res = await provider.getDetail(movie.id);
  const str = JSON.stringify(res);

  assert.ok(res.returnValue, 'getDetail debe retornar returnValue=true');
  assert.ok(!/"streamUrl"\s*:/i.test(str), 'getDetail película no debe contener streamUrl');
  assert.ok(!str.includes('fakepassword'), 'getDetail película no debe contener password');
});

test('Seguridad: getDetail(serie) no expone streamUrl en episodios', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  const catalog  = await provider.refresh(true);

  const serie = catalog.series[0];
  assert.ok(serie, 'Debe haber una serie');

  const res = await provider.getDetail(serie.id);
  const str = JSON.stringify(res);

  assert.ok(res.returnValue, 'getDetail debe retornar returnValue=true');
  assert.ok(!/"streamUrl"\s*:/i.test(str), 'getDetail serie no debe contener streamUrl en respuesta');
  assert.ok(!str.includes('fakepassword'), 'getDetail serie no debe contener password');

  // La respuesta SÍ debe incluir episodios (pero sin streamUrl)
  assert.ok(res.episodes && res.episodes.length > 0, 'Debe incluir episodios en getDetail de serie');
  for (const ep of res.episodes) {
    assert.ok(!ep.streamUrl, `Episodio ${ep.id} no debe tener streamUrl en respuesta de API`);
  }
});

test('Seguridad: getDetail(ID inexistente) retorna returnValue=false sin exponer credenciales', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  await provider.refresh(true);

  const res = await provider.getDetail('mov-ffffffffffffffff');
  assert.equal(res.returnValue, false, 'ID inexistente debe retornar returnValue=false');
  assert.ok(!res.item, 'No debe haber item para ID inexistente');

  const str = JSON.stringify(res);
  assert.ok(!str.includes('fakepassword'), 'Error de ID inexistente no debe exponer password');
});

test('Seguridad: search() no expone streamUrl', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  await provider.refresh(true);

  const res = await provider.search('inception');
  const str = JSON.stringify(res);

  assert.ok(!/"streamUrl"\s*:/i.test(str), 'search() no debe contener streamUrl');
  assert.ok(!str.includes('fakepassword'), 'search() no debe contener password');
  assert.ok(res.items && res.items.length > 0, 'search("inception") debe encontrar resultados');
});

test('Seguridad: sanitizeUrlForLogs ofusca credenciales en URL de stream', () => {
  const url = 'http://proveedor.com:8080/get.php?username=miusuario&password=misecreta&type=m3u';
  const sanitized = sanitizeUrlForLogs(url);

  assert.ok(!sanitized.includes('misecreta'), 'Debe ofuscar la contraseña');
  assert.ok(!sanitized.includes('miusuario'), 'Debe ofuscar el usuario');
  assert.ok(sanitized.includes('***'), 'Debe contener *** como reemplazo');
});

// ─── TEST DE ÍNDICE EN MEMORIA ────────────────────────────────────────────────

test('ResolverIndex: movieCount y episodeCount correctos', async () => {
  const provider = makeProvider(FIXTURE_M3U);
  const catalog  = await provider.refresh(true);

  const index = new ResolverIndex();
  index.buildFromCatalog(catalog);

  assert.equal(index.movieCount, catalog.movies.length,
    'movieCount debe igualar el número de películas únicas');

  let epTotal = 0;
  for (const s of catalog.series) {
    for (const season of (s.seasons||[])) {
      epTotal += (season.episodes||[]).length;
    }
  }
  assert.equal(index.episodeCount, epTotal,
    'episodeCount debe igualar el total de episodios agrupados');
});

test('ResolverIndex: rebuild limpia el índice previo', async () => {
  const provider1 = makeProvider(FIXTURE_M3U);
  const c1        = await provider1.refresh(true);
  const index     = new ResolverIndex();
  index.buildFromCatalog(c1);
  const count1 = index.movieCount;

  // Reconstruir con un catálogo vacío
  index.buildFromCatalog({ movies: [], series: [] });
  assert.equal(index.movieCount, 0, 'Después de rebuild con vacío, movieCount debe ser 0');
  assert.equal(index.episodeCount, 0, 'Después de rebuild con vacío, episodeCount debe ser 0');
});

