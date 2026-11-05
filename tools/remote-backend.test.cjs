'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const backend = require('../webos/fidelity/api/lib/remote-backend');
const env = { XUPER_BACKEND_URL: 'https://api.example.test', XUPER_BACKEND_TOKEN: 'a'.repeat(48) };
function response(body, status = 200, headers) { return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) }); }

test('configuration rejects HTTP, credentials, paths and missing secret', async () => {
  for (const url of ['http://example.test', 'https://u:p@example.test', 'https://example.test/api', 'https://example.test/?q=x', 'https://example.test/#x']) {
    assert.equal(backend.configuration({ ...env, XUPER_BACKEND_URL: url }), null);
  }
  assert.equal(backend.configuration({ XUPER_BACKEND_URL: env.XUPER_BACKEND_URL }), null);
  const result = await backend.forward('home', {}, 'app.example.test', { env: {}, fetch() { throw new Error('must not fetch'); } });
  assert.equal(result.body.errorCode, 'BACKEND_CONFIG');
});
test('self-targeting configuration rejects before any connection', async () => {
  const result = await backend.forward('home', {}, 'api.example.test', { env, fetch() { throw new Error('must not fetch'); } });
  assert.equal(result.status, 503);
});
test('gateway sends only its server token and payload to a fixed HTTPS endpoint', async () => {
  const result = await backend.forward('search', { value: 'dragon' }, 'app.example.test', { env, fetch(url, options) {
    assert.equal(url, env.XUPER_BACKEND_URL + '/api/search');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.XUPER_BACKEND_TOKEN });
    assert.deepEqual(JSON.parse(options.body), { value: 'dragon' });
    assert.ok(options.signal instanceof AbortSignal);
    return response({ returnValue: true, items: [] });
  } });
  assert.equal(result.status, 200);
  assert.equal(result.body.returnValue, true);
});
test('portal regional rejection stays an error with the original code', async () => {
  const result = await backend.forward('resolve', {}, 'app.example.test', { env, fetch: async () => response({ returnValue: false, errorCode: 'portal100024', errorText: 'Región rechazada' }, 503) });
  assert.equal(result.status, 503);
  assert.equal(result.body.errorCode, 'portal100024');
  assert.equal(result.body.mediaUrl, undefined);
});
test('media and subtitle URLs go straight to VPS without exposing a source URL', async () => {
  const result = await backend.forward('resolve', {}, 'app.example.test', { env, fetch: async () => response({ returnValue: true, mediaToken: 'signed.token', isHls: true, url: 'https://wrong.example/video', subtitles: [{ lang: 'es', format: 'srt', url: '/api/media?old' }] }) });
  assert.equal(result.body.mediaUrl, env.XUPER_BACKEND_URL + '/api/media?token=signed.token&manifest=1');
  assert.equal(result.body.url, result.body.mediaUrl);
  assert.equal(result.body.subtitles[0].url, env.XUPER_BACKEND_URL + '/api/media?token=signed.token&subtitle=0');
});
test('MP4 media does not request a synthetic HLS manifest', async () => {
  const result = await backend.forward('resolve', {}, 'app.example.test', { env, fetch: async () => response({ returnValue: true, mediaToken: 'signed.token', isHls: false }) });
  assert.equal(result.body.mediaUrl, env.XUPER_BACKEND_URL + '/api/media?token=signed.token');
});
test('invalid JSON, HTML and incorrect schema return a controlled backend error', async () => {
  for (const bad of [new Response('<html>secret stack</html>', { headers: { 'Content-Type': 'text/html' } }), new Response('invalid', { headers: { 'Content-Type': 'application/json' } }), response({ message: 'unexpected' })]) {
    const result = await backend.forward('home', {}, 'app.example.test', { env, fetch: async () => bad });
    assert.equal(result.status, 502);
    assert.equal(result.body.errorCode, 'BACKEND_RESPONSE');
    assert.ok(!JSON.stringify(result).includes('secret stack'));
  }
});
test('response limits apply to both headers and streamed bodies', async () => {
  const oversized = 'x'.repeat(3 * 1024 * 1024 + 1);
  for (const bad of [response({}, 200, { 'Content-Length': String(4 * 1024 * 1024) }), new Response(oversized, { headers: { 'Content-Type': 'application/json' } })]) {
    const result = await backend.forward('home', {}, 'app.example.test', { env, fetch: async () => bad });
    assert.equal(result.body.errorCode, 'BACKEND_RESPONSE');
  }
});
test('network errors do not reveal backend addresses or secret values', async () => {
  const result = await backend.forward('home', {}, 'app.example.test', { env, fetch() { throw new Error(env.XUPER_BACKEND_URL + env.XUPER_BACKEND_TOKEN); } });
  assert.equal(result.body.errorCode, 'BACKEND_UNREACHABLE');
  assert.ok(!JSON.stringify(result).includes(env.XUPER_BACKEND_TOKEN));
  assert.ok(!JSON.stringify(result).includes(env.XUPER_BACKEND_URL));
});
test('the request deadline also aborts response-body reads', async () => {
  let expire;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../webos/fidelity/api/lib/remote-backend'), 'utf8'), {
    module, process: { env }, Buffer, URL, AbortController,
    setTimeout(fn, delay) { assert.equal(delay, 57000); expire = fn; return 1; }, clearTimeout() {}
  });
  const result = module.exports.forward('home', {}, 'app.example.test', { env, fetch(url, options) {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      queueMicrotask(expire);
    });
  } });
  assert.equal((await result).body.errorCode, 'BACKEND_TIMEOUT');
});

function route({ environment = {}, magis = {}, remote = backend, now = Date.now() } = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../webos/fidelity/api/[method].js'), 'utf8'), {
    module, process: { env: environment }, Buffer, URL, Date: { now: () => now },
    require(name) {
      if (name === './lib/magis') return magis;
      if (name === './lib/remote-backend') return remote;
      if (name === 'crypto') return require('node:crypto');
      throw new Error(name);
    }
  });
  return async method => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } };
    await module.exports({ query: { method }, method: 'POST', body: { contentId: 'real-id' }, headers: { host: 'app.example.test', origin: 'https://app.example.test' }, socket: { remoteAddress: '127.0.0.1' } }, res);
    return res;
  };
}
test('API route forwards configured gateway requests instead of contacting portal locally', async () => {
  const api = route({ environment: env, remote: { forward(method, input, host) {
    assert.equal(method, 'prewarm'); assert.equal(input.contentId, 'real-id'); assert.equal(host, 'app.example.test');
    return Promise.resolve({ status: 503, body: { returnValue: false, errorCode: 'portal100024' } });
  } } });
  const result = await api('prewarm');
  assert.equal(result.statusCode, 503);
  assert.equal(result.value.errorCode, 'portal100024');
});
test('local runtime returns signed absolute proxy URLs and duration, never the source URL', async () => {
  const api = route({ environment: { PUBLIC_BASE_URL: env.XUPER_BACKEND_URL, MEDIA_TOKEN_SECRET: 's'.repeat(48) }, magis: {
    runWithDeadline(timeout, operation, done) { operation(done); },
    resolve(id, series, options, done) { done(null, { url: 'https://cdn.example.test/movie.ts', duration: 60, mime: 'video/mp2t', subtitles: [{ lang: 'es', format: 'srt', url: 'https://subs.example.test/title.srt' }] }); }
  } });
  const result = await api('resolve');
  assert.equal(result.statusCode, 200);
  assert.equal(result.value.isHls, true, 'video/mp2t must use the HLS transmuxer');
  assert.equal(result.value.mediaUrl, env.XUPER_BACKEND_URL + '/api/media?token=' + encodeURIComponent(result.value.mediaToken) + '&manifest=1');
  assert.equal(result.value.url, undefined);
  assert.equal(result.value.subtitles[0].url, env.XUPER_BACKEND_URL + '/api/media?token=' + encodeURIComponent(result.value.mediaToken) + '&subtitle=0');
  assert.equal(JSON.parse(Buffer.from(result.value.mediaToken.split('.')[0], 'base64url').toString()).duration, 60);
});
test('browser prefers VPS media URL while native LG keeps its proxy contract', async () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../webos/fidelity/js/app.js'), 'utf8');
  const start = source.indexOf('        var playUrlValue = payload.proxyPath');
  const end = source.indexOf('        item._htmlSubtitleUrls', start);
  assert.ok(start > 0 && end > start);
  const payload = { proxyPath: 'http://127.0.0.1:8787/native.mp4', mediaUrl: env.XUPER_BACKEND_URL + '/api/media?token=signed', mediaToken: 'signed', isHls: true };
  const browser = { window: {}, payload };
  vm.runInNewContext(source.slice(start, end), browser);
  assert.equal(browser.playUrlValue, payload.mediaUrl);
  const native = { window: { PalmServiceBridge() {} }, payload };
  vm.runInNewContext(source.slice(start, end), native);
  assert.equal(native.playUrlValue, payload.proxyPath);
});
test('live browser chooses VPS proxy rather than reconstructing a Vercel media URL', async () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../webos/fidelity/js/app.js'), 'utf8');
  const start = source.indexOf('        var streamUrl = payload.mediaToken');
  const end = source.indexOf('        if (!streamUrl)', start);
  assert.ok(start > 0 && end > start);
  const state = { payload: { mediaUrl: env.XUPER_BACKEND_URL + '/api/media?token=signed&manifest=1', mediaToken: 'signed' } };
  vm.runInNewContext(source.slice(start, end), state);
  assert.equal(state.streamUrl, state.payload.mediaUrl);
});
test('live signed manifest query selects the actual browser HLS pipeline', async () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../webos/fidelity/js/app.js'), 'utf8');
  const start = source.indexOf('    var rawMime = (state.playerItem');
  const end = source.indexOf('    playerVideo.onerror', start);
  assert.ok(start > 0 && end > start);
  const browser = { state: { playerItem: null }, url: env.XUPER_BACKEND_URL + '/api/media?token=signed&manifest=1', browserMode: true, window: { Hls: { isSupported: () => true } } };
  vm.runInNewContext(source.slice(start, end), browser);
  assert.equal(browser.isHls, true);
  assert.equal(browser.useBrowserHls, true);
  const native = { ...browser, browserMode: false };
  vm.runInNewContext(source.slice(start, end), native);
  assert.equal(native.useBrowserHls, false);
});

function preview(native = false, clock) {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../webos/fidelity/js/app.js'), 'utf8');
  const service = source.slice(source.indexOf('function portalServiceCall('), source.indexOf('  function startServiceKeepAlive('));
  const functions = source.slice(source.indexOf('  function stopLivePreview('), source.indexOf('  function scheduleLivePreview('));
  const requests = [], luna = [], instances = [];
  function Hls() { this.events = {}; this.destroyed = false; instances.push(this); }
  Hls.isSupported = () => true;
  Hls.Events = { ERROR: 'error', MEDIA_ATTACHED: 'attached', MANIFEST_PARSED: 'parsed' };
  Hls.prototype.on = function (event, callback) { this.events[event] = callback; };
  Hls.prototype.attachMedia = function (video) { this.video = video; this.events.attached(); };
  Hls.prototype.loadSource = function (url) { this.source = url; };
  Hls.prototype.destroy = function () { this.destroyed = true; };
  const classes = new Set();
  const video = { src: '', playCount: 0, loadCount: 0, pause() {}, removeAttribute() {}, load() { this.loadCount++; }, play() { this.playCount++; return Promise.resolve(); }, canPlayType() { return ''; } };
  const window = { Hls, URL, location: { href: 'https://app.example.test/', origin: 'https://app.example.test' }, webOS: { service: { request(uri, options) { luna.push({ uri, options }); } } } };
  if (native) window.PalmServiceBridge = function () {};
  const context = { window, state: { screen: 'home', tab: 0 }, vodApi: { devServiceUrl: '/api', browserTimeoutMs: 65000 },
    livePreviewVideo: video, livePreviewHls: null, livePreviewSeq: 0, livePreviewTimer: null, livePreviewRefreshTimer: null, livePreviewChannel: '',
    livePreviewStatus: { textContent: '' }, liveMain: { classList: { add(...values) { values.forEach(value => classes.add(value)); }, remove(...values) { values.forEach(value => classes.delete(value)); }, contains(value) { return classes.has(value); } } },
    hasLuna: () => true, describeServiceError: value => value, rememberCdnProbe() {},
    setTimeout: clock ? clock.setTimeout : () => 1, clearTimeout: clock ? clock.clearTimeout : function () {}, apiRequest(url, callback, options) { requests.push({ url, callback, options }); }
  };
  if (clock) context.Date = { now: () => clock.now };
  vm.createContext(context);
  vm.runInContext(service + '\n' + functions, context);
  return { context, requests, luna, video, classes, instances };
}

test('browser TV preview uses the real HTTP transport and an isolated HLS instance', async () => {
  const p = preview();
  p.context.startLivePreview({ channelCode: 'portal-channel', name: 'Canal' });
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].url, '/api/resolveLive');
  assert.equal(p.requests[0].options.body.channelCode, 'portal-channel');
  assert.equal(p.luna.length, 0, 'webOSTV.js must not invoke the LG bridge in a browser');
  const mediaUrl = env.XUPER_BACKEND_URL + '/api/media?token=signed&manifest=1';
  p.requests[0].callback(null, { returnValue: true, mediaToken: 'signed', mediaUrl, isHls: true });
  assert.equal(p.instances.length, 1);
  assert.equal(p.instances[0].source, mediaUrl);
  assert.equal(p.video.src, '', 'MSE preview must not start a second native source');
  p.instances[0].events.parsed();
  assert.equal(p.video.playCount, 1);
  p.video.onloadeddata();
  assert.equal(p.classes.has('is-preview-playing'), true);
});
test('browser preview rejects arbitrary addon URLs and unsigned raw media responses', async () => {
  const addon = preview();
  addon.context.startLivePreview({ streamUrl: 'https://arbitrary.example/video' });
  assert.equal(addon.requests.length, 0);
  for (const payload of [
    { returnValue: true, url: 'https://arbitrary.example/video.m3u8', isHls: true },
    { returnValue: true, mediaToken: 'signed', mediaUrl: 'https://arbitrary.example/video.m3u8', isHls: true },
    { returnValue: true, mediaToken: 'signed', mediaUrl: 'https://arbitrary.example/api/media?token=other', isHls: true }
  ]) {
    const p = preview(); p.context.startLivePreview({ channelCode: 'portal-channel' }); p.requests[0].callback(null, payload);
    assert.equal(p.instances.length, 0); assert.equal(p.video.playCount, 0); assert.equal(p.video.src, '');
  }
});
test('leaving TV destroys preview HLS and ignores late events and portal replies', async () => {
  const p = preview();
  p.context.startLivePreview({ channelCode: 'portal-channel' });
  const payload = { returnValue: true, mediaToken: 'signed', isHls: true };
  p.requests[0].callback(null, payload);
  const old = p.instances[0];
  p.context.stopLivePreview();
  assert.equal(old.destroyed, true);
  assert.equal(p.context.livePreviewHls, null);
  old.events.parsed();
  p.requests[0].callback(null, payload);
  assert.equal(p.video.playCount, 0);
  assert.equal(p.instances.length, 1);
});
test('fatal preview errors release HLS without altering the main player', async () => {
  const p = preview(); p.context.startLivePreview({ channelCode: 'portal-channel' });
  const mainPlayer = {};
  p.context.window.__xuperHls = mainPlayer;
  p.requests[0].callback(null, { returnValue: true, mediaToken: 'signed', isHls: true });
  p.instances[0].events.error('error', { fatal: true });
  assert.equal(p.instances[0].destroyed, true); assert.equal(p.context.livePreviewHls, null);
  assert.equal(p.classes.has('is-preview-loading'), false);
  assert.equal(p.context.window.__xuperHls, mainPlayer);
});
test('native LG preview retains its Luna resolution and native proxy video source', async () => {
  const p = preview(true); p.context.startLivePreview({ streamUrl: 'https://authorized.example/channel' });
  assert.equal(p.requests.length, 0); assert.equal(p.luna.length, 1);
  assert.equal(p.luna[0].options.parameters.streamUrl, 'https://authorized.example/channel');
  p.luna[0].options.onSuccess({ returnValue: true, proxyPath: 'http://127.0.0.1:9000/media/channel.m3u8' });
  assert.equal(p.video.src, 'http://127.0.0.1:9000/media/channel.m3u8'); assert.equal(p.instances.length, 0); assert.equal(p.video.playCount, 1);
});

function virtualClock() {
  let id = 0;
  const timers = new Map();
  const clock = { now: 1000000, timers,
    setTimeout(callback, delay) { const timer = ++id; timers.set(timer, { at: clock.now + delay, callback }); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    advance(duration) {
      const end = clock.now + duration;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); clock.now = due[1].at; due[1].callback();
      }
      clock.now = end;
    }
  };
  return clock;
}
function livePlayer(clock, native = false) {
  const p = preview(native, clock);
  const source = fs.readFileSync(require('node:path').join(__dirname, '../webos/fidelity/js/app.js'), 'utf8');
  const liveSource = source.slice(source.indexOf('  var liveChannelSeq = 0;'), source.indexOf('  function updatePlayerChannel()'));
  const stopSource = source.slice(source.indexOf('  function stopPlayerVideo()'), source.indexOf('  function setPlayerStatus('));
  const streams = [];
  Object.assign(p.context, {
    state: { screen: 'player', playerMode: 'live', channel: 0 }, CHANNELS: [{ channelCode: 'one' }, { channelCode: 'two' }],
    playerVideo: null, seekTimer: null, seekPending: 0, resolveSeq: 0, lastProxyOrigin: '', lastPlayingUrl: '',
    relayPaused: false, relayBaseUrl: '', relayStartOffset: 0,
    clearBufferingNotice() {}, setPlayerStatus() {}, showOsdIcon() {}, stopVodProgressTicker() {}, releaseRelaySeek() {}, showInfobar() {},
    playUrl(url) { p.context.stopPlayerVideo(); streams.push(url); }
  });
  vm.runInContext(liveSource + '\n' + stopSource, p.context);
  return { ...p, streams };
}
const livePayload = (clock, token = 'signed') => ({ returnValue: true, mediaToken: token, mediaUrl: 'https://api.example.test/api/media?token=' + token + '&manifest=1', isHls: true, mediaExpiresAt: clock.now + 15 * 60 * 1000 });

test('VOD signed lifetime covers the known duration plus 30 minutes and is bounded', async () => {
  const now = 1000000;
  for (const [duration, ttl] of [[0, 15 * 60000], [60, 31 * 60000], [7200, 150 * 60000], [86400, 6 * 3600000], [Infinity, 15 * 60000]]) {
    const api = route({ now, environment: { MEDIA_TOKEN_SECRET: 's'.repeat(48) }, magis: {
      runWithDeadline(timeout, operation, done) { operation(done); },
      resolve(id, series, options, done) { done(null, { url: 'https://cdn.example.test/movie.mp4', duration, mime: 'video/mp4' }); }
    } });
    const result = await api('resolve');
    assert.equal(result.value.mediaExpiresAt, now + ttl);
    const signed = JSON.parse(Buffer.from(result.value.mediaToken.split('.')[0], 'base64url').toString());
    assert.equal(signed.exp, result.value.mediaExpiresAt);
  }
});
test('live tokens still expire in 15 minutes and expose only expiry metadata', async () => {
  const now = 1000000;
  const api = route({ now, environment: { MEDIA_TOKEN_SECRET: 's'.repeat(48) }, magis: {
    runWithDeadline(timeout, operation, done) { operation(done); },
    resolveLive(id, done) { done(null, { url: 'https://cdn.example.test/live.m3u8', mime: 'application/x-mpegurl', duration: 86400 }); }
  } });
  const result = await api('resolveLive');
  assert.equal(result.value.mediaExpiresAt, now + 15 * 60000);
  assert.equal(JSON.parse(Buffer.from(result.value.mediaToken.split('.')[0], 'base64url')).exp, result.value.mediaExpiresAt);
});
test('fullscreen live renews one minute before expiry and schedules the fresh token', async () => {
  const clock = virtualClock(), p = livePlayer(clock);
  p.context.startLiveChannel({ channelCode: 'one' }, true);
  p.requests[0].callback(null, livePayload(clock, 'first'));
  clock.advance(14 * 60000 - 1); assert.equal(p.requests.length, 1);
  clock.advance(1); assert.equal(p.requests.length, 2);
  assert.equal(p.requests[1].options.body.channelCode, 'one');
  p.requests[1].callback(null, livePayload(clock, 'fresh'));
  assert.match(p.streams[1], /token=fresh/);
  clock.advance(14 * 60000); assert.equal(p.requests.length, 3);
});
test('fullscreen stop and channel change cancel timers and stale renewal callbacks', async () => {
  const clock = virtualClock(), p = livePlayer(clock);
  p.context.startLiveChannel({ channelCode: 'one' }, true);
  p.requests[0].callback(null, livePayload(clock));
  clock.advance(14 * 60000); assert.equal(p.requests.length, 2);
  p.context.startLiveChannel({ channelCode: 'two' }, true);
  p.requests[1].callback(null, livePayload(clock, 'obsolete'));
  assert.equal(p.streams.length, 1);
  p.requests[2].callback(null, livePayload(clock, 'two'));
  p.context.stopPlayerVideo();
  assert.equal(p.context.liveRefreshTimer, null);
  clock.advance(20 * 60000); assert.equal(p.requests.length, 3);
});
test('fullscreen renewal retries twice at 15 second intervals then stops', async () => {
  const clock = virtualClock(), p = livePlayer(clock);
  p.context.startLiveChannel({ channelCode: 'one' }, true); p.requests[0].callback(null, livePayload(clock));
  clock.advance(14 * 60000); p.requests[1].callback('temporal', null);
  clock.advance(15000); p.requests[2].callback('temporal', null);
  clock.advance(15000); p.requests[3].callback('temporal', null);
  assert.equal(p.context.liveRefreshTimer, null);
  clock.advance(5 * 60000); assert.equal(p.requests.length, 4);
});
test('home preview renews before expiry and stopping clears future renewals', async () => {
  const clock = virtualClock(), p = preview(false, clock);
  p.context.startLivePreview({ channelCode: 'one' }); p.requests[0].callback(null, livePayload(clock));
  clock.advance(14 * 60000); assert.equal(p.requests.length, 2);
  assert.equal(p.instances[0].destroyed, true);
  p.requests[1].callback(null, livePayload(clock, 'fresh'));
  assert.match(p.instances[1].source, /token=fresh/);
  p.context.stopLivePreview(); assert.equal(p.context.livePreviewRefreshTimer, null);
  clock.advance(20 * 60000); assert.equal(p.requests.length, 2);
});
test('preview channel change discards an in-flight renewal', async () => {
  const clock = virtualClock(), p = preview(false, clock);
  p.context.startLivePreview({ channelCode: 'one' }); p.requests[0].callback(null, livePayload(clock));
  clock.advance(14 * 60000);
  p.context.startLivePreview({ channelCode: 'two' });
  p.requests[1].callback(null, livePayload(clock, 'obsolete'));
  assert.equal(p.instances.length, 1);
  p.requests[2].callback(null, livePayload(clock, 'two'));
  assert.match(p.instances[1].source, /token=two/);
});
test('preview stops after failed renewal retries and displays the failure', async () => {
  const clock = virtualClock(), p = preview(false, clock);
  p.context.startLivePreview({ channelCode: 'one' }); p.requests[0].callback(null, livePayload(clock));
  clock.advance(14 * 60000); p.requests[1].callback('temporal', null);
  clock.advance(15000); p.requests[2].callback('temporal', null);
  clock.advance(15000); p.requests[3].callback('temporal', null);
  assert.equal(p.context.livePreviewRefreshTimer, null);
  assert.equal(p.context.livePreviewStatus.textContent, 'No se pudo renovar la señal');
  clock.advance(5 * 60000); assert.equal(p.requests.length, 4);
});
test('native LG creates no browser renewal timers for fullscreen or preview', async () => {
  const clock = virtualClock(), p = livePlayer(clock, true);
  p.context.startLiveChannel({ channelCode: 'one' }, true);
  p.luna[0].options.onSuccess({ ...livePayload(clock), proxyPath: 'http://127.0.0.1:9000/live.m3u8' });
  assert.equal(p.context.liveRefreshTimer, null);
  const home = preview(true, clock); home.context.startLivePreview({ channelCode: 'one' });
  home.luna[0].options.onSuccess({ ...livePayload(clock), proxyPath: 'http://127.0.0.1:9000/live.m3u8' });
  assert.equal(home.context.livePreviewRefreshTimer, null);
  clock.advance(14 * 60000);
  assert.equal(p.luna.filter(call => call.options.method === 'resolveLive').length, 1);
  assert.equal(home.luna.filter(call => call.options.method === 'resolveLive').length, 1);
});

