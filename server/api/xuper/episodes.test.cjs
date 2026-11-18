'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { listEpisodes, adjacentEpisode } = require('../../../web/xuper/episodes.js');

const seasons = [
  { number: 1, episodes: [
    { id: 'e1', title: 'Inicio', number: 1 },
    { id: 'e2', title: 'Regreso', number: 2, playbackRestriction: { code: 'UNSUPPORTED_FORMAT', message: 'Se requiere HLS' } }
  ] },
  { number: 2, episodes: [{ id: 'e3', number: 1 }, { id: 'e4', title: 'Final' }] }
];

test('episode browser preserves the provider order across seasons', () => {
  const list = listEpisodes(seasons);
  assert.deepEqual(list.map((episode) => episode.id), ['e1', 'e2', 'e3', 'e4']);
  assert.deepEqual(list.map((episode) => episode.seasonIndex), [0, 0, 1, 1]);
  assert.equal(list[2].title, 'Episodio 1');
  assert.equal(list[1].playbackRestriction.code, 'UNSUPPORTED_FORMAT');
});

test('next and previous episodes cross season boundaries without wrapping', () => {
  assert.equal(adjacentEpisode(seasons, 'e2', 1).id, 'e3');
  assert.equal(adjacentEpisode(seasons, 'e3', -1).id, 'e2');
  assert.equal(adjacentEpisode(seasons, 'e1', -1), null);
  assert.equal(adjacentEpisode(seasons, 'e4', 1), null);
  assert.equal(adjacentEpisode(seasons, 'unknown', 1), null);
  assert.equal(adjacentEpisode(seasons, 'e1', 0), null);
});

test('malformed or duplicated episode identifiers cannot enter player selection', () => {
  const bad = [{ episodes: [
    { id: 'ok', title: 'Primero' }, { id: 'ok', title: 'Duplicado' },
    { id: '', title: 'Vacío' }, { title: 'Falta ID' }, { id: 'x'.repeat(257) }
  ] }, null, { episodes: 'invalid' }];
  assert.deepEqual(listEpisodes(bad).map((episode) => episode.id), ['ok']);
  assert.deepEqual(listEpisodes(null), []);
  assert.deepEqual(listEpisodes([null]), []);
});
