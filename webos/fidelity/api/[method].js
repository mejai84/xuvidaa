'use strict';

const path = require('path');
const net = require('net');
const magis = require('./lib/magis');
const { IptvOrgProvider } = require(path.join(__dirname, '../../../server/providers/iptvOrgProvider.cjs'));

const iptvOrg = new IptvOrgProvider({
  country: process.env.IPTV_COUNTRY || 'CO',
  languagePriority: process.env.IPTV_LANG || 'spa',
  excludeNsfw: process.env.IPTV_EXCLUDE_NSFW !== 'false',
  cacheDir: path.join(__dirname, '../../../server/.cache')
});

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
  const cacheFlyAuth = /(?:^|[?&])sign_type=cfl(?:&|$)/i.test(String((stream.headers || {})['Content-Auth'] || (stream.headers || {})['content-auth'] || ''));
  const urls = [stream.url].concat(stream.backupUrls || [], (stream.subtitles || []).map((sub) => sub && sub.url));
  return Array.from(new Set(urls.map((value) => {
    try { const url = new URL(value); return (url.protocol === 'https:' || (url.protocol === 'http:' && (cacheFlyAuth || url.hostname.toLowerCase().endsWith('.cachefly.net') || url.hostname.toLowerCase() === 'cachefly.net'))) ? url.hostname.toLowerCase() : ''; } catch (_) { return ''; }
  }).filter(Boolean).concat(configured)));
}
function mediaExpiry(stream, live) {
  const minimum = 15 * 60 * 1000;
  const duration = Number(stream && stream.duration);
  const lifetime = !live && Number.isFinite(duration) && duration > 0
    ? Math.min(6 * 60 * 60 * 1000, Math.max(minimum, duration * 1000 + 30 * 60 * 1000))
    : minimum;
  return Date.now() + lifetime;
}
function issueMediaToken(stream, expiresAt) {
  if (!secret || !stream || !/^https?:\/\//i.test(stream.url || '')) return '';
  const hosts = tokenHosts(stream);
  const payload = b64(JSON.stringify({
    url: stream.url, hosts: hosts, headers: stream.headers || {}, mime: stream.mime || '', duration: Number(stream.duration) || 0, subtitles: stream.subtitles || [], exp: expiresAt,
    session: crypto.randomBytes(12).toString('hex')
  }));
  return payload + '.' + sign(payload);
}

function reply(res, status, value) {
  res.status(status).setHeader('Cache-Control', 'no-store');
  return res.json(value);
}

function mediaProxyUrl(token, suffix) {
  let origin = '';
  const configured = process.env.PUBLIC_BASE_URL || process.env.PUBLIC_ORIGIN;
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash) origin = parsed.origin;
    } catch (_) { /* Keep same-origin URLs when no valid public origin exists. */ }
  }
  return origin + '/api/media?token=' + encodeURIComponent(token) + (suffix || '');
}

function isPrivateOrLocalHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h === '::') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.corp')) return true;
  if (net.isIPv4(h)) {
    const parts = h.split('.').map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] >= 224) return true;
  }
  if (net.isIPv6(h)) {
    if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc00:') || h.startsWith('fd00:')) return true;
  }
  return false;
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
  if (method === 'resolveSmooth') return reply(res, 501, { returnValue: false, errorText: 'Modo Fluido requiere el relay FFmpeg local del televisor LG y no está disponible en esta edición web.' });

  const done = (err, value) => {
    if (err && err.code === 'PORTAL_TIMEOUT') return reply(res, 504, { returnValue: false, errorText: 'El portal no respondió a tiempo. Vuelve a intentarlo.', errorCode: 'PORTAL_TIMEOUT' });
    if (err && err.portalCode === 'portal100024') return reply(res, 503, { returnValue: false, errorText: 'El proveedor no permite el acceso desde la región de este servidor.', errorCode: err.portalCode });
    if (err) return reply(res, 502, { returnValue: false, errorText: String(err.message || err), errorCode: err.portalCode || 1 });
    return reply(res, 200, Object.assign({ returnValue: true }, value || {}));
  };
  // Keep this HTTP request alive until the portal callback replies. The portal
  // context cancels unfinished work when the request deadline is reached.
  const portalRequest = (operation, complete) => new Promise((resolve) => {
    magis.runWithDeadline(55000, operation, (err, value) => {
      try { (complete || done)(err, value); }
      catch (error) {
        if (!res.headersSent) done(error);
        else res.destroy();
      }
      resolve();
    });
  });

  try {
    if (method === 'ping' || method === 'heartbeat' || method === 'keepAlive') return done(null, { service: 'xuper-html', alive: true });
    if (method === 'home') return portalRequest((finish) => magis.home(String(input.root || 'movies'), finish));
    if (method === 'search') return portalRequest((finish) => magis.search(String(input.value || ''), finish));
    if (method === 'detail') return portalRequest((finish) => magis.detail(String(input.contentId || ''), finish));
    if (method === 'resolve') {
      return portalRequest((finish) => magis.resolve(String(input.contentId || ''), String(input.seriesContentId || ''), { trackIndex: input.trackIndex }, finish), (err, stream) => {
        if (err) return done(err);
        let mediaUrl;
        try { mediaUrl = new URL(stream.url); } catch (_) { return reply(res, 502, { returnValue: false, errorText: 'El portal devolvió una URL inválida.' }); }
        if (mediaUrl.protocol !== 'https:') {
          return reply(res, 503, { returnValue: false, errorText: 'El portal devolviÃ³ un host CDN no HTTPS.' });
        }
        const mediaExpiresAt = mediaExpiry(stream, false);
        const mediaToken = issueMediaToken(stream, mediaExpiresAt);
        if (!mediaToken) return reply(res, 503, { returnValue: false, errorText: 'Falta configurar MEDIA_TOKEN_SECRET para habilitar reproducción.' });
        const isHls = /mp2t|mpegurl|(?:^|\/)ts(?:$|;)/i.test(stream.mime || '');
        const safe = {
          mime: stream.mime, codec: stream.codec, quality: stream.quality,
          duration: stream.duration, selectedTrack: stream.selectedTrack,
          availableTracks: stream.availableTracks, trackIndex: stream.trackIndex,
          audio: stream.audio, name: stream.name, isHls, mediaToken, mediaExpiresAt,
          mediaUrl: mediaProxyUrl(mediaToken, isHls ? '&manifest=1' : ''),
          subtitles: (stream.subtitles || []).map((sub, index) => ({
            lang: sub.lang, format: sub.format,
            url: mediaProxyUrl(mediaToken, '&subtitle=' + index)
          }))
        };
        return reply(res, 200, Object.assign({ returnValue: true }, safe));
      });
    }
    if (method === 'mediaInfo') return portalRequest((finish) => magis.mediaInfo(String(input.contentId || ''), String(input.seriesContentId || ''), finish));
    if (method === 'liveCategories') {
      try {
        const res = await iptvOrg.getCategories();
        if (res && res.categories && res.categories.length) {
          return done(null, { categories: res.categories });
        }
      } catch (iptvErr) {
        console.warn('[api] Fallback a portal para liveCategories:', iptvErr.message);
      }
      return portalRequest((finish) => magis.getLiveCategories((err, categories) => finish(err, { categories: categories || [] })));
    }
    if (method === 'liveChannels') {
      try {
        const res = await iptvOrg.getChannels({
          columnId: input.columnId,
          pageNum: input.pageNum,
          pageSize: input.pageSize,
          search: input.search || input.value
        });
        if (res && res.channels) {
          return done(null, {
            channels: res.channels,
            hasMore: !!res.hasMore,
            pageNum: Number(res.pageNum) || 1,
            total: res.total
          });
        }
      } catch (iptvErr) {
        console.warn('[api] Fallback a portal para liveChannels:', iptvErr.message);
      }
      return portalRequest((finish) => magis.getLiveChannels(input.columnId || null, input.pageNum, input.pageSize, (err, channels, hasMore) => finish(err, { channels: channels || [], hasMore: !!hasMore, pageNum: Number(input.pageNum) || 1 })));
    }
    if (method === 'prewarm') return portalRequest((finish) => magis.ensureSession((err) => finish(err, {})));
    if (method === 'abortMedia') return done(null, {});
    if (method === 'resolveLive') {
      const channelTarget = String(input.channelCode || input.id || input.streamUrl || '').trim();
      if (channelTarget) {
        try {
          const iptvChannel = await iptvOrg.getChannel(channelTarget);
          if (iptvChannel && iptvChannel.source === 'iptv-org') {
            if (!iptvChannel.hasStream || !iptvChannel.streamUrl) {
              return reply(res, 404, { returnValue: false, errorText: 'El canal ' + (iptvChannel.name || channelTarget) + ' no tiene transmisiones disponibles.' });
            }

            // Seleccionar el mejor stream disponible priorizando HTTPS
            let chosenStream = null;
            if (Array.isArray(iptvChannel.streams) && iptvChannel.streams.length > 0) {
              chosenStream = iptvChannel.streams.find((s) => s.url && s.url.startsWith('https://')) || iptvChannel.streams[0];
            } else if (iptvChannel.streamUrl) {
              chosenStream = { url: iptvChannel.streamUrl, quality: iptvChannel.quality };
            }

            if (!chosenStream || !chosenStream.url) {
              return reply(res, 404, { returnValue: false, errorText: 'No se encontró un stream válido para este canal.' });
            }

            let parsedStreamUrl;
            try {
              parsedStreamUrl = new URL(chosenStream.url);
            } catch (_) {
              return reply(res, 502, { returnValue: false, errorText: 'URL de transmisión inválida en el catálogo.' });
            }

            if (parsedStreamUrl.protocol !== 'http:' && parsedStreamUrl.protocol !== 'https:') {
              return reply(res, 502, { returnValue: false, errorText: 'Protocolo de transmisión no soportado.' });
            }

            if (isPrivateOrLocalHost(parsedStreamUrl.hostname)) {
              return reply(res, 403, { returnValue: false, errorText: 'Dirección de transmisión restringida.' });
            }

            const backupUrls = (iptvChannel.streams || [])
              .map((s) => s && s.url)
              .filter((u) => u && typeof u === 'string' && u !== chosenStream.url && /^https?:\/\//i.test(u));

            const isHls = /\.m3u8(?:\?|$)/i.test(chosenStream.url) || /mpegurl/i.test(chosenStream.mime || '');
            const mime = isHls ? 'application/vnd.apple.mpegurl' : (chosenStream.mime || 'video/mp2t');

            const streamObj = {
              url: chosenStream.url,
              name: iptvChannel.name || 'Canal en vivo',
              mime: mime,
              backupUrls: backupUrls
            };

            const mediaExpiresAt = mediaExpiry(streamObj, true);
            const mediaToken = issueMediaToken(streamObj, mediaExpiresAt);
            if (!mediaToken) {
              return reply(res, 503, { returnValue: false, errorText: 'Falta configurar MEDIA_TOKEN_SECRET para TV en vivo.' });
            }

            const liveMediaUrl = mediaProxyUrl(mediaToken, isHls ? '&manifest=1' : '');

            return reply(res, 200, {
              returnValue: true,
              name: iptvChannel.name,
              mime: mime,
              isHls: isHls,
              mediaToken: mediaToken,
              mediaExpiresAt: mediaExpiresAt,
              mediaUrl: liveMediaUrl,
              url: liveMediaUrl,
              channelCode: iptvChannel.channelCode,
              source: 'iptv-org'
            });
          }
        } catch (iptvErr) {
          console.warn('[api] Fallback a portal tras fallo en IPTV-org resolveLive:', iptvErr.message);
        }
      }

      return portalRequest((finish) => magis.resolveLive(String(input.channelCode || ''), finish), (err, stream) => {
        if (err) return done(err);
        let liveUrl;
        try { liveUrl = new URL(stream.url); } catch (_) { return reply(res, 502, { returnValue: false, errorText: 'El portal devolvió una URL de vivo inválida.' }); }
        if (liveUrl.protocol !== 'http:' && liveUrl.protocol !== 'https:') return reply(res, 502, { returnValue: false, errorText: 'Protocolo de vivo inválido.' });
        stream.url = liveUrl.protocol + '//' + liveUrl.host + liveUrl.pathname + liveUrl.search;
        stream.backupUrls = (stream.backupUrls || []).map((backup) => {
          try { const parsed = new URL(backup); return parsed.protocol + '//' + parsed.host + parsed.pathname + parsed.search; } catch (_) { return ''; }
        }).filter(Boolean);
        const mediaExpiresAt = mediaExpiry(stream, true);
        const mediaToken = issueMediaToken(stream, mediaExpiresAt);
        if (!mediaToken) return reply(res, 503, { returnValue: false, errorText: 'Falta configurar MEDIA_TOKEN_SECRET para TV en vivo.' });
        const liveMediaUrl = mediaProxyUrl(mediaToken, '&manifest=1');
        return reply(res, 200, { returnValue: true, name: stream.name, mime: stream.mime, isHls: true, mediaToken, mediaExpiresAt, mediaUrl: liveMediaUrl, url: liveMediaUrl });
      });
    }
    return reply(res, 404, { returnValue: false, errorText: 'Método no disponible en HTML' });
  } catch (err) {
    return done(err);
  }
};

module.exports.iptvOrg = iptvOrg;
