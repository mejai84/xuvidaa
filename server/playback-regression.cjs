'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.resolve(__dirname, '../webos/fidelity/js/app.js'), 'utf8');
function section(startText, endText) {
  const start = appSource.indexOf(startText);
  const end = appSource.indexOf(endText, start);
  assert(start >= 0 && end > start, 'Could not find playback source section: ' + startText);
  return appSource.slice(start, end);
}

const seekSource = section('  var relaySeekInFlight = false;', '  function vodPlaybackPosition()');
const episodeSource = section('  function chooseEpisode(ep)', '  function syncDetailEpisodeHighlight(item)');
const resolveSource = section('  function resolvePlayerStream(item, done)', '  function startPlayerVideo(item, episode)');
const stopSource = section('  function stopPlayerVideo()', '  function setPlayerStatus(');
const playSource = section('  function playUrl(', '  /* Portal titles need a license');

function playerContext(isHls) {
  const instances = [];
  const statuses = [];
  const counts = { play: 0, load: 0 };
  const activeClasses = new Set();
  const video = {
    children: [], currentTime: 0, duration: 0, paused: true, src: '',
    classList: { add: name => activeClasses.add(name), remove: name => activeClasses.delete(name) },
    canPlayType() { return ''; }, pause() {}, load() { counts.load++; }, play() { counts.play++; return { catch() { return this; } }; },
    appendChild(child) { this.children.push(child); },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  };
  Object.defineProperty(video, 'firstChild', { get() { return this.children[0]; } });
  class FakeHls {
    constructor() { this.listeners = new Map(); this.loaded = []; instances.push(this); }
    static isSupported() { return true; }
    on(event, callback) { this.listeners.set(event, callback); }
    attachMedia() { this.listeners.get(FakeHls.Events.MEDIA_ATTACHED)(FakeHls.Events.MEDIA_ATTACHED); }
    loadSource(url) { this.loaded.push(url); }
    destroy() {}
  }
  FakeHls.Events = { ERROR: 'error', MEDIA_ATTACHED: 'attached', MANIFEST_PARSED: 'manifest' };
  const window = isHls ? { Hls: FakeHls } : {};
  const frame = { style: { display: 'block' } };
  const context = {
    window, playerVideo: video, playerFrame: frame,
    state: { screen: 'player', playerMode: 'vod', streamMode: 'normal', streamError: '', playerItem: { isHls, streamMime: isHls ? 'application/vnd.apple.mpegurl' : 'video/mp4' } },
    relayBaseUrl: '', relayStartOffset: 0, relayPaused: false,
    resolveSeq: 0, lastPlayingUrl: '', lastProxyOrigin: '', seekTimer: null, seekPending: 0,
    vodProgressInterval: null, audioTrackSwitchUntil: 0, vodAudioChosen: false, vodCurrentAudioTrack: 0,
    autoSmoothFallbackKey: '', liveChannelSeq: 0,
    document: { createElement() { const attributes = {}; return { attributes, setAttribute(name, value) { attributes[name] = value; } }; } },
    XMLHttpRequest: function () {}, setPlayerStatus: text => statuses.push(text),
    clearBufferingNotice() {}, hideNextEpisodeLoading() {}, releaseRelaySeek() {}, cancelBrowserLivePlayback() {},
    stopVodProgressTicker() {}, startVodProgressTicker() {},
    rememberWatchProgress() {}, showOsdIcon() {}, updateVodProgress() {}, updateSubtitleDisplay() {},
    durationToSeconds: value => Number(value) || 0,
    portalServiceCall(method, params, done) { done(null, {}); },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}
  };
  vm.createContext(context);
  vm.runInContext(stopSource + '\n' + playSource, context);
  return { context, window, video, frame, instances, statuses, counts, activeClasses };
}

function seekContext() {
  const calls = { urls: [], osd: [] };
  const context = {
    state: { playerMode: 'vod', playerItem: { duration: 100 } },
    playerVideo: { currentTime: 10, duration: 100 },
    relayBaseUrl: '', relayStartOffset: 0, relayPaused: false,
    seekPending: 0, seekTimer: null, relaySeekInFlight: false, relaySeekWatchdog: null,
    setTimeout(callback, delay) { return { callback, delay }; },
    clearTimeout() {},
    showOsdIcon(type) { calls.osd.push(type); },
    playUrl(url) { calls.urls.push(url); }
  };
  vm.createContext(context);
  vm.runInContext(seekSource, context);
  return { context, calls };
}

function episodeContext(item) {
  const timers = [];
  const playerStarts = [];
  const apiCalls = [];
  const nextLoader = { style: {}, classList: { add() {}, remove() {} } };
  const context = {
    state: {
      playerItem: item, playerEpisode: item.episodes[0], detailEpisode: item.episodes[0],
      screen: 'player', streamMode: 'normal', trackIndex: 0,
      playerSeasonIndex: 0, detailSeason: 0, browserSeason: 0
    },
    playerStage: null, playerInfo: null, nextEpisodeLoading: nextLoader,
    playSettingViewOpen: false, resolveSeq: 1, vodAudioChosen: false, vodCurrentAudioTrack: 0,
    mediaInfoCache: {}, window: {},
    closeEpisodeBrowser() {}, closePlaySettingView() {}, updatePlayer() {},
    syncDetailEpisodeHighlight() {}, stopPlayerVideo() {},
    setPlayerStatus() {}, startPlayerVideo(title, episode) { playerStarts.push({ title, episode }); },
    clearTimeout() {}, setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    isSeriesItem(value) { return !!(value && value.seasons && value.seasons.length); },
    seriesSeasons(value) { return value.seasons || []; },
    seasonEpisodes(title, season, done) { done(season._episodes || []); },
    preferredAudioIndex() { return 0; }, mediaInfoKey() { return ''; },
    rememberCdnProbe() {}, applySubtitleDefaults() {},
    portalServiceCall(method, params, done) {
      apiCalls.push({ method, params });
      done(null, { returnValue: true, mime: 'video/mp4', duration: 90, mediaToken: 'opaque-token', mediaUrl: 'https://app.example/api/media?token=opaque-token' });
    }
  };
  vm.createContext(context);
  vm.runInContext(episodeSource + '\n' + resolveSource, context);
  return { context, timers, playerStarts, apiCalls };
}

const cases = [
  ['MP4 playback keeps the progressive media URL and source type', () => {
    const run = playerContext(false);
    const url = 'https://app.example/api/media?token=opaque';
    run.context.playUrl(url);
    assert.equal(run.video.src, url);
    assert.equal(run.video.children.length, 1);
    assert.equal(run.video.children[0].attributes.src, url);
    assert.equal(run.video.children[0].attributes.type, 'video/mp4');
    assert.equal(run.counts.load, 1);
    assert.equal(run.counts.play, 1);
    assert.equal(run.instances.length, 0);
  }],
  ['HLS playback passes the private manifest URL only to the HLS pipeline', () => {
    const run = playerContext(true);
    const url = 'https://app.example/api/media?token=opaque&manifest=1';
    run.context.playUrl(url);
    assert.equal(run.instances.length, 1);
    assert.deepEqual(run.instances[0].loaded, [url]);
    assert.equal(run.video.src, '');
    assert.equal(run.video.children.length, 0);
    assert.equal(run.counts.load, 0);
    run.instances[0].listeners.get('manifest')('manifest');
    assert.equal(run.counts.play, 1);
  }],
  ['forward and rewind accumulate and clamp direct MP4 seeks', () => {
    const run = seekContext();
    run.context.playerSeek(20);
    run.context.playerSeek(-5);
    run.context.flushSeek();
    assert.equal(run.context.playerVideo.currentTime, 25);
    run.context.playerSeek(-60);
    run.context.flushSeek();
    assert.equal(run.context.playerVideo.currentTime, 0);
    run.context.playerVideo.currentTime = 99;
    run.context.playerSeek(30);
    run.context.flushSeek();
    assert.equal(run.context.playerVideo.currentTime, 99);
    assert.deepEqual(run.calls.osd.slice(0, 2), ['fwd', 'rew']);
  }],
  ['forward and rewind rebuild a relay MP4 at the requested timestamp', () => {
    const run = seekContext();
    run.context.state.playerItem.duration = 300;
    run.context.relayBaseUrl = 'http://127.0.0.1:8787/s/opaque.mp4';
    run.context.relayStartOffset = 100;
    run.context.playerVideo.currentTime = 12;
    run.context.playerSeek(-20);
    run.context.flushSeek();
    assert.equal(run.context.relayStartOffset, 92);
    assert.equal(run.calls.urls[0], run.context.relayBaseUrl + '?start=92');
    run.context.releaseRelaySeek();
    run.context.playerVideo.currentTime = 2;
    run.context.playerSeek(15);
    run.context.flushSeek();
    assert.equal(run.context.relayStartOffset, 109);
    assert.equal(run.calls.urls[1], run.context.relayBaseUrl + '?start=109');
  }],
  ['selecting another season resolves the selected episode with that season ID', () => {
    const first = { id: 'episode-1', number: 1 };
    const second = { id: 'episode-2', number: 1 };
    const title = {
      id: 'series-id', _portal: true, seasonId: 'season-1', episodes: [first],
      seasons: [
        { id: 'season-1', number: 1, _episodes: [first] },
        { id: 'season-2', number: 2, _episodes: [second] }
      ]
    };
    const run = episodeContext(title);
    run.context.state.browserSeason = 1;
    run.context.chooseEpisode(second);
    assert.equal(run.context.state.playerEpisode, second);
    assert.equal(run.context.state.detailSeason, 1);
    assert.equal(run.context.state.playerSeasonIndex, 1);
    assert.equal(title.seasonId, 'season-2');
    assert.deepEqual(title.episodes, [second]);
    assert.equal(run.timers[0].delay, 600);
    run.timers[0].callback();
    assert.equal(run.playerStarts[0].episode, second);
    let url = '';
    run.context.resolvePlayerStream(title, value => { url = value; });
    assert.equal(run.apiCalls[0].method, 'resolve');
    assert.equal(run.apiCalls[0].params.contentId, 'episode-2');
    assert.equal(run.apiCalls[0].params.seriesContentId, 'season-2');
    assert.equal(run.apiCalls[0].params.playbackMode, 'normal');
    assert.equal(run.apiCalls[0].params.forceRelay, false);
    assert.equal(run.apiCalls[0].params.trackIndex, 0);
    assert.equal(run.apiCalls[0].params.audioTrack, 0);
    assert.equal(url, 'https://app.example/api/media?token=opaque-token');
  }],
  ['ending a season advances to the first episode of the next season', () => {
    const first = { id: 'episode-1', number: 1 };
    const second = { id: 'episode-2', number: 1 };
    const title = {
      id: 'series-id', seasonId: 'season-1', episodes: [first],
      seasons: [
        { id: 'season-1', number: 1, _episodes: [first] },
        { id: 'season-2', number: 2, _episodes: [second] }
      ]
    };
    const run = episodeContext(title);
    run.context.advanceToNextEpisode();
    assert.equal(run.context.state.playerEpisode, second);
    assert.equal(run.context.state.playerSeasonIndex, 1);
    assert.equal(title.seasonId, 'season-2');
    assert.deepEqual(title.episodes, [second]);
    assert.equal(run.timers[0].delay, 600);
    run.timers[0].callback();
    assert.equal(run.playerStarts[0].episode, second);
  }]
];

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
console.log((cases.length - failed) + '/' + cases.length + ' VOD playback regression checks passed');
process.exitCode = failed ? 1 : 0;
