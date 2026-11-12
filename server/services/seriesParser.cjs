'use strict';

const crypto = require('node:crypto');

function hash(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

function normalizeKey(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Regular expressions to identify series season and episode patterns
// 1. S01E01, s1e1, S01 E01, S01.E01, S01-E01, S01_E01
const SXX_EXX_REGEX = /(.*?)(?:[-._\s([{|]*\b[sS](\d{1,3})[-._\s]*[eE](\d{1,4})\b[-._\s)\]}|]*)(.*)/i;

// 2. 1x01, 01x01, 2x15
const NUM_X_NUM_REGEX = /(.*?)(?:[-._\s([{|]*\b(\d{1,2})[xX](\d{1,4})\b[-._\s)\]}|]*)(.*)/i;

// 3. Temporada X Episodio Y / Season X Episode Y / T1 E1 / T01 Cap 02
const WORD_SEASON_EP_REGEX = /(.*?)(?:[-._\s([{|]*\b(?:temporada|season|temp\.?|seas\.?|t)\s*(\d{1,3})\s*(?:[-._–:|/]?\s*(?:episodio|episode|capitulo|cap\.?|ep\.?|e)\s*(\d{1,4}))\b[-._\s)\]}|]*)(.*)/i;

// 4. Standalone episode marker: Episodio 5 / Episode 5 / Cap 5
const STANDALONE_EP_REGEX = /(.*?)(?:[-._\s([{|]*\b(?:episodio|episode|capitulo|cap\.?|ep\.?)\s*(\d{1,4})\b[-._\s)\]}|]*)(.*)/i;

// 5. Standalone season marker in title: Temporada 1 / Season 2 / T1
const STANDALONE_SEASON_REGEX = /\b(?:temporada|season|temp\.?)\s*(\d{1,3})\b/i;
const STANDALONE_T_SEASON_REGEX = /\b[sStT]\s*0?(\d{1,3})\b/i;

function cleanTitle(raw) {
  return String(raw || '')
    .replace(/^[-._–:|#/\s]+/, '')
    .replace(/[-._–:|#/\s]+$/, '')
    .trim();
}

function parseEpisodeInfo(rawTitle, rawGroup) {
  const title = String(rawTitle || '').trim();
  const group = String(rawGroup || '').trim();
  if (!title) return { isEpisode: false };

  // Check 1: SxxExx
  let match = SXX_EXX_REGEX.exec(title);
  if (match) {
    const series = cleanTitle(match[1]);
    const season = parseInt(match[2], 10);
    const episode = parseInt(match[3], 10);
    const epTitle = cleanTitle(match[4]) || `Episodio ${episode}`;
    if (series && Number.isInteger(season) && Number.isInteger(episode)) {
      return {
        isEpisode: true,
        seriesTitle: series,
        season,
        episode,
        episodeTitle: epTitle,
        originalTitle: title,
        pattern: 'SxxExx'
      };
    }
  }

  // Check 2: 1x01
  match = NUM_X_NUM_REGEX.exec(title);
  if (match) {
    const series = cleanTitle(match[1]);
    const season = parseInt(match[2], 10);
    const episode = parseInt(match[3], 10);
    const epTitle = cleanTitle(match[4]) || `Episodio ${episode}`;
    if (series && Number.isInteger(season) && Number.isInteger(episode)) {
      return {
        isEpisode: true,
        seriesTitle: series,
        season,
        episode,
        episodeTitle: epTitle,
        originalTitle: title,
        pattern: '1x01'
      };
    }
  }

  // Check 3: Temporada 1 Episodio 2 / Season 1 Episode 2
  match = WORD_SEASON_EP_REGEX.exec(title);
  if (match) {
    const series = cleanTitle(match[1]);
    const season = parseInt(match[2], 10);
    const episode = parseInt(match[3], 10);
    const epTitle = cleanTitle(match[4]) || `Episodio ${episode}`;
    if (series && Number.isInteger(season) && Number.isInteger(episode)) {
      return {
        isEpisode: true,
        seriesTitle: series,
        season,
        episode,
        episodeTitle: epTitle,
        originalTitle: title,
        pattern: 'WordSeasonEp'
      };
    }
  }

  // Check 4: If group indicates season (e.g. group="Series HBO | Game of Thrones T1" or "Temporada 2")
  // and title has standalone episode ("Capítulo 5" or "Episodio 5")
  const groupSeasonMatch = STANDALONE_SEASON_REGEX.exec(group) || STANDALONE_T_SEASON_REGEX.exec(group);
  match = STANDALONE_EP_REGEX.exec(title);
  if (match && (groupSeasonMatch || /series|serie/i.test(group))) {
    const series = cleanTitle(match[1]);
    const season = groupSeasonMatch ? parseInt(groupSeasonMatch[1], 10) : 1;
    const episode = parseInt(match[2], 10);
    const epTitle = cleanTitle(match[3]) || `Episodio ${episode}`;
    if (series && Number.isInteger(season) && Number.isInteger(episode)) {
      return {
        isEpisode: true,
        seriesTitle: series,
        season,
        episode,
        episodeTitle: epTitle,
        originalTitle: title,
        pattern: 'GroupSeasonEp'
      };
    }
  }

  return { isEpisode: false };
}

function extractSeriesBaseName(seriesTitle) {
  let cleaned = cleanTitle(seriesTitle);
  // Remove trailing season identifiers from the base series title if any:
  // e.g. "Game of Thrones Temporada 1" -> "Game of Thrones"
  cleaned = cleaned.replace(/\s*[-–:|]?\s*(?:temporada|season|temp\.?|seas\.?)\s*\d+\s*$/i, '');
  cleaned = cleaned.replace(/\s*[-–:|]?\s*[sStT]\s*0?\d+\s*$/i, '');
  return cleanTitle(cleaned) || seriesTitle;
}

function groupEpisodesIntoSeries(rawEpisodes) {
  const episodesList = Array.isArray(rawEpisodes) ? rawEpisodes : [];
  const seriesMap = new Map(); // seriesKey -> seriesRecord

  for (const item of episodesList) {
    if (!item) continue;
    const info = parseEpisodeInfo(item.title, item.groupTitle);

    let seriesName = '';
    let seasonNumber = 1;
    let episodeNumber = 1;
    let episodeTitle = item.title;

    if (info.isEpisode) {
      seriesName = extractSeriesBaseName(info.seriesTitle);
      seasonNumber = info.season || 1;
      episodeNumber = info.episode || 1;
      episodeTitle = info.episodeTitle || `Episodio ${episodeNumber}`;
    } else {
      // If marked as series by group-title but couldn't parse SxxExx
      seriesName = extractSeriesBaseName(item.title);
      seasonNumber = 1;
      episodeNumber = 1;
      episodeTitle = item.title;
    }

    const seriesKey = normalizeKey(seriesName);
    if (!seriesKey) continue;

    let seriesRecord = seriesMap.get(seriesKey);
    if (!seriesRecord) {
      const seriesId = 'series-' + hash(seriesKey);
      seriesRecord = {
        id: seriesId,
        key: seriesKey,
        title: seriesName,
        poster: item.logo || null,
        backdrop: item.logo || null,
        category: item.groupTitle || 'Series',
        groupTitle: item.groupTitle || 'Series',
        kind: 'serie',
        type: 'teleplay',
        isSeries: true,
        source: 'private-m3u',
        seasonsMap: new Map(),
        allEpisodesCount: 0
      };
      seriesMap.set(seriesKey, seriesRecord);
    } else {
      // Keep best poster if current record doesn't have one
      if (!seriesRecord.poster && item.logo) {
        seriesRecord.poster = item.logo;
        seriesRecord.backdrop = item.logo;
      }
      // Prefer cleaner/longer title
      if (seriesName.length > seriesRecord.title.length && !/\d+$/.test(seriesName)) {
        seriesRecord.title = seriesName;
      }
    }

    // Add to seasonsMap
    let seasonRecord = seriesRecord.seasonsMap.get(seasonNumber);
    if (!seasonRecord) {
      seasonRecord = {
        number: seasonNumber,
        seasonNumber: seasonNumber,
        id: `season-${seriesRecord.id}-s${seasonNumber}`,
        title: `Temporada ${seasonNumber}`,
        name: `Temporada ${seasonNumber}`,
        episodes: []
      };
      seriesRecord.seasonsMap.set(seasonNumber, seasonRecord);
    }

    const episodeId = `ep-${seriesRecord.id}-s${seasonNumber}-e${episodeNumber}-${hash(item.id || item.url)}`;
    seasonRecord.episodes.push({
      id: episodeId,
      seriesId: seriesRecord.id,
      season: seasonNumber,
      number: episodeNumber,
      episode: episodeNumber,
      title: episodeTitle,
      originalTitle: item.title,
      logo: item.logo || seriesRecord.poster || null,
      streamUrl: item.url || '', // kept internal in server memory
      sourceItemId: item.id || '',
      groupTitle: item.groupTitle || ''
    });

    seriesRecord.allEpisodesCount++;
  }

  // Format final series array
  const result = [];
  for (const s of seriesMap.values()) {
    // Sort seasons numerically
    const sortedSeasonNumbers = Array.from(s.seasonsMap.keys()).sort((a, b) => a - b);
    const seasons = [];

    for (const sNum of sortedSeasonNumbers) {
      const seasonObj = s.seasonsMap.get(sNum);
      // Sort episodes numerically by episode number
      seasonObj.episodes.sort((a, b) => {
        if (a.number !== b.number) return a.number - b.number;
        return a.title.localeCompare(b.title, 'es');
      });
      seasonObj.episodeCount = seasonObj.episodes.length;
      seasons.push(seasonObj);
    }

    result.push({
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
      seasonCount: seasons.length,
      episodeCount: s.allEpisodesCount,
      seasons: seasons
    });
  }

  // Sort series alphabetically
  result.sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
  return result;
}

module.exports = {
  parseEpisodeInfo,
  extractSeriesBaseName,
  groupEpisodesIntoSeries,
  normalizeKey
};

