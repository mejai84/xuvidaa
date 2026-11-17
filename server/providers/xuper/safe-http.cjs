'use strict';

const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');

// Catalog imports are a server-side boundary. Resolve once, reject the entire
// answer if it contains a private address, then pin the socket to that answer.
function isPublicAddress(raw) {
  const value = String(raw || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(value)) {
    const [a, b, c] = value.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (!net.isIPv6(value)) return false;
  // Only ordinary globally routed IPv6 is supported. In particular reject
  // mapped IPv4, translation/tunnelling ranges and documentation addresses.
  const first = Number.parseInt(value.split(':')[0], 16);
  const second = Number.parseInt(value.split(':')[1] || '0', 16);
  return (first & 0xe000) === 0x2000 && first !== 0x2002 && first !== 0x3fff &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8));
}

function validateUrl(raw, allowedHosts) {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('PROVIDER_DESTINATION_BLOCKED');
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const literal = host.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || host === 'localhost' ||
      /\.(?:local|internal|lan|corp|localhost|home|test|invalid)$/.test(host) ||
      (net.isIP(literal) && !isPublicAddress(literal)) ||
      (allowedHosts && !allowedHosts.includes(host))) throw new Error('PROVIDER_DESTINATION_BLOCKED');
  return url;
}

async function resolveDestination(url, lookup = dns.lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await lookup(host, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
    throw new Error('PROVIDER_DESTINATION_BLOCKED');
  }
  const selected = addresses.find((item) => item.family === 4) || addresses[0];
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (hostname !== host) return callback(new Error('PROVIDER_DESTINATION_BLOCKED'));
    if (options && options.all) return callback(null, [{ address: selected.address, family: selected.family }]);
    callback(null, selected.address, selected.family);
  };
}

function deadline(promise, milliseconds) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PROVIDER_TIMEOUT')), milliseconds); })])
    .finally(() => clearTimeout(timer));
}

async function fetchText(raw, options = {}) {
  const url = validateUrl(raw, options.allowedHosts);
  const timeout = options.timeout || 20000;
  const lookup = await deadline(resolveDestination(url, options.lookup), Math.min(timeout, 5000));
  const maxBytes = options.maxBytes || 32 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let done = false;
    let timer;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(new Error('PROVIDER_FETCH_FAILED'));
      else resolve(value);
    };
    const request = (options.request || https.request)(url, {
      method: 'GET', lookup, rejectUnauthorized: true,
      headers: { 'User-Agent': 'TVVIDAA-Xuper/1.0', 'Accept-Encoding': 'identity', ...(options.headers || {}) }
    }, (response) => {
      // Redirects deliberately do not carry credentials to another origin.
      if (response.statusCode < 200 || response.statusCode >= 300 ||
          (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') ||
          Number(response.headers['content-length'] || 0) > maxBytes) {
        response.resume(); request.destroy(); finish(new Error('PROVIDER_FETCH_FAILED')); return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(); finish(new Error('PROVIDER_TOO_LARGE')); return; }
        chunks.push(chunk);
      });
      response.on('error', finish);
      response.on('aborted', () => finish(new Error('PROVIDER_FETCH_FAILED')));
      response.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
    });
    timer = setTimeout(() => { request.destroy(); finish(new Error('PROVIDER_TIMEOUT')); }, timeout);
    request.on('error', finish);
    request.end();
  });
}

module.exports = { isPublicAddress, validateUrl, resolveDestination, fetchText };
