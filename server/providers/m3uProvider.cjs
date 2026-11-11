'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { parseEpisodeInfo, groupEpisodesIntoSeries, normalizeKey } = require('../services/seriesParser.cjs');

function hash(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

function sanitizeText(text) {
  return String(text || '').replace(/[\r\n]+/g, ' ').trim();
}

function sanitizeUrlForLogs(url) {
  if (!url) return '';
  return String(url).replace(/((?:username|user|password|pass)=)[^&]+/gi, '$1***');
}

function cleanCategory(group) {
  let cat = String(group || '').trim();
  // Strip common IPTV provider prefixes like "ES | ", "LATINO - ", "VOD: "
  cat = cat.replace(/^[A-Z]{2,4}\s*[:|–-]\s*/i, '');
  cat = cat.replace(/^(?:peliculas?|movies?|series?|vod)\s*[:|–-]\s*/i, '');
  return cat.trim() || 'General';
}

function parseExtInfLine(infLine) {
  const commaIdx = infLine.indexOf(',');
  let meta = '';
  let title = '';
  if (commaIdx !== -1) {
    meta = infLine.slice(0, commaIdx);
    title = infLine.slice(commaIdx + 1).trim();
  } else {
    meta = infLine;
  }

  const attrs = {};
  const attrRegex = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  let match;
  while ((match = attrRegex.exec(meta)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4]);
    attrs[key] = val;
  }

  const tvgName = attrs['tvg-name'] || attrs['tvgname'] || '';
  const tvgId = attrs['tvg-id'] || attrs['tvgid'] || '';
  const tvgLogo = attrs['tvg-logo'] || attrs['tvglogo'] || attrs['logo'] || '';
  const groupTitle = attrs['group-title'] || attrs['grouptitle'] || attrs['group'] || '';
  const finalTitle = title || tvgName || tvgId || 'Sin título';

  return {
    tvgId,
    tvgName,
    tvgLogo,
    groupTitle,
    title: finalTitle
  };
}

// Extract relative Xtream path and ID without credentials
function parseXtreamPath(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    // Typical format: /movie/username/password/12345.mp4 (4 parts)
    // or /series/username/password/12345.mp4
    // or /live/username/password/12345.m3u8
    // or /username/password/12345
    if (parts.length >= 4 && (parts[0] === 'movie' || parts[0] === 'series' || parts[0] === 'live')) {
      const type = parts[0];
      const filename = parts[3];
      const extMatch = /\.([a-zA-Z0-9]+)$/.exec(filename);
      const extension = extMatch ? extMatch[1] : '';
      const streamId = filename.replace(/\.[a-zA-Z0-9]+$/, '');
      return {
        type,
        streamId,
        extension,
        relativePath: `/${type}/${streamId}${extension ? '.' + extension : ''}`
      };
    }
    // Generic path: strip 2 potential credential segments if present
    return {
      type: 'generic',
      streamId: hash(parsed.pathname),
      extension: path.extname(parsed.pathname).slice(1),
      relativePath: parsed.pathname
    };
  } catch (_) {
    return null;
  }
}

class M3uProvider {
  constructor(options) {
    const opts = options || {};
    this.baseUrl = opts.baseUrl || process.env.M3U_BASE_URL || '';
    this.username = opts.username || process.env.M3U_USERNAME || '';
    this.password = opts.password || process.env.M3U_PASSWORD || '';
    this.type = opts.type || process.env.M3U_TYPE || 'm3u';
    this.cacheDir = opts.cacheDir || path.join(__dirname, '..', '.cache');
    this.cacheFile = path.join(this.cacheDir, 'm3u-catalog.json');
    this.ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : 24 * 60 * 60 * 1000;
    this.fetchM3uContent = typeof opts.fetchM3uContent === 'function' ? opts.fetchM3uContent : null;

    // In-memory catalog
    this.inMemoryCatalog = null;
    this.fetchedAt = 0;
    this.refreshPromise = null;
  }

  isConfigured() {
    return !!(this.baseUrl && this.username && this.password) || typeof this.fetchM3uContent === 'function';
  }

  buildProviderUrl() {
    if (!this.baseUrl || !this.username || !this.password) return '';
    const cleanBase = this.baseUrl.replace(/\/+$/, '');
    return `${cleanBase}/get.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}&type=${encodeURIComponent(this.type)}`;
  }

  classifyEntry(entry) {
    const title = String(entry.title || '').trim();
    const group = String(entry.groupTitle || '').trim();
    const url = String(entry.url || '').trim();

    // 1. Episode check
    const epInfo = parseEpisodeInfo(title, group);
    if (epInfo.isEpisode) {
      return 'episode';
    }
    if (/\/series\//i.test(url)) {
      return 'episode';
    }
    if (/\b(?:series|serie|temporadas?|seasons?)\b/i.test(group) && /\b(?:cap|ep|episodio|capitulo)\b/i.test(title)) {
      return 'episode';
    }

    // 2. Movie check
    if (/\/movie\//i.test(url)) {
      return 'movie';
    }
    if (/\b(?:peliculas?|películas?|movies?|cine|vod|estrenos|films?)\b/i.test(group)) {
      return 'movie';
    }
    if (/\.(?:mp4|mkv|avi|mov|wmv)(?:\?|$)/i.test(url) && !/\b(?:live|en vivo|canales|tv)\b/i.test(group)) {
      return 'movie';
    }

    // 3. Live check
    if (/\/live\//i.test(url)) {
      return 'live';
    }
    if (/\b(?:en vivo|live|canales|channels|tv|noticias|deportes 24\/7)\b/i.test(group)) {
      return 'live';
    }
    if (/\.m3u8(?:\?|$)/i.test(url) && !/\b(?:series|peliculas|movies|vod)\b/i.test(group)) {
      return 'live';
    }

    // 4. Ambiguous -> unknown
    return 'unknown';
  }

  parseM3u(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('Contenido M3U vacío o inválido');
    }

    const trimmed = content.trim();
    if (!trimmed.startsWith('#EXTM3U') && !trimmed.includes('#EXTINF:')) {
      throw new Error('El contenido descargado no es un formato M3U válido (#EXTM3U ausente)');
    }

    const lines = content.split(/\r?\n/);
    const movies = [];
    const rawEpisodes = [];
    const liveChannels = [];
    const unknowns = [];
    let invalidCount = 0;
    let duplicateMoviesCount = 0;

    let currentInf = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        currentInf = parseExtInfLine(line);
        continue;
      }

      if (line.startsWith('#')) {
        // Ignore other directives (#EXTVLCOPT, #EXTGRP, etc.)
        continue;
      }

      // If we have a URL line following an #EXTINF
      if (currentInf) {
        const url = line;
        if (!/^https?:\/\//i.test(url)) {
          invalidCount++;
          currentInf = null;
          continue;
        }

        const entry = {
          id: currentInf.tvgId || hash(currentInf.title + '|' + url),
          title: currentInf.title,
          tvgName: currentInf.tvgName,
          logo: currentInf.tvgLogo || null,
          groupTitle: currentInf.groupTitle || '',
          url: url
        };

        const classification = this.classifyEntry(entry);

        if (classification === 'movie') {
          movies.push(entry);
        } else if (classification === 'episode') {
          rawEpisodes.push(entry);
        } else if (classification === 'live') {
          liveChannels.push(entry);
        } else {
          unknowns.push(entry);
        }

        currentInf = null;
      } else {
        // Stray URL without #EXTINF
        invalidCount++;
      }
    }

    // Process & deduplicate movies
    const uniqueMoviesMap = new Map();
    for (const m of movies) {
      const titleKey = normalizeKey(m.title);
      // Extract optional release year (e.g. "Movie Title (2024)")
      const yearMatch = /\b(19\d\d|20\d\d)\b/.exec(m.title);
      const year = yearMatch ? yearMatch[1] : '';
      const dedupeKey = titleKey + '|' + year;

      if (uniqueMoviesMap.has(dedupeKey)) {
        duplicateMoviesCount++;
        continue;
      }

      const movieId = 'mov-' + hash(m.id + '|' + dedupeKey);
      const xtreamInfo = parseXtreamPath(m.url);

      uniqueMoviesMap.set(dedupeKey, {
        id: movieId,
        sourceItemId: m.id,
        title: m.title,
        year: year || null,
        poster: m.logo,
        category: cleanCategory(m.groupTitle),
        groupTitle: m.groupTitle || 'Películas',
        kind: 'película',
        type: 'movie',
        isSeries: false,
        source: 'private-m3u',
        streamPath: xtreamInfo ? xtreamInfo.relativePath : '', // sanitized path for disk cache
        streamUrl: m.url // in-memory stream URL
      });
    }

    const processedMovies = Array.from(uniqueMoviesMap.values());
    processedMovies.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));

    // Process series grouping
    const processedSeries = groupEpisodesIntoSeries(rawEpisodes);

    // Compute stats
    const totalEntries = movies.length + rawEpisodes.length + liveChannels.length + unknowns.length + invalidCount;
    let totalSeasons = 0;
    for (const s of processedSeries) {
      totalSeasons += s.seasonCount;
    }

    // Movie categories
    const movieCatsMap = new Map();
    for (const m of processedMovies) {
      const cat = m.category || 'General';
      movieCatsMap.set(cat, (movieCatsMap.get(cat) || 0) + 1);
    }
    const movieCategories = [
      { id: 'all', name: 'Todas las Películas', count: processedMovies.length }
    ];
    for (const [catName, count] of movieCatsMap.entries()) {
      movieCategories.push({ id: normalizeKey(catName), name: catName, count });
    }

    // Series categories
    const seriesCatsMap = new Map();
    for (const s of processedSeries) {
      const cat = cleanCategory(s.groupTitle) || 'Series';
      seriesCatsMap.set(cat, (seriesCatsMap.get(cat) || 0) + 1);
    }
    const seriesCategories = [
      { id: 'all', name: 'Todas las Series', count: processedSeries.length }
    ];
    for (const [catName, count] of seriesCatsMap.entries()) {
      seriesCategories.push({ id: normalizeKey(catName), name: catName, count });
    }

    return {
      fetchedAt: Date.now(),
      stats: {
        totalEntries,
        moviesCount: processedMovies.length,
        episodesCount: rawEpisodes.length,
        seriesCount: processedSeries.length,
        seasonsCount: totalSeasons,
        liveCount: liveChannels.length,
        unknownCount: unknowns.length,
        invalidCount,
        duplicatesCount: duplicateMoviesCount
      },
      movieCategories,
      seriesCategories,
      movies: processedMovies,
      series: processedSeries
    };
  }

  async fetchRemoteM3u() {
    if (typeof this.fetchM3uContent === 'function') {
      return this.fetchM3uContent();
    }

    const targetUrl = this.buildProviderUrl();
    if (!targetUrl) {
      throw new Error('Configura M3U_BASE_URL, M3U_USERNAME y M3U_PASSWORD para descargar el catálogo.');
    }

    return new Promise((resolve, reject) => {
      const parsed = new URL(targetUrl);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(targetUrl, { timeout: 45000, headers: { 'User-Agent': 'xuvidaa/1.0' } }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} al descargar lista M3U`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', (err) => reject(new Error('Fallo de red al descargar M3U: ' + err.message)));
      req.setTimeout(45000, () => req.destroy(new Error('Timeout de 45s descargando M3U')));
    });
  }

  // Prepares data for disk cache, guaranteeing ZERO CREDENTIALS in file
  sanitizeDataForDisk(data) {
    const sanitizeMovies = data.movies.map((m) => {
      const copy = Object.assign({}, m);
      delete copy.streamUrl; // do not store raw authenticated URL on disk
      return copy;
    });

    const sanitizeSeries = data.series.map((s) => {
      const copy = Object.assign({}, s);
      copy.seasons = s.seasons.map((season) => ({
        id: season.id,
        number: season.number,
        title: season.title,
        episodeCount: season.episodeCount,
        episodes: season.episodes.map((ep) => {
          const epCopy = Object.assign({}, ep);
          delete epCopy.streamUrl; // do not store raw authenticated URL on disk
          return epCopy;
        })
      }));
      return copy;
    });

    return {
      fetchedAt: data.fetchedAt,
      stats: data.stats,
      movieCategories: data.movieCategories,
      seriesCategories: data.seriesCategories,
      movies: sanitizeMovies,
      series: sanitizeSeries
    };
  }

  async readDiskCache() {
    try {
      const content = await fs.promises.readFile(this.cacheFile, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && (Array.isArray(parsed.movies) || Array.isArray(parsed.series))) {
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
      const cleanData = this.sanitizeDataForDisk(data);
      await fs.promises.writeFile(tempPath, JSON.stringify(cleanData, null, 2), 'utf8');
      await fs.promises.rename(tempPath, this.cacheFile);
    } catch (err) {
      console.warn('[M3uProvider] Advertencia: no se pudo escribir caché M3U en disco:', err.message);
    }
  }

  async refresh(force) {
    if (this.refreshPromise && !force) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      // 1. Return in-memory catalog if fresh
      if (!force && this.inMemoryCatalog && (Date.now() - this.fetchedAt < this.ttlMs)) {
        return this.inMemoryCatalog;
      }

      // 2. Return disk cache if memory empty
      if (!this.inMemoryCatalog && !force) {
        const disk = await this.readDiskCache();
        if (disk && (Date.now() - (disk.fetchedAt || 0) < this.ttlMs)) {
          this.inMemoryCatalog = disk;
          this.fetchedAt = disk.fetchedAt || Date.now();
          return this.inMemoryCatalog;
        }
      }

      // 3. Download and parse
      try {
        const rawM3u = await this.fetchRemoteM3u();
        const parsed = this.parseM3u(rawM3u);

        this.inMemoryCatalog = parsed;
        this.fetchedAt = parsed.fetchedAt;
        await this.writeDiskCache(parsed);

        return parsed;
      } catch (err) {
        console.error('[M3uProvider] Error actualizando M3U:', err.message);

        // Fallback: preserve memory cache
        if (this.inMemoryCatalog) {
          return Object.assign({}, this.inMemoryCatalog, {
            stale: true,
            warning: 'Usando catálogo M3U previo en memoria: ' + err.message
          });
        }

        // Fallback: preserve disk cache
        const disk = await this.readDiskCache();
        if (disk) {
          this.inMemoryCatalog = disk;
          this.fetchedAt = disk.fetchedAt || Date.now();
          return Object.assign({}, disk, {
            stale: true,
            warning: 'Usando catálogo M3U previo en disco: ' + err.message
          });
        }

        throw new Error('No se pudo obtener el catálogo M3U y no hay caché previa: ' + err.message);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async getMovies(params) {
    const data = await this.refresh(false);
    const options = params || {};
    const category = options.category || 'all';
    const pageNum = Math.max(1, parseInt(options.pageNum || options.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(options.pageSize || options.limit, 10) || 30));
    const search = options.search || options.value || '';

    let pool = data.movies || [];

    if (category && category !== 'all' && category !== 'Todas las Películas') {
      const catNorm = normalizeKey(category);
      pool = pool.filter((m) => normalizeKey(m.category) === catNorm || normalizeKey(m.groupTitle) === catNorm);
    }

    if (search) {
      const qNorm = normalizeKey(search);
      pool = pool.filter((m) => normalizeKey(m.title).includes(qNorm));
    }

    const total = pool.length;
    const startIndex = (pageNum - 1) * pageSize;
    // Strip internal streamUrl before sending to frontend
    const pageItems = pool.slice(startIndex, startIndex + pageSize).map((m) => {
      const safe = Object.assign({}, m);
      delete safe.streamUrl;
      return safe;
    });

    return {
      returnValue: true,
      items: pageItems,
      total,
      pageNum,
      pageSize,
      hasMore: startIndex + pageSize < total,
      categories: data.movieCategories || []
    };
  }

  async getSeries(params) {
    const data = await this.refresh(false);
    const options = params || {};
    const category = options.category || 'all';
    const pageNum = Math.max(1, parseInt(options.pageNum || options.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(options.pageSize || options.limit, 10) || 30));
    const search = options.search || options.value || '';

    let pool = data.series || [];

    if (category && category !== 'all' && category !== 'Todas las Series') {
      const catNorm = normalizeKey(category);
      pool = pool.filter((s) => normalizeKey(s.category) === catNorm || normalizeKey(s.groupTitle) === catNorm);
    }

    if (search) {
      const qNorm = normalizeKey(search);
      pool = pool.filter((s) => normalizeKey(s.title).includes(qNorm));
    }

    const total = pool.length;
    const startIndex = (pageNum - 1) * pageSize;

    // For catalog listing, send series cards without huge episode arrays over the wire
    const pageItems = pool.slice(startIndex, startIndex + pageSize).map((s) => ({
      id: s.id,
      title: s.title,
      poster: s.poster,
      backdrop: s.backdrop,
      category: s.category,
      groupTitle: s.groupTitle,
      kind: 'serie',
      type: 'teleplay',
      isSeries: true,
      source: 'private-m3u',
      seasonCount: s.seasonCount,
      episodeCount: s.episodeCount,
      seasons: s.seasons.map((season) => ({
        id: season.id,
        number: season.number,
        title: season.title,
        episodeCount: season.episodeCount
      }))
    }));

    return {
      returnValue: true,
      items: pageItems,
      total,
      pageNum,
      pageSize,
      hasMore: startIndex + pageSize < total,
      categories: data.seriesCategories || []
    };
  }

  async getDetail(id) {
    const data = await this.refresh(false);
    if (!id) return { returnValue: false, errorText: 'ID no proporcionado' };

    const targetId = String(id).trim();

    // Check movies
    const movie = (data.movies || []).find((m) => m.id === targetId || m.sourceItemId === targetId);
    if (movie) {
      const safeMovie = Object.assign({}, movie);
      delete safeMovie.streamUrl;
      return {
        returnValue: true,
        item: safeMovie,
        isSeries: false
      };
    }

    // Check series
    const series = (data.series || []).find((s) => s.id === targetId);
    if (series) {
      // Return full seasons and episodes for detail view, without sensitive URLs
      const safeSeasons = series.seasons.map((season) => ({
        id: season.id,
        number: season.number,
        title: season.title,
        episodeCount: season.episodeCount,
        episodes: season.episodes.map((ep) => {
          const safeEp = Object.assign({}, ep);
          delete safeEp.streamUrl;
          return safeEp;
        })
      }));

      // Flatten all episodes for easy access in app.js
      const allEpisodes = [];
      for (const season of safeSeasons) {
        for (const ep of season.episodes) {
          allEpisodes.push(ep);
        }
      }

      return {
        returnValue: true,
        item: {
          id: series.id,
          title: series.title,
          poster: series.poster,
          backdrop: series.backdrop,
          category: series.category,
          kind: 'serie',
          type: 'teleplay',
          isSeries: true,
          seasonCount: series.seasonCount,
          episodeCount: series.episodeCount,
          episodes: allEpisodes,
          seasons: safeSeasons
        },
        seasons: safeSeasons,
        episodes: allEpisodes,
        isSeries: true
      };
    }

    return { returnValue: false, errorText: 'Contenido no encontrado' };
  }

  async search(query, limit) {
    const data = await this.refresh(false);
    const q = normalizeKey(query);
    if (!q) return { returnValue: true, items: [], total: 0 };

    const maxItems = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    const results = [];

    // Search movies
    for (const m of (data.movies || [])) {
      if (normalizeKey(m.title).includes(q)) {
        const safe = Object.assign({}, m);
        delete safe.streamUrl;
        results.push(safe);
        if (results.length >= maxItems) break;
      }
    }

    // Search series if limit not reached
    if (results.length < maxItems) {
      for (const s of (data.series || [])) {
        if (normalizeKey(s.title).includes(q)) {
          results.push({
            id: s.id,
            title: s.title,
            poster: s.poster,
            category: s.category,
            kind: 'serie',
            type: 'teleplay',
            isSeries: true,
            seasonCount: s.seasonCount,
            episodeCount: s.episodeCount
          });
          if (results.length >= maxItems) break;
        }
      }
    }

    return {
      returnValue: true,
      items: results,
      total: results.length
    };
  }
}

module.exports = {
  M3uProvider,
  parseExtInfLine,
  parseXtreamPath,
  cleanCategory,
  sanitizeUrlForLogs
};
