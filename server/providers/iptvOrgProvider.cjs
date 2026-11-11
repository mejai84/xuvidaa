'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');

const DEFAULT_ENDPOINTS = {
  channels: 'https://iptv-org.github.io/api/channels.json',
  streams: 'https://iptv-org.github.io/api/streams.json',
  categories: 'https://iptv-org.github.io/api/categories.json',
  countries: 'https://iptv-org.github.io/api/countries.json',
  logos: 'https://iptv-org.github.io/api/logos.json'
};

const CATEGORY_TRANSLATIONS = {
  general: 'General',
  news: 'Noticias',
  sports: 'Deportes',
  entertainment: 'Entretenimiento',
  music: 'Música',
  movies: 'Cine',
  kids: 'Infantil',
  animation: 'Animación',
  series: 'Series',
  documentary: 'Documentales',
  comedy: 'Comedia',
  culture: 'Cultura',
  education: 'Educación',
  family: 'Familiar',
  lifestyle: 'Estilo de vida',
  outdoor: 'Naturaleza',
  religious: 'Religión',
  science: 'Ciencia',
  classic: 'Clásicos',
  legislative: 'Institucional',
  travel: 'Viajes',
  weather: 'Clima',
  business: 'Negocios',
  auto: 'Motores',
  cooking: 'Cocina',
  relax: 'Relajación',
  shop: 'Compras',
  public: 'Público',
  interactive: 'Interactivo'
};

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function defaultFetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = timeoutMs || 25000;
    const req = https.get(url, { headers: { 'User-Agent': 'xuvidaa/1.0' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} al descargar ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const data = JSON.parse(body);
          resolve(data);
        } catch (err) {
          reject(new Error(`JSON inválido de ${url}: ${err.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy(new Error(`Timeout de ${timeout}ms al consultar ${url}`));
    });
  });
}

function scoreStream(stream) {
  if (!stream || typeof stream !== 'object') return -1;
  const url = String(stream.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return -1;

  let score = 0;

  // 1. Protocol: HTTPS is preferred over HTTP
  if (url.startsWith('https://')) {
    score += 100;
  } else {
    score += 50;
  }

  // 2. Format: HLS / .m3u8 preferred for TV compatibility
  const isHls = /\.m3u8(?:$|\?)/i.test(url) || stream.feed === 'HLS';
  if (isHls) {
    score += 50;
  } else if (/\.mp4(?:$|\?)/i.test(url)) {
    score += 20;
  }

  // 3. Labels
  const labels = Array.isArray(stream.labels) ? stream.labels : [];
  const isGeoBlocked = labels.some((l) => /geo[- ]?blocked/i.test(l));
  const isNot247 = labels.some((l) => /not[- ]?24\/7/i.test(l));

  if (!isGeoBlocked) {
    score += 40;
  }
  if (!isNot247) {
    score += 20;
  }

  // 4. Quality
  const quality = String(stream.quality || '').toLowerCase();
  if (quality.includes('1080') || quality.includes('fhd')) {
    score += 15;
  } else if (quality.includes('720') || quality.includes('hd')) {
    score += 10;
  } else if (quality.includes('480') || quality.includes('sd')) {
    score += 5;
  }

  return score;
}

function sortStreams(streams) {
  return streams.slice().sort((a, b) => {
    const scoreA = scoreStream(a);
    const scoreB = scoreStream(b);
    if (scoreB !== scoreA) return scoreB - scoreA;

    // Tie breaker 1: prefer stream with feed / title
    const feedA = String(a.feed || a.title || '');
    const feedB = String(b.feed || b.title || '');
    if (feedA !== feedB) return feedA.localeCompare(feedB);

    // Tie breaker 2: alphabetical URL
    return String(a.url || '').localeCompare(String(b.url || ''));
  });
}

class IptvOrgProvider {
  constructor(options) {
    const opts = options || {};
    this.country = opts.country || 'CO';
    this.languagePriority = opts.languagePriority || 'spa';
    this.excludeNsfw = opts.excludeNsfw !== false;
    this.preferHls = opts.preferHls !== false;
    this.endpoints = Object.assign({}, DEFAULT_ENDPOINTS, opts.endpoints || {});
    this.cacheDir = opts.cacheDir || path.join(__dirname, '..', '.cache');
    this.cacheFile = path.join(this.cacheDir, `iptv-org-${this.country.toLowerCase()}.json`);
    this.ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : 24 * 60 * 60 * 1000; // 24 hours
    this.fetchJson = typeof opts.fetchJson === 'function' ? opts.fetchJson : defaultFetchJson;

    // In-memory catalog state
    this.inMemoryData = null;
    this.fetchedAt = 0;
    this.refreshPromise = null;
  }

  async readDiskCache() {
    try {
      const content = await fs.promises.readFile(this.cacheFile, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.channels) && parsed.channels.length > 0) {
        return parsed;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  async writeDiskCache(data) {
    try {
      await fs.promises.mkdir(this.cacheDir, { recursive: true });
      const tempPath = this.cacheFile + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
      const content = JSON.stringify(data, null, 2);
      await fs.promises.writeFile(tempPath, content, 'utf8');
      await fs.promises.rename(tempPath, this.cacheFile);
    } catch (err) {
      // Do not crash if disk cache cannot be saved (e.g. read-only filesystem)
      console.warn('[IptvOrgProvider] Advertencia: no se pudo guardar caché en disco:', err.message);
    }
  }

  processRawCatalog(rawChannels, rawStreams, rawLogos, rawCategories, rawCountries) {
    const channels = Array.isArray(rawChannels) ? rawChannels : [];
    const streams = Array.isArray(rawStreams) ? rawStreams : [];
    const logos = Array.isArray(rawLogos) ? rawLogos : [];
    const categoriesList = Array.isArray(rawCategories) ? rawCategories : [];
    const countriesList = Array.isArray(rawCountries) ? rawCountries : [];

    // Map logos by channel ID (prefer in_use: true)
    const logoMap = new Map();
    for (const l of logos) {
      if (l && l.channel && l.url) {
        if (!logoMap.has(l.channel) || l.in_use) {
          logoMap.set(l.channel, l.url);
        }
      }
    }

    // Map categories definition
    const categoryNameMap = new Map();
    for (const cat of categoriesList) {
      if (cat && cat.id) {
        categoryNameMap.set(cat.id, CATEGORY_TRANSLATIONS[cat.id] || cat.name || cat.id);
      }
    }

    // Group streams by channel ID
    const streamMap = new Map();
    for (const s of streams) {
      if (s && s.channel && s.url) {
        if (!streamMap.has(s.channel)) streamMap.set(s.channel, []);
        streamMap.get(s.channel).push(s);
      }
    }

    // Filter channels for target country & NSFW
    const normalizedChannels = [];
    const categoryCount = new Map();
    let totalTargetCountry = 0;
    let totalTargetCountryFiltered = 0;
    let totalWithStreams = 0;
    let totalWithoutStreams = 0;

    for (const ch of channels) {
      if (!ch || typeof ch !== 'object') continue;
      if (ch.country !== this.country) continue;
      totalTargetCountry++;

      // Filter NSFW
      const isNsfw = !!ch.is_nsfw || (Array.isArray(ch.categories) && ch.categories.includes('xxx'));
      if (this.excludeNsfw && isNsfw) continue;
      totalTargetCountryFiltered++;

      const chStreams = streamMap.get(ch.id) || [];
      const hasStreams = chStreams.length > 0;
      if (hasStreams) {
        totalWithStreams++;
      } else {
        totalWithoutStreams++;
      }

      // Sort streams deterministically
      const sorted = sortStreams(chStreams);
      const primaryStream = sorted.length > 0 ? sorted[0] : null;

      // Extract labels & flags
      const labels = primaryStream && Array.isArray(primaryStream.labels) ? primaryStream.labels : [];
      const isGeoBlocked = labels.some((l) => /geo[- ]?blocked/i.test(l));
      const isNot247 = labels.some((l) => /not[- ]?24\/7/i.test(l));

      // Resolve category names
      const chCategories = Array.isArray(ch.categories) && ch.categories.length > 0 ? ch.categories : ['general'];
      const categoryNames = chCategories.map((cId) => categoryNameMap.get(cId) || CATEGORY_TRANSLATIONS[cId] || cId);
      const mainCategoryName = categoryNames[0] || 'General';

      if (hasStreams) {
        for (const catId of chCategories) {
          categoryCount.set(catId, (categoryCount.get(catId) || 0) + 1);
        }
      }

      const normalizedChannel = {
        id: String(ch.id || ''),
        channelCode: String(ch.id || ''),
        name: String(ch.name || ch.id || 'Canal sin nombre'),
        altNames: Array.isArray(ch.alt_names) ? ch.alt_names : [],
        logo: logoMap.get(ch.id) || null,
        country: ch.country || this.country,
        category: mainCategoryName,
        categories: categoryNames,
        categoryIds: chCategories,
        streamUrl: primaryStream ? primaryStream.url : '',
        quality: primaryStream ? (primaryStream.quality || null) : null,
        labels: labels,
        isGeoBlocked: isGeoBlocked,
        isNot247: isNot247,
        source: 'iptv-org',
        hasStream: hasStreams,
        streamCount: sorted.length,
        streams: sorted.map((s) => ({
          url: s.url,
          feed: s.feed || null,
          title: s.title || null,
          quality: s.quality || null,
          labels: Array.isArray(s.labels) ? s.labels : []
        }))
      };

      normalizedChannels.push(normalizedChannel);
    }

    // Sort channels alphabetically by name
    normalizedChannels.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

    // Build categories list
    const generatedCategories = [
      { id: 'all', code: 'all', name: 'Todos', count: totalWithStreams, isAddon: false }
    ];

    for (const [catId, count] of categoryCount.entries()) {
      const translatedName = categoryNameMap.get(catId) || CATEGORY_TRANSLATIONS[catId] || catId;
      generatedCategories.push({
        id: catId,
        code: catId,
        name: translatedName,
        count: count,
        isAddon: false
      });
    }

    // Sort categories (Todos always first, then by count descending / name)
    const restCategories = generatedCategories.slice(1).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'es');
    });

    const categories = [generatedCategories[0], ...restCategories];

    return {
      fetchedAt: Date.now(),
      country: this.country,
      stats: {
        totalTargetCountry,
        totalTargetCountryFiltered,
        totalWithStreams,
        totalWithoutStreams
      },
      categories,
      channels: normalizedChannels
    };
  }

  async refresh(force) {
    if (this.refreshPromise && !force) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      // 1. If not forced and memory cache is fresh, return memory cache
      if (!force && this.inMemoryData && (Date.now() - this.fetchedAt < this.ttlMs)) {
        return this.inMemoryData;
      }

      // 2. If memory cache empty, check disk cache
      if (!this.inMemoryData && !force) {
        const diskCache = await this.readDiskCache();
        if (diskCache && (Date.now() - (diskCache.fetchedAt || 0) < this.ttlMs)) {
          this.inMemoryData = diskCache;
          this.fetchedAt = diskCache.fetchedAt || Date.now();
          return this.inMemoryData;
        }
      }

      // 3. Fetch from remote endpoints in parallel
      try {
        const [channels, streams, logos, categories, countries] = await Promise.all([
          this.fetchJson(this.endpoints.channels),
          this.fetchJson(this.endpoints.streams),
          this.fetchJson(this.endpoints.logos).catch((err) => {
            console.warn('[IptvOrgProvider] logos.json omitido:', err.message);
            return [];
          }),
          this.fetchJson(this.endpoints.categories).catch(() => []),
          this.fetchJson(this.endpoints.countries).catch(() => [])
        ]);

        if (!Array.isArray(channels) || channels.length === 0) {
          throw new Error('Respuesta inválida o vacía de channels.json');
        }
        if (!Array.isArray(streams) || streams.length === 0) {
          throw new Error('Respuesta inválida o vacía de streams.json');
        }

        const processed = this.processRawCatalog(channels, streams, logos, categories, countries);

        // Update in-memory state and atomic disk cache
        this.inMemoryData = processed;
        this.fetchedAt = processed.fetchedAt;
        await this.writeDiskCache(processed);

        return processed;
      } catch (err) {
        console.error('[IptvOrgProvider] Error actualizando desde IPTV-org:', err.message);

        // Fallback: If we have prior valid cache (in memory or on disk), preserve it!
        if (this.inMemoryData) {
          return Object.assign({}, this.inMemoryData, {
            stale: true,
            warning: 'Usando catálogo previo en memoria por fallo de conexión: ' + err.message
          });
        }

        const diskCache = await this.readDiskCache();
        if (diskCache) {
          this.inMemoryData = diskCache;
          this.fetchedAt = diskCache.fetchedAt || Date.now();
          return Object.assign({}, diskCache, {
            stale: true,
            warning: 'Usando catálogo previo en disco por fallo de conexión: ' + err.message
          });
        }

        // Only if absolutely no prior cache exists, throw
        throw new Error('No se pudo obtener el catálogo de IPTV-org y no hay caché previa: ' + err.message);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async getCategories() {
    const data = await this.refresh(false);
    return {
      returnValue: true,
      categories: data.categories || []
    };
  }

  async getChannels(params) {
    const data = await this.refresh(false);
    const options = params || {};

    const category = options.category || options.columnId || 'all';
    const pageNum = Math.max(1, parseInt(options.pageNum || options.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(options.pageSize || options.limit, 10) || 30));
    const searchQuery = options.search || options.value || '';
    const onlyWithStreams = options.onlyWithStreams !== false; // default true: return channels with playable stream

    // Filter pool
    let pool = data.channels || [];
    if (onlyWithStreams) {
      pool = pool.filter((ch) => ch.hasStream && ch.streamUrl);
    }

    // Filter category
    const catStr = String(category).trim();
    if (catStr && catStr !== 'all' && catStr !== 'Todos' && catStr !== '76182' && catStr !== 'ChannelList') {
      const targetNorm = normalizeText(catStr);
      pool = pool.filter((ch) => {
        if (Array.isArray(ch.categoryIds) && ch.categoryIds.some((cId) => normalizeText(cId) === targetNorm)) {
          return true;
        }
        if (Array.isArray(ch.categories) && ch.categories.some((cName) => normalizeText(cName) === targetNorm)) {
          return true;
        }
        if (normalizeText(ch.category) === targetNorm) {
          return true;
        }
        return false;
      });
    }

    // Filter search query if present
    if (searchQuery) {
      const qNorm = normalizeText(searchQuery);
      pool = pool.filter((ch) => {
        if (normalizeText(ch.name).includes(qNorm)) return true;
        if (Array.isArray(ch.altNames) && ch.altNames.some((alt) => normalizeText(alt).includes(qNorm))) return true;
        if (normalizeText(ch.id).includes(qNorm)) return true;
        return false;
      });
    }

    const total = pool.length;
    const startIndex = (pageNum - 1) * pageSize;
    const pageChannels = pool.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < total;

    return {
      returnValue: true,
      channels: pageChannels,
      total: total,
      pageNum: pageNum,
      pageSize: pageSize,
      hasMore: hasMore,
      category: category,
      fetchedAt: data.fetchedAt,
      stale: !!data.stale,
      stats: data.stats
    };
  }
}

module.exports = {
  IptvOrgProvider,
  scoreStream,
  sortStreams,
  CATEGORY_TRANSLATIONS,
  DEFAULT_ENDPOINTS
};
