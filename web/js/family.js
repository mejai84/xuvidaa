/* TVVIDAA family preferences: local, per-device, never media URLs or credentials. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VIDAAFamily = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  var KEY = 'tvvidaa.family.v1';
  var PROFILES = ['Principal', 'Familia', 'Invitados'];
  function blank() {
    return { favorites: { tv: {}, movies: {}, series: {} },
      recent: [], lastChannel: null, progress: {} };
  }
  function cleanString(s, max) {
    if (typeof s !== 'string' && typeof s !== 'number') return '';
    return String(s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 160);
  }
  function asItem(kind, item) {
    if (kind !== 'tv' && kind !== 'movies' && kind !== 'series') return null;
    if (!item || typeof item !== 'object') return null;
    var id = cleanString(kind === 'tv' ? (item.channelCode || item.id) : item.id, 120);
    if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) return null;
    return {
      id: id, kind: kind,
      title: cleanString(item.name || item.title, 140) || id,
      // Avoid persisting upstream/private URLs, tokens, passwords or free-form payloads.
      category: cleanString(item.category, 64),
      year: cleanString(item.year, 8)
    };
  }
  function cap(list, max) { return list.slice(0, max); }
  function safeProfile(raw) {
    var p = blank();
    if (!raw || typeof raw !== 'object') return p;
    var kinds = ['tv', 'movies', 'series'];
    for (var i = 0; i < kinds.length; i++) {
      var kind = kinds[i], map = raw.favorites && raw.favorites[kind];
      if (!map || typeof map !== 'object') continue;
      var keys = Object.keys(map).slice(0, 120);
      for (var j = 0; j < keys.length; j++) {
        var v = asItem(kind, map[keys[j]]);
        if (v) p.favorites[kind][v.id] = v;
      }
    }
    if (Array.isArray(raw.recent)) {
      for (var k = 0; k < Math.min(50, raw.recent.length); k++) {
        var entry = raw.recent[k];
        var record = asItem(entry && entry.kind, entry);
        if (record && !p.recent.some(function (x) {return x.id === record.id && x.kind === record.kind;}))
          p.recent.push(record);
      }
    }
    p.lastChannel = asItem('tv', raw.lastChannel);
    if (raw.progress && typeof raw.progress === 'object') {
      Object.keys(raw.progress).slice(0, 100).forEach(function (id) {
        var value = raw.progress[id];
        if (!/^([a-zA-Z0-9._-]{1,120})$/.test(id) || !value || typeof value !== 'object') return;
        var position = Number(value.position), duration = Number(value.duration);
        if (!isFinite(position) || !isFinite(duration) || position < 0 || duration <= 0 || position >= duration) return;
        var item = asItem(value.kind === 'series' ? 'series' : 'movies', value);
        if (item) p.progress[id] = {id:item.id,kind:item.kind,title:item.title,
          position:Math.floor(position),duration:Math.floor(duration)};
      });
    }
    return p;
  }
  function create(storage) {
    var data = { active: 'Principal', profiles: {} };
    function load() {
      var raw = '';
      try { raw = storage && storage.getItem(KEY); } catch (_) {}
      try {
        var parsed = JSON.parse(raw || 'null');
        if (parsed && parsed.profiles) {
          for (var i = 0; i < PROFILES.length; i++)
            data.profiles[PROFILES[i]] = safeProfile(parsed.profiles[PROFILES[i]]);
          if (PROFILES.indexOf(parsed.active) >= 0) data.active = parsed.active;
        }
      } catch (_) {}
      for (var j = 0; j < PROFILES.length; j++)
        if (!data.profiles[PROFILES[j]]) data.profiles[PROFILES[j]] = blank();
    }
    function save() {
      try { if (storage) storage.setItem(KEY, JSON.stringify(data)); } catch (_) {}
    }
    function current() { return data.profiles[data.active]; }
    function pickProfile(name) {
      if (PROFILES.indexOf(name) < 0) return false;
      data.active = name;
      save();
      return true;
    }
    function isFavorite(kind, id) {
      return !!(current().favorites[kind] && current().favorites[kind][id]);
    }
    function toggleFavorite(kind, source) {
      var item = asItem(kind, source);
      if (!item) return false;
      var map = current().favorites[kind];
      if (map[item.id]) delete map[item.id];
      else {
        map[item.id] = item;
        if (Object.keys(map).length > 120) delete map[Object.keys(map)[0]];
      }
      save(); return !!map[item.id];
    }
    function favorites(kind) {
      var map = current().favorites[kind] || {};
      return Object.keys(map).map(function (k) { return map[k]; });
    }
    function watched(kind, source) {
      var item = asItem(kind, source);
      if (!item) return;
      var currentData = current();
      currentData.recent = currentData.recent.filter(function (x) { return x.id !== item.id || x.kind !== kind; });
      currentData.recent.unshift(item);
      currentData.recent = cap(currentData.recent, 50);
      if (kind === 'tv') currentData.lastChannel = item;
      save();
    }
    function putProgress(kind, source, position, duration) {
      var item = asItem(kind, source), p = Number(position), d = Number(duration);
      if (!item || kind === 'tv' || !isFinite(p) || !isFinite(d) || d <= 0) return false;
      if (p < 10 || p >= d - 30) {
        delete current().progress[item.id];
      } else {
        current().progress[item.id] = { id:item.id, kind:item.kind,title:item.title,
          position:Math.floor(p), duration:Math.floor(d) };
        var ids = Object.keys(current().progress);
        if (ids.length > 100) delete current().progress[ids[0]];
      }
      save();
      return true;
    }
    function clearRecent() { current().recent = []; current().lastChannel = null; save(); }
    function clearProgress() { current().progress = {}; save(); }
    load();
    return {
      profiles: function () { return PROFILES.slice(); },
      active: function () { return data.active; },
      pickProfile: pickProfile,
      favorites: favorites, isFavorite: isFavorite, toggleFavorite: toggleFavorite,
      watched: watched,
      recent: function () {return current().recent.slice();},
      lastChannel: function () {return current().lastChannel;},
      progress: function () {return Object.keys(current().progress).map(function (id) {return current().progress[id];});},
      putProgress: putProgress, clearRecent: clearRecent, clearProgress: clearProgress
    };
  }
  return {create: create, asItem: asItem, key: KEY};
});
