'use strict';

const { XuperLocators, idFor } = require('./xuper-locators.cjs');
const { validateUrl, fetchText } = require('./safe-http.cjs');

// The four routes belong to an operator-authorized HTTPS catalog service. The
// provider never contacts a device portal, forwards media headers or uses a local proxy.
const ROUTES = new Set(['home', 'search', 'detail', 'resolve']);
const TTL = 60000;
const upstreamId = value => typeof value === 'string' || Number.isSafeInteger(value)
  ? (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/.test(String(value)) ? String(value) : '') : '';

function store(map, key, value, limit) {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

function records(value, max) {
  if (!Array.isArray(value) || value.length > max) throw new Error('INVALID_PROVIDER_RESPONSE');
  return value;
}

function durationSeconds(value) {
  const clock = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(String(value || ''));
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric > 100000 ? numeric / 1000 : numeric;
}

function directMime(url, data) {
  const reported = String(data.mime || '').split(';')[0].trim().toLowerCase();
  const hls = 'application/vnd.apple.mpegurl';
  const mediaTypes = { 'application/x-mpegurl': hls, 'audio/mpegurl': hls, [hls]: hls,
    'video/mp4': 'video/mp4', 'video/mp2t': 'video/mp2t' };
  const mime = Object.hasOwn(mediaTypes, reported) ? mediaTypes[reported] : '';
  if (reported && !mime && reported !== 'application/octet-stream') return '';
  const suffix = /\.(m3u8|mp4|m2ts|ts)$/i.exec(url.pathname)?.[1].toLowerCase();
  if (!suffix) {
    if (/\.(?:mkv|avi|mpd|webm|mov|flv|m4s|aac|mp3)$/i.test(url.pathname)) return '';
    // A loopback HLS wrapper can describe a different format than the raw URL.
    if (mime === hls && data.proxyPath && data.proxyPath !== data.url) return '';
    return mime;
  }
  const expected = { m3u8: hls, mp4: 'video/mp4', ts: 'video/mp2t', m2ts: 'video/mp2t' }[suffix];
  if (!mime || mime === expected) return expected;
  // The upstream development dispatcher changes the MIME for its own TS proxy.
  if (expected === 'video/mp2t' && mime === hls && data.proxyPath && data.proxyPath !== data.url) return expected;
  return '';
}

class XuperHttpAdapter {
  constructor(config, streamHosts, secrets, options = {}) {
    this.base = validateUrl(config.baseUrl);
    if (this.base.search || config.url || config.username || config.password || !streamHosts.length) throw new Error('INVALID_PROVIDERS');
    if (!this.base.pathname.endsWith('/')) this.base.pathname += '/';
    this.id = config.id;
    this.name = config.name;
    this.format = 'xuper-http';
    this.configured = true;
    this.sections = ['movies', 'series'];
    this.streamHosts = streamHosts;
    this.secrets = secrets;
    this.authorization = config.authorization || '';
    this.fetch = options.fetchText || fetchText;
    this.now = options.now || Date.now;
    this.status = 'configured';
    this.message = 'Conexión pendiente de validar.';
    this.known = new Map();
    this.locators = new XuperLocators(options.cacheDir, options.locatorKey, config, streamHosts, secrets);
    this.cache = new Map();
    this.pending = new Map();
  }

  async request(route, params) {
    if (!ROUTES.has(route)) throw new Error('INVALID_ROUTE');
    const url = new URL(route, this.base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const headers = this.authorization ? { Authorization: this.authorization } : {};
    try {
      const body = await this.fetch(url.href, { allowedHosts: [this.base.hostname], headers, maxBytes: 2 * 1024 * 1024, timeout: 8000 });
      const response = JSON.parse(body);
      if (response?.returnValue !== true) throw new Error('INVALID_PROVIDER_RESPONSE');
      return response;
    } catch {
      throw new Error('PROVIDER_UNAVAILABLE');
    }
  }

  async cached(key, force, get) {
    const cached = this.cache.get(key);
    if (!force && cached && this.now() - cached.at < TTL) return cached.data;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 8) throw new Error('PROVIDER_BUSY');
    const task = get().then(data => {
      store(this.cache, key, { at: this.now(), data }, 32);
      return data;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  text(value, max = 220) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    let result = String(value).replace(/https?:\/\/\S+/gi, '[enlace privado]').replace(/[\x00-\x1f\x7f]/g, ' ');
    for (const secret of this.secrets) result = result.split(secret).join('[privado]').split(encodeURIComponent(secret)).join('[privado]');
    return result.trim().slice(0, max);
  }

  card(raw, type, parent = '') {
    const source = upstreamId(raw?.id);
    if (!source) return null;
    const title = this.text(raw.title || raw.name);
    if (!title) return null;
    const item = {
      id: idFor(type, parent, source), type, title, category: this.text(raw.category, 128),
      year: this.text(raw.year, 8), synopsis: this.text(raw.synopsis || raw.description, 4000), country: this.text(raw.country, 64),
      genre: this.text(Array.isArray(raw.genres) ? raw.genres.filter(g => typeof g === 'string').join(', ') : raw.genre, 120),
      duration: durationSeconds(raw.duration)
    };
    // The API separately validates artwork extension, URL policy and credentials.
    for (const key of ['poster', 'backdrop']) {
      const imageUrl = key === 'poster' ? raw.poster || raw.picture : raw.backdrop || raw.landscape;
      if (typeof imageUrl !== 'string' || this.secrets.some(s => imageUrl.includes(s) || imageUrl.includes(encodeURIComponent(s)))) continue;
      try {
        const picture = validateUrl(imageUrl);
        if (!picture.search && /\.(?:png|jpe?g|webp|avif)$/i.test(picture.pathname)) item[key] = picture.href;
      } catch { /* Optional artwork. */ }
    }
    if (type === 'episode') item.number = Math.max(1, Number(raw.number) || 1);
    store(this.known, item.id, { source, parent, item }, 10000);
    return item;
  }

  async load(force = false, query = {}) {
    const root = query.section || 'home';
    const q = String(query.q || '').trim().slice(0, 120);
    const scopes = ['movies', 'series', 'anime', 'kids'].includes(root) ? [root] : ['movies', 'series'];
    try {
      const groups = q ? [await this.cached('q:' + q, force, () => this.list('search', { value: q }))] :
        await Promise.all(scopes.map(section => this.cached('home:' + section, force, () => this.list('home', { root: section }))));
      const catalog = { movies: [], series: [] };
      const seen = new Set();
      for (const group of groups) for (const raw of group) {
        const type = raw?.type === 'teleplay' || raw?.type === 'series' || raw?.kind === 'serie' ? 'series' : 'movie';
        const item = this.card(raw, type);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        catalog[type === 'series' ? 'series' : 'movies'].push(item);
      }
      this.locators.remember([...seen].map(id => this.known.get(id)));
      this.status = 'connected';
      this.message = '';
      this.updatedAt = this.now();
      return catalog;
    } catch {
      this.status = 'unavailable';
      this.message = 'No se pudo consultar el catálogo autorizado.';
      throw new Error('PROVIDER_UNAVAILABLE');
    }
  }

  async list(route, params) {
    const response = await this.request(route, params);
    // Cache only the typed, whitelisted catalog fields. Control replies may
    // contain operational metadata which must never be returned as a card.
    return records(response.items, 1000).filter(raw => raw && upstreamId(raw.id)).map(raw => ({
      id: raw.id, title: raw.title || raw.name, type: raw.type, kind: raw.kind, year: raw.year, synopsis: raw.synopsis,
      category: raw.category, country: raw.country, genre: raw.genre, genres: raw.genres, duration: raw.duration,
      poster: raw.poster, backdrop: raw.backdrop || raw.landscape
    }));
  }

  async getItem(id) {
    const known = this.known.get(id);
    if (known?.item.type === 'episode') return known.item;
    const ref = known || this.locators.get(id);
    if (!ref) return null;
    return this.cached('detail:' + id, false, async () => {
      if (ref.item.type !== 'episode') return this.detail(ref);
      const data = await this.request('detail', { contentId: ref.parent });
      if (upstreamId(data.item?.id) !== ref.parent) return null;
      const raw = records(data.episodes || [], 500).find(entry => upstreamId(entry?.id) === ref.source);
      const item = this.card(raw, 'episode', ref.parent);
      if (item) item.season = ref.item.season;
      return item;
    });
  }

  async detail(known) {
    const response = await this.request('detail', { contentId: known.source });
    if (upstreamId(response.item?.id) !== known.source) throw new Error('INVALID_PROVIDER_RESPONSE');
    const item = this.card(response.item, known.item.type) || (known.item.title ? known.item : null);
    if (!item) return null;
    if (item.type !== 'series') return item;
    const declared = records(response.seasons || [], 40);
    const unique = new Map();
    for (const raw of declared) {
      const season = upstreamId(raw?.id);
      if (season && !unique.has(season)) unique.set(season, Number(raw.number) || unique.size + 1);
    }
    if (!unique.has(known.source) && (!unique.size || response.episodes?.length)) {
      const label = /\bS(\d+)\b/i.exec(String(response.item.alias || '')) || /\bT(\d+)\b/i.exec(String(response.item.title || ''));
      unique.set(known.source, label ? Math.max(1, Number(label[1])) : 1);
    }
    const entries = [...unique.entries()].sort((a, b) => a[1] - b[1]);
    const seasons = [];
    for (let i = 0; i < entries.length; i += 3) {
      const batch = await Promise.all(entries.slice(i, i + 3).map(async ([season, number]) => {
        const data = season === known.source ? response : await this.request('detail', { contentId: season });
        if (upstreamId(data.item?.id) !== season) throw new Error('INVALID_PROVIDER_RESPONSE');
        const episodes = [];
        for (const raw of records(data.episodes || [], 500)) {
          const episode = this.card(raw, 'episode', season);
          if (episode) { episode.season = number; episodes.push(episode); }
        }
        return { id: idFor('season', known.source, season), number, title: 'Temporada ' + number, episodes };
      }));
      seasons.push(...batch);
      this.locators.remember(batch.flatMap(season => season.episodes.map(ep => this.known.get(ep.id))));
    }
    return { ...item, seasons };
  }

  async resolve(id, signal = 0) {
    if (signal !== 0) return null;
    let known = this.known.get(id);
    if (!known) {
      const item = await this.getItem(id);
      if (item) known = this.known.get(id) || this.locators.get(id);
    }
    if (!known || known.item.type === 'series') return null;
    const params = { contentId: known.source };
    if (known.parent) params.seriesContentId = known.parent;
    const data = await this.request('resolve', params);
    if (data.headers && Object.keys(data.headers).length) return null;
    let url;
    try { url = validateUrl(data.url, this.streamHosts); } catch { return null; }
    const mime = directMime(url, data);
    if (!mime) return null;
    return { found: true, streamUrl: url.href, mime, duration: durationSeconds(data.duration) || known.item.duration,
      isHls: mime === 'application/vnd.apple.mpegurl', live: false };
  }
}

module.exports = { XuperHttpAdapter };

