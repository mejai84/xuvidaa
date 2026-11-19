'use strict';

const { fetchText, validateUrl } = require('./safe-http.cjs');
const { XuperLocators, idFor } = require('./xuper-locators.cjs');

const SLUG = /^[a-zA-Z0-9_-]{1,160}$/;
const TYPES = { movie: 'movies', series: 'series' };
const clean = (value, max = 220) => typeof value === 'string' || typeof value === 'number'
  ? String(value).replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, '[enlace]')
    .replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';

class LaMovieAdapter {
  constructor(config = {}, options = {}) {
    this.id = config.id || 'lamovie';
    this.name = 'LaMovie · Videoteca';
    this.format = 'lamovie';
    this.origin = 'desktop';
    this.role = 'original';
    this.base = validateUrl(config.baseUrl);
    if (this.base.pathname !== '/' || this.base.search) throw new Error('INVALID_PROVIDERS');
    this.fetch = options.fetchText || fetchText;
    this.sections = ['movies', 'series'];
    this.streamHosts = [this.base.hostname];
    this.secrets = [];
    this.configured = true;
    this.status = 'configured';
    this.known = new Map();
    this.cache = new Map();
    this.pending = new Map();
    this.locators = new XuperLocators(options.cacheDir, options.mediaTokenSecret, config, this.streamHosts, []);
  }

  apiUrl(relative) {
    const url = new URL(relative, this.base);
    validateUrl(url.href, [this.base.hostname]);
    if (url.origin !== this.base.origin || url.pathname.includes('..')) throw new Error('INVALID_PROVIDER_RESPONSE');
    return url;
  }

  async request(relative, fresh = false) {
    const url = this.apiUrl(relative);
    const key = url.href;
    const hit = this.cache.get(key);
    if (!fresh && hit && Date.now() - hit.at < 300000) return hit.data;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 4) throw new Error('PROVIDER_BUSY');
    const task = (async () => {
      const body = await this.fetch(url.href, { allowedHosts: [this.base.hostname], maxBytes: 8 * 1024 * 1024, timeout: 20000 });
      const data = JSON.parse(body);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_PROVIDER_RESPONSE');
      // Signed media links are requested fresh and never added to the metadata cache.
      if (!fresh) {
        this.cache.delete(key);
        this.cache.set(key, { at: Date.now(), data });
        while (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value);
      }
      return data;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  card(raw, type, source, parent = '') {
    if (!SLUG.test(parent || source) || !clean(raw?.title || raw?.name)) return null;
    const item = { id: idFor(type, parent, source), type, title: clean(raw.title || raw.name),
      year: clean(raw.year, 8), synopsis: clean(raw.overview_tmdb || raw.tmdb_overview || raw.overview || raw.description, 4000),
      duration: Math.max(0, Number(raw.runtime) || 0) * 60 };
    const genres = raw.genres_tmdb || raw.tmdb_genres || raw.genres || [];
    item.genre = (Array.isArray(genres) ? genres : [genres]).slice(0, 20).map(g => clean(g?.name || g, 60)).filter(Boolean).join(', ').slice(0, 120);
    item.category = item.genre.split(', ')[0] || 'General';
    for (const [field, value] of [['poster', raw.poster_tmdb || raw.tmdb_poster || raw.image || raw.still], ['backdrop', raw.backdrop]]) {
      try {
        const image = validateUrl(value);
        if (!image.search) item[field] = image.href;
      } catch { /* Artwork is optional. */ }
    }
    if (type === 'episode') {
      [item.season, item.number] = source.split(':').map(Number);
    }
    this.known.delete(item.id);
    this.known.set(item.id, { source, parent, item });
    while (this.known.size > 10000) this.known.delete(this.known.keys().next().value);
    return item;
  }

  async load(force = false, query = {}) {
    const section = query.section || 'home';
    const q = clean(query.q || '', 120);
    const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
    const scopes = section === 'series' ? ['series'] : section === 'movies' ? ['movies'] : ['movies', 'series'];
    const catalog = { movies: [], series: [] };
    try {
      const routes = q ? ['/buscar?q=' + encodeURIComponent(q) + '&page=' + page] :
        scopes.map(s => (s === 'series' ? '/generos/series/comedia' : '/generos/peliculas/suspense') + '?page=' + page);
      const data = await Promise.all(routes.map(route => this.request(route, force)));
      for (const payload of data) {
        const rows = payload.items || payload.results;
        if (!Array.isArray(rows) || rows.length > 200) throw new Error('INVALID_PROVIDER_RESPONSE');
        for (const raw of rows) {
          const type = raw?.type === 'tvshows' || raw?.type === 'series' ? 'series' : 'movie';
          if (!scopes.includes(TYPES[type]) || !SLUG.test(raw?.slug)) continue;
          const item = this.card(raw, type, raw.slug);
          if (item) catalog[TYPES[type]].push(item);
        }
      }
      if (data.length === 1) {
        const raw = data[0], rows = raw.items || raw.results;
        if (raw.next_page_url) this.apiUrl(raw.next_page_url);
        catalog.pagination = { page, pageSize: Math.max(1, rows.length), hasMore: !!raw.next_page_url,
          total: Math.max(rows.length, Number(raw.total_results) || 0) };
      }
      this.locators.remember([...catalog.movies, ...catalog.series].map(item => this.known.get(item.id)));
      this.status = 'connected';
      this.updatedAt = Date.now();
      this.message = '';
      return catalog;
    } catch {
      this.status = 'unavailable';
      this.message = 'No se pudo consultar el catálogo de LaMovie.';
      throw new Error('PROVIDER_UNAVAILABLE');
    }
  }

  async detail(ref, fresh = false) {
    const type = ref.item.type;
    let route = (type === 'movie' ? '/pelicula/' : '/serie/') + (ref.parent || ref.source);
    if (type === 'episode') {
      const match = /^(\d{1,3}):(\d{1,5})$/.exec(ref.source);
      if (!match || !SLUG.test(ref.parent)) return null;
      route += '/' + Number(match[1]) + '/' + Number(match[2]);
    } else if (!SLUG.test(ref.source)) return null;
    const raw = await this.request(route, fresh);
    if (type !== 'episode' && raw.slug !== ref.source) return null;
    if (type === 'episode' && (raw.serie_slug !== ref.parent || Number(raw.season) + ':' + Number(raw.episode) !== ref.source)) return null;
    const item = this.card(raw, type, ref.source, ref.parent);
    if (!item) return null;
    const servers = raw.embeds?.video;
    if (Array.isArray(servers)) item.signals = [{ label: 'Automático' }].concat(servers.slice(0, 14).map((server, index) => ({
      label: clean([server.name || server.server || 'Servidor ' + (index + 1), server.language, server.quality].filter(Boolean).join(' · '), 120)
    })));
    if (type === 'series') {
      if (!Array.isArray(raw.temporadas) || raw.temporadas.length > 100) throw new Error('INVALID_PROVIDER_RESPONSE');
      item.seasons = [];
      for (const season of raw.temporadas) {
        const number = Number(season.season_number);
        if (!Number.isInteger(number) || number < 0 || number > 999 || !Array.isArray(season.episodios) || season.episodios.length > 1000) continue;
        const episodes = [];
        for (const ep of season.episodios) {
          const n = Number(ep.episode_number);
          if (!Number.isInteger(n) || n < 1 || n > 99999) continue;
          const card = this.card(ep, 'episode', number + ':' + n, ref.source);
          if (card) episodes.push(card);
        }
        item.seasons.push({ id: idFor('season', ref.source, String(number)), number, title: 'Temporada ' + number,
          episodes: episodes.sort((a, b) => a.number - b.number) });
      }
      item.seasons.sort((a, b) => a.number - b.number);
      this.locators.remember(item.seasons.flatMap(s => s.episodes.map(ep => this.known.get(ep.id))));
    }
    this.locators.remember([this.known.get(item.id)]);
    return { item, raw };
  }

  async getItem(id) {
    const ref = this.known.get(id) || this.locators.get(id);
    if (!ref) return null;
    return (await this.detail(ref))?.item || null;
  }

  async resolve(id, signal = 0) {
    const ref = this.known.get(id) || this.locators.get(id);
    if (!ref || ref.item.type === 'series' || !Number.isInteger(signal) || signal < 0 || signal > 15) return null;
    const detail = await this.detail(ref, true);
    const servers = detail?.raw?.embeds?.video;
    if (!Array.isArray(servers)) return null;
    const selected = signal === 0 ? servers.slice(0, 3) : [servers[signal - 1]];
    const candidates = [], proxies = [];
    for (const server of selected) {
      if (!server?.stream_url) continue;
      try {
        const resolver = this.apiUrl(server.stream_url);
        if (resolver.pathname !== '/streamurl') continue;
        const data = await this.request(resolver.href, true);
        const qualities = (Array.isArray(data.qualities) ? data.qualities : []).slice(0, 16);
        candidates.push(...qualities.map(v => ({ url: v?.url, proxy: false })));
        if (Array.isArray(data.videos?.hls)) candidates.push(...data.videos.hls.slice(0, 16).map(url => ({ url, proxy: false })));
        proxies.push(...qualities.map(v => ({ url: v?.proxy_url, proxy: true })));
      } catch { /* Another explicitly listed server can still be available. */ }
    }
    candidates.push(...proxies);
    for (const candidate of candidates) {
      try {
        const media = candidate.proxy ? this.apiUrl(candidate.url) : validateUrl(candidate.url);
        const allowed = candidate.proxy ? media.pathname === '/streamproxy' :
          ['vimeos.net', 'vimeos.zip'].some(host => media.hostname === host || media.hostname.endsWith('.' + host));
        if (!allowed) continue;
        this.streamHosts = [...new Set([this.base.hostname, media.hostname, ...this.streamHosts])].slice(0, 48);
        return { found: true, streamUrl: media.href, mime: 'application/vnd.apple.mpegurl', isHls: true,
          duration: detail.item.duration, live: false };
      } catch { /* Only an explicit HTTPS media host can become a relay source. */ }
    }
    return null;
  }
}

module.exports = { LaMovieAdapter };
