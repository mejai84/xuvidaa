'use strict';

const magis = require('./lib/magis');
const mediaTokenCodec = require('./lib/media-token');
const path = require('path');
const net = require('net');
const { IptvOrgProvider } = require(path.join(__dirname, '../../../server/providers/iptvOrgProvider.cjs'));
const { M3uProvider } = require(path.join(__dirname, '../../../server/providers/m3uProvider.cjs'));

const iptvOrg = new IptvOrgProvider({
  country: process.env.IPTV_COUNTRY || 'CO',
  languagePriority: process.env.IPTV_LANG || 'spa',
  excludeNsfw: process.env.IPTV_EXCLUDE_NSFW !== 'false',
  cacheDir: path.join(__dirname, '../../../server/.cache')
});
const m3uProvider = new M3uProvider({
  baseUrl: process.env.M3U_BASE_URL || '',
  username: process.env.M3U_USERNAME || '',
  password: process.env.M3U_PASSWORD || '',
  type: process.env.M3U_TYPE || 'm3u',
  cacheDir: path.join(__dirname, '../../../server/.cache')
});
const legacyPortalEnabled = process.env.LEGACY_MAGIS_ENABLED === 'true';

function restrictedStreamHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host || net.isIP(host) || host === 'localhost' ||
      /\.(?:localhost|local|internal|lan|corp)$/.test(host)) return true;
  return false;
}


const methods = new Set([
  'ping', 'keepAlive', 'heartbeat', 'home', 'search', 'detail', 'resolve',
  'resolveSmooth', 'mediaInfo', 'liveChannels', 'liveCategories', 'fetchM3u',
  'resolveLive', 'abortMedia', 'prewarm',
  'm3uMovies', 'm3uSeries', 'm3uDetail', 'm3uStatus'
]);
const roots = new Set(['featured', 'movies', 'series', 'anime', 'kids', 'free']);
const limits = new Map();
const secret = process.env.MEDIA_TOKEN_SECRET || process.env.XUPER_MEDIA_SECRET || '';
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
  return mediaTokenCodec.encode({
    url: stream.url, hosts: hosts, headers: stream.headers || {}, mime: stream.mime || '', duration: Number(stream.duration) || 0, subtitles: stream.subtitles || [], exp: expiresAt,
  }, secret);
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

    if (method === 'home') {
      const root = String(input.root || 'movies');
      try {
        if (root === 'movies' || root === 'series') {
          const data = root === 'movies'
            ? await m3uProvider.getMovies({ pageNum: input.pageNum || 1, pageSize: input.pageSize || 30 })
            : await m3uProvider.getSeries({ pageNum: input.pageNum || 1, pageSize: input.pageSize || 30 });
          return done(null, { items: data.items || [], total: data.total || 0, hasMore: !!data.hasMore, pageNum: data.pageNum || 1 });
        }
        if (root === 'featured') {
          const [movies, series] = await Promise.all([
            m3uProvider.getMovies({ pageSize: 15 }),
            m3uProvider.getSeries({ pageSize: 15 })
          ]);
          const items = (movies.items || []).concat(series.items || []);
          return done(null, { items, total: items.length });
        }
      } catch (_) {
        // A temporarily unavailable private provider must not restore the blocked portal dependency.
        return done(null, { items: [], total: 0, warning: 'Catálogo M3U temporalmente no disponible o sin configurar' });
      }
      if (legacyPortalEnabled) return portalRequest((finish) => magis.home(root, finish));
      return done(null, { items: [], total: 0 });
    }

    if (method === 'search') {
      try {
        const result = await m3uProvider.search(String(input.value || input.q || ''), 30);
        return done(null, { items: result.items || [], total: result.total || 0 });
      } catch (_) {
        return done(null, { items: [], total: 0, warning: 'Búsqueda M3U temporalmente no disponible' });
      }
    }

    if (method === 'detail') {
      const id = String(input.contentId || input.id || '').trim();
      if (!/^(?:mov-|series-)/.test(id)) {
        if (legacyPortalEnabled) return portalRequest((finish) => magis.detail(id, finish));
        return reply(res, 404, { returnValue: false, errorText: 'Contenido no encontrado' });
      }
      try {
        const detail = await m3uProvider.getDetail(id);
        if (detail && detail.returnValue && detail.item) {
          return done(null, { item: detail.item, seasons: detail.seasons || [], episodes: detail.episodes || [] });
        }
        return reply(res, 404, { returnValue: false, errorText: 'Contenido no encontrado' });
      } catch (_) {
        return reply(res, 503, { returnValue: false, errorText: 'Catálogo M3U temporalmente no disponible' });
      }
    }
    if (method === 'm3uMovies' || method === 'm3uSeries' || method === 'm3uDetail') {
      try {
        const result = method === 'm3uMovies' ? await m3uProvider.getMovies(input)
          : method === 'm3uSeries' ? await m3uProvider.getSeries(input)
          : await m3uProvider.getDetail(input.contentId || input.id);
        return done(null, result);
      } catch (_) {
        return reply(res, 503, { returnValue: false, errorText: 'Catálogo M3U temporalmente no disponible' });
      }
    }
    if (method === 'm3uStatus') {
      const cached = await m3uProvider.readDiskCache();
      return done(null, {
        configured: m3uProvider.isConfigured(),
        hasCache: !!cached,
        fetchedAt: cached ? cached.fetchedAt : null,
        stats: cached ? cached.stats : null
      });
    }
    if (method === 'resolve') {
      const contentId = String(input.contentId || input.id || '');
      if (/^(?:mov-|ep-)/.test(contentId)) {
        return reply(res, 501, { returnValue: false,
          errorText: 'La reproducción M3U privada requiere completar las pruebas de seguridad de VOD.' });
      }
      if (!legacyPortalEnabled) {
        return reply(res, 404, { returnValue: false, errorText: 'Origen de reproducción no habilitado' });
      }
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
        const result = await iptvOrg.getCategories();
        return done(null, { categories: result.categories || [] });
      } catch (_) {
        return done(null, { categories: [], warning: 'Catálogo IPTV-org temporalmente no disponible' });
      }
    }

    if (method === 'liveChannels') {
      try {
        const result = await iptvOrg.getChannels({
          columnId: input.columnId, pageNum: input.pageNum,
          pageSize: input.pageSize, search: input.search || input.value
        });
        return done(null, { channels: result.channels || [], hasMore: !!result.hasMore,
          pageNum: result.pageNum || 1, total: result.total || 0 });
      } catch (_) {
        return done(null, { channels: [], hasMore: false,
          pageNum: Number(input.pageNum) || 1, total: 0,
          warning: 'Catálogo IPTV-org temporalmente no disponible' });
      }
    }
    if (method === 'prewarm') return done(null, { provider: 'iptv-org+m3u', ready: true });
    if (method === 'abortMedia') return done(null, {});
    if (method === 'resolveLive') {
      const channelTarget = String(input.channelCode || input.id || '').trim();
      if (!channelTarget) return reply(res, 400, { returnValue: false, errorText: 'Falta identificar el canal' });
      let channel;
      try { channel = await iptvOrg.getChannel(channelTarget); }
      catch (_) { return reply(res, 502, { returnValue: false, errorText: 'No se pudo consultar IPTV-org' }); }
      if (!channel) {
        if (!legacyPortalEnabled) return reply(res, 404, { returnValue: false, errorText: 'Canal no encontrado en IPTV-org' });
      } else {
        if (!channel.hasStream || !channel.streamUrl) {
          return reply(res, 404, { returnValue: false, errorText: 'Este canal no tiene transmisión registrada' });
        }
        const candidates = Array.isArray(channel.streams) ? channel.streams : [];
        // HTTPS only: the existing media endpoint is intentionally restricted to encrypted origins.
        const selected = candidates.find((s) => s && typeof s.url === 'string' && s.url.startsWith('https://')) ||
          (String(channel.streamUrl).startsWith('https://') ? { url: channel.streamUrl } : null);
        if (!selected) return reply(res, 415, { returnValue: false, errorText: 'El canal no ofrece un origen HTTPS compatible' });
        let url;
        try { url = new URL(selected.url); }
        catch (_) { return reply(res, 502, { returnValue: false, errorText: 'Origen IPTV inválido' }); }
        if (url.protocol !== 'https:' || restrictedStreamHost(url.hostname) || url.username || url.password) {
          return reply(res, 403, { returnValue: false, errorText: 'Origen IPTV restringido' });
        }
        const isHls = /\.m3u8(?:\?|$)/i.test(url.toString()) || /mpegurl/i.test(selected.mime || '');
        const stream = { url: url.toString(), name: channel.name || 'TV',
          mime: isHls ? 'application/vnd.apple.mpegurl' : (selected.mime || 'video/mp2t'), headers: {}, subtitles: [] };
        const expiresAt = mediaExpiry(stream, true);
        const token = issueMediaToken(stream, expiresAt);
        if (!token) return reply(res, 503, { returnValue: false, errorText: 'MEDIA_TOKEN_SECRET no configurado' });
        const urlForTv = mediaProxyUrl(token, isHls ? '&manifest=1' : '');
        return reply(res, 200, { returnValue: true, name: channel.name,
          mime: stream.mime, isHls, mediaToken: token, mediaExpiresAt: expiresAt,
          mediaUrl: urlForTv, url: urlForTv, channelCode: channel.channelCode, source: 'iptv-org' });
      }
      return portalRequest((finish) => magis.resolveLive(String(input.channelCode || ''), finish), (err, stream) => {
        if (err) return done(err);
        let liveUrl;
        try { liveUrl = new URL(stream.url); } catch (_) { return reply(res, 502, { returnValue: false, errorText: 'El portal devolviÃ³ una URL de vivo invÃ¡lida.' }); }
        if (liveUrl.protocol !== 'http:' && liveUrl.protocol !== 'https:') return reply(res, 502, { returnValue: false, errorText: 'Protocolo de vivo invÃ¡lido.' });
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

// Export internal providers for isolated API contract tests (not public HTTP endpoints).
module.exports.iptvOrg = iptvOrg;
module.exports.m3uProvider = m3uProvider;
