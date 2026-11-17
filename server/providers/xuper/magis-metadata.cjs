'use strict';

// Metadata-only normalization of a licensed export whose structure matches
// the community webOS client. This module never logs into the portal, handles
// device identifiers, or returns streaming URLs / licenses.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/;
const list = (value) => Array.isArray(value) ? value : [];
function clean(value, limit = 300) {
  return (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    .replace(/[\x00-\x1f\x7f]/g, ' ').replace(/https?:\/\/[^\s<>]+/gi, '[enlace privado]')
    .slice(0, limit).trim();
}
function safeImage(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password ||
        /(?:token|password|username|secret|signature|auth|key)=/i.test(url.search)) return '';
    return url.href;
  } catch (_) { return ''; }
}
function artwork(asset, kind) {
  for (const item of list(asset.posterList).slice(0, 20)) {
    if (item && item.fileType === kind && item.fileUrl) {
      const url = safeImage(item.fileUrl);
      if (url) return url;
    }
  }
  const fallbacks = kind === 'stage'
    ? ['backdropUrl', 'landscapeUrl', 'wideImage', 'bannerImage']
    : ['posterUrl', 'coverUrl', 'iconUrl', 'imageUrl'];
  for (const field of fallbacks) {
    const url = safeImage(asset[field]);
    if (url) return url;
  }
  return '';
}
function normalizeMagisMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_CATALOG');
  const movies = new Map(), series = new Map();
  function remember(asset, category = '') {
    if (!asset || typeof asset !== 'object') return;
    const id = clean(asset.contentId, 180), title = clean(asset.name || asset.title, 220);
    if (!ID.test(id) || !title || movies.has(id) || series.has(id)) return;
    const type = clean(asset.programType, 32).toLowerCase();
    const isSeries = type === 'teleplay' || type === 'series' || Number(asset.volumnCount || asset.volumeCount) > 1;
    const released = clean(asset.releaseTime || asset.releaseDate, 32);
    const year = /^(?:19|20)\d\d/.exec(released);
    const item = {
      id, title, type: isSeries ? 'series' : 'movie',
      year: year ? year[0] : '',
      category: clean(category || asset.category || '', 100),
      genre: clean(asset.tags, 200),
      country: clean(asset.originalCountry || asset.country, 64),
      synopsis: clean(asset.description || asset.synopsis, 4000),
      poster: artwork(asset, 'icon') || artwork(asset, 'poster'),
      backdrop: artwork(asset, 'stage'),
      catalogOnly: true
    };
    if (isSeries) { item.seasons = []; series.set(id, item); }
    else movies.set(id, item);
  }
  for (const row of list(raw.home && raw.home.recommendList).slice(0, 100)) {
    for (const asset of list(row && row.assetList).slice(0, 100)) remember(asset, clean(row && row.name, 100));
  }
  for (const block of list(raw.search && raw.search.searchItemList).slice(0, 100)) {
    for (const asset of list(block && block.itemList).slice(0, 100)) remember(asset);
  }
  for (const entry of list(raw.details).slice(0, 300)) {
    const detail = entry && (entry.assetData || entry);
    if (!detail) continue;
    remember(detail);
    const id = clean(detail.contentId, 180), parent = series.get(id);
    if (!parent || parent.seasons.length) continue;
    const episodes = [], used = new Set();
    for (const [index, episode] of list(detail.simpleProgramList).slice(0, 2000).entries()) {
      if (!episode || typeof episode !== 'object') continue;
      const episodeId = clean(episode.contentId, 180);
      if (!ID.test(episodeId) || used.has(episodeId)) continue;
      used.add(episodeId);
      episodes.push({
        id: episodeId,
        title: clean(episode.name || ('Episodio ' + (index + 1)), 220),
        number: Number.isInteger(Number(episode.seriesNumber)) && Number(episode.seriesNumber) > 0
          ? Math.min(Number(episode.seriesNumber), 100000) : index + 1,
        catalogOnly: true
      });
    }
    if (episodes.length) parent.seasons.push({
      id: id + '-s1', number: 1, title: 'Temporada 1', episodes
    });
  }
  return {
    movies: [...movies.values()].slice(0, 10000),
    series: [...series.values()].slice(0, 10000),
    live: [], radio: [], music: []
  };
}
module.exports = { normalizeMagisMetadata };
