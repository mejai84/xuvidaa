'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { M3uProvider, parseExtInfLine } = require('../m3uProvider.cjs');
const { fetchText, validateUrl } = require('./safe-http.cjs');
const { RadioBrowserAdapter, IptvOrgAdapter } = require('./public-providers.cjs');
const { InternetArchiveAdapter } = require('./internet-archive.cjs');
const { normalizeMagisMetadata } = require('./magis-metadata.cjs');

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/;
const SECTIONS = ['movies', 'series', 'live', 'radio', 'music'];
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
const array = (value) => Array.isArray(value) ? value : [];
const sectionType = { movies: 'movie', series: 'series', live: 'live', radio: 'radio', music: 'music' };

function hostList(value) {
  if (!Array.isArray(value) || value.length > 48) return [];
  return Array.from(new Set(value.map((host) => {
    if (typeof host !== 'string' || !/^[A-Za-z0-9.:[\]-]{1,253}$/.test(host)) throw new Error('INVALID_HOST');
    return validateUrl('https://' + host + '/').hostname.toLowerCase();
  })));
}

function credentialsFor(config) {
  const values = [config.username, config.password, config.authorization].filter((value) => typeof value === 'string' && value);
  if (typeof config.authorization === 'string') {
    const match = /^[A-Za-z]+\s+(.+)$/.exec(config.authorization);
    if (match) values.push(match[1]);
  }
  for (const raw of [config.url, config.baseUrl]) {
    try {
      const url = new URL(raw);
      for (const [key, value] of url.searchParams) if (/user|pass|token|auth|key|secret|signature/i.test(key) && value) values.push(value);
    } catch (_) { /* Optional URL. */ }
  }
  return Array.from(new Set(values));
}

function audioEntries(text) {
  const items = [];
  let info = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) { info = parseExtInfLine(trimmed); continue; }
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (info && (/(?:radio|emisoras?)/i.test(info.groupTitle || '') ||
        /(?:m[uú]sica|music|audio)/i.test(info.groupTitle || '') || /\.(?:mp3|aac|ogg|opus|flac|wav)(?:[?#]|$)/i.test(trimmed))) {
      try {
        validateUrl(trimmed);
        items.push({ ...info, id: 'audio-' + hash(trimmed), title: info.title || 'Audio',
          type: /(?:radio|emisoras?)/i.test(info.groupTitle || '') ? 'radio' : 'music',
          category: info.groupTitle || 'Audio', poster: info.tvgLogo || '', streamUrl: trimmed });
      } catch (_) { /* The adapter never makes unsafe entries playable. */ }
    }
    info = null;
    if (items.length >= 20000) break;
  }
  return items;
}

function liveEntries(text) {
  const items = [];
  let info = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXTINF:')) { info = parseExtInfLine(trimmed); continue; }
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (info && !/(?:radio|emisoras?|m[uÃº]sica|music|audio)/i.test(info.groupTitle || '') &&
        (/(?:en vivo|live|canales|channels|television|noticias|deportes|\btv\b)/i.test(info.groupTitle || '') || /\.m3u8(?:[?#]|$)/i.test(trimmed))) {
      try {
        validateUrl(trimmed);
        items.push({ ...info, id: 'live-' + hash(trimmed), title: info.title || 'Canal', type: 'live',
          category: info.groupTitle || 'General', poster: info.tvgLogo || '', streamUrl: trimmed, live: true,
          isHls: /\.m3u8(?:[?#]|$)/i.test(trimmed) });
      } catch (_) { /* The adapter never makes unsafe entries playable. */ }
    }
    info = null;
    if (items.length >= 20000) break;
  }
  return items;
}

class M3uAdapter {
  constructor(config, options = {}) {
    this.id = config.id;
    this.name = config.name;
    this.format = config.format;
    this.config = config;
    this.secrets = credentialsFor(config);
    this.sections = SECTIONS;
    this.configured = !!config.url || !!(config.baseUrl && config.username && config.password);
    this.status = this.configured ? 'configured' : 'not_configured';
    this.message = this.configured ? 'Conexión pendiente de validar.' : 'Configura este proveedor autorizado en el servidor.';
    this.streamHosts = hostList(config.streamHosts || []);
    this.fetch = options.fetchText || fetchText;
    this.audio = [];
    this.live = [];
    this.lastCatalog = null;
    this.lastResult = null;
    this.nextAttemptAt = 0;
    this.lastResolveRefresh = 0;
    this.provider = options.provider || new M3uProvider({ cacheDir: config.cacheDir || false });
    // Explicit assignment avoids inheriting the default provider's environment
    // when an additional provider has an intentionally absent field.
    Object.assign(this.provider, { playlistUrl: config.url || '', baseUrl: config.baseUrl || '',
      username: config.username || '', password: config.password || '', type: config.type || 'm3u_plus' });
    if (this.configured) this.provider.fetchM3uContent = async () => {
      if (!this.configured) throw new Error('PROVIDER_NOT_CONFIGURED');
      const url = this.config.url || this.provider.buildProviderUrl();
      const parsed = validateUrl(url);
      const text = await this.fetch(url, { allowedHosts: [parsed.hostname], maxBytes: 32 * 1024 * 1024 });
      this.audio = audioEntries(text);
      this.live = liveEntries(text);
      return text;
    };
    // TVVIDAA owns its existing disk cache. This module reads it, but never
    // replaces it or changes its credential/source fingerprint.
    this.provider.writeDiskCache = async () => {};
  }

  async load(force = false) {
    if (!force && Date.now() < this.nextAttemptAt) {
      if (this.lastResult) return this.lastResult;
      throw new Error('PROVIDER_UNAVAILABLE');
    }
    try {
      const data = await this.provider.refresh(force);
      this.lastCatalog = data;
      this.status = data.stale ? 'stale' : (this.configured ? 'connected' : 'not_configured');
      this.message = data.stale ? 'Se muestra el último catálogo guardado; verifica la conexión del proveedor.' : '';
      this.nextAttemptAt = data.stale ? Date.now() + 30000 : 0;
      this.updatedAt = Number(data.fetchedAt) || 0;
      const audioIds = new Set(this.audio.map((item) => item.streamUrl));
      this.lastResult = {
        movies: array(data.movies).map((item) => ({ ...item, type: 'movie' })),
        series: array(data.series).map((item) => ({ ...item, type: 'series' })),
        live: this.live.concat(array(data.live).filter((item) => !audioIds.has(item.streamUrl)).map((item) => ({ ...item, type: 'live' }))),
        radio: this.audio.filter((item) => item.type === 'radio'),
        music: this.audio.filter((item) => item.type === 'music'), stale: !!data.stale
      };
      return this.lastResult;
    } catch (_) {
      this.nextAttemptAt = Date.now() + 30000;
      this.status = this.configured ? 'unavailable' : 'not_configured';
      this.message = this.configured ? 'No se pudo conectar. Verifica HTTPS, credenciales y disponibilidad del proveedor.' : 'Configura este proveedor autorizado en el servidor.';
      throw new Error('PROVIDER_UNAVAILABLE');
    }
  }

  async resolve(id) {
    if (!this.configured) return null;
    const audio = this.audio.find((item) => item.id === id);
    if (audio) return { ...audio, found: true, live: audio.type === 'radio' };
    const live = this.live.find((item) => item.id === id);
    if (live) return { ...live, found: true, live: true };
    // Do not let an arbitrary ID trigger the provider's forced-refresh path.
    if (!this.provider.streamIndex || !this.provider.streamIndex.has(id)) {
      this.provider.streamIndex = this.provider.buildStreamIndex(this.provider.inMemoryCatalog);
    }
    if (!this.provider.streamIndex.has(id)) {
      const data = this.lastCatalog || {};
      const known = array(data.movies).some((item) => item.id === id) || array(data.live).some((item) => item.id === id) ||
        array(data.series).some((series) => array(series.seasons).some((season) => array(season.episodes).some((episode) => episode.id === id)));
      if (!known || Date.now() - this.lastResolveRefresh < 60000) return null;
      this.lastResolveRefresh = Date.now();
      await this.load(true);
      this.provider.streamIndex = this.provider.buildStreamIndex(this.provider.inMemoryCatalog);
      if (!this.provider.streamIndex.has(id)) return null;
    }
    const value = await this.provider.resolveStream(id);
    return value && value.found ? value : null;
  }
}

function parseJsonCatalog(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_CATALOG');
  const result = Object.fromEntries(SECTIONS.map((section) => [section, []]));
  let total = 0;
  const ids = new Set();
  for (const section of SECTIONS) {
    if (raw[section] !== undefined && !Array.isArray(raw[section])) throw new Error('INVALID_CATALOG');
    for (const entry of array(raw[section])) {
      if (++total > 30000 || !entry || typeof entry !== 'object' || !ID.test(String(entry.id || '')) || ids.has(entry.id)) throw new Error('INVALID_CATALOG');
      ids.add(entry.id);
      if (typeof entry.title !== 'string' || entry.title.length > 500) throw new Error('INVALID_CATALOG');
      if (entry.signals !== undefined && (!Array.isArray(entry.signals) || entry.signals.length > 16 || entry.signals.some((signal) => !signal || typeof signal !== 'object'))) throw new Error('INVALID_CATALOG');
      const item = { ...entry, type: sectionType[section], streamUrl: entry.url || entry.streamUrl || '' };
      if (section === 'series') {
        if ((item.seasons !== undefined && !Array.isArray(item.seasons)) || array(item.seasons).length > 200) throw new Error('INVALID_CATALOG');
        item.seasons = array(item.seasons).map((season, seasonIndex) => {
          if (!season || typeof season !== 'object' || (season.episodes !== undefined && !Array.isArray(season.episodes)) || array(season.episodes).length > 5000) throw new Error('INVALID_CATALOG');
          const seasonId = String(season.id || item.id + '-s' + (seasonIndex + 1));
          if (!ID.test(seasonId)) throw new Error('INVALID_CATALOG');
          return { id: seasonId, number: season.number || seasonIndex + 1,
            title: season.title || 'Temporada ' + (seasonIndex + 1), episodes: array(season.episodes).map((episode, index) => {
              if (++total > 30000 || !episode || !ID.test(String(episode.id || '')) || ids.has(episode.id)) throw new Error('INVALID_CATALOG');
              ids.add(episode.id);
              return { ...episode, type: 'episode', title: episode.title || 'Episodio ' + (index + 1), number: episode.number || index + 1,
                streamUrl: episode.url || episode.streamUrl || '', season: season.number || seasonIndex + 1 };
            }) };
        });
      }
      result[section].push(item);
    }
  }
  return result;
}

class JsonAdapter {
  constructor(config, options = {}) {
    this.id = config.id;
    this.name = config.name;
    this.format = config.format === 'magis-metadata' ? 'magis-metadata' : 'json';
    this.config = config;
    this.secrets = credentialsFor(config);
    this.configured = !!config.url;
    this.sections = this.format === 'magis-metadata' ? ['movies', 'series'] : SECTIONS;
    this.status = this.configured ? 'configured' : 'not_configured';
    this.message = this.format === 'magis-metadata'
      ? 'Solo metadatos: no incluye enlaces ni permisos de reproducción.'
      : (this.configured ? 'Conexión pendiente de validar.' : 'Configura un catálogo JSON autorizado en el servidor.');
    this.fetch = options.fetchText || fetchText;
    this.streamHosts = hostList(config.streamHosts || []);
    this.cached = null;
    this.updatedAt = 0;
    this.pending = null;
    this.ttlMs = 15 * 60 * 1000;
    this.nextAttemptAt = 0;
  }

  async load(force = false) {
    if (!force && Date.now() < this.nextAttemptAt) {
      if (this.cached) return { ...this.cached, stale: true };
      throw new Error('PROVIDER_UNAVAILABLE');
    }
    if (!force && this.cached && this.status !== 'stale' && Date.now() - this.updatedAt < this.ttlMs) return this.cached;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        if (!this.configured) throw new Error('PROVIDER_NOT_CONFIGURED');
        const url = validateUrl(this.config.url);
        const headers = this.config.authorization ? { Authorization: this.config.authorization } : {};
        const content = await this.fetch(url.href, { allowedHosts: [url.hostname], maxBytes: 16 * 1024 * 1024, headers });
        const payload = JSON.parse(content);
        this.cached = parseJsonCatalog(this.format === 'magis-metadata' ? normalizeMagisMetadata(payload) : payload);
        this.status = 'connected';
        this.nextAttemptAt = 0;
        this.message = this.format === 'magis-metadata' ? 'Solo metadatos autorizados; sin reproducción habilitada.' : '';
        this.updatedAt = Date.now();
        return this.cached;
      } catch (_) {
        this.nextAttemptAt = Date.now() + 30000;
        this.status = this.cached ? 'stale' : (this.configured ? 'unavailable' : 'not_configured');
        this.message = this.cached ? 'Se muestra el último catálogo guardado; el proveedor no respondió.' : 'No se pudo conectar al catálogo autorizado.';
        if (this.cached) return { ...this.cached, stale: true };
        throw new Error('PROVIDER_UNAVAILABLE');
      } finally { this.pending = null; }
    })();
    return this.pending;
  }

  async resolve(id, signal = 0) {
    if (!this.configured || !this.cached || this.format === 'magis-metadata') return null;
    const items = SECTIONS.flatMap((section) => this.cached[section]);
    for (const series of this.cached.series) for (const season of series.seasons || []) items.push(...season.episodes);
    const item = items.find((entry) => entry.id === id);
    if (!item) return null;
    const sources = array(item.signals).slice(0, 16);
    const streamUrl = sources.length ? sources[signal] && (sources[signal].url || sources[signal].streamUrl) : item.streamUrl;
    return streamUrl ? { found: true, ...item, streamUrl, live: item.type === 'live' || item.type === 'radio', signalCount: sources.length || 1 } : null;
  }
}

function disabled(id, name, message) {
  return { id, name, format: 'unverified', configured: false, status: 'pending_verification', sections: [],
    message, secrets: [], streamHosts: [], async load() { return {}; }, async resolve() { return null; } };
}

function createRegistry(env = process.env, options = {}) {
  const baseCache = env.M3U_CACHE_DIR === 'off' ? false : (env.M3U_CACHE_DIR || path.join(__dirname, '../..', '.cache'));
  const providers = [];
  try {
    providers.push(new M3uAdapter({ id: 'existing_private_m3u', name: 'Proveedor M3U actual', format: env.M3U_BASE_URL ? 'xtream' : 'm3u',
      url: env.M3U_URL || '', baseUrl: env.M3U_BASE_URL || '', username: env.M3U_USERNAME || '', password: env.M3U_PASSWORD || '',
      type: env.M3U_TYPE || 'm3u_plus', cacheDir: baseCache, streamHosts: String(env.MEDIA_ALLOWED_HOSTS || '').split(',').map((value) => value.trim()).filter(Boolean) }, options));
  } catch (_) {
    providers.push(disabled('existing_private_m3u', 'Proveedor M3U actual', 'Revisa los hosts multimedia configurados en el servidor.'));
  }
  if (env.XUPER_PROVIDERS_JSON) {
    try {
      if (Buffer.byteLength(env.XUPER_PROVIDERS_JSON) > 128 * 1024) throw new Error('INVALID_PROVIDERS');
      const configs = JSON.parse(env.XUPER_PROVIDERS_JSON);
      if (!Array.isArray(configs) || configs.length > 8) throw new Error('INVALID_PROVIDERS');
      const ids = new Set(['existing_private_m3u', 'xuper_premium', 'provider_configuration', 'radio_browser', 'iptv_org', 'internet_archive', 'lamovie', 'youtube_music']);
      const added = [];
      for (const config of configs) {
        if (!config || typeof config !== 'object' || !/^[a-z][a-z0-9_-]{0,47}$/.test(config.id || '') || ids.has(config.id) ||
            typeof config.name !== 'string' || !config.name.trim() || config.name.length > 100 ||
            !['m3u', 'xtream', 'json', 'magis-metadata'].includes(config.format) || config.authorized !== true) throw new Error('INVALID_PROVIDERS');
        if (credentialsFor(config).some((value) => value.length >= 3 ? config.id.includes(value) || config.id.includes(encodeURIComponent(value)) : config.id === value)) throw new Error('INVALID_PROVIDERS');
        ids.add(config.id);
        for (const field of ['url', 'baseUrl', 'username', 'password', 'authorization']) if (config[field] !== undefined && (typeof config[field] !== 'string' || config[field].length > 8192 || /[\r\n]/.test(config[field]))) throw new Error('INVALID_PROVIDERS');
        if (config.url) validateUrl(config.url);
        if (config.baseUrl) validateUrl(config.baseUrl);
        added.push(['json', 'magis-metadata'].includes(config.format)
          ? new JsonAdapter(config, options) : new M3uAdapter({ ...config, cacheDir: false }, options));
      }
      providers.push(...added);
    } catch (_) {
      providers.push(disabled('provider_configuration', 'Configuración de proveedores', 'Revisa XUPER_PROVIDERS_JSON: identificadores únicos, HTTPS y authorized: true son obligatorios.'));
    }
  }
  providers.push(new RadioBrowserAdapter(env, options));
  if (/^(?:true|1)$/i.test(String(env.XUPER_ENABLE_ARCHIVE || ''))) {
    const archive = new InternetArchiveAdapter(options);
    archive.name = 'Internet Archive · Fuente heredada';
    providers.push(archive);
  } else {
    providers.push({ ...disabled('internet_archive', 'Internet Archive · Fuente heredada (opcional)',
      'Fuente heredada incluida en el paquete, distinta de LaMovie. Habilítala explícitamente con XUPER_ENABLE_ARCHIVE=true.'),
    format: 'internet_archive', status: 'not_configured', sections: ['movies'], includeOnHome: false });
  }
  try { providers.push(new IptvOrgAdapter(env, options)); }
  catch (_) { providers.push(disabled('iptv_org', 'IPTV-org · TVVIDAA', 'Revisa el país y el idioma del proveedor existente de TVVIDAA.')); }
  providers.push(disabled('xuper_premium', 'Magis / Xuper · Portal original', 'Pendiente de API y autenticación autorizadas. No se importan claves, sesiones ni identidades del portable.'));
  providers.push(disabled('lamovie', 'LaMovie · Videoteca original', 'Proveedor identificado en el desktop. Su autorización y mecanismo de integración permitido están pendientes de verificar.'));
  providers.push({ ...disabled('youtube_music', 'YouTube Music · YouMusic', 'Abre YouTube Music e inicia sesión en su sitio oficial.'),
    status: 'official_link', officialUrl: 'https://music.youtube.com/' });
  for (const provider of providers) {
    if (provider.id === 'iptv_org') { provider.origin = 'tvvidaa'; provider.role = 'supplementary'; }
    else if (provider.id === 'internet_archive') { provider.origin = 'desktop'; provider.role = 'legacy'; }
    else if (['radio_browser', 'xuper_premium', 'lamovie', 'youtube_music'].includes(provider.id)) { provider.origin = 'desktop'; provider.role = 'original'; }
    else if (provider.id === 'existing_private_m3u') { provider.origin = 'existing_configuration'; provider.role = 'user_configured'; }
    else { provider.origin = 'server_configuration'; provider.role = 'custom'; }
  }
  return providers;
}

module.exports = { createRegistry, M3uAdapter, JsonAdapter, parseJsonCatalog, credentialsFor, hostList, ID, SECTIONS };
