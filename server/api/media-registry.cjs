'use strict';
// Media URLs, credential-bearing provider paths and HLS child URLs live only
// in this server's memory. The browser receives an encrypted, opaque ref.
const crypto = require('node:crypto');
const codec = require('./lib/media-token.js');
const {permittedMediaOrigin} = require('./lib/vod-origin-policy.cjs');
const pool = new Map();
const MAX_ENTRIES = 25000;
const DEFAULT_TTL = 8 * 60 * 60 * 1000;
const secret = () => process.env.MEDIA_TOKEN_SECRET || '';

function clean() {
  const now = Date.now();
  for (const [id, entry] of pool) if (entry.exp < now) pool.delete(id);
  while (pool.size >= MAX_ENTRIES) pool.delete(pool.keys().next().value);
}
function register(entry, until) {
  const exp = Math.min(Number(until) || (Date.now() + DEFAULT_TTL), Date.now() + DEFAULT_TTL);
  if (!entry || typeof entry.url !== 'string' || !secret() || exp <= Date.now()) return null;
  const url = new URL(entry.url);
  if (!permittedMediaOrigin(url)) return null;
  const hosts = Array.isArray(entry.hosts) ? entry.hosts.map(x=>String(x).toLowerCase()) : [];
  if (!hosts.includes(url.hostname.toLowerCase())) return null;
  clean();
  const id = crypto.randomBytes(20).toString('hex');
  pool.set(id, {url:url.toString(),hosts:hosts,
    mime:entry.mime || 'application/octet-stream',
    headers:entry.headers || {},duration:entry.duration||0,exp});
  const token = codec.encode({ref:id, exp}, secret());
  if (!token) {pool.delete(id);return null;}
  return {token,exp};
}
function lookup(token) {
  const signed = codec.decode(String(token || ''), secret());
  if (!signed || typeof signed.ref !== 'string' || !/^[0-9a-f]{40}$/.test(signed.ref) ||
    !Number.isFinite(signed.exp) || signed.exp < Date.now()) return null;
  const entry = pool.get(signed.ref);
  if (!entry || entry.exp < Date.now() || entry.exp !== signed.exp) return null;
  return entry;
}
function clearForTest() {pool.clear();}
module.exports={register,lookup,clearForTest};
