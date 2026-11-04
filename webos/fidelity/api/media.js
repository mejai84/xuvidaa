'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const dnsx = require('./lib/dnsx');
const configuredHosts = new Set((process.env.MEDIA_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
const secret = process.env.MEDIA_TOKEN_SECRET || process.env.XUPER_MEDIA_SECRET || '';

function reply(res, status, message) {
  res.status(status).setHeader('Cache-Control', 'no-store');
  return res.json({ error: message });
}

module.exports = function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!secret) return reply(res, 503, 'Media relay no configurado');
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Método no permitido');
  const pieces = String(req.query.token || '').split('.');
  if (pieces.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(pieces[0])) return reply(res, 400, 'Token inválido');
  const expected = crypto.createHmac('sha256', secret).update(pieces[0]).digest();
  let supplied;
  try { supplied = Buffer.from(pieces[1], 'base64url'); } catch (_) { return reply(res, 400, 'Token inválido'); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return reply(res, 403, 'Token inválido');

  let entry, url;
  try {
    entry = JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8'));
    url = new URL(entry.url);
  } catch (_) { return reply(res, 400, 'Token inválido'); }
  const subtitleIndex = req.query.subtitle;
  if (subtitleIndex !== undefined) {
    const index = Number(subtitleIndex);
    const subtitle = Number.isInteger(index) && index >= 0 && index < (entry.subtitles || []).length ? entry.subtitles[index] : null;
    if (!subtitle || !subtitle.url) return reply(res, 404, 'Subtítulo no encontrado');
    let subtitleUrl;
    try { subtitleUrl = new URL(subtitle.url); } catch (_) { return reply(res, 400, 'URL de subtítulo inválida'); }
    if (subtitleUrl.protocol !== 'https:' || !(entry.hosts || []).includes(subtitleUrl.hostname.toLowerCase())) return reply(res, 403, 'CDN de subtítulos no permitido');
    const subtitleRequest = https.get(subtitleUrl, { headers: Object.assign({}, entry.headers || {}) }, (remote) => {
      if (remote.statusCode < 200 || remote.statusCode >= 300) { remote.resume(); return reply(res, 502, 'No se pudo descargar el subtítulo'); }
      const chunks = [];
      let size = 0;
      remote.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { subtitleRequest.destroy(new Error('subtitle too large')); return; }
        chunks.push(chunk);
      });
      remote.on('end', () => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'private, no-store');
        res.status(200).send(Buffer.concat(chunks).toString('utf8'));
      });
    });
    subtitleRequest.on('error', () => { if (!res.headersSent) reply(res, 502, 'No se pudo leer el subtítulo'); });
    subtitleRequest.setTimeout(15000, () => subtitleRequest.destroy(new Error('timeout')));
    return;
  }
  const child = String(req.query.child || '');
  if (child) {
    let childUrl;
    try { childUrl = new URL(child, url); } catch (_) { return reply(res, 400, 'Segmento inválido'); }
    const childHost = childUrl.hostname.toLowerCase();
    if (!Number.isFinite(entry.exp) || entry.exp < Date.now()) return reply(res, 410, 'Token vencido');
    if ((childUrl.protocol !== 'https:' && !(childUrl.protocol === 'http:' && (childHost.endsWith('.cachefly.net') || childHost === 'cachefly.net'))) || !(entry.hosts || []).includes(childHost)) return reply(res, 403, 'Segmento no permitido');
    url = childUrl;
  }
  const streamHost = url.hostname.toLowerCase();
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && (streamHost.endsWith('.cachefly.net') || streamHost === 'cachefly.net'))) || !(entry.hosts || []).includes(streamHost)) return reply(res, 403, 'CDN no permitido');
  if (!Number.isFinite(entry.exp) || entry.exp < Date.now()) return reply(res, 410, 'Token vencido');

  if (req.query.manifest === '1') {
    const manifest = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:86400\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:86400.0,\n/api/media?token=' + encodeURIComponent(req.query.token) + '&child=' + encodeURIComponent(url.toString()) + '\n#EXT-X-ENDLIST\n';
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(manifest);
  }

  const headers = Object.assign({}, entry.headers || {}, { Host: url.host, Connection: 'close' });
  const requestModule = url.protocol === 'http:' ? http : https;
  if (req.headers.range) headers.Range = String(req.headers.range).slice(0, 200);
  if (req.headers['if-range']) headers['If-Range'] = String(req.headers['if-range']).slice(0, 200);
  const requestOptions = { method: req.method, headers: headers, timeout: 25000, protocol: url.protocol, hostname: url.hostname, port: url.port || (url.protocol === 'http:' ? 80 : 443), path: url.pathname + url.search, servername: url.protocol === 'https:' ? url.hostname : undefined };
  const begin = (options) => {
  const upstream = requestModule.request(options, (remote) => {
    if ([301, 302, 303, 307, 308].includes(remote.statusCode)) {
      remote.resume(); return reply(res, 502, 'CDN redirigió la fuente');
    }
    const out = {
      'Content-Type': remote.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': remote.headers['accept-ranges'] || 'bytes',
      'Access-Control-Allow-Origin': '*'
    };
    if (remote.headers['content-length']) out['Content-Length'] = remote.headers['content-length'];
    if (remote.headers['content-range']) out['Content-Range'] = remote.headers['content-range'];
    const contentType = String(remote.headers['content-type'] || '');
    if (!child && (/mpegurl/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(url.pathname + url.search))) {
      const chunks = [];
      remote.on('data', (chunk) => chunks.push(chunk));
      remote.on('end', () => {
        let manifest;
        try { manifest = Buffer.concat(chunks).toString('utf8').split(/\r?\n/).map((line) => {
          if (!line) return line;
          if (line.charAt(0) === '#') return line.replace(/URI=("|')([^"']+)\1/g, (all, quote, ref) => 'URI=' + quote + '/api/media?token=' + encodeURIComponent(req.query.token) + '&child=' + encodeURIComponent(new URL(ref, url).toString()) + quote);
          return '/api/media?token=' + encodeURIComponent(req.query.token) + '&child=' + encodeURIComponent(new URL(line, url).toString());
        }).join('\n'); } catch (_) { return reply(res, 502, 'Manifiesto contiene URLs no válidas'); }
        delete out['Content-Length'];
        out['Content-Type'] = 'application/vnd.apple.mpegurl';
        res.writeHead(remote.statusCode || 502, out);
        res.end(manifest);
      });
      return;
    }
    res.writeHead(remote.statusCode || 502, out);
    if (req.method === 'HEAD') { remote.resume(); return res.end(); }
    remote.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => { if (!res.headersSent) reply(res, 502, 'No se pudo leer el medio'); else res.destroy(); });
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy();
  });
  upstream.end();
  };
  if (url.hostname.toLowerCase().endsWith('.cachefly.net') || url.hostname.toLowerCase() === 'cachefly.net') {
    dnsx.prepare(requestOptions, (err, options) => { if (err) return reply(res, 502, 'No se pudo resolver el CDN de TV'); begin(options); });
  } else { begin(requestOptions); }
};
