'use strict';

const crypto = require('crypto');

const VERSION = 'v1';
const AAD = Buffer.from('xuvidaa-media-token:v1', 'utf8');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_TOKEN_CHARS = 24 * 1024;
const MAX_PAYLOAD_BYTES = 16 * 1024;

function keyFor(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) return null;
  return crypto.createHash('sha256')
    .update('xuvidaa-media-token-key:v1\0', 'utf8')
    .update(secret, 'utf8')
    .digest();
}

function validPayload(payload) {
  return !!payload && typeof payload === 'object' && !Array.isArray(payload) &&
    typeof payload.url === 'string' && payload.url.length > 0 && payload.url.length <= 8192 &&
    Array.isArray(payload.hosts) && payload.hosts.length > 0 && payload.hosts.length <= 64 &&
    payload.hosts.every((host) => typeof host === 'string' && host.length > 0 && host.length <= 253) &&
    !!payload.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers) &&
    Number.isFinite(payload.exp) &&
    (payload.subtitles === undefined || (Array.isArray(payload.subtitles) && payload.subtitles.length <= 64));
}

function encode(payload, secret) {
  const key = keyFor(secret);
  if (!key || !validPayload(payload)) return '';
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  if (plain.length > MAX_PAYLOAD_BYTES) return '';
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [VERSION, iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

function decodePart(value, maxBytes) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length > maxBytes || decoded.toString('base64url') !== value) return null;
  return decoded;
}

function decode(token, secret) {
  const key = keyFor(secret);
  if (!key || typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const iv = decodePart(parts[1], IV_BYTES);
  const encrypted = decodePart(parts[2], MAX_PAYLOAD_BYTES);
  const tag = decodePart(parts[3], TAG_BYTES);
  if (!iv || iv.length !== IV_BYTES || !encrypted || !encrypted.length || !tag || tag.length !== TAG_BYTES) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    if (plain.length > MAX_PAYLOAD_BYTES) return null;
    const payload = JSON.parse(plain.toString('utf8'));
    return validPayload(payload) ? payload : null;
  } catch (_) {
    return null;
  }
}

module.exports = { encode, decode };
