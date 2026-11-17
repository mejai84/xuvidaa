'use strict';

// Loopback-only browser-test fixture. Never used by the production entry point.
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer } = require('../server/http-server.cjs');
const { createXuperApi } = require('../server/api/xuper/index.cjs');
const { JsonAdapter } = require('../server/providers/xuper/adapters.cjs');

const port = Number(process.env.XUPER_TEST_PORT || 18767);
const catalog = {
  movies: [{ id: 'test-film', title: 'Película de prueba', category: 'Pruebas', year: '2026', synopsis: 'Contenido aislado de las pruebas automatizadas.', url: 'https://media.example.com/test.mp4' },
    { id: 'test-xss', title: '<img src=x onerror=window.injected=true>', category: 'Pruebas', url: 'https://media.example.com/test.mp4' }],
  series: [{ id: 'test-series', title: 'Serie de prueba', category: 'Pruebas', seasons: [
    { number: 1, title: 'Temporada 1', episodes: [{ id: 'test-episode-1', title: 'Episodio uno', url: 'https://media.example.com/test.mp4' }] },
    { number: 2, title: 'Temporada 2', episodes: [{ id: 'test-episode-2', title: 'Episodio dos', url: 'https://media.example.com/test.mp4' }] }
  ] }],
  live: [{ id: 'test-channel', title: 'Canal de prueba', category: 'Pruebas', url: 'https://media.example.com/live.m3u8', programmes: [{ title: 'Programa de prueba', start: '2026-11-17T12:00:00Z', end: '2026-11-17T13:00:00Z' }] }],
  radio: [{ id: 'test-radio', title: 'Radio de prueba', country: 'Colombia', url: 'https://media.example.com/radio.mp3' }],
  music: [{ id: 'test-music', title: 'Música de prueba', url: 'https://media.example.com/music.mp3' }]
};
const provider = new JsonAdapter({ id: 'browser_tests', name: 'Proveedor de pruebas', url: 'https://catalog.example.com/test.json' }, {
  fetchText: async () => process.env.XUPER_TEST_EMPTY === '1' ? '{}' : JSON.stringify(catalog)
});
const server = createServer({
  publicOrigin: 'https://localhost:' + port,
  root: path.join(__dirname, '../web'),
  accessPassword: 'xuper-local-test-only', sessionSecret: crypto.randomBytes(32).toString('hex'),
  apiHandler(req, res) { res.json({ returnValue: true, items: [], channels: [], categories: [], hasMore: false }); },
  // Browser tests intercept this endpoint with a generated media fixture.
  mediaHandler(req, res) { res.status(404).json({ error: 'Test media must be intercepted' }); },
  xuperHandler: createXuperApi({ providers: [provider], env: { MEDIA_TOKEN_SECRET: crypto.randomBytes(32).toString('hex') },
    mediaRegistry: { register(_entry, exp) { return { token: 'fixture-' + crypto.randomBytes(20).toString('hex'), exp }; } } })
});
// The production service sits behind HTTPS. This fixture is loopback HTTP;
// translate only its own origin before the unchanged production handler runs.
// Hostile-origin rejection is exercised in server/xuper-http.test.cjs.
server.prependListener('request', (req) => {
  if (req.headers.origin === 'http://localhost:' + port) req.headers.origin = 'https://localhost:' + port;
});
server.listen(port, '127.0.0.1', () => console.log('Xuper browser fixture on loopback ' + port));
process.on('SIGINT', () => { server.closeAllConnections(); server.close(); });
process.on('SIGTERM', () => { server.closeAllConnections(); server.close(); });
