'use strict';

// TVVIDAA HTTP-only catalog API. No Luna, LG webOS services or Magis portal.
const path = require('node:path');
const net = require('node:net');
const { IptvOrgProvider } = require('../providers/iptvOrgProvider.cjs');
const { M3uProvider } = require('../providers/m3uProvider.cjs');
const registry = require('./media-registry.cjs');

const cacheDir = path.join(__dirname, '..', '.cache');
const live = new IptvOrgProvider({
  cacheDir,
  country: process.env.IPTV_COUNTRY || 'CO',
  languagePriority: process.env.IPTV_LANG || 'spa',
  excludeNsfw: process.env.IPTV_EXCLUDE_NSFW !== 'false'
});
const vod = new M3uProvider({
  cacheDir,
  baseUrl: process.env.M3U_BASE_URL || '',
  username: process.env.M3U_USERNAME || '',
  password: process.env.M3U_PASSWORD || '',
  type: process.env.M3U_TYPE || 'm3u'
});
const allowed = new Set([
  'ping','liveCategories','liveChannels','resolveLive',
  'm3uMovies','m3uSeries','m3uDetail','m3uStatus','resolve'
]);
const requests = new Map();

function respond(res, status, body) {
  res.setHeader('Cache-Control','no-store');
  return res.status(status).json(Object.assign({ returnValue: status >= 200 && status < 300 }, body));
}
function isUnsafeHost(host) {
  const h = String(host || '').toLowerCase();
  return !h || net.isIP(h) !== 0 || h === 'localhost' ||
    !h.includes('.') || h.endsWith('.') || 
    /(?:\.local|\.localhost|\.internal|\.lan|\.home|\.corp|\.test|\.invalid)$/.test(h);
}
function safeImage(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || isUnsafeHost(url.hostname)) return '';
    const text = decodeURIComponent(url.toString());
    for (const secret of [process.env.M3U_PASSWORD, process.env.M3U_USERNAME]) {
      if (secret && secret.length > 3 && text.includes(secret)) return '';
    }
    if (/[?&](?:password|username|token|auth|apikey|api_key|key)=/i.test(text)) return '';
    return url.toString();
  } catch (_) { return ''; }
}
function safeMovie(item) {
  return {
    id: String(item.id || ''), title: String(item.title || ''), kind: 'película',
    year: item.year || '', category: String(item.category || ''),
    poster: safeImage(item.poster), source: 'private-m3u'
  };
}
function safeSeries(item) {
  return {
    id: String(item.id || ''), title: String(item.title || ''), kind: 'serie',
    category: String(item.category || ''), poster: safeImage(item.poster),
    seasonCount: Number(item.seasonCount || 0),
    episodeCount: Number(item.episodeCount || 0), source: 'private-m3u'
  };
}
function safeChannel(ch) {
  return {
    id: String(ch.id || ch.channelCode || ''),
    channelCode: String(ch.channelCode || ch.id || ''),
    name: String(ch.name || ''), category: String(ch.category || ''),
    logo: safeImage(ch.logo), hasStream: !!ch.hasStream
  };
}
function safeDetail(d) {
  const series = !!d.isSeries || d.item && (d.item.isSeries || d.item.kind === 'serie');
  const src = d.item || {};
  const item = series ? safeSeries(src) : safeMovie(src);
  const seasons = series ? (d.seasons || src.seasons || []).map((s) => ({
    id: String(s.id || ''), number: Number(s.number || 0),
    title: String(s.title || ''), episodes: (s.episodes || []).map((ep) => ({
      id: String(ep.id || ''), title: String(ep.title || ep.name || ''),
      number: Number(ep.number || ep.episodeNumber || 0)
    }))
  })) : [];
  return { item, seasons, isSeries: series };
}
function normalizeInput(req) {
  return req.method === 'POST' ? (req.body || {}) : (req.query || {});
}
function protectRate(req, method) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  let rate = requests.get(ip);
  if (!rate || now - rate.at > 60000) rate = {at:now,n:0};
  rate.n += 1;
  requests.set(ip,rate);
  if (requests.size > 3000) requests.clear();
  return rate.n <= (method === 'resolveLive' ? 45 : 120);
}
async function handler(req, res) {
  const method = String(req.query.method || '');
  if (!allowed.has(method)) return respond(res,404,{errorText:'Método no disponible'});
  if (req.method !== 'POST') return respond(res,405,{errorText:'Utiliza POST'});
  if (!protectRate(req,method)) return respond(res,429,{errorText:'Demasiadas solicitudes'});
  const input = normalizeInput(req);
  const search = String(input.search || '').trim();
  const pageNum = Math.min(10000,Math.max(1,parseInt(input.pageNum,10)||1));
  const pageSize = Math.min(60,Math.max(1,parseInt(input.pageSize,10)||30));
  if (search.length > 100) return respond(res,400,{errorText:'Búsqueda demasiado larga'});
  try {
    if (method === 'ping') return respond(res,200,{service:'TVVIDAA-web',ready:true});
    if (method === 'liveCategories') {
      const r = await live.getCategories();
      return respond(res,200,{categories:(r.categories||[]).map(c=>({
        id:String(c.id || ''),name:String(c.name || c.id || '')
      }))});
    }
    if (method === 'liveChannels') {
      const result = await live.getChannels({
        columnId: String(input.columnId || 'all'),
        pageNum,pageSize,search,onlyWithStreams:true
      });
      return respond(res,200,{channels:(result.channels||[]).map(safeChannel),
        pageNum,total:result.total||0,hasMore:!!result.hasMore});
    }
    if (method === 'm3uMovies' || method === 'm3uSeries') {
      const args = {pageNum,pageSize,search,category:String(input.category||'all')};
      const r = method === 'm3uMovies' ? await vod.getMovies(args) : await vod.getSeries(args);
      return respond(res,200,{items:(r.items||[]).map(method === 'm3uMovies'?safeMovie:safeSeries),
        pageNum,total:r.total||0,hasMore:!!r.hasMore,
        configured:vod.isConfigured()});
    }
    if (method === 'm3uDetail') {
      const id=String(input.id||input.contentId||'').trim();
      if (!/^(mov-|series-)[A-Za-z0-9-]{4,120}$/.test(id)) return respond(res,400,{errorText:'ID inválido'});
      const d=await vod.getDetail(id);
      if (!d || !d.returnValue || !d.item) return respond(res,404,{errorText:'Contenido no encontrado'});
      return respond(res,200,safeDetail(d));
    }
    if (method === 'm3uStatus') {
      return respond(res,200,{configured:vod.isConfigured()});
    }
    if (method === 'resolve') {
      // Only identifiers from the provider's catalog are accepted. Never accept
      // a caller-supplied URL, path, headers, cookie or credential.
      const id = String(input.contentId || input.id || '').trim();
      if (!/^(?:mov-|ep-)[A-Za-z0-9._-]{5,120}$/.test(id)) {
        return respond(res,400,{errorText:'Identificador de contenido inválido'});
      }
      if (!vod.isConfigured()) return respond(res,503,{errorText:'Biblioteca privada no configurada'});
      const result = await vod.resolveStream(id);
      if (!result || !result.found || !result.streamUrl) {
        return respond(res,404,{errorText:'No se encontró el título en el catálogo privado'});
      }
      let url;
      try { url = new URL(result.streamUrl); }
      catch (_) { return respond(res,415,{errorText:'Origen de video inválido'}); }
      if (url.protocol !== 'https:' || url.username || url.password ||
          isUnsafeHost(url.hostname) || (url.port && url.port !== '443')) {
        return respond(res,415,{errorText:'La fuente privada requiere HTTPS público compatible'});
      }
      if (!['video/mp4','application/vnd.apple.mpegurl','video/mp2t'].includes(result.mime)) {
        return respond(res,415,{errorText:'Formato no compatible con reproducción web VIDAA'});
      }
      const exp = Date.now() + 8 * 60 * 60 * 1000;
      const issued = registry.register({
        url:url.toString(),hosts:[url.hostname.toLowerCase()],mime:result.mime,
        headers:{},duration:result.duration||0
      },exp);
      if (!issued) return respond(res,503,{errorText:'No se pudo preparar el video'});
      return respond(res,200,{
        contentId:id,isHls:result.isHls,mime:result.mime,
        mediaUrl:'/api/media?token='+encodeURIComponent(issued.token)+(result.isHls?'&manifest=1':''),
        mediaExpiresAt:issued.exp,
        title:String(result.item && result.item.title || '')
      });
    }
    if (method === 'resolveLive') {
      const code=String(input.channelCode||'').trim();
      if (!/^[A-Za-z0-9._-]{2,100}$/.test(code)) return respond(res,400,{errorText:'Canal inválido'});
      const ch=await live.getChannel(code);
      if (!ch || !ch.hasStream) return respond(res,404,{errorText:'Canal sin señal registrada'});
      const candidates=Array.isArray(ch.streams)?ch.streams:[];
      const streams=candidates.concat(ch.streamUrl?[{url:ch.streamUrl}]:[]);
      let selected=null;
      for (const candidate of streams) {
        if (!candidate || !candidate.url) continue;
        let uri;
        try { uri=new URL(candidate.url); } catch (_) { continue; }
        if (uri.protocol !== 'https:' || uri.username || uri.password ||
            isUnsafeHost(uri.hostname) || uri.port && uri.port !== '443') continue;
        selected=uri;
        break;
      }
      if (!selected) return respond(res,415,{errorText:'No existe un origen HTTPS compatible para este canal'});
      const hls=/\.m3u8$/i.test(selected.pathname);
      const mime=hls?'application/vnd.apple.mpegurl':'video/mp2t';
      const issued=registry.register({
        url:selected.toString(),hosts:[selected.hostname.toLowerCase()],
        headers:{},mime,duration:0
      },Date.now()+15*60*1000);
      if (!issued) return respond(res,503,{errorText:'Servidor multimedia no configurado'});
      return respond(res,200,{
        name:String(ch.name||'TV'),isHls:hls,mime,
        mediaUrl:'/api/media?token='+encodeURIComponent(issued.token)+(hls?'&manifest=1':''),
        mediaExpiresAt:issued.exp
      });
    }
  } catch (_) {
    return respond(res,503,{errorText:'La fuente de contenido no está disponible. Intenta nuevamente.'});
  }
  return respond(res,404,{errorText:'Método no disponible'});
}

module.exports=handler;
module.exports.live=live;
module.exports.vod=vod;
module.exports.safeMovie=safeMovie;
module.exports.safeChannel=safeChannel;
module.exports.safeDetail=safeDetail;
module.exports.isUnsafeHost=isUnsafeHost;
