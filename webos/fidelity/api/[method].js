'use strict';

const magis = require('./lib/magis');

const methods = new Set([
  'ping', 'keepAlive', 'heartbeat', 'home', 'search', 'detail', 'resolve',
  'resolveSmooth', 'mediaInfo', 'liveChannels', 'liveCategories', 'fetchM3u',
  'resolveLive', 'abortMedia', 'prewarm'
]);
const roots = new Set(['featured', 'movies', 'series', 'anime', 'kids', 'free']);
const limits = new Map();
const secret = process.env.MEDIA_TOKEN_SECRET || process.env.XUPER_MEDIA_SECRET || '';
const crypto = require('crypto');

function b64(value) { return Buffer.from(value).toString('base64url'); }
function sign(value) { return crypto.createHmac('sha256', secret).update(value).digest('base64url'); }
function tokenHosts(stream) {
  const configured = (process.env.MEDIA_ALLOWED_HOSTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const urls = [stream.url].concat(stream.backupUrls || [], (stream.subtitles || []).map((sub) => sub && sub.url));
  return Array.from(new Set(urls.map((value) => {
    try { const url = new URL(value); return (url.protocol === 'https:' || (url.protocol === 'http:' && (url.hostname.toLowerCase().endsWith('.cachefly.net') || url.hostname.toLowerCase() === 'cachefly.net'))) ? url.hostname.toLowerCase() : ''; } catch (_) { return ''; }
  }).filter(Boolean).concat(configured)));
}
function issueMediaToken(stream) {
  if (!secret || !stream || !/^https?:\/\//i.test(stream.url || '')) return '';
  const hosts = tokenHosts(stream);
  const payload = b64(JSON.stringify({
    url: stream.url, hosts: hosts, headers: stream.headers || {}, mime: stream.mime || '', subtitles: stream.subtitles || [], exp: Date.now() + 15 * 60 * 1000,
    session: crypto.randomBytes(12).toString('hex')
  }));
  return payload + '.' + sign(payload);
}

function reply(res, status, value) {
  res.status(status).setHeader('Cache-Control', 'no-store');
  return res.json(value);
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST' && req.method !== 'GET') {
    return reply(res, 405, { returnValue: false, errorText: 'Método no permitido' });
  }

  const method = String(req.query.method || '');
  if (!methods.has(method)) return reply(res, 404, { returnValue: false, errorText: 'Método desconocido' });

  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.host !== req.headers.host || parsed.protocol !== 'https:') {
        return reply(res, 403, { returnValue: false, errorText: 'Origen no permitido' });
      }
    } catch (_) { return reply(res, 403, { returnValue: false, errorText: 'Origen no permitido' }); }
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const rate = limits.get(ip) || { at: now, count: 0 };
  if (now - rate.at > 60000) { rate.at = now; rate.count = 0; }
  if (++rate.count > 90) return reply(res, 429, { returnValue: false, errorText: 'Demasiadas solicitudes' });
  limits.set(ip, rate);
  if (limits.size > 2000) limits.clear();

  const input = req.method === 'POST' ? (req.body || {}) : req.query;
  if (method === 'home' && !roots.has(String(input.root || 'movies'))) {
    return reply(res, 400, { returnValue: false, errorText: 'Sección inválida' });
  }
  if (method === 'search' && String(input.value || '').length > 120) {
    return reply(res, 400, { returnValue: false, errorText: 'Búsqueda demasiado larga' });
  }
  if (method === 'fetchM3u') return reply(res, 400, { returnValue: false, errorText: 'Las listas M3U requieren una fuente propia autorizada' });
  if (method === 'resolveSmooth' && String(req.headers['x-xuper-runtime'] || '') !== 'persistent') return reply(res, 501, { returnValue: false, errorText: 'Modo Fluido necesita FFmpeg en un servidor persistente; Vercel Functions no puede alojarlo.' });

  const done = (err, value) => {
    if (err) return reply(res, 502, { returnValue: false, errorText: String(err.message || err), errorCode: err.portalCode || 1 });
    return reply(res, 200, Object.assign({ returnValue: true }, value || {}));
  };

  try {
    if (method === 'ping' || method === 'heartbeat' || method === 'keepAlive') return done(null, { service: 'xuper-html', alive: true });
    if (method === 'home') return magis.home(String(input.root || 'movies'), done);
    if (method === 'search') return magis.search(String(input.value || ''), done);
    if (method === 'detail') return magis.detail(String(input.contentId || ''), done);
    if (method === 'resolve') {
      return magis.resolve(String(input.contentId || ''), String(input.seriesContentId || ''), { trackIndex: input.trackIndex }, (err, stream) => {
        if (err) return done(err);
        let mediaUrl;
        try { mediaUrl = new URL(stream.url); } catch (_) { return reply(res, 502, { returnValue: false, errorText: 'El portal devolvió una URL inválida.' }); }
        if (mediaUrl.protocol !== 'https:') {
          return reply(res, 503, { returnValue: false, errorText: 'El portal devolviÃ³ un host CDN no HTTPS.' });
        }
        const mediaToken = issueMediaToken(stream);
        if (!mediaToken) return reply(res, 503, { returnValue: false, errorText: 'Falta configurar MEDIA_TOKEN_SECRET para habilitar reproducción.' });
        const safe = {
          mime: stream.mime, codec: stream.codec, quality: stream.quality,
          duration: stream.duration, selectedTrack: stream.selectedTrack,
          availableTracks: stream.availableTracks, trackIndex: stream.trackIndex,
          audio: stream.audio, name: stream.name, isHls: /ts|mpegurl/i.test(stream.mime || ''), mediaToken,
          subtitles: (stream.subtitles || []).map((sub, index) => ({
            lang: sub.lang, format: sub.format,
            url: '/api/media?token=' + encodeURIComponent(mediaToken) + '&subtitle=' + index
          }))
        };
        return reply(res, 200, Object.assign({ returnValue: true }, safe));
      });
    }
    if (method === 'mediaInfo') return magis.mediaInfo(String(input.contentId || ''), String(input.seriesContentId || ''), done);
    if (method === 'liveCategories') return magis.getLiveCategories((err, categories) => done(err, { categories: categories || [] }));
    if (method === 'liveChannels') return magis.getLiveChannels(input.columnId || null, input.pageNum, input.pageSize, (err, channels, hasMore) => done(err, { channels: channels || [], hasMore: !!hasMore, pageNum: Number(input.pageNum) || 1 }));
    if (method === 'prewarm') return magis.ensureSession((err) => done(err, {}));
    if (method === 'abortMedia') return done(null, {});
    if (method === 'resolveLive') {
      return magis.resolveLive(String(input.channelCode || ''), (err, stream) => {
        if (err) return done(err);
        let liveUrl;
        try { liveUrl = new URL(stream.url); } catch (_) { return reply(res, 502, { returnValue: false, errorText: 'El portal devolviÃ³ una URL de vivo invÃ¡lida.' }); }
        if (liveUrl.protocol !== 'http:' && liveUrl.protocol !== 'https:') return reply(res, 502, { returnValue: false, errorText: 'Protocolo de vivo invÃ¡lido.' });
        stream.url = liveUrl.protocol + '//' + liveUrl.host + liveUrl.pathname + liveUrl.search;
        stream.backupUrls = (stream.backupUrls || []).map((backup) => {
          try { const parsed = new URL(backup); return parsed.protocol + '//' + parsed.host + parsed.pathname + parsed.search; } catch (_) { return ''; }
        }).filter(Boolean);
        const mediaToken = issueMediaToken(stream);
        if (!mediaToken) return reply(res, 503, { returnValue: false, errorText: 'Falta configurar MEDIA_TOKEN_SECRET para TV en vivo.' });
        return reply(res, 200, { returnValue: true, name: stream.name, mime: stream.mime, isHls: true, mediaToken, url: '/api/media?token=' + encodeURIComponent(mediaToken) + '&manifest=1' });
      });
    }
    return reply(res, 404, { returnValue: false, errorText: 'Método no disponible en HTML' });
  } catch (err) {
    return done(err);
  }
};
