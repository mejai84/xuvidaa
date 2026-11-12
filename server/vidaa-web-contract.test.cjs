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

test('private VOD uses opaque references, not URLs from the browser', () => {
  const api = fs.readFileSync(path.join(root, 'server/api/vidaa-api.cjs'), 'utf8');
  const codec = fs.readFileSync(path.join(root, 'server/api/lib/media-token.js'), 'utf8');
  assert.match(api, /method === 'resolve'/);
  assert.match(api, /registry\.register/);
  assert.match(api, /vod\.resolveStream\(id\)/);
  assert.match(codec, /typeof payload\.ref === 'string'/);
  assert.doesNotMatch(codec, /typeof payload\.url === 'string'/);
});

test('startup splash is viewport centered and hides login until session is checked', () => {
  const css = fs.readFileSync(path.join(root, 'web/css/app.css'), 'utf8');
  assert.match(html, /id="splash" class="splash-screen"/);
  assert.match(html, /id="auth" class="auth-screen"[^>]*hidden/);
  assert.match(html, /id="shell" hidden/);
  assert.match(css, /\.splash-screen\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/);
  assert.match(app, /function showLogin\(message\)\s*\{[\s\S]*?show\('splash', false\)/);
  assert.match(app, /xhr\.ontimeout = function \(\) \{ showLogin/);
  assert.match(app, /function enter\(\)\s*\{\s*show\('splash', false\)/);
});

test('catalog shows and clears its centered loading indicator', () => {
  const css = fs.readFileSync(path.join(root, 'web/css/app.css'), 'utf8');
  assert.match(html, /id="catalogLoader"[^>]*hidden/);
  assert.match(css, /\.catalog-loader\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/);
  assert.match(app, /show\('catalogLoader', !append\)/);
  assert.match(app, /show\('catalogLoader', false\)/);
});

test('mobile centers content while desktop and TVs use viewport sizing', () => {
  const css = fs.readFileSync(path.join(root, 'web/css/app.css'), 'utf8');
  assert.match(html, /name="viewport"/);
  assert.match(css, /#shell\s*\{\s*width:\s*100%;\s*min-height:\s*100vh;/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /\.content\s*\{\s*width:\s*100%;\s*max-width:\s*580px;\s*margin:\s*0 auto;/);
  assert.match(css, /\.catalog\s*\{\s*-webkit-justify-content:\s*center;\s*justify-content:\s*center;/);
  assert.match(css, /@media \(min-width: 2200px\)/);
  assert.doesNotMatch(css, /transform:\s*scale\(/);
});

test('family UX has profile switch, favorites, playback and diagnostics callbacks', () => {
  const family = fs.readFileSync(path.join(root, 'web/js/family.js'),'utf8');
  for (const name of ['profile','favoritesFilter','recentFilter','continueFilter',
     'detailPlay','prevChannel','nextChannel','diagnosticsButton']) {
    assert.match(html,new RegExp('id="'+name+'"'));
  }
  assert.match(family,/function toggleFavorite/);
  assert.match(app,/function resolveVodPlayback/);
  assert.match(app,/function refreshDiagnostics/);
});


test('password visibility button is accessible, shows an eye and keeps submit separate', () => {
  const css = fs.readFileSync(path.join(root,'web/css/app.css'),'utf8');
  assert.match(html, /id="password" type="password" autocomplete="current-password"/);
  assert.match(html, /id="passwordToggle" class="password-toggle" type="button"/);
  assert.match(html, /aria-label="Mostrar contraseña" aria-pressed="false"/);
  assert.match(html, /class="eye-slash"/);
  assert.match(css, /\.password-field\s*\{ position: relative;/);
  assert.match(css, /\.password-toggle\.is-visible \.eye-slash \{ display: block; \}/);
  assert.match(app, /\$\('passwordToggle'\)\.addEventListener\('click'/);
  assert.match(app, /setPasswordVisible\(\$\('password'\)\.type === 'password'\)/);
});

test('eye toggle changes input type and accessible state without changing password value', () => {
  const vm = require('node:vm');
  const helper = /  function setPasswordVisible\(visible\) \{[\s\S]*?\n  \}/.exec(app);
  assert.ok(helper, 'toggle helper must exist');
  const field = {type:'password', value:'private-value-with-@-symbol'};
  const attrs = {};
  const button = {
    className:'password-toggle', title:'',
    setAttribute(name,value) { attrs[name]=value; }
  };
  const context = {$: id => id === 'password' ? field : id === 'passwordToggle' ? button : null};
  vm.runInNewContext(helper[0] + '\nsetPasswordVisible(true);', context);
  assert.equal(field.type,'text');
  assert.equal(field.value,'private-value-with-@-symbol');
  assert.equal(attrs['aria-pressed'],'true');
  assert.equal(attrs['aria-label'],'Ocultar contraseña');
  assert.equal(button.className,'password-toggle is-visible');
  vm.runInNewContext(helper[0] + '\nsetPasswordVisible(false);', context);
  assert.equal(field.type,'password');
  assert.equal(field.value,'private-value-with-@-symbol');
  assert.equal(attrs['aria-pressed'],'false');
  assert.equal(attrs['aria-label'],'Mostrar contraseña');
  assert.equal(button.className,'password-toggle');
  assert.match(app, /if\(document\.hidden\) \{\s*setPasswordVisible\(false\)/);
});
