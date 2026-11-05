'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../webos/fidelity/js/app.js'), 'utf8');
const start = source.indexOf('  function playEpisode(item, ep) {');
const end = source.indexOf('  function episodeListForCurrentSeason', start);
assert.ok(start >= 0 && end > start);

function fixture(screen) {
  const pending = new Map();
  const callbacks = [];
  const calls = [];
  let next = 0;
  const context = {
    state: { screen, detailSeason: 1 }, playerStage: null, playerInfo: null,
    syncDetailEpisodeHighlight() {},
    stopPlayerVideo() { calls.push('stop'); },
    setPlayerStatus(status) { calls.push(status); },
    startPlayerVideo(item, episode) { calls.push({ item, episode }); },
    setTimeout(callback, delay) { assert.equal(delay, 600); callbacks.push(callback); pending.set(++next, callback); return next; },
    clearTimeout(id) { pending.delete(id); }
  };
  vm.runInNewContext(source.slice(start, end), context);
  return { context, calls, callbacks, pending, tick() { const callback = pending.values().next().value; pending.clear(); callback(); } };
}

for (const screen of ['player', 'detail']) {
  test('episode selection restarts exactly once on the ' + screen + ' playback screen', () => {
    const f = fixture(screen), item = { id: 'series' }, episode = { id: 'next' };
    f.context.playEpisode(item, episode);
    assert.deepEqual(f.calls, ['stop', 'Cambiando capítulo…']);
    f.tick();
    assert.deepEqual(f.calls.at(-1), { item, episode });
    assert.equal(f.calls.length, 3);
    assert.equal(f.context.state.detailEpisode, episode);
    assert.equal(f.context.state.playerEpisode, episode);
  });
}

test('leaving playback before the delay prevents a background episode restart', () => {
  const f = fixture('detail');
  f.context.playEpisode({ id: 'series' }, { id: 'next' });
  f.context.state.screen = 'home';
  f.tick();
  assert.equal(f.calls.length, 2);
});

test('a superseded episode cannot restart even if its cancelled callback arrives late', () => {
  const f = fixture('detail'), item = { id: 'series' }, finalEpisode = { id: 'latest' };
  f.context.playEpisode(item, { id: 'superseded' });
  f.context.playEpisode(item, finalEpisode);
  assert.equal(f.pending.size, 1);
  f.callbacks[0]();
  assert.equal(f.calls.length, 4);
  f.tick();
  assert.deepEqual(f.calls.at(-1), { item, episode: finalEpisode });
});
