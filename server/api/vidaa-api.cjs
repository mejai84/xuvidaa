'use strict';

// TVVIDAA HTTP-only catalog API. No Luna, LG webOS services or Magis portal.
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { IptvOrgProvider } = require('../providers/iptvOrgProvider.cjs');
const { M3uProvider } = require('../providers/m3uProvider.cjs');
const registry = require('./media-registry.cjs');
const mkvPlayback=require('../services/mkv-playback.cjs');
const {permittedMediaOrigin,permittedLiveOrigin} = require('./lib/vod-origin-policy.cjs');

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
  'm3uMovies','m3uSeries','m3uDetail','m3uStatus','resolve','home','prewarm'
]);
const requests = new Map();
// Bounded, best-effort stream checks. Never probe credentialed/private URLs.
const liveHealth = new Map();
const healthQueue = [];
let activeHealthChecks = 0;
const HEALTH_TTL = 30 * 60 * 1000;
function channelHealth(code) {
  const entry = liveHealth.get(code);
  return entry && entry.until > Date.now() ? entry.status : 'unverified';
}
function validMediaResponse(uri, headers, body) {
  const type = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  const prefix = bytes.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/mpegurl|vnd\.apple\.mpegurl/.test(type) || /\.m3u8$/i.test(uri.pathname)) {
    return /^#EXTM3U(?:\s|$)/.test(prefix) && /(?:#EXTINF:|#EXT-X-STREAM-INF:|#EXT-X-TARGETDURATION:)/.test(prefix);
  }
  if (/mp2t/.test(type) || /\.ts$/i.test(uri.pathname)) {
    return bytes.length >= 188 && bytes[0] === 0x47 &&
      (bytes.length < 189 || bytes[188] === 0x47) &&
      (bytes.length < 377 || bytes[376] === 0x47);
  }
  if (/^(?:video\/mp4|video\/iso\.segment)$/.test(type) || /\.mp4$/i.test(uri.pathname)) {
    return bytes.length >= 8 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  return false;
}
function checkStream(uri) {
  return new Promise(resolve => {
    const client = uri.protocol === 'https:' ? https : http;
    let settled = false, size = 0;
    const chunks = [];
    const finish = status => { if (!settled) { settled = true; resolve(status); } };
    const req = client.request(uri, {
      method:'GET', timeout:3500,
      headers:{'User-Agent':'TVVIDAA/1.0','Accept':'application/vnd.apple.mpegurl,video/mp2t,video/mp4;q=0.9,*/*;q=0.1','Accept-Encoding':'identity','Range':'bytes=0-376'}
    }, response => {
      const status = response.statusCode || 0;
      if (status === 401 || status === 403 || status === 451) { response.resume(); finish('restricted'); return; }
      if (status === 405 || status === 501) { response.resume(); finish('unverified'); return; }
      if (status < 200 || status >= 300) { response.resume(); finish('offline'); return; }
      response.on('data', chunk => {
        size += chunk.length;
        if (size <= 4096) chunks.push(chunk.subarray(0, 4096 - (size - chunk.length)));
        if (size >= 4096) response.destroy();
      });
      const inspect = () => finish(validMediaResponse(uri, response.headers, Buffer.concat(chunks)) ? 'available' : 'unverified');
      response.on('end', inspect);
      response.on('close', inspect);
      response.on('error', () => finish('unverified'));
    });
    req.on('error', () => finish('offline'));
    req.on('timeout', () => req.destroy());
    req.end();
  });
}
function pumpHealth() {
  while (activeHealthChecks < 2 && healthQueue.length) {
    const task = healthQueue.shift();
    activeHealthChecks++;
    checkStream(task.uri).then(status => {
      liveHealth.set(task.code,{status,until:Date.now()+HEALTH_TTL});
    }).finally(() => {activeHealthChecks--;pumpHealth();});
  }
}
function scheduleHealth(channels, privateM3u) {
  let scheduled = 0;
  for (const ch of channels) {
    if (scheduled >= 24) break;
    const code = String(ch.channelCode || ch.id || '');
    const cached = liveHealth.get(code);
    if (!code || cached && cached.until > Date.now() || healthQueue.some(t=>t.code===code)) continue;
    if (cached) liveHealth.delete(code);
    const candidate = privateM3u ? {url:vod.reconstructLiveUrl(ch.streamPath)} :
      ((ch.streams || []).find(s=>s && s.url) || {url:ch.streamUrl});
    let uri;
    try {uri = new URL(candidate.url);} catch (_) {continue;}
    let permitted = permittedLiveOrigin(uri);
    if (privateM3u) {
      try { permitted = permittedMediaOrigin(uri) && uri.hostname.toLowerCase() === new URL(vod.baseUrl).hostname.toLowerCase(); }
      catch (_) { permitted = false; }
    }
    if (!permitted || isUnsafeHost(uri.hostname) || uri.username || uri.password) continue;
    if (healthQueue.length >= 48) break;
    liveHealth.set(code,{status:'unverified',until:Date.now()+60000});
    healthQueue.push({code,uri});
    scheduled++;
  }
  if (liveHealth.size > 3000) {
    for (const [key,value] of liveHealth) if (value.until < Date.now()) liveHealth.delete(key);
    if (liveHealth.size > 3000) liveHealth.clear();
  }
  pumpHealth();
}

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
    logo: safeImage(ch.logo), hasStream: !!ch.hasStream,
    signalStatus: channelHealth(String(ch.channelCode || ch.id || ''))
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
  let method = String(req.query.method || '');
  if (!allowed.has(method)) return respond(res,404,{errorText:'Método no disponible'});
  if (req.method !== 'POST') return respond(res,405,{errorText:'Utiliza POST'});
  if (!protectRate(req,method)) return respond(res,429,{errorText:'Demasiadas solicitudes'});
  const input = normalizeInput(req);
  if (method === 'prewarm') return respond(res,200,{ready:true,providers:{live:'iptv-org',vod:'m3u'}});
  if (method === 'home') {
    const root = String(input.root || 'movies');
    if (root !== 'movies' && root !== 'series') return respond(res,400,{errorText:'Sección inválida'});
    method = root === 'movies' ? 'm3uMovies' : 'm3uSeries';
  }
  const search = String(input.search || '').trim();
  const pageNum = Math.min(10000,Math.max(1,parseInt(input.pageNum,10)||1));
  const pageSize = Math.min(60,Math.max(1,parseInt(input.pageSize,10)||30));
  if (search.length > 100) return respond(res,400,{errorText:'Búsqueda demasiado larga'});
  try {
    if (method === 'ping') return respond(res,200,{service:'TVVIDAA-web',ready:true});
    if (method === 'liveCategories') {
      const r = await live.getCategories();
      const privateSports = vod.isConfigured() ? [{id:'private-sports',name:'Deportes M3U'}] : [];
      return respond(res,200,{stale:!!r.stale,warning:r.stale?'Se muestra el catálogo IPTV-org guardado.':'',countries:(r.countries||[]).map(c=>({code:String(c.code||''),name:String(c.name||c.code||'')})),categories:(r.categories||[]).map(c=>({
        id:String(c.id || ''),name:String(c.name || c.id || '')
      })).concat(privateSports)});
    }
    if (method === 'liveChannels' && String(input.columnId || '').toLowerCase() === 'private-sports') {
      const all = (await vod.getLiveChannels()).filter(ch => ch.category === 'Deportes');
      const filtered = all.filter(ch => !search || ch.name.toLowerCase().includes(search.toLowerCase()));
      scheduleHealth(filtered,true);
      const start = (pageNum - 1) * pageSize;
      const channels = filtered.slice(start,start+pageSize).map(safeChannel);
      const workingOnly = input.workingOnly === true;
      return respond(res,200,{channels:workingOnly ? channels.filter(c=>c.signalStatus==='available') : channels,
        pageNum,total:filtered.length,hasMore:start+pageSize<filtered.length,
        healthPending:workingOnly && channels.some(c=>c.signalStatus==='unverified')});
    }
    if (method === 'liveChannels') {
      const result = await live.getChannels({
        columnId: String(input.columnId || 'all'),
        country: /^(?:[A-Z]{2}|ALL)$/.test(String(input.country || 'ALL').toUpperCase()) ? String(input.country || 'ALL').toUpperCase() : 'ALL',
        pageNum,pageSize,search,onlyWithStreams:true
      });
      scheduleHealth(result.channels || []);
      const channels = (result.channels||[]).map(safeChannel);
      const workingOnly = input.workingOnly === true;
      return respond(res,200,{channels:workingOnly ? channels.filter(c=>c.signalStatus==='available') : channels,
        pageNum,total:result.total||0,hasMore:!!result.hasMore,
        stale:!!result.stale,warning:result.stale?'Se muestra el catálogo IPTV-org guardado.':'',
        healthPending:workingOnly && channels.some(c=>c.signalStatus==='unverified')});
    }
    if (method === 'm3uMovies' || method === 'm3uSeries') {
      const args = {pageNum,pageSize,search,category:String(input.category||'all')};
      const r = method === 'm3uMovies' ? await vod.getMovies(args) : await vod.getSeries(args);
      return respond(res,200,{items:(r.items||[]).map(method === 'm3uMovies'?safeMovie:safeSeries),
        pageNum,total:r.total||0,hasMore:!!r.hasMore,
        configured:vod.isConfigured(),stale:!!r.stale,warning:r.warning||''});
    }
    if (method === 'm3uDetail') {
      const id=String(input.id||input.contentId||'').trim();
      if (!/^(mov-|series-)[A-Za-z0-9-]{4,120}$/.test(id)) return respond(res,400,{errorText:'ID inválido'});
      const d=await vod.getDetail(id);
      if (!d || !d.returnValue || !d.item) return respond(res,404,{errorText:'Contenido no encontrado'});
      return respond(res,200,safeDetail(d));
    }
    if (method === 'm3uStatus') {
      // Diagnostics are metadata-only; no network fetch, host, username,
      // password or private stream URL is ever returned.
      const cache = vod.inMemoryCatalog;
      return respond(res,200,{
        configured:vod.isConfigured(),
        cacheReady:!!cache,
        updatedAt:cache ? (cache.fetchedAt || null) : null,
        moviesCount:cache && cache.stats ? (cache.stats.moviesCount || 0) : null,
        seriesCount:cache && cache.stats ? (cache.stats.seriesCount || 0) : null,
        episodesCount:cache && cache.stats ? (cache.stats.episodesCount || 0) : null
      });
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
      if (!permittedMediaOrigin(url) || isUnsafeHost(url.hostname)) {
        return respond(res,415,{errorText:'La fuente privada no tiene un origen HTTPS o HTTP autorizado'});
      }
      if (result.mime === 'video/x-matroska') {
        const playback=await mkvPlayback.resolveMkv({url:url.toString(),hosts:[url.hostname.toLowerCase()]});
        if(playback.busy)return respond(res,429,{errorText:'Ya hay una reproducción MKV en curso. Intenta más tarde.',errorCode:'MKV_BUSY'});
        if(playback.unsupported)return respond(res,415,{errorText:'El códec de este MKV no es compatible con el servidor.',errorCode:'MKV_CODEC_UNSUPPORTED'});
        return respond(res,200,{
          contentId:id,isHls:true,mime:'application/vnd.apple.mpegurl',
          mediaUrl:playback.mediaUrl,mediaExpiresAt:playback.expires,
          title:String(result.item && result.item.title || '')
        });
      }
      if (!['video/mp4','application/vnd.apple.mpegurl','video/mp2t'].includes(result.mime)) {
        // Do not mislabel unsupported containers as MP4 or disclose private URLs.
        const format = result.mime === 'video/x-matroska' ? 'MKV' :
          result.mime === 'video/x-msvideo' ? 'AVI' : 'desconocido';
        return respond(res,415,{
          errorText: format === 'desconocido'
            ? 'El formato de este video no es compatible con el reproductor web VIDAA'
            : 'El video está en formato '+format+', no compatible con el reproductor web VIDAA. Prueba otra fuente en MP4 o HLS.',
          errorCode: 'VOD_UNSUPPORTED_CONTAINER',
          mediaFormat: format
        });
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
      if (/^priv-[a-f0-9]{16}$/.test(code)) {
        const channels = await vod.getLiveChannels();
        const ch = channels.find(item => item.id === code);
        if (!ch || !ch.hasStream) return respond(res,404,{errorText:'Canal privado no encontrado'});
        const urlString = vod.reconstructLiveUrl(ch.streamPath);
        let uri;
        try { uri = new URL(urlString); } catch (_) { return respond(res,415,{errorText:'Origen privado no disponible'}); }
        if (!permittedMediaOrigin(uri) || isUnsafeHost(uri.hostname)) return respond(res,415,{errorText:'Origen privado no autorizado'});
        const hls = /\.m3u8$/i.test(uri.pathname);
        const mime = hls ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        const issued = registry.register({
          url:uri.toString(),hosts:[uri.hostname.toLowerCase()],
          source:'live',headers:{},mime,duration:0
        },Date.now()+15*60*1000);
        if (!issued) return respond(res,503,{errorText:'Servidor multimedia no configurado'});
        return respond(res,200,{name:ch.name,isHls:hls,mime,
          mediaUrl:'/api/media?token='+encodeURIComponent(issued.token)+(hls?'&manifest=1':''),
          mediaExpiresAt:issued.exp,sourceIndex:0,sourceCount:1});
      }
      if (!/^[A-Za-z0-9._-]{2,100}$/.test(code)) return respond(res,400,{errorText:'Canal inválido'});
      const ch=await live.getChannel(code);
      if (!ch || !ch.hasStream) return respond(res,404,{errorText:'Canal sin señal registrada'});
      const candidates=Array.isArray(ch.streams)?ch.streams:[];
      const streams=candidates.concat(ch.streamUrl?[{url:ch.streamUrl}]:[]);
      const compatible=[];
      const seen=new Set();
      for (const candidate of streams) {
        if (!candidate || !candidate.url) continue;
        let uri;
        try { uri=new URL(candidate.url); } catch (_) { continue; }
        if (!permittedLiveOrigin(uri) || isUnsafeHost(uri.hostname)) continue;
        if (!seen.has(uri.toString())) { seen.add(uri.toString()); compatible.push(uri); }
      }
      if (!compatible.length) return respond(res,415,{errorText:'No hay una fuente compatible autorizada para este canal'});
      const requested=Number(input.sourceIndex || 0);
      if (!Number.isInteger(requested) || requested<0 || requested>=compatible.length) return respond(res,404,{errorText:'No hay más señales disponibles para este canal'});
      const selected=compatible[requested];
      const hls=/\.m3u8$/i.test(selected.pathname);
      const mime=hls?'application/vnd.apple.mpegurl':'video/mp2t';
      const issued=registry.register({
        url:selected.toString(),hosts:[selected.hostname.toLowerCase()],
        source:'live',headers:{},mime,duration:0
      },Date.now()+15*60*1000);
      if (!issued) return respond(res,503,{errorText:'Servidor multimedia no configurado'});
      return respond(res,200,{
        name:String(ch.name||'TV'),isHls:hls,mime,
        mediaUrl:'/api/media?token='+encodeURIComponent(issued.token)+(hls?'&manifest=1':''),
        mediaExpiresAt:issued.exp,sourceIndex:requested,sourceCount:compatible.length
      });
    }
  } catch (_) {
    if (['liveCategories','liveChannels','m3uMovies','m3uSeries'].includes(method)) {
      const isLive = method === 'liveCategories' || method === 'liveChannels';
      const warning = isLive ? 'IPTV-org no está disponible. Vuelve a intentarlo más tarde.' :
        (vod.isConfigured() ? 'El proveedor M3U no está disponible. Vuelve a intentarlo más tarde.' : 'Configura las variables privadas M3U del servidor para cargar películas y series.');
      return respond(res,200,{categories:[],channels:[],items:[],total:0,hasMore:false,pageNum,
        configured:isLive||vod.isConfigured(),unavailable:true,warning,
        errorCode:isLive?'IPTV_UNAVAILABLE':(vod.isConfigured()?'M3U_UNAVAILABLE':'M3U_NOT_CONFIGURED')});
    }
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
module.exports.checkStream=checkStream;
module.exports.liveHealth=liveHealth;
