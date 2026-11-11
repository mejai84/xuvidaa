'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const codec = require('../webos/fidelity/api/lib/media-token');

const secret = crypto.randomBytes(48).toString('hex');
const payload = {
  url: 'https://private-cdn.example/movie.mp4?license=private-value',
  hosts: ['private-cdn.example'],
  headers: { Authorization: 'Bearer private-header' },
  mime: 'video/mp4',
  duration: 180,
  subtitles: [],
  exp: Date.now() + 60_000
};

test('media tokens encrypt private URLs and upstream authorization headers', () => {
  const token = codec.encode(payload, secret);
  assert.match(token, /^v1\./);
  assert.doesNotMatch(token, /private-cdn|license|private-value|Authorization|Bearer/);
  assert.deepEqual(codec.decode(token, secret), payload);
});

test('the resolve API returns an opaque URL instead of exposing the source stream', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../webos/fidelity/api/[method].js'), 'utf8');
  const mediaSecret = crypto.randomBytes(48).toString('hex');
  const privateUrl = 'https://private-cdn.example/movie.mp4?license=private-value';
  const privateHeader = 'Bearer private-header';
  const magis = {
    runWithDeadline(timeout, operation, done) { operation(done); },
    resolve(id, seriesId, options, done) {
      done(null, { url: privateUrl, headers: { Authorization: privateHeader }, mime: 'video/mp4', duration: 180 });
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, Buffer, URL, process: { env: { MEDIA_TOKEN_SECRET: mediaSecret, PUBLIC_BASE_URL: 'https://app.example.test' } },
    require(name) {
      if (name === './lib/magis') return magis;
      if (name === './lib/media-token') return codec;
      throw new Error('Unexpected dependency');
    }
  });
  const response = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return value; } };
  await module.exports({ method: 'POST', query: { method: 'resolve' }, body: { contentId: 'movie-1' }, headers: { host: 'app.example.test' }, socket: { remoteAddress: '127.0.0.1' } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.value.mediaUrl.startsWith('https://app.example.test/api/media?token=v1.'), true);
  assert.equal(response.value.url, undefined);
  assert.doesNotMatch(JSON.stringify(response.value), /private-cdn|private-value|private-header/);
  const token = new URL(response.value.mediaUrl).searchParams.get('token');
  assert.equal(codec.decode(token, mediaSecret).url, privateUrl);
});

test('tokens are authenticated and bound to the configured secret', () => {
  const token = codec.encode(payload, secret);
  assert.equal(codec.decode(token, crypto.randomBytes(48).toString('hex')), null);
  const parts = token.split('.');
  parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
  assert.equal(codec.decode(parts.join('.'), secret), null);
  assert.equal(codec.decode(token.slice(0, -1), secret), null);
});

test('a media URL can be recovered by a fresh Node process after restart', () => {
  const modulePath = path.resolve(__dirname, '../webos/fidelity/api/lib/media-token.js');
  const env = Object.assign({}, process.env, { MEDIA_TOKEN_SECRET: secret });
  const issue = spawnSync(process.execPath, ['-e',
    "const c=require(process.argv[1]);const p=JSON.parse(process.argv[2]);const t=c.encode(p,process.env.MEDIA_TOKEN_SECRET);if(!t)process.exit(2);process.stdout.write(t)",
    modulePath, JSON.stringify(payload)], { encoding: 'utf8', env });
  assert.equal(issue.status, 0, issue.stderr);
  assert.ok(issue.stdout.startsWith('v1.'));

  const recover = spawnSync(process.execPath, ['-e',
    "const c=require(process.argv[1]);const p=c.decode(process.argv[2],process.env.MEDIA_TOKEN_SECRET);if(!p)process.exit(2);process.stdout.write(JSON.stringify(p))",
    modulePath, issue.stdout], { encoding: 'utf8', env });
  assert.equal(recover.status, 0, recover.stderr);
  assert.deepEqual(JSON.parse(recover.stdout), payload);
});

test('invalid secret, payload, and oversized data cannot mint a token', () => {
  assert.equal(codec.encode(payload, 'short'), '');
  assert.equal(codec.encode({ ...payload, hosts: [] }, secret), '');
  assert.equal(codec.encode({ ...payload, headers: { x: 'x'.repeat(20 * 1024) } }, secret), '');
});
