/* Contextual search rules shared by the Smart TV UI and Node.js tests.
 * ES5 syntax: compatible with older VIDAA and LG webOS browsers. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.TVVIDAASearch = api; }
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  function normalize(value) {
    var text = String(value === undefined || value === null ? '' : value).toLowerCase();
    if (text.normalize) { text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
    return text;
  }
  function scopeForPage(page) {
    if (page === 0) { return 'tv'; }
    if (page === 3) { return 'series'; }
    return 'movies';
  }
  function endpoint(scope) {
    return scope === 'tv' ? 'liveChannels' : scope === 'series' ? 'm3uSeries' : 'm3uMovies';
  }
  function isSeries(item) {
    if (!item) { return false; }
    var kind = normalize(item.kind || item.media_type || '');
    var type = normalize(item.type || '');
    return kind === 'serie' || kind === 'series' ||
      type === 'teleplay' || type === 'series' ||
      !!(item.seasons && item.seasons.length) ||
      !!(item.episodes && item.episodes.length) ||
      normalize(item.category || '').indexOf('serie') !== -1;
  }
  function matches(scope, q, item) {
    var value = normalize(q).replace(/^\s+|\s+$/g, '');
    if (!item || !value) { return false; }
    if (scope === 'tv') {
      return normalize([item.name, item.channelCode, item.id].join(' ')).indexOf(value) !== -1;
    }
    if (scope === 'series' ? !isSeries(item) : isSeries(item)) { return false; }
    return normalize([item.title, item.alias].join(' ')).indexOf(value) !== -1;
  }
  function localMatches(scope, query, vod, channels, maximum) {
    var pool = scope === 'tv' ? (channels || []) : (vod || []);
    var result = [], max = Math.min(200, Math.max(1, maximum || 100));
    for (var i = 0; i < pool.length && result.length < max; i++) {
      if (matches(scope, query, pool[i])) { result.push(pool[i]); }
    }
    return result;
  }
  function identity(item, scope) {
    return String((scope === 'tv' && (item.channelCode || item.id)) || item.id || item.sourceItemId || item.title || item.name || '');
  }
  function merge(scope, current, incoming) {
    var out = [], seen = {};
    function add(item) {
      if (!item || (scope !== 'tv' && (scope === 'series' ? !isSeries(item) : isSeries(item)))) { return; }
      var id = identity(item, scope);
      if (!id || seen['$' + id]) { return; }
      seen['$' + id] = true;
      out.push(item);
    }
    var a = current || [], b = incoming || [];
    for (var i = 0; i < a.length; i++) { add(a[i]); }
    for (var j = 0; j < b.length; j++) { add(b[j]); }
    return out;
  }
  return { normalize: normalize, scopeForPage: scopeForPage,
    endpoint: endpoint, isSeries: isSeries, matches: matches,
    localMatches: localMatches, merge: merge };
});
