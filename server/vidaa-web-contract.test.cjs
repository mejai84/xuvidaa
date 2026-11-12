'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'web/js/app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server/http-server.cjs'), 'utf8');

test('TVVIDAA has exactly three first-level tabs and contextual search', () => {
  assert.deepEqual([...html.matchAll(/data-section="([^"]+)"/g)].map(x => x[1]), ['tv', 'movies', 'series']);
  assert.match(html, /id="search"/);
  assert.match(app, /endpoints = \{ tv: 'liveChannels', movies: 'm3uMovies', series: 'm3uSeries' \}/);
  assert.match(app, /Buscar canales/);
  assert.match(app, /Buscar películas/);
  assert.match(app, /Buscar series/);
});

test('frontend is completely independent of webOS and Xuper services', () => {
  assert.doesNotMatch(html, /(?:webos|xuper|palmservicebridge|luna)/i);
  assert.doesNotMatch(app, /(?:PalmServiceBridge|luna:\/\/|webOSTV\.js|XuperTV)/i);
  assert.ok(!fs.existsSync(path.join(root, 'webos')));
  assert.ok(!fs.existsSync(path.join(root, 'tools/vendor/ffmpeg-7.0.2-armhf-static.tar.xz')));
});

test('static web server exposes only new native web assets', () => {
  assert.match(server, /\['js\/app\.js', 'text\/javascript/);
  assert.match(server, /\['css\/app\.css', 'text\/css/);
  assert.doesNotMatch(server, /\['js\/webOSTV\.js'/);
  assert.doesNotMatch(server, /\['config\/api\.js'/);
});

test('VIDAA control events support arrows, OK and Back', () => {
  assert.match(app, /key===37\|\|key===38\|\|key===39\|\|key===40/);
  assert.match(app, /key===461\|\|key===27/);
  assert.match(app, /key===13\|\|key===32/);
});

test('private VOD is still blocked until playback safety is verified', () => {
  const api = fs.readFileSync(path.join(root, 'server/api/vidaa-api.cjs'), 'utf8');
  assert.match(api, /if \(method === 'resolve'\) \{[\s\S]*?return respond\(res,501/);
});
