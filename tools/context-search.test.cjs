'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../webos/fidelity/js/search-scope.js');

const vod = [
  { id: 'mov-1', title: 'El Último Viaje', type: 'movie', kind: 'película' },
  { id: 'series-1', title: 'Viaje en Familia', type: 'teleplay', kind: 'serie' },
  { id: 'mov-2', title: 'La Aventura', type: 'movie', kind: 'película' }
];
const channels = [
  { id: 'CanalUno.co', channelCode: 'CanalUno.co', name: 'Canal Uno' },
  { id: 'RadioVivo.co', channelCode: 'RadioVivo.co', name: 'Radio Vívo' }
];
test('la búsqueda depende de la sección activa', () => {
  assert.equal(s.scopeForPage(0), 'tv');
  assert.equal(s.scopeForPage(2), 'movies');
  assert.equal(s.scopeForPage(3), 'series');
  assert.equal(s.endpoint('tv'), 'liveChannels');
  assert.equal(s.endpoint('movies'), 'm3uMovies');
  assert.equal(s.endpoint('series'), 'm3uSeries');
});
test('TV busca solamente canales sin distinguir tildes', () => {
  assert.deepEqual(s.localMatches('tv', 'VIVO', vod, channels).map(x => x.id), ['RadioVivo.co']);
  assert.deepEqual(s.localMatches('tv', 'viaje', vod, channels), []);
});
test('películas y series no se mezclan', () => {
  assert.deepEqual(s.localMatches('movies', 'viaje', vod, channels).map(x => x.id), ['mov-1']);
  assert.deepEqual(s.localMatches('series', 'viaje', vod, channels).map(x => x.id), ['series-1']);
});
test('deduplicar sin introducir categorías equivocadas', () => {
  const old = [vod[0]], incoming = [vod[0], vod[1], vod[2]];
  assert.deepEqual(s.merge('movies', old, incoming).map(x => x.id), ['mov-1', 'mov-2']);
  assert.deepEqual(s.merge('series', [], incoming).map(x => x.id), ['series-1']);
  assert.deepEqual(s.merge('tv', channels, [channels[0]]).length, 2);
});
test('búsqueda vacía no devuelve todos los registros', () => {
  assert.deepEqual(s.localMatches('tv', '', vod, channels), []);
  assert.deepEqual(s.localMatches('movies', ' ', vod, channels), []);
});
