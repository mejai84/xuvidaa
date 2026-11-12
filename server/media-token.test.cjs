'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const codec = require('./api/lib/media-token.js');

const secret = crypto.randomBytes(48).toString('hex');
const payload = {
  url: 'https://media.example.test/movie.mp4?private=not-for-client',
  hosts: ['media.example.test'],
  headers: { Authorization: 'Bearer confidential-value' },
  mime: 'video/mp4',
  subtitles: [],
  exp: Date.now() + 60000
};

test('AES-GCM media token encrypts URL and upstream headers', () => {
  const token = codec.encode(payload, secret);
  assert.match(token, /^v1\./);
  assert.doesNotMatch(token, /media\.example|confidential|private|Bearer|Authorization/);
  assert.deepEqual(codec.decode(token, secret), payload);
});

test('tampered token, wrong secret, invalid token version and weak secret fail closed', () => {
  const token = codec.encode(payload, secret);
  assert.equal(codec.decode(token, 'wrong-secret'.repeat(6)), null);
  assert.equal(codec.encode(payload, 'short'), '');
  assert.equal(codec.decode(token.replace(/^v1/, 'v2'), secret), null);
  const parts = token.split('.');
  parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1);
  assert.equal(codec.decode(parts.join('.'), secret), null);
});

test('token can be decrypted after Node restart without storing secrets in catalog cache', () => {
  const token = codec.encode(payload, secret);
  const modulePath = path.resolve(__dirname, 'api/lib/media-token.js');
  const result = spawnSync(process.execPath,
    ['-e', 'const m=require(process.argv[1]);process.stdout.write(JSON.stringify(m.decode(process.argv[2], process.env.MEDIA_TOKEN_SECRET)));',
      modulePath, token],
    { encoding: 'utf8', env: { ...process.env, MEDIA_TOKEN_SECRET: secret }, timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), payload);
});

test('invalid payload cannot be signed or recovered', () => {
  assert.equal(codec.encode({ url: 'https://media.example.test/file', hosts: [], headers: {}, exp: Date.now() }, secret), '');
  assert.equal(codec.decode('not-a-valid-token', secret), null);
});
