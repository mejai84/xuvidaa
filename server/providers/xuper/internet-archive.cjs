'use strict';

const { fetchText, validateUrl } = require('./safe-http.cjs');

// This is the Internet Archive source present in the supplied desktop's
// service/videoteca.js. It is separate from that build's active LaMovie API.
const COLLECTIONS = new Map([
  ['feature_films', 'Clásicos más vistos'], ['Film_Noir', 'Cine negro'],
  ['SciFi_Horror', 'Terror y ciencia ficción'], ['Comedy_Films', 'Comedia clásica'],
  ['silent_films', 'Cine mudo'], ['classic_cartoons', 'Dibujos animados clásicos']
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const STORAGE_HOST = /^ia\d{5,8}\.(?:us|eu)\.archive\.org$/;
const TTL = 15 * 60 * 1000;
const MAX_ROWS = 40;
const MAX_METADATA_ITEMS = 200;
const array = (value) => Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
const text = (value, max = 500) => (typeof value === 'number' ? String(value) : array(value).join(' ')).replace(/<[^>]*>/g, ' ').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const marked = (value) => value === true || value === 1 || /^(?:true|1|yes)$/i.test(String(value || ''));
const escaped = (value) => value.replace(/([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');

function licenseOf(value) {
  const values = array(value);
  if (!values.length || values.length > 8) return '';
  const licenses = values.map((raw) => {
    try {
      const url = new URL(raw);
      if (!['https:', 'http:'].includes(url.protocol) || !['creativecommons.org', 'www.creativecommons.org'].includes(url.hostname) ||
          url.username || url.password || url.port || url.search || url.hash ||
          !/^\/(?:publicdomain\/(?:zero|mark)\/1\.0|licenses\/publicdomain)\/?$/.test(url.pathname)) return '';
      return 'https://creativecommons.org' + url.pathname.replace(/\/?$/, '/');
    } catch (_) { return ''; }
  });
  return licenses.every(Boolean) ? licenses[0] : '';
}

function collectionOf(metadata) {
  return array(metadata.collection).find((collection) => COLLECTIONS.has(collection)) || '';
}

function permitted(metadata, record = {}) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) &&
    metadata.mediatype === 'movies' && collectionOf(metadata) && licenseOf(metadata.licenseurl) &&
    ![record.is_dark, record.is_restricted, record.is_borrowable, metadata.is_dark,
      metadata.is_restricted, metadata.is_borrowable, metadata['access-restricted-item']].some(marked);
}

function durationOf(value) {
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value || ''))) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.min(number, 172800) : 0;
  }
  const clock = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/.exec(String(value || ''));
  return clock ? Math.min(Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]), 172800) : 0;
}

function fileName(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\\\x00-\x1f\x7f?#]/.test(value)) return '';
  const parts = value.split('/');
  if (parts.length > 12 || parts.some((part) => !part || part === '.' || part === '..')) return '';
  return parts.map(encodeURIComponent).join('/');
}

function mediaFrom(record, identifier) {
  if (!permitted(record.metadata, record) || record.metadata.identifier !== identifier ||
      !Array.isArray(record.files) || record.files.length > 10000 ||
      record.dir !== '/' + String(record.dir || '').split('/')[1] + '/items/' + identifier ||
      !/^\/\d{1,3}\/items\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(record.dir)) return null;
  const hosts = Array.from(new Set([record.d1, record.d2, record.server].filter((host) => typeof host === 'string' && STORAGE_HOST.test(host))));
  if (!hosts.length) return null;
  const candidates = record.files.filter((file) => file && !marked(file.private) && !marked(file.is_restricted) &&
    /\.mp4$/i.test(file.name || '') && fileName(file.name) &&
    /^(?:h\.?264(?:\s+(?:HD|IA))?|(?:64Kb|256Kb|512Kb|1Mb|2Mb|3Mb) MPEG4|MPEG4)$/i.test(file.format || '') &&
    Number(file.size) > 0 && Number(file.size) <= 16 * 1024 ** 3 &&
    (!file.height || Number(file.height) <= 1080));
  candidates.sort((left, right) => {
    const rank = (file) => /^h\.?264/i.test(file.format) ? 0 : (/512Kb/i.test(file.format) ? 1 : 2);
    return rank(left) - rank(right) || Number(left.size) - Number(right.size);
  });
  const selected = candidates[0];
  if (!selected) return null;
  const url = validateUrl('https://' + hosts[0] + record.dir + '/' + fileName(selected.name), hosts);
  return { streamUrl: url.href, hosts, duration: durationOf(selected.length || selected.duration || record.metadata.runtime), mime: 'video/mp4' };
}

function card(metadata) {
  if (!permitted(metadata) || !IDENTIFIER.test(metadata.identifier || '') || !text(metadata.title)) return null;
  const collection = collectionOf(metadata);
  return {
    id: 'ia:' + metadata.identifier, title: text(metadata.title), type: 'movie',
    synopsis: text(metadata.description, 4000), poster: '', backdrop: '',
    category: COLLECTIONS.get(collection), genre: text(metadata.subject, 120),
    year: text(metadata.year || metadata.date, 4), duration: durationOf(metadata.runtime),
    licenseUrl: licenseOf(metadata.licenseurl), sourceName: 'Internet Archive',
    sourceUrl: 'https://archive.org/details/' + encodeURIComponent(metadata.identifier),
    attribution: text(metadata.creator, 300)
  };
}

class InternetArchiveAdapter {
  constructor(options = {}) {
    this.id = 'internet_archive';
    this.name = 'Internet Archive · Videoteca';
    this.format = 'internet_archive';
    this.configured = true;
    this.status = 'configured';
    this.message = 'Videoteca pública filtrada por licencia de dominio público o CC0.';
    this.sections = ['movies'];
    this.includeOnHome = false;
    this.secrets = [];
    this.streamHosts = ['archive.org'];
    this.fetch = options.fetchText || fetchText;
    this.now = options.now || Date.now;
    this.searches = new Map();
    this.items = new Map();
    this.known = new Set();
    this.pending = new Map();
    this.nextSearchAt = 0;
    this.nextMetadataAt = 0;
  }

  async json(url, maxBytes) {
    validateUrl(url, ['archive.org']);
    const value = await this.fetch(url, { allowedHosts: ['archive.org'], maxBytes, timeout: 15000 });
    if (typeof value !== 'string' || Buffer.byteLength(value) > maxBytes) throw new Error('ARCHIVE_UNAVAILABLE');
    return JSON.parse(value);
  }

  async load(force = false, query = {}) {
    const q = typeof query.q === 'string' ? query.q.slice(0, 120).replace(/[\x00-\x1f\x7f]/g, ' ').trim() : '';
    const size = Math.min(MAX_ROWS, Math.max(1, Math.floor(Number(query.pageSize)) || MAX_ROWS));
    const page = Math.min(Math.floor(10000 / size), Math.max(1, Math.floor(Number(query.page)) || 1));
    const collection = Array.from(COLLECTIONS).find(([key, label]) => query.category === key || query.category === label);
    const scope = collection ? 'collection:' + collection[0] : 'collection:(' + Array.from(COLLECTIONS.keys()).join(' OR ') + ')';
    const key = JSON.stringify([q, collection && collection[0], page, size]);
    const cached = this.searches.get(key);
    if (!force && cached && this.now() - cached.at < TTL) return { ...cached.catalog, stale: !!cached.stale };
    if (this.now() < this.nextSearchAt) {
      if (cached) return { ...cached.catalog, stale: true };
      throw new Error('ARCHIVE_UNAVAILABLE');
    }
    if (this.pending.has('search:' + key)) return this.pending.get('search:' + key);
    if (this.pending.size >= 4) throw new Error('ARCHIVE_BUSY');
    const pending = (async () => {
      try {
        const url = new URL('https://archive.org/advancedsearch.php');
        url.searchParams.set('q', 'mediatype:movies AND ' + scope + ' AND licenseurl:*publicdomain*' +
          (q ? ' AND (title:"' + escaped(q) + '" OR description:"' + escaped(q) + '")' : ''));
        for (const field of ['identifier', 'title', 'description', 'collection', 'mediatype', 'licenseurl', 'year', 'date', 'subject', 'creator', 'access-restricted-item']) url.searchParams.append('fl[]', field);
        url.searchParams.set('sort[]', 'downloads desc');
        url.searchParams.set('rows', String(size)); url.searchParams.set('page', String(page)); url.searchParams.set('output', 'json');
        const data = await this.json(url.href, 1024 * 1024);
        if (!data.response || !Array.isArray(data.response.docs) || data.response.docs.length > MAX_ROWS) throw new Error('ARCHIVE_UNAVAILABLE');
        const movies = data.response.docs.map(card).filter(Boolean);
        for (const item of movies) this.known.add(item.id);
        while (this.known.size > 1000) this.known.delete(this.known.values().next().value);
        const total = Math.min(10000, Math.max(0, Number(data.response.numFound) || 0));
        const catalog = { movies, categories: Array.from(COLLECTIONS.values()), stale: false,
          pagination: { page, pageSize: size, total, hasMore: page * size < total } };
        this.searches.set(key, { at: this.now(), catalog });
        while (this.searches.size > 12) this.searches.delete(this.searches.keys().next().value);
        this.status = 'connected'; this.updatedAt = this.now();
        this.message = 'Solo registros con licencia pública declarada. La disponibilidad se verifica al reproducir.';
        return catalog;
      } catch (_) {
        if (cached) cached.stale = true;
        this.nextSearchAt = this.now() + 30000;
        this.status = cached ? 'stale' : 'unavailable';
        this.message = 'Internet Archive no respondió; vuelve a intentarlo más tarde.';
        if (cached) return { ...cached.catalog, stale: true };
        throw new Error('ARCHIVE_UNAVAILABLE');
      } finally { this.pending.delete('search:' + key); }
    })();
    this.pending.set('search:' + key, pending);
    return pending;
  }

  async getItem(id) {
    if (typeof id !== 'string' || !id.startsWith('ia:') || !IDENTIFIER.test(id.slice(3))) return null;
    const cached = this.items.get(id);
    if (cached && this.now() - cached.at < TTL) return cached.item;
    if (this.now() < this.nextMetadataAt) return null;
    if (this.pending.has(id)) return this.pending.get(id);
    if (this.pending.size >= 4) return null;
    const pending = (async () => {
      try {
        const identifier = id.slice(3);
        const record = await this.json('https://archive.org/metadata/' + encodeURIComponent(identifier), 2 * 1024 * 1024);
        const item = card(record.metadata || {});
        const media = mediaFrom(record, identifier);
        if (!item || !media) { this.items.delete(id); return null; }
        this.items.set(id, { at: this.now(), item: { ...item, duration: media.duration }, media });
        while (this.items.size > MAX_METADATA_ITEMS) this.items.delete(this.items.keys().next().value);
        this.known.add(id);
        while (this.known.size > 1000) this.known.delete(this.known.values().next().value);
        this.streamHosts = Array.from(new Set([...media.hosts, ...this.streamHosts])).slice(0, 48);
        return this.items.get(id).item;
      } catch (_) { this.nextMetadataAt = this.now() + 5000; return null; }
      finally { this.pending.delete(id); }
    })();
    this.pending.set(id, pending);
    return pending;
  }

  async resolve(id, signal = 0) {
    if (signal !== 0 || !this.known.has(id)) return null;
    const item = await this.getItem(id);
    const cached = this.items.get(id);
    if (!item || !cached) return null;
    return { found: true, ...item, ...cached.media, type: 'movie', live: false };
  }
}

module.exports = { InternetArchiveAdapter, licenseOf, mediaFrom };
