'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns');
const events = require('node:events');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { URL } = require('node:url');

// The upstream portal and media modules may log diagnostic URLs. Keep them
// quiet so signed source URLs, request headers and opaque playback paths never
// reach container logs.
const quietConsole = () => {};
console.log = quietConsole;
console.info = quietConsole;
console.warn = quietConsole;
console.error = quietConsole;

const upstreamDir = `${__dirname}/upstream`;
const dnsx = require(`${upstreamDir}/dnsx`);
const magis = require(`${upstreamDir}/magis`);
const mediaProxy = require(`${upstreamDir}/proxy`);

const port = 8081;
const maxBodyBytes = 16 * 1024;
const sessionCookie = 'xuvidaa_session';
const sessionLifetimeSeconds = 8 * 60 * 60;
const mediaLifetimeMs = 60 * 60 * 1000;
const publicOrigin = 'https://tv.rfcsas.com';
const mediaRecords = new Map();
const artworkRecords = new Map();
const artworkTokens = new Map();
const loginAttempts = new Map();
const artworkFields = new Set(['poster', 'landscape', 'backdrop', 'logo', 'picture']);
const safeFields = new Set([
  'items', 'results', 'channels', 'categories', 'data', 'item', 'episodes', 'seasons',
  'total', 'page', 'pageNum', 'pageSize', 'title', 'name', 'id', 'contentId',
  'channelCode', 'columnId', 'season', 'episode', 'seasonNumber', 'episodeNumber',
  'lang', 'format', 'duration', 'root', 'cached', 'category', 'kind', 'score',
  'year', 'genres', 'director', 'actors', 'synopsis', 'type', 'alias', 'country',
  'releaseDate', 'tagline', 'volumeCount', 'updateCount', 'moreAudio',
  'moreSubtitle', 'row', 'index', 'uhd', 'fav', 'now', 'next', 'time', 'number',
  'quality', 'description'
]);

const accessPassword = process.env.XUVIDAA_WEB_PASSWORD;
if (!accessPassword || Buffer.byteLength(accessPassword) < 14) {
  process.stderr.write('XUVIDAA_WEB_PASSWORD must be a private API-service variable with at least 14 characters.\n');
  process.exit(1);
}

// The upstream module can otherwise download and randomly adopt a session seed
// from a third-party repository. Block only that exact path; normal portal and
// CDN HTTPS requests continue through Node's original HTTPS implementation.
const originalHttpsRequest = https.request;
https.request = function guardedHttpsRequest(options, ...args) {
  const requestPath = typeof options === 'string'
    ? new URL(options).pathname
    : String((options && (options.path || options.pathname)) || '');
  if (requestPath.includes('/xuper-plugin/kino-plugin-xuper/seeds/seeds.json')) {
    const blocked = new events.EventEmitter();
    blocked.setTimeout = function setTimeout() { return blocked; };
    blocked.write = function write() { return true; };
    blocked.end = function end() {
      process.nextTick(() => blocked.emit('error', new Error('Remote session seeds are disabled')));
      return blocked;
    };
    blocked.destroy = function destroy() { return blocked; };
    blocked.abort = function abort() { return blocked.destroy(); };
    return blocked;
  }
  return originalHttpsRequest.call(https, options, ...args);
};

let proxyStart;
let portalReady = false;
let portalStart;

function ensureMediaProxy() {
  if (!proxyStart) {
    proxyStart = new Promise((resolve, reject) => {
      mediaProxy.start((err) => (err ? reject(err) : resolve()));
    });
  }
  return proxyStart;
}

function ensurePortalSession() {
  if (portalReady) return Promise.resolve();
  if (!portalStart) {
    portalStart = new Promise((resolve, reject) => {
      magis.ensureSession((err) => {
        if (err) {
          portalStart = null;
          reject(err);
          return;
        }
        portalReady = true;
        resolve();
      });
    });
  }
  return portalStart;
}

function signSession(expiry) {
  return crypto.createHmac('sha256', accessPassword)
    .update(String(expiry))
    .digest('base64url');
}

function sessionExpiry(req) {
  const cookieHeader = req.headers.cookie || '';
  const encoded = cookieHeader.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${sessionCookie}=`));
  if (!encoded) return null;

  const value = encoded.slice(sessionCookie.length + 1);
  const separator = value.indexOf('.');
  if (separator < 1) return null;
  const expiryText = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!/^\d{10,}$/.test(expiryText)) return null;

  const expected = Buffer.from(signSession(expiryText));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;

  const expiry = Number(expiryText);
  return expiry > Math.floor(Date.now() / 1000) ? expiry : null;
}

function sendJson(res, status, value, headers) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(headers || {})
  });
  res.end(body);
}

function sendError(res, status, code) {
  sendJson(res, status, { error: code });
}

function sanitizePortalData(value) {
  if (Array.isArray(value)) return value.map(sanitizePortalData);
  if (!value || typeof value !== 'object') return value;
  const safe = {};
  for (const [key, item] of Object.entries(value)) {
    if (artworkFields.has(key)) safe[key] = registerArtwork(item);
    else if (safeFields.has(key)) safe[key] = sanitizePortalData(item);
  }
  return safe;
}

function publicIpv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

function registerArtwork(value) {
  if (typeof value !== 'string' || value.length > 8192) return '';
  let url;
  try { url = new URL(value); } catch (_) { return ''; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) ||
      (net.isIP(url.hostname) && !publicIpv4(url.hostname))) return '';
  const now = Date.now();
  for (const [token, record] of artworkRecords) {
    if (record.expiresAt <= now) {
      artworkRecords.delete(token);
      artworkTokens.delete(record.url);
    }
  }
  const existing = artworkTokens.get(url.href);
  if (existing) return `/api/image/${existing}`;
  while (artworkRecords.size >= 1024) {
    const oldest = artworkRecords.keys().next().value;
    artworkTokens.delete(artworkRecords.get(oldest).url);
    artworkRecords.delete(oldest);
  }
  const token = crypto.randomBytes(12).toString('hex');
  artworkRecords.set(token, { url: url.href, expiresAt: now + sessionLifetimeSeconds * 1000 });
  artworkTokens.set(url.href, token);
  return `/api/image/${token}`;
}

async function serveArtwork(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED');
  }
  const match = /^\/api\/image\/([a-f0-9]{24})$/.exec(pathname);
  const record = match && artworkRecords.get(match[1]);
  if (!record || record.expiresAt <= Date.now()) return sendError(res, 404, 'IMAGE_UNAVAILABLE');
  let addresses;
  const url = new URL(record.url);
  try {
    addresses = await dns.promises.lookup(url.hostname, { family: 4, all: true });
    if (!addresses.length || addresses.some((entry) => !publicIpv4(entry.address))) throw new Error('private address');
  } catch (_) { return sendError(res, 502, 'IMAGE_UNAVAILABLE'); }
  if (res.destroyed) return;
  const transport = url.protocol === 'https:' ? https : http;
  const upstreamRequest = transport.request({
    hostname: addresses[0].address,
    servername: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method: req.method,
    headers: { Host: url.host, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' }
  }, (upstream) => {
    const type = String(upstream.headers['content-type'] || '').split(';')[0].toLowerCase();
    if (upstream.statusCode !== 200 || !['image/avif', 'image/webp', 'image/png', 'image/jpeg', 'image/gif'].includes(type) ||
        Number(upstream.headers['content-length']) > 8 * 1024 * 1024) {
      upstream.destroy();
      return sendError(res, 502, 'IMAGE_UNAVAILABLE');
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (req.method === 'HEAD') { upstream.resume(); res.end(); return; }
    let bytes = 0;
    upstream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) { upstream.destroy(); res.destroy(); }
    });
    upstream.on('error', () => res.destroy());
    upstream.pipe(res);
  });
  upstreamRequest.setTimeout(15000, () => upstreamRequest.destroy(new Error('image timeout')));
  upstreamRequest.on('error', () => {
    if (!res.headersSent) sendError(res, 502, 'IMAGE_UNAVAILABLE');
    else res.destroy();
  });
  res.on('close', () => upstreamRequest.destroy());
  upstreamRequest.end();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let rejected = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        if (!rejected) reject(Object.assign(new Error('body limit'), { status: 413 }));
        rejected = true;
        return;
      }
      if (rejected) return;
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (_) {
        reject(Object.assign(new Error('invalid body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function textField(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null;
}

function intField(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function portalCall(res, method, args, transform) {
  ensurePortalSession().then(() => {
    const fn = magis[method];
    if (typeof fn !== 'function') {
      sendError(res, 501, 'PORTAL_METHOD_UNAVAILABLE');
      return;
    }
    fn(...args, (err, result) => {
      if (err) {
        sendError(res, 502, 'PORTAL_REQUEST_FAILED');
        return;
      }
      Promise.resolve(transform ? transform(result) : sanitizePortalData(result))
        .then((payload) => sendJson(res, 200, payload))
        .catch(() => sendError(res, 502, 'MEDIA_PROXY_FAILED'));
    });
  }).catch(() => sendError(res, 502, 'PORTAL_SESSION_UNAVAILABLE'));
}

function proxyLoopbackPath(localUrl, expectedPrefix) {
  try {
    const parsed = new URL(localUrl);
    if (parsed.hostname !== '127.0.0.1' || Number(parsed.port) !== Number(mediaProxy.port())) return null;
    if (!parsed.pathname.startsWith(expectedPrefix)) return null;
    return `/api${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return null;
  }
}

function safeSubtitle(subtitle) {
  if (!subtitle || typeof subtitle.url !== 'string') return null;
  const url = mediaProxy.addSubtitle(subtitle.url);
  const safeUrl = proxyLoopbackPath(url, '/sub/');
  if (!safeUrl) return null;
  return {
    lang: typeof subtitle.lang === 'string' ? subtitle.lang : '',
    format: typeof subtitle.format === 'string' ? subtitle.format : '',
    url: safeUrl
  };
}

function attachSafeSubtitles(value) {
  return ensureMediaProxy().then(() => {
    const subtitles = value && Array.isArray(value.subtitles) ? value.subtitles : [];
    return { subtitles: subtitles.map(safeSubtitle).filter(Boolean) };
  });
}

function registerStream(stream) {
  if (!stream || typeof stream.url !== 'string' || !stream.url) {
    return Promise.reject(new Error('stream unavailable'));
  }
  let parsed;
  try {
    parsed = new URL(stream.url);
  } catch (_) {
    return Promise.reject(new Error('invalid upstream stream'));
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    return Promise.reject(new Error('unsupported upstream stream'));
  }

  return ensureMediaProxy().then(() => new Promise((resolve) => {
    dnsx.resolve(parsed.hostname, (dnsErr, dnsResult) => {
      const resolvedIp = (dnsResult && dnsResult.ips && dnsResult.ips[0]) || '';
      const token = mediaProxy.add(
        stream.url,
        stream.headers || {},
        stream.duration,
        resolvedIp,
        stream.backupUrls
      );
      const origins = new Set([parsed.origin]);
      if (parsed.protocol === 'http:' && !parsed.port) origins.add(`https://${parsed.host}`);
      for (const backup of stream.backupUrls || []) {
        try {
          const alternate = new URL(backup);
          origins.add(alternate.origin);
          if (alternate.protocol === 'http:' && !alternate.port) origins.add(`https://${alternate.host}`);
        } catch (_) { /* unusable backup */ }
      }
      while (mediaRecords.size >= 6) mediaRecords.delete(mediaRecords.keys().next().value);
      mediaRecords.set(token, { expiresAt: Date.now() + mediaLifetimeMs, origins, hlsPaths: new Set() });
      const isHls = Boolean(stream.isHls) || /mpegurl/i.test(stream.mime || '') || /\.m3u8(?:$|\?)/i.test(stream.url);
      const extension = isHls ? 'm3u8' : stream.mime === 'video/mp4' ? 'mp4' : 'ts';
      const subtitles = Array.isArray(stream.subtitles)
        ? stream.subtitles.map(safeSubtitle).filter(Boolean)
        : [];
      resolve({
        playbackUrl: `/api/media/${token}/stream.${extension}`,
        mime: typeof stream.mime === 'string' ? stream.mime : 'application/octet-stream',
        codec: typeof stream.codec === 'string' ? stream.codec : '',
        duration: Number.isFinite(Number(stream.duration)) ? Number(stream.duration) : null,
        isHls,
        subtitles
      });
    });
  }));
}

function pruneMediaRecords() {
  const now = Date.now();
  for (const [token, record] of mediaRecords) {
    if (record.expiresAt <= now) mediaRecords.delete(token);
  }
}

function rewritePlaylist(source, token) {
  const record = mediaRecords.get(token);
  if (!record) throw new Error('expired media');
  const base = mediaProxy.baseUrl();
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const references = new RegExp(`${escaped}(/hls/([a-f0-9]{24})/([A-Za-z0-9_-]+))`, 'g');
  for (const match of source.matchAll(references)) {
    const target = new URL(Buffer.from(match[3], 'base64url').toString('utf8'));
    if (match[2] !== token || !record.origins.has(target.origin) || target.username || target.password) {
      throw new Error('untrusted playlist reference');
    }
    while (record.hlsPaths.size >= 4096 && !record.hlsPaths.has(match[1])) {
      record.hlsPaths.delete(record.hlsPaths.values().next().value);
    }
    record.hlsPaths.add(match[1]);
  }
  return source.split(base).join('/api');
}

function authorized(req) {
  return sessionExpiry(req) !== null;
}

function isSafeOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === publicOrigin;
}

function loginRateLimited(req) {
  // Nginx overwrites this private header using Traefik's verified X-Real-IP.
  // The API is reachable only through the private application network.
  const forwarded = req.headers['x-xuvidaa-client-ip'];
  const key = typeof forwarded === 'string' && net.isIP(forwarded)
    ? forwarded : req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  for (const [address, attempt] of loginAttempts) {
    if (now - attempt.startedAt >= 60_000) loginAttempts.delete(address);
  }
  const previous = loginAttempts.get(key);
  if (!previous || now - previous.startedAt >= 60_000) {
    loginAttempts.set(key, { startedAt: now, count: 1 });
    return false;
  }
  previous.count += 1;
  return previous.count > 10;
}

function forwardToLoopback(req, res, localPath) {
  const localRequest = http.request({
    hostname: '127.0.0.1',
    port: mediaProxy.port(),
    path: localPath,
    method: req.method,
    headers: {
      ...(req.headers.range ? { range: req.headers.range } : {}),
      ...(req.headers['if-range'] ? { 'if-range': req.headers['if-range'] } : {}),
      ...(req.headers['if-none-match'] ? { 'if-none-match': req.headers['if-none-match'] } : {}),
      ...(req.headers['if-modified-since'] ? { 'if-modified-since': req.headers['if-modified-since'] } : {})
    }
  }, (upstream) => {
    const headers = {};
    for (const name of [
      'accept-ranges', 'cache-control', 'content-length', 'content-range', 'content-type',
      'etag', 'last-modified'
    ]) {
      if (upstream.headers[name]) headers[name] = upstream.headers[name];
    }
    headers['Cache-Control'] = 'no-store';
    headers['X-Content-Type-Options'] = 'nosniff';
    res.statusCode = upstream.statusCode || 502;
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);

    const contentType = String(upstream.headers['content-type'] || '').toLowerCase();
    if (req.method !== 'HEAD' && (contentType.includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(localPath))) {
      const parts = [];
      let size = 0;
      upstream.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          upstream.destroy();
          if (!res.headersSent) sendError(res, 502, 'PLAYLIST_TOO_LARGE');
          return;
        }
        parts.push(chunk);
      });
      upstream.on('end', () => {
        try {
          const token = /^\/(?:media|hls)\/([a-f0-9]{24})\//.exec(localPath);
          const body = Buffer.from(rewritePlaylist(Buffer.concat(parts).toString('utf8'), token && token[1]));
          res.removeHeader('Content-Length');
          res.removeHeader('Content-Range');
          res.setHeader('Content-Length', body.length);
          res.end(body);
        } catch (_) {
          res.removeHeader('Content-Length');
          res.removeHeader('Content-Range');
          sendError(res, 502, 'INVALID_PLAYLIST');
        }
      });
      upstream.on('error', () => {
        if (!res.headersSent) sendError(res, 502, 'MEDIA_PROXY_FAILED');
        else res.destroy();
      });
      return;
    }

    if (req.method === 'HEAD') {
      upstream.resume();
      res.end();
      return;
    }
    upstream.pipe(res);
  });

  localRequest.on('error', () => {
    if (!res.headersSent) sendError(res, 502, 'MEDIA_PROXY_FAILED');
    else res.destroy();
  });
  res.on('close', () => {
    if (!res.writableEnded) localRequest.destroy();
  });
  localRequest.end();
}

function handleMedia(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    sendError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }
  const mediaMatch = pathname.match(/^\/api\/media\/([a-f0-9]{24})\/([^?#]+)$/);
  const hlsMatch = pathname.match(/^\/api\/hls\/([a-f0-9]{24})\/([A-Za-z0-9_-]{1,16384})$/);
  const subtitleMatch = pathname.match(/^\/api\/sub\/([a-f0-9]+\.srt)$/);
  let localPath;
  if (mediaMatch || hlsMatch) {
    pruneMediaRecords();
    const match = mediaMatch || hlsMatch;
    if (!mediaRecords.has(match[1])) {
      sendError(res, 410, 'MEDIA_EXPIRED');
      return;
    }
    localPath = `${hlsMatch ? '/hls' : '/media'}/${match[1]}/${match[2]}`;
    if (hlsMatch && !mediaRecords.get(match[1]).hlsPaths.has(localPath)) {
      sendError(res, 404, 'NOT_FOUND');
      return;
    }
  } else if (subtitleMatch) {
    localPath = `/sub/${subtitleMatch[1]}`;
  } else {
    sendError(res, 404, 'NOT_FOUND');
    return;
  }
  forwardToLoopback(req, res, localPath);
}

function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/session') {
    sendJson(res, 200, { authenticated: authorized(req) });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/login') {
    if (!isSafeOrigin(req)) return sendError(res, 403, 'ORIGIN_NOT_ALLOWED');
    if (loginRateLimited(req)) return sendError(res, 429, 'LOGIN_RATE_LIMITED');
    readJson(req).then((body) => {
      const submitted = typeof body.password === 'string' ? Buffer.from(body.password) : Buffer.alloc(0);
      const expected = Buffer.from(accessPassword);
      const matches = submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);
      if (!matches) {
        sendError(res, 401, 'LOGIN_FAILED');
        return;
      }
      const expiry = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds;
      const value = `${expiry}.${signSession(expiry)}`;
      sendJson(res, 200, { authenticated: true }, {
        'Set-Cookie': `${sessionCookie}=${value}; Path=/; Max-Age=${sessionLifetimeSeconds}; HttpOnly; Secure; SameSite=Strict`
      });
    }).catch((err) => sendError(res, err.status || 400, 'INVALID_REQUEST'));
    return;
  }
  if (req.method === 'POST' && pathname === '/api/logout') {
    if (!isSafeOrigin(req)) return sendError(res, 403, 'ORIGIN_NOT_ALLOWED');
    sendJson(res, 200, { authenticated: false }, {
      'Set-Cookie': `${sessionCookie}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
    });
    return;
  }
  if (pathname.startsWith('/api/image/')) {
    if (!authorized(req)) return sendError(res, 401, 'AUTH_REQUIRED');
    serveArtwork(req, res, pathname).catch(() => {
      if (!res.headersSent) sendError(res, 502, 'IMAGE_UNAVAILABLE');
      else res.destroy();
    });
    return;
  }
  if (pathname.startsWith('/api/media/') || pathname.startsWith('/api/hls/') || pathname.startsWith('/api/sub/')) {
    if (!authorized(req)) return sendError(res, 401, 'AUTH_REQUIRED');
    handleMedia(req, res, pathname);
    return;
  }
  if (!pathname.startsWith('/api/')) {
    sendError(res, 404, 'NOT_FOUND');
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendError(res, 405, 'METHOD_NOT_ALLOWED');
    return;
  }
  if (!authorized(req)) return sendError(res, 401, 'AUTH_REQUIRED');
  if (!isSafeOrigin(req)) return sendError(res, 403, 'ORIGIN_NOT_ALLOWED');

  readJson(req).then((body) => {
    const id = textField(body.contentId, 128);
    const seriesId = textField(body.seriesContentId, 128) || '';
    switch (pathname) {
      case '/api/home': {
        const root = textField(body.root, 32) || 'movies';
        return portalCall(res, 'home', [root]);
      }
      case '/api/search': {
        const value = typeof body.value === 'string' ? body.value.slice(0, 160) : '';
        return portalCall(res, 'search', [value]);
      }
      case '/api/detail':
        if (!id) return sendError(res, 400, 'CONTENT_ID_REQUIRED');
        return portalCall(res, 'detail', [id]);
      case '/api/media-info':
        if (!id) return sendError(res, 400, 'CONTENT_ID_REQUIRED');
        return portalCall(res, 'mediaInfo', [id, seriesId], attachSafeSubtitles);
      case '/api/resolve':
        if (!id) return sendError(res, 400, 'CONTENT_ID_REQUIRED');
        return portalCall(res, 'resolve', [id, seriesId, {
          trackIndex: intField(body.trackIndex, undefined, 0, 64)
        }], registerStream);
      case '/api/live/categories':
        return portalCall(res, 'getLiveCategories', []);
      case '/api/live/channels':
        return portalCall(res, 'getLiveChannels', [
          textField(body.columnId, 128) || null,
          intField(body.pageNum, 1, 1, 10000),
          intField(body.pageSize, 100, 1, 200)
        ]);
      case '/api/live/resolve': {
        const channelCode = textField(body.channelCode, 128);
        if (!channelCode) return sendError(res, 400, 'CHANNEL_CODE_REQUIRED');
        return portalCall(res, 'resolveLive', [channelCode], registerStream);
      }
      default:
        return sendError(res, 404, 'NOT_FOUND');
    }
  }).catch((err) => sendError(res, err.status || 400, 'INVALID_REQUEST'));
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, publicOrigin).pathname;
  } catch (_) {
    sendError(res, 400, 'INVALID_REQUEST');
    return;
  }
  if (req.method === 'GET' && pathname === '/healthz') {
    sendJson(res, 200, { healthy: true });
    return;
  }
  if (pathname.startsWith('/api/')) handleApi(req, res, pathname);
  else sendError(res, 404, 'NOT_FOUND');
});

server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;
server.listen(port, '0.0.0.0');
