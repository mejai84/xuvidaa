'use strict';

const https = require('https');
const http = require('http');
const dns = require('node:dns');
const net = require('node:net');
const mediaTokenCodec = require('./lib/media-token');
const registry = require('./media-registry.cjs');
const secret = process.env.MEDIA_TOKEN_SECRET || '';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

function mediaBase() {
  const configured = process.env.PUBLIC_BASE_URL || process.env.PUBLIC_ORIGIN;
  if (!configured) return '';
  const parsed = new URL(configured);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('Invalid public base');
  }
  return parsed.origin;
}

function reply(res, status, message) {
  res.status(status).setHeader('Cache-Control', 'no-store');
  return res.json({ error: message });
}

module.exports = function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = req.headers.origin;
  if (origin) {
    let parsed;
    try { parsed = new URL(origin); } catch (_) { return reply(res, 403, 'Origen no permitido'); }
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.host !== req.headers.host) {
      return reply(res, 403, 'Origen no permitido');
    }
  }
  if (!secret) return reply(res, 503, 'Media relay no configurado');
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Método no permitido');
  const signed = mediaTokenCodec.decode(String(req.query.token || ''), secret);
  if (!signed) return reply(res, 403, 'Token inválido');
  const entry = signed.ref ? registry.lookup(String(req.query.token || '')) : signed;
  if (!entry) return reply(res, 410, 'Referencia de video vencida');
  // New tokens carry only a random reference and expiry; the original URL and
  // upstream credentials never appear in the browser, including HLS segments.
  let url;
  try { url = new URL(entry.url); }
  catch (_) { return reply(res, 400, 'Token inválido'); }
  if (!Number.isFinite(entry.exp) || entry.exp < Date.now()) return reply(res, 410, 'Token vencido');
  let base;
  try { base = mediaBase(); } catch (_) { return reply(res, 503, 'URL pública del servicio no configurada correctamente'); }
  const reference = (source) => {
    // An HLS playlist may refer to variants, segments and key URIs.
    // Do not expose these URLs through the 'child' query (they may contain
    // credentials). Register each reference in the private memory registry.
    const child = new URL(source, url);
    if (child.protocol !== 'https:' || child.username || child.password ||
      (child.port && child.port !== '443') ||
      !(entry.hosts || []).includes(child.hostname.toLowerCase())) {
      throw new Error('Segmento fuera del proveedor autorizado');
    }
    const issued = registry.register({
      url:child.toString(),hosts:entry.hosts,mime:'application/octet-stream',
      headers:entry.headers || {},duration:entry.duration||0
    },entry.exp);
    if (!issued) throw new Error('No se pudo registrar el segmento');
    return base + '/api/media?token=' + encodeURIComponent(issued.token);
  };
  // Only HTTPS public IPTV origins are accepted in the dedicated VIDAA web runtime.
  const subtitleIndex = req.query.subtitle;
  if (subtitleIndex !== undefined) {
    const index = Number(subtitleIndex);
    const subtitle = Number.isInteger(index) && index >= 0 && index < (entry.subtitles || []).length ? entry.subtitles[index] : null;
    if (!subtitle || !subtitle.url) return reply(res, 404, 'Subtítulo no encontrado');
    let subtitleUrl;
    try { subtitleUrl = new URL(subtitle.url); } catch (_) { return reply(res, 400, 'URL de subtítulo inválida'); }
    if (subtitleUrl.protocol !== 'https:' || subtitleUrl.username || subtitleUrl.password || !(entry.hosts || []).includes(subtitleUrl.hostname.toLowerCase())) return reply(res, 403, 'CDN de subtítulos no permitido');
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
    if (childUrl.protocol !== 'https:' || childUrl.username || childUrl.password || !(entry.hosts || []).includes(childHost)) return reply(res, 403, 'Segmento no permitido');
    url = childUrl;
  }
  const streamHost = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || !(entry.hosts || []).includes(streamHost))
    return reply(res, 403, 'CDN no permitido');

  const hlsSource = /mpegurl/i.test(entry.mime || '') || /\.m3u8$/i.test(url.pathname);
  if (!child && req.query.manifest === '1' && !hlsSource && /video\/mp2t|\.ts$/i.test(entry.mime || url.pathname)) {
    const duration = Number.isFinite(entry.duration) && entry.duration > 0 ? entry.duration : 86400;
    let childReference;
    try { childReference = reference(url.toString()); }
    catch (_) { return reply(res, 403, 'Fuente no permitida'); }
    const manifest = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:' + Math.ceil(duration) + '\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:' + duration + ',\n' + childReference + '\n#EXT-X-ENDLIST\n';
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(req.method === 'HEAD' ? '' : manifest);
  }

  const headers = Object.assign({}, entry.headers || {}, { Host: url.host, Connection: 'close' });
  const requestModule = https;
  if (req.headers.range) headers.Range = String(req.headers.range).slice(0, 200);
  if (req.headers['if-range']) headers['If-Range'] = String(req.headers['if-range']).slice(0, 200);
  const requestOptions = { method: req.method, headers: headers, timeout: 25000, protocol: 'https:', hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, servername: url.hostname };
  const begin = (options) => {
  const upstream = requestModule.request(options, (remote) => {
    if ([301, 302, 303, 307, 308].includes(remote.statusCode)) {
      remote.resume(); return reply(res, 502, 'CDN redirigió la fuente');
    }
    const out = {
      'Content-Type': remote.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': remote.headers['accept-ranges'] || 'bytes'
    };
    if (remote.headers['content-length']) out['Content-Length'] = remote.headers['content-length'];
    if (remote.headers['content-range']) out['Content-Range'] = remote.headers['content-range'];
    const contentType = String(remote.headers['content-type'] || '');
    if (req.method === 'HEAD') {
      res.writeHead(remote.statusCode || 502, out);
      remote.resume();
      return res.end();
    }
    if (/mpegurl/i.test(contentType) || /\.m3u8$/i.test(url.pathname)) {
      if (remote.statusCode < 200 || remote.statusCode >= 300) {
        remote.resume(); return reply(res, 502, 'No se pudo descargar el manifiesto');
      }
      const chunks = [];
      let size = 0;
      let failed = false;
      const fail = () => {
        if (failed || res.writableEnded || res.destroyed) return;
        failed = true;
        if (!res.headersSent) reply(res, 502, 'No se pudo leer el manifiesto');
        else res.destroy();
        upstream.destroy();
      };
      remote.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_MANIFEST_BYTES) { fail(); return; }
        if (!failed) chunks.push(chunk);
      });
      remote.on('error', fail);
      remote.on('aborted', fail);
      remote.on('end', () => {
        if (failed || res.writableEnded || res.destroyed) return;
        let manifest;
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          if (!/^\s*#EXTM3U(?:\s|$)/.test(body)) return fail();
          manifest = body.split(/\r?\n/).map((line) => {
          if (!line) return line;
          if (line.charAt(0) === '#') return line.replace(/URI=("|')([^"']+)\1/g, (all, quote, ref) => 'URI=' + quote + reference(new URL(ref, url).toString()) + quote);
          return reference(new URL(line, url).toString());
        }).join('\n'); } catch (_) { return reply(res, 502, 'Manifiesto contiene URLs no válidas'); }
        delete out['Content-Length'];
        out['Content-Type'] = 'application/vnd.apple.mpegurl';
        res.writeHead(remote.statusCode || 502, out);
        res.end(manifest);
      });
      return;
    }
    res.writeHead(remote.statusCode || 502, out);
    remote.on('error', () => res.destroy());
    remote.on('aborted', () => res.destroy());
    remote.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => { if (!res.headersSent) reply(res, 502, 'No se pudo leer el medio'); else res.destroy(); });
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy();
  });
  upstream.end();
  };
  // Resolve and pin a public IPv4 address before opening the upstream socket.
  // Reject local, carrier/private, metadata, reserved and multicast ranges.
  dns.lookup(url.hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error || !addresses || !addresses.length) return reply(res, 502, 'No se pudo resolver el canal');
    function publicIPv4(value) {
      if (net.isIP(value) !== 4) return false;
      const a = value.split('.').map(Number);
      return !(a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224 ||
        (a[0] === 100 && a[1] >= 64 && a[1] <= 127) ||
        (a[0] === 169 && a[1] === 254) ||
        (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
        (a[0] === 192 && (a[1] === 168 || a[1] === 0)) ||
        (a[0] === 198 && (a[1] === 18 || a[1] === 19)) ||
        (a[0] === 192 && a[1] === 0 && a[2] === 2) ||
        (a[0] === 198 && a[1] === 51 && a[2] === 100) ||
        (a[0] === 203 && a[1] === 0 && a[2] === 113));
    }
    // We pin an IPv4 socket. Ignore ordinary public IPv6 answers, but never
    // connect to IPv6 or a private/reserved IPv4 address.
    const ipv4 = addresses.filter(a => a.family === 4);
    if (!ipv4.length) return reply(res, 502, 'Este CDN solo tiene conectividad IPv6');
    if (ipv4.some(a => !publicIPv4(a.address))) return reply(res, 403, 'Origen de red restringido');
    const ip = ipv4[0].address;
    const opts = Object.assign({}, requestOptions, {
      lookup: (_hostname, _options, cb) => cb(null, ip, 4)
    });
    begin(opts);
  });
};
