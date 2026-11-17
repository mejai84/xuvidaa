'use strict';

const dns = require('node:dns').promises;
const { IptvOrgProvider } = require('../iptvOrgProvider.cjs');
const { fetchText, validateUrl } = require('./safe-http.cjs');

const array = (value) => Array.isArray(value) ? value : [];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeSource(value) {
  try { return validateUrl(value).href; } catch (_) { return ''; }
}

function configuredStreamHosts(env) {
  const hosts = [];
  for (const entry of String(env.MEDIA_ALLOWED_HOSTS || '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 48)) {
    try { hosts.push(validateUrl('https://' + entry + '/').hostname); } catch (_) { /* Invalid optional hosts are never granted relay access. */ }
  }
  return Array.from(new Set(hosts));
}

function bounded(promise, milliseconds) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PROVIDER_TIMEOUT')), milliseconds); })])
    .finally(() => clearTimeout(timer));
}

class RadioBrowserAdapter {
  constructor(env = {}, options = {}) {
    this.id = 'radio_browser';
    this.name = 'Radio Browser · Radio';
    this.format = 'radio-browser';
    this.configured = true;
    this.status = 'configured';
    this.message = 'Directorio público de la aplicación original. Se consultará al abrir Radio.';
    this.sections = ['radio'];
    this.includeOnHome = false;
    this.secrets = [];
    this.streamHosts = configuredStreamHosts(env);
    this.fetch = options.fetchText || fetchText;
    this.resolveSrv = options.resolveSrv || dns.resolveSrv.bind(dns);
    this.defaultCountry = /^[A-Z]{2}$/.test(String(env.IPTV_COUNTRY || 'CO').toUpperCase()) ? String(env.IPTV_COUNTRY || 'CO').toUpperCase() : 'CO';
    this.servers = null;
    this.serverExpiry = 0;
    this.countryExpiry = 0;
    this.countries = [];
    this.cache = new Map();
    this.index = new Map();
    this.pending = new Map();
    this.failures = new Map();
    this.clicks = new Map();
    this.updatedAt = 0;
  }

  async discover() {
    if (this.servers && Date.now() < this.serverExpiry) return this.servers;
    let names = [];
    try {
      const records = await bounded(this.resolveSrv('_api._tcp.radio-browser.info'), 4000);
      names = array(records).map((record) => String(record.name || '').replace(/\.$/, '').toLowerCase())
        .filter((host) => /^[a-z0-9-]+\.api\.radio-browser\.info$/.test(host));
    } catch (_) { /* A bounded fallback still uses multiple original mirrors. */ }
    // Same public mirrors observed in the desktop, used only if DNS SRV discovery
    // is unavailable. Every actual request rechecks DNS and pins a public IP.
    this.servers = Array.from(new Set(names.length ? names : ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'all.api.radio-browser.info']));
    this.serverExpiry = Date.now() + 30 * 60 * 1000;
    return this.servers;
  }

  async request(path, maxBytes = 8 * 1024 * 1024) {
    const servers = await this.discover();
    let attempts = 0;
    for (const host of servers) {
      if (++attempts > 3) break;
      try {
        const text = await this.fetch('https://' + host + path, { allowedHosts: [host], maxBytes, timeout: 8000,
          headers: { Accept: 'application/json', 'User-Agent': 'TVVIDAA-Xuper/1.0 (Radio Browser directory)' } });
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object') throw new Error('INVALID_RADIO_RESPONSE');
        return value;
      } catch (_) { /* Try the next public mirror without forwarding secrets. */ }
    }
    throw new Error('RADIO_BROWSER_UNAVAILABLE');
  }

  station(raw) {
    if (!raw || !UUID.test(String(raw.stationuuid || '')) || Number(raw.lastcheckok) !== 1) return null;
    const source = safeSource(raw.url_resolved || raw.url);
    const codec = String(raw.codec || '').toUpperCase();
    if (!source || (!Number(raw.hls) && !['MP3', 'AAC', 'AAC+', 'OGG', 'OPUS', 'FLAC'].includes(codec))) return null;
    return { id: raw.stationuuid.toLowerCase(), title: String(raw.name || 'Radio').slice(0, 500), type: 'radio',
      country: /^[A-Z]{2}$/.test(raw.countrycode || '') ? raw.countrycode : '',
      category: String(raw.tags || 'Radio').split(',')[0].trim().slice(0, 128) || 'Radio',
      genre: String(raw.tags || '').slice(0, 500), poster: typeof raw.favicon === 'string' ? raw.favicon : '',
      synopsis: String(raw.country || '').slice(0, 128), streamUrl: source,
      mime: Number(raw.hls) ? 'application/vnd.apple.mpegurl' : codec.startsWith('AAC') ? 'audio/aac' : codec === 'FLAC' ? 'audio/flac' : ['OGG', 'OPUS'].includes(codec) ? 'audio/ogg' : 'audio/mpeg' };
  }

  remember(item) {
    this.index.set(item.id, item);
    while (this.index.size > 10000) this.index.delete(this.index.keys().next().value);
    return item;
  }

  async load(force = false, query = {}) {
    const requested = String(query.country || '');
    const country = requested === 'all' ? '' : (requested ? requested.toUpperCase() : this.defaultCountry);
    if (country && !/^[A-Z]{2}$/.test(country)) return { radio: [], countries: this.countries, warning: 'Selecciona un código de país de dos letras para Radio Browser.' };
    const name = String(query.q || '').slice(0, 120);
    const tag = query.category && query.category !== 'all' ? String(query.category).slice(0, 128) : '';
    const key = JSON.stringify([country, name, tag]);
    const cached = this.cache.get(key);
    if (!force && (this.failures.get(key) || 0) > Date.now()) {
      if (cached) return { ...cached.data, stale: true };
      throw new Error('RADIO_BROWSER_UNAVAILABLE');
    }
    if (!force && cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.data;
    if (this.pending.has(key)) return this.pending.get(key);
    const pending = (async () => {
      try {
        const params = new URLSearchParams({ hidebroken: 'true', is_https: 'true', limit: '2000', order: 'clickcount', reverse: 'true' });
        if (country) params.set('countrycode', country);
        if (name) params.set('name', name);
        if (tag) { params.set('tag', tag); params.set('tagExact', 'true'); }
        const [stations, countries] = await Promise.all([
          this.request('/json/stations/search?' + params),
          Date.now() >= this.countryExpiry ? this.request('/json/countrycodes?hidebroken=true', 1024 * 1024).catch(() => []) : Promise.resolve([])
        ]);
        if (!Array.isArray(stations) || stations.length > 2000) throw new Error('INVALID_RADIO_RESPONSE');
        if (Array.isArray(countries) && countries.length) {
          this.countries = Array.from(new Set(countries.map((entry) => String(entry.name || '').toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)))).sort();
          this.countryExpiry = Date.now() + 24 * 3600 * 1000;
        }
        const radio = stations.map((station) => this.station(station)).filter(Boolean).map((station) => this.remember(station));
        const warning = stations.length === 2000 ? 'Radio Browser: se muestran hasta 2000 emisoras HTTPS; acota la búsqueda para ver más resultados.' : '';
        const data = { radio, countries: this.countries.length ? this.countries : (country ? [country] : []), warning, stale: false };
        this.cache.set(key, { at: Date.now(), data });
        while (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
        this.failures.delete(key);
        this.updatedAt = Date.now();
        this.status = 'connected';
        this.message = warning;
        return data;
      } catch (_) {
        this.failures.set(key, Date.now() + 30000);
        while (this.failures.size > 32) this.failures.delete(this.failures.keys().next().value);
        this.status = cached ? 'stale' : 'unavailable';
        this.message = 'Radio Browser no respondió. Comprueba la conexión y vuelve a intentarlo.';
        if (cached) return { ...cached.data, stale: true };
        throw new Error('RADIO_BROWSER_UNAVAILABLE');
      } finally { this.pending.delete(key); }
    })();
    this.pending.set(key, pending);
    return pending;
  }

  async getItem(id) {
    if (!UUID.test(id)) return null;
    if (this.index.has(id.toLowerCase())) return this.index.get(id.toLowerCase());
    const rows = await this.request('/json/stations/byuuid/' + encodeURIComponent(id), 256 * 1024);
    const station = array(rows).map((row) => this.station(row)).find((item) => item && item.id === id.toLowerCase());
    return station ? this.remember(station) : null;
  }

  async resolve(id) {
    const station = await this.getItem(id);
    if (!station) return null;
    // Report a user-initiated station selection as requested by the public API.
    // This sends the server's request only, never the viewer's IP or identity.
    if (Date.now() - (this.clicks.get(station.id) || 0) > 60000) {
      this.clicks.set(station.id, Date.now());
      while (this.clicks.size > 10000) this.clicks.delete(this.clicks.keys().next().value);
      await this.request('/json/url/' + encodeURIComponent(station.id), 64 * 1024).catch(() => {});
    }
    return { ...station, found: true, live: true };
  }
}

class IptvOrgAdapter {
  constructor(env = {}, options = {}) {
    this.id = 'iptv_org';
    this.name = 'IPTV-org · TVVIDAA';
    this.format = 'iptv-org';
    this.configured = true;
    this.status = 'configured';
    this.message = 'Proveedor público existente de TVVIDAA; independiente de los proveedores originales del desktop.';
    this.sections = ['live'];
    this.includeOnHome = false;
    this.secrets = [];
    this.streamHosts = configuredStreamHosts(env);
    const download = options.fetchText || fetchText;
    this.provider = options.iptvProvider || new IptvOrgProvider({ country: env.IPTV_COUNTRY || 'CO', languagePriority: env.IPTV_LANG || 'spa',
      excludeNsfw: !['false', '0'].includes(String(env.IPTV_EXCLUDE_NSFW || 'true').toLowerCase()),
      cacheDir: env.IPTV_CACHE_DIR === 'off' || env.M3U_CACHE_DIR === 'off' ? false : (env.IPTV_CACHE_DIR || env.M3U_CACHE_DIR),
      fetchJson: async (url) => JSON.parse(await download(url, { allowedHosts: ['iptv-org.github.io'], maxBytes: 32 * 1024 * 1024, timeout: 15000 })) });
    this.provider.writeDiskCache = async () => {};
    this.catalog = null;
    this.index = new Map();
  }

  async load(force = false) {
    try {
      const data = await this.provider.refresh(force);
      const live = [];
      this.index = new Map();
      for (const channel of array(data.channels).slice(0, 10000)) {
        if (!channel || !channel.hasStream || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/.test(channel.id || '')) continue;
        const signals = array(channel.streams).filter((stream) => stream && safeSource(stream.url) && /\.m3u8(?:[?#]|$)/i.test(stream.url)).slice(0, 16)
          .map((stream, index) => ({ url: stream.url, label: stream.quality || stream.title || 'Señal ' + (index + 1),
            headers: { ...(stream.referrer && !/[\r\n]/.test(stream.referrer) ? { Referer: stream.referrer } : {}),
              ...(stream.user_agent && !/[\r\n]/.test(stream.user_agent) ? { 'User-Agent': stream.user_agent } : {}) } }));
        if (!signals.length && safeSource(channel.streamUrl) && /\.m3u8(?:[?#]|$)/i.test(channel.streamUrl)) signals.push({ url: channel.streamUrl, label: 'Señal 1', headers: {} });
        if (!signals.length) continue;
        const item = { id: channel.id, title: channel.name || channel.id, type: 'live', category: channel.category || 'General',
          country: channel.country || this.provider.country, poster: channel.logo || '', signals,
          synopsis: channel.isGeoBlocked ? 'El proveedor indica una restricción geográfica.' : '' };
        live.push(item); this.index.set(item.id, item);
      }
      this.status = data.stale ? 'stale' : 'connected';
      this.message = data.stale ? 'IPTV-org no respondió; se muestra el catálogo guardado de TVVIDAA.' : '';
      this.updatedAt = data.fetchedAt || Date.now();
      this.catalog = { live, stale: !!data.stale };
      return this.catalog;
    } catch (_) {
      this.status = this.catalog ? 'stale' : 'unavailable';
      this.message = 'No se pudo cargar IPTV-org. Los otros proveedores siguen disponibles.';
      if (this.catalog) return { ...this.catalog, stale: true };
      throw new Error('IPTV_ORG_UNAVAILABLE');
    }
  }

  async resolve(id, signal = 0) {
    const item = this.index.get(id);
    const stream = item && item.signals[signal];
    return stream ? { found: true, type: 'live', live: true, streamUrl: stream.url, mime: 'application/vnd.apple.mpegurl',
      headers: stream.headers, signalCount: item.signals.length } : null;
  }
}

module.exports = { RadioBrowserAdapter, IptvOrgAdapter };
