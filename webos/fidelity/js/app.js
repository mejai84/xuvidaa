/* =============================================================================
   XuperTV 4.34.4  ->  LG webOS 4 (Chromium 53) fidelity reconstruction
   -----------------------------------------------------------------------------
   All geometry comes from the decoded Android resources:
     res/layout/*.xml, res/values/{colors,dimens,styles}.xml, values-es/strings.xml
   Scale: design_width 1920 / design_width_in_dp 1280  =>  1dp = 1.5px
   Content that the APK loads from its backend (posters, channel logos, QR,
   tab icons/order, home logo) is represented with the original "no data"
   assets and flagged in the audit documents. VOD data may additionally come
   from a separately configured, authorized API; no APK endpoint, credential
   or DRM logic is reproduced here.
   ============================================================================= */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ utils */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n.firstChild) { n.removeChild(n.firstChild); } }
  function abs(n, x, y, w, h) {
    n.style.position = 'absolute';
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    if (w !== undefined) { n.style.width = w + 'px'; }
    if (h !== undefined) { n.style.height = h + 'px'; }
    return n;
  }
  function closest(node, sel) {
    while (node && node !== document) {
      if (node.nodeType === 1 && node.matches && node.matches(sel)) { return node; }
      node = node.parentNode;
    }
    return null;
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function norm(s) {
    s = String(s).toLowerCase();
    if (s.normalize) {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return s;
  }
  function each(list, fn) { for (var i = 0; i < list.length; i++) { fn(list[i], i); } }

  var VOD = [];

  /* ------------------------------------------------------------- VOD API
     XMLHttpRequest is used deliberately: it works on Chromium 53, where
     fetch/async functions are not a safe webOS 4 baseline. */
  var vodApi = window.XUPERTV_API || {};
  /* Desktop harness override: ?service=http://127.0.0.1:8910 */
  var devServiceParam = /[?&]service=([^&]+)/.exec(window.location.search || '');
  if (devServiceParam) { vodApi.devServiceUrl = decodeURIComponent(devServiceParam[1]); }
  var vodApiState = { loading: false, source: 'portal', error: null };
  var portalState = { refreshing: false, lastSync: 0, roots: 0, error: null };
  var PORTAL_ROOTS = ['featured', 'movies', 'series', 'anime', 'kids', 'free'];

  function apiArray(payload) {
    if (Object.prototype.toString.call(payload) === '[object Array]') { return payload; }
    if (!payload) { return []; }
    var keys = ['items', 'movies', 'results', 'recommendList', 'movieList',
                'totalMovieList', 'programList', 'data'];
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.toString.call(payload[keys[i]]) === '[object Array]') {
        return payload[keys[i]];
      }
      if (payload[keys[i]] && typeof payload[keys[i]] === 'object') {
        var nested = apiArray(payload[keys[i]]);
        if (nested.length) { return nested; }
      }
    }
    return [];
  }

  function apiError(payload) {
    if (!payload || typeof payload !== 'object') { return ''; }
    var code = payload.returnCode || payload.code || payload.errorCode || '';
    var message = payload.errorMessage || payload.message || payload.msg || '';
    if (!code && !message) { return ''; }
    return (code ? String(code) + ': ' : '') + (message ? String(message) : 'La API rechazó la petición');
  }

  function apiUrl(kind) {
    var direct = vodApi[kind + 'Url'];
    if (direct) { return String(direct); }
    var base = String(vodApi.baseUrl || '').replace(/\/$/, '');
    var path = String(vodApi[kind + 'Path'] || '');
    return base && path ? base + (path.charAt(0) === '/' ? path : '/' + path) : '';
  }

  function xuperSession() {
    var session = vodApi.session || {};
    return {
      userId: String(session.userId || ''),
      userToken: String(session.userToken || ''),
      portalCode: String(session.portalCode || ''),
      homePageCode: String(session.homePageCode || ''),
      version: String(session.version || '4.34.4')
    };
  }

  function hasXuperSession() {
    var session = xuperSession();
    return !!(session.userId && session.userToken && session.portalCode);
  }

  function xuperPayload(kind, value) {
    var session = xuperSession();
    if (kind === 'catalog') {
      return {
        userId: session.userId,
        userToken: session.userToken,
        portalCode: session.portalCode,
        homePageCode: session.homePageCode,
        version: session.version
      };
    }
    if (kind === 'search') {
      return {
        userToken: session.userToken,
        userId: session.userId,
        portalCode: session.portalCode,
        columnId: '',
        value: value || '',
        type: '',
        pageSize: 20,
        pageNum: 1,
        filter: ''
      };
    }
    return {
      userToken: session.userToken,
      userId: session.userId,
      portalCode: session.portalCode,
      programId: value
    };
  }

  function apiImage(value) {
    if (!value) { return ''; }
    value = String(value);
    if (/^https?:\/\//i.test(value) || value.indexOf('data:') === 0) { return value; }
    if (!vodApi.imageBaseUrl) { return value; }
    return String(vodApi.imageBaseUrl).replace(/\/$/, '') + '/' + value.replace(/^\//, '');
  }

  function apiText(value, fallback) {
    return value === undefined || value === null || value === '' ? fallback : String(value);
  }

  function isSeriesItem(item) {
    if (!item) { return false; }
    return item.type === 'teleplay' || item.type === 'series' || item.kind === 'serie' ||
           (item.category && item.category.indexOf('serie') !== -1) ||
           (item.episodes && item.episodes.length > 0) ||
           (item.seasons && item.seasons.length > 0) ||
           (item.volumeCount && parseInt(item.volumeCount, 10) > 1);
  }

  function normalizeVod(raw, index) {
    raw = raw || {};
    var genres = raw.genres || raw.genre || [];
    if (typeof genres === 'string') { genres = genres.split(','); }
    if (Object.prototype.toString.call(genres) !== '[object Array]') { genres = []; }
    var names = [];
    for (var i = 0; i < genres.length; i++) {
      names.push(typeof genres[i] === 'string' ? genres[i] : (genres[i].name || ''));
    }
    var runtime = raw.duration || raw.runtime || raw.runtimeMinutes || '';
    if (typeof runtime === 'number') { runtime = Math.floor(runtime / 60) + ' h ' + (runtime % 60) + ' min'; }
    var type = apiText(raw.type || raw.programType, '');
    var isSeries = type === 'teleplay' || type === 'series' || norm(apiText(raw.kind || '', '')) === 'serie' ||
                   norm(apiText(raw.category || '', '')).indexOf('serie') !== -1 ||
                   (raw.episodes && raw.episodes.length > 0) ||
                   (raw.seasons && raw.seasons.length > 0) ||
                   (raw.volumeCount && parseInt(raw.volumeCount, 10) > 1) ||
                   (raw.volumnCount && parseInt(raw.volumnCount, 10) > 1);
    return {
      id: apiText(raw.id || raw.vodId || raw.programId || raw.program_id || raw.tmdb_id, 'api-' + index),
      title: apiText(raw.title || raw.name || raw.programName || raw.programTitle || raw.original_title, 'Sin título'),
      category: norm(apiText(raw.category || raw.section || raw.collection || raw.homeSection, '')),
      score: apiText(raw.score || raw.vote_average || raw.rating || raw.movieRate || raw.programScore, '—'),
      year: apiText(raw.year || raw.release_year || raw.programYear || (raw.releaseDate || raw.releaseTime || raw.release_date || '').slice(0, 4), '—'),
      duration: apiText(runtime, '—'),
      genres: names.length ? names : ['Sin clasificar'],
      director: apiText(raw.director, '—'),
      actors: apiText(raw.actors || raw.actorDisplay || raw.cast, '—'),
      synopsis: apiText(raw.synopsis || raw.overview || raw.description || raw.programUpdateContent, 'Sin sinopsis disponible.'),
      kind: isSeries ? 'serie' : apiText(raw.kind || raw.media_type, 'película'),
      poster: apiImage(raw.posterUrl || raw.poster_url || raw.poster || raw.poster_path || raw.image || raw.imageUrl || raw.cover || raw.coverUrl || raw.programPoster || raw.programImage),
      landscape: apiImage(raw.landscapeUrl || raw.landscape_url || raw.landscape || raw.wideImage || raw.bannerImage),
      backdrop: apiImage(raw.backdropUrl || raw.backdrop_url || raw.backdrop || raw.backdrop_path),
      streamUrl: raw.streamUrl || raw.stream_url || '',
      /* Magis portal records (service / snapshot). */
      type: type || (isSeries ? 'teleplay' : 'movie'),
      row: apiText(raw.row, ''),
      alias: apiText(raw.alias, ''),
      country: apiText(raw.country || raw.originalCountry, ''),
      releaseDate: apiText(raw.releaseDate || raw.releaseTime, ''),
      tagline: apiText(raw.tagline || raw.viewPoint, ''),
      volumeCount: parseInt(raw.volumeCount || raw.volumnCount, 10) || 0,
      updateCount: parseInt(raw.updateCount, 10) || 0,
      episodes: raw.episodes || [],
      seasons: raw.seasons || [],
      moreAudio: raw.moreAudio !== undefined ? raw.moreAudio : 0,
      moreSubtitle: raw.moreSubtitle !== undefined ? raw.moreSubtitle : 0,
      _portal: raw.portal === true || raw._portal === true || (vodApi && vodApi.mode === 'portal' && String(raw.id || '').length > 10)
    };
  }

  function apiRequest(url, done, options) {
    options = options || {};
    var xhr = new XMLHttpRequest();
    var finished = false;
    var timeout = parseInt(options.timeoutMs, 10) || parseInt(vodApi.timeoutMs, 10) || 10000;
    function finish(error, payload) {
      if (finished) { return; }
      finished = true;
      done(error, payload);
    }
    xhr.open(options.method || 'GET', url, true);
    xhr.timeout = timeout;
    var headers = vodApi.headers || {};
    for (var name in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, name)) { xhr.setRequestHeader(name, headers[name]); }
    }
    if (options.body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
      xhr.setRequestHeader('Content-Type', 'application/json;charset=utf-8');
    }
    /* Network errors and timeouts also reach readyState 4 with status 0.
       Handle HTTP replies on load so those events keep their real cause. */
    xhr.onload = function () {
      if (xhr.status < 200 || xhr.status >= 300) {
        var responseError = '';
        try {
          var errorPayload = JSON.parse(xhr.responseText || '{}');
          responseError = errorPayload.errorText || errorPayload.errorMessage || errorPayload.error || '';
        } catch (ignoreErrorPayload) {}
        finish(responseError ? ('HTTP ' + xhr.status + ': ' + responseError) : ('HTTP ' + xhr.status));
        return;
      }
      try { finish(null, JSON.parse(xhr.responseText)); }
      catch (err) { finish('La API no devolvió JSON válido'); }
    };
    xhr.onerror = function () { finish('No se pudo conectar con la API. Comprueba la conexión o si el navegador bloqueó la solicitud.'); };
    xhr.ontimeout = function () { finish('La API no respondió en ' + Math.round(timeout / 1000) + ' s. Vuelve a intentarlo.'); };
    xhr.onabort = function () { finish('La solicitud a la API fue cancelada.'); };
    try { xhr.send(options.body === undefined ? null : JSON.stringify(options.body)); }
    catch (err) { finish(err.message || 'No se pudo iniciar la petición'); }
  }

  /* Some portal catalogues publish every season as a separate series card
     ("The Walking Dead T1", "The Walking Dead T2", ...).  Treat only an
     explicit trailing season marker as a grouping signal; ordinary titles
     such as spin-offs are left untouched. */
  function catalogSeasonMarker(item) {
    if (!item || !isSeriesItem(item)) { return null; }
    var title = String(item.title || item.alias || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    var match = /^(.*?)(?:\s*[-–:|]?\s*(?:temporada|season)\s*(\d+)|\s*[-–:|]?\s*[st]\s*0?(\d+))\s*$/i.exec(title);
    if (!match || !match[1]) { return null; }
    var number = parseInt(match[2] || match[3], 10);
    if (!number || number > 99) { return null; }
    return { title: match[1].replace(/\s+$/, ''), number: number };
  }

  function groupCatalogSeasons(items) {
    var groups = {}, out = [];
    for (var i = 0; i < items.length; i++) {
      var marker = catalogSeasonMarker(items[i]);
      if (!marker) { out.push(items[i]); continue; }
      var key = norm(marker.title);
      if (!groups[key]) { groups[key] = { title: marker.title, items: [] }; }
      groups[key].items.push({ item: items[i], number: marker.number });
    }
    for (var key in groups) {
      if (!groups.hasOwnProperty(key)) { continue; }
      var group = groups[key];
      if (group.items.length < 2) {
        out.push(group.items[0].item);
        continue;
      }
      group.items.sort(function (a, b) { return a.number - b.number; });
      var main = group.items[0].item;
      var allCats = {};
      main._catalogSeasons = [];
      main._seriesGroup = true;
      main._seriesTitle = group.title;
      main.title = group.title;
      main.alias = group.title;
      main.seasons = [];
      for (var s = 0; s < group.items.length; s++) {
        var part = group.items[s];
        var cats = String(part.item.category || '').split(',');
        for (var c = 0; c < cats.length; c++) { if (cats[c]) { allCats[cats[c]] = true; } }
        var season = { id: part.item.id, number: part.number, title: group.title };
        main._catalogSeasons.push(season);
        main.seasons.push(season);
      }
      main.category = Object.keys(allCats).join(',');
      out.push(main);
    }
    return out;
  }

  function replaceVod(records, source, portal) {
    if (!records.length) { return false; }
    var previous = {};
    for (var p = 0; p < VOD.length; p++) { previous[String(VOD[p].id)] = VOD[p]; }
    VOD.splice(0, VOD.length);
    var normalizedItems = [];
    for (var i = 0; i < records.length; i++) {
      var item = normalizeVod(records[i], i + 1);
      if (portal && records[i].portal !== false) { item._portal = true; }
      var old = previous[String(item.id)];
      if (old) {
        /* Keep what the detail/player already learned about this title. */
        if (old.episodes) { item.episodes = old.episodes; }
        if (old.seasons) { item.seasons = old.seasons; }
        if (old._detailsLoaded) { item._detailsLoaded = true; }
        if (!item.streamUrl && old.streamUrl) { item.streamUrl = old.streamUrl; }
      }
      normalizedItems.push(item);
    }
    var catalogItems = groupCatalogSeasons(normalizedItems);
    for (var n = 0; n < catalogItems.length; n++) {
      VOD.push(catalogItems[n]);
    }
    if (state.detail) {
      var foundDetail = false;
      for (var d = 0; d < VOD.length; d++) {
        if (String(VOD[d].id) === String(state.detail.id)) {
          state.detail = VOD[d];
          foundDetail = true;
          break;
        }
      }
      if (!foundDetail) { state.detail = VOD[0]; }
    }
    vodApiState.source = source;
    vodApiState.error = null;
    refreshVodViews();
    return true;
  }

  /* Show only records actually returned for the requested portal category. */
  function vodFor(category, count, fallbackStart) {
    var out = [], i;
    if (category) {
      for (i = 0; i < VOD.length; i++) {
        var cats = norm(VOD[i].category || '').split(',');
        if (cats.indexOf(category) !== -1) { out.push(VOD[i]); }
      }
    }
    return out;
  }

  function refreshVodViews() {
    if (homeBuilt) {
      var rail = $('home-tabs');
      var railWasExpanded = !!(rail && rail.classList.contains('is-expanded') && !rail.classList.contains('is-collapsed'));
      var focusWasTab = !!(state.focus && state.focus._tab !== undefined);
      var focusWasNotify = !!(state.focus && closest(state.focus, '#home-notify'));
      var hadContentFocus = !!(state.focus && closest(state.focus, '.home-page'));
      pages = [];
      tabEls = [];
      buildHome();
      selectTab(state.tab, false);
      if (state.screen === 'home') {
        if (focusWasTab && tabEls[state.tab]) { setFocus(tabEls[state.tab], true); }
        else if (focusWasNotify) {
          var n = firstIn($('home-notify'));
          if (n) { setFocus(n, true); }
        } else if (hadContentFocus) {
          var page = pages[TABS[state.tab].page];
          var f = page ? firstIn(page) : null;
          if (f) { setFocus(f, true); }
        }
        if (railWasExpanded && rail) {
          /* The reference keeps the full labels on the first paint even while
             the content holds focus; preserve that across a catalog refresh. */
          rail.classList.add('is-expanded');
          rail.classList.remove('is-collapsed');
          var railBg = document.querySelector('.home-sidebar-bg');
          if (railBg) { railBg.classList.add('is-on'); }
        }
      }
    }
    if (searchKeyboard) { buildSearch(); if (state.searchQuery) { runSearch(); } }
    if (state.detail) { buildDetail(state.detail); }
  }

  /* ------------------------------------------------------ portal service
     The Magis portal answers no CORS preflight, so the page cannot call it.
     The bundled Node service speaks the encrypted protocol and returns plain
     JSON over Luna; devServiceUrl mirrors the same methods for desktop tests. */
  function hasLuna() {
    if (window.PalmServiceBridge && (!window.webOS || !window.webOS.service)) {
      window.webOS = window.webOS || {};
      window.webOS.service = {
        request: function (uri, opts) {
          opts = opts || {};
          var bridge = new window.PalmServiceBridge();
          bridge.onservicecallback = function (msg) {
            var res;
            try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false, errorText: msg }; }
            if (res.returnValue === false) {
              if (opts.onFailure) { opts.onFailure(res); }
            } else {
              if (opts.onSuccess) { opts.onSuccess(res); }
            }
          };
        var fullUri = opts.method ? (uri.replace(/\/$/, '') + '/' + opts.method) : uri;
        bridge.call(fullUri, JSON.stringify(opts.parameters || {}));
        return bridge;
      }
    };
  }
  return !!(window.webOS && window.webOS.service && window.webOS.service.request);
}

function queryString(params) {
  var parts = [];
  for (var k in params) {
    if (Object.prototype.hasOwnProperty.call(params, k)) {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
  }
  return parts.join('&');
}

/* ls-hubd refuses a call when the app is missing from the service ACL, which
   happens when the installed manifest is stale after an update.  "Denied
   method netdiag for category /" means nothing to a viewer, so translate it
   into the two things that actually fix it and keep the raw text in brackets
   for whoever supports the TV. */
var SERVICE_BLOCKED_HINT = 'La TV tiene bloqueado el servicio de XuperTV. ' +
  'Desenchufa la TV 10 segundos y vuelve a abrir la app; si sigue igual, ' +
  'reinstala con el instalador.';
function describeServiceError(text) {
  var raw = String(text == null ? '' : text);
  if (/denied|permission|not permitted/i.test(raw)) {
    return SERVICE_BLOCKED_HINT + ' (' + raw + ')';
  }
  return raw;
}

/* The network test can only judge the carrier by touching the real CDN, so the
   page remembers the last raw CDN URLs the portal handed out.  Loopback proxy
   URLs are useless here: they always answer, even when the carrier drops the
   upstream connection. */
var lastCdnProbe = { live: null, vod: null };
function rememberCdnProbe(kind, payload) {
  try {
    if (!payload) { return; }
    var url = payload.url || '';
    if (!/^https?:\/\//i.test(url)) { return; }
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url)) { return; }
    lastCdnProbe[kind] = { url: url, headers: payload.headers || {} };
  } catch (eProbe) { /* ignore */ }
}

function portalServiceCall(method, params, done, customTimeout) {
  if (!window.PalmServiceBridge && /^(ping|heartbeat|keepAlive|abortMedia|netdiag|fetchM3u|resolveSmooth)$/.test(method)) {
    done(null, { returnValue: true, skipped: true });
    return true;
  }
  var serviceId = vodApi.serviceId || 'com.webosflux.xuptertv.fidelity.service';
  var settled = false;
  var browserService = !window.PalmServiceBridge && !!vodApi.devServiceUrl;
  var timeoutMs = customTimeout || (browserService && parseInt(vodApi.browserTimeoutMs, 10)) || parseInt(vodApi.timeoutMs, 10) || 20000;
  var callTimer = null;
  function finish(error, payload) {
    if (settled) { return; }
    settled = true;
    if (callTimer) { clearTimeout(callTimer); callTimer = null; }
    done(error ? describeServiceError(error) : error, payload);
  }
  callTimer = setTimeout(function () {
    finish(browserService ? ('La API no respondió en ' + Math.round(timeoutMs / 1000) + ' s. Vuelve a intentarlo.') : ('El servicio de la TV no respondió en ' + Math.round(timeoutMs / 1000) + ' s. Desenchufa la TV de la corriente 10 segundos y vuelve a abrir la app.'), null);
  }, timeoutMs + 1000);
  /* webOSTV.js defines webOS.service.request even in a plain browser; without
     the native bridge it only reports an error, so the desktop harness must
     skip the Luna branch entirely. */
  if (hasLuna() && window.PalmServiceBridge) {
    try {
      window.webOS.service.request('luna://' + serviceId, {
        method: method,
        parameters: params || {},
        timeout: customTimeout || parseInt(vodApi.timeoutMs, 10) || 20000,
        onSuccess: function (payload) { finish(null, payload); },
        onFailure: function (error) {
          finish((error && error.errorText) || 'Error del servicio XuperTV', null);
        }
      });
      return true;
    } catch (e) {
      if (!vodApi.devServiceUrl) {
        finish('Error comunicando con el servicio: ' + (e.message || e), null);
        return false;
      }
    }
  }
  /* Desktop harness: reach the same methods over plain HTTP when the Luna
     bridge is missing or rejected the request (webOSTV.js on a browser). */
  if (vodApi.devServiceUrl) {
    var serviceBase = String(vodApi.devServiceUrl).replace(/\/$/, '');
    apiRequest(serviceBase + '/' + encodeURIComponent(method),
      function (error, payload) { finish(error, payload); },
      { method: 'POST', body: params || {}, timeoutMs: timeoutMs });
    return true;
  }
  finish('El servicio XuperTV no está disponible', null);
  return false;
}

  function startServiceKeepAlive() {
    if (!hasLuna()) { return; }
    var serviceId = vodApi.serviceId || 'com.webosflux.xuptertv.fidelity.service';
    try {
      window.webOS.service.request('luna://' + serviceId, {
        method: 'keepAlive',
        parameters: { subscribe: true },
        resubscribe: true,
        onSuccess: function () {},
        onFailure: function () {}
      });
    } catch (eSub) { /* ignore */ }

    setInterval(function () {
      try {
        window.webOS.service.request('luna://' + serviceId, {
          method: 'heartbeat',
          parameters: {},
          onSuccess: function () {},
          onFailure: function () {}
        });
      } catch (eHb) { /* ignore */ }
    }, 15000);
  }

  function portalSnapshot() {
    var data = window.XUPERTV_PORTAL;
    return data ? apiArray(data) : [];
  }

  function applyPortalRefresh(roots) {
    var byId = {}, order = [], cats = {};
    function absorb(item) {
      if (!item || !item.id) { return; }
      var id = String(item.id);
      if (!byId[id]) { byId[id] = item; order.push(id); }
      else {
        var cur = byId[id];
        for (var k in item) {
          if (Object.prototype.hasOwnProperty.call(item, k) &&
              item[k] !== '' && item[k] !== '—' && item[k] !== null && item[k] !== undefined) {
            cur[k] = item[k];
          }
        }
      }
      var list = String(item.category || '').split(',');
      cats[id] = cats[id] || {};
      for (var c = 0; c < list.length; c++) { if (list[c]) { cats[id][list[c]] = true; } }
    }
    for (var r = 0; r < PORTAL_ROOTS.length; r++) {
      var list = roots[PORTAL_ROOTS[r]] || [];
      for (var i = 0; i < list.length; i++) { list[i].portal = true; absorb(list[i]); }
    }
    if (!order.length) {
      /* Refresh received no items: preserve the genuine portal snapshot. */
      return;
    }
    var records = [];
    for (var o = 0; o < order.length; o++) {
      var rec = byId[order[o]];
      rec.category = Object.keys(cats[order[o]]).join(',');
      records.push(rec);
    }
    if (records.length) { replaceVod(records, 'portal', true); }
  }

  function refreshPortalCatalog() {
    if (portalState.refreshing) { return; }
    portalState.refreshing = true;
    portalState.error = null;
    var fresh = {};
    var index = 0;
    function next() {
      if (index >= PORTAL_ROOTS.length) {
        portalState.refreshing = false;
        portalState.lastSync = Date.now();
        applyPortalRefresh(fresh);
        return;
      }
      var root = PORTAL_ROOTS[index++];
      portalServiceCall('home', { root: root }, function (error, payload) {
        if (!error && payload && payload.returnValue !== false && payload.items && payload.items.length) {
          fresh[root] = payload.items;
          portalState.roots++;
        } else if (error) {
          portalState.error = error;
        }
        next();
      });
    }
    next();
  }

  function loadPortalCatalog() {
    var snap = portalSnapshot();
    if (snap.length) {
      replaceVod(snap, 'portal-snapshot', true);
    }
    if (vodApi.refresh === false) {
      if (!snap.length) { vodApiState.error = 'Sin snapshot del portal'; }
      return;
    }
    refreshPortalCatalog();
  }

  function loadVodCatalog() {
    if (!vodApi.enabled) { return; }
    if (vodApi.mode === 'portal') { loadPortalCatalog(); return; }
    if (vodApi.mode === 'static') { vodApiState.error = 'El catálogo de muestra está desactivado'; return; }
    var url = apiUrl('catalog');
    if (vodApi.mode === 'xuper' && !hasXuperSession()) {
      vodApiState.error = 'Falta la sesión XuperTV (userId, userToken y portalCode)';
      return;
    }
    if (!url) {
      vodApiState.error = 'Falta baseUrl/catalogUrl del catálogo autorizado';
      return;
    }
    vodApiState.loading = true;
    apiRequest(url, function (error, payload) {
      vodApiState.loading = false;
      var responseError = apiError(payload);
      if (!error && !responseError && replaceVod(apiArray(payload), 'api')) { return; }
      var message = error || responseError || 'La API no devolvió películas';
      vodApiState.error = message;
    }, vodApi.mode === 'xuper' ? { method: 'POST', body: xuperPayload('catalog') } : null);
  }

  function mergeDetail(item, raw) {
    var groupedId = item && item._seriesGroup ? item.id : null;
    var groupedTitle = item && item._seriesGroup ? item._seriesTitle : null;
    var full = normalizeVod(raw, item.id);
    /* Catalog values remain useful when a detail response omits a field. */
    for (var key in full) {
      if (Object.prototype.hasOwnProperty.call(full, key) && full[key] !== '—' && full[key] !== '' &&
          full[key] !== 'Sin sinopsis disponible.') {
        item[key] = full[key];
      }
    }
    if (groupedId !== null) {
      item.id = groupedId;
      item.title = groupedTitle;
      item.alias = groupedTitle;
      item.seasons = item._catalogSeasons || item.seasons;
    }
  }

  function loadVodDetail(item, done) {
    done = done || function () {};
    if (!item) { return done(null); }
    if (item._detailsLoaded) { return done(item); }
    /* The portal's getItemData endpoint returns episodes for series. Movies
       already carry their full ficha in the catalogue and return portal100006
       from that endpoint. A cold browser Function has no catalogue cache, so
       let resolve request the movie's real source directly. */
    if (!window.PalmServiceBridge && item._portal && !isSeriesItem(item)) {
      item._detailsLoaded = true;
      return done(item);
    }
    if (item._detailLoading) {
      item._detailWait = item._detailWait || [];
      item._detailWait.push(done);
      return;
    }
    if (vodApi.mode === 'portal' && item._portal) {
      item._detailLoading = true;
      item._detailWait = [done];
      portalServiceCall('detail', { contentId: item.id }, function (error, payload) {
        item._detailLoading = false;
        var detailError = error || (payload && payload.returnValue === false && (payload.errorText || payload.errorMessage)) || '';
        if (!error && payload && payload.returnValue !== false && payload.item) {
          mergeDetail(item, payload.item);
          item.episodes = payload.episodes || [];
          item.seasons = item._catalogSeasons || payload.seasons || [];
          /* The portal keys episodes by the season container, so remember
             which container this list came from (item.id stays the series). */
          if (!item.seasonId) { item.seasonId = item.id; }

          /* Ordenar temporadas ascendentemente por numero */
          if (item.seasons && item.seasons.length) {
            item.seasons.sort(function (a, b) {
              var na = parseInt(a.number, 10) || 0;
              var nb = parseInt(b.number, 10) || 0;
              return na - nb;
            });
          }

          /* Si no hay temporadas pero el titulo o alias tiene T/S, asegurar al menos una temporada */
          if ((!item.seasons || !item.seasons.length) && isSeriesItem(item)) {
            var sNum = 1;
            var sm = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
            if (sm) { sNum = parseInt(sm[1], 10) || 1; }
            item.seasons = [{ id: item.id, number: sNum }];
          }

          /* Sincronizar indice de temporada activa con item.id */
          if (item.seasons && item.seasons.length) {
            var activeIdx = 0;
            for (var s = 0; s < item.seasons.length; s++) {
              if (item.seasons[s].id === item.id) {
                activeIdx = s;
                break;
              }
            }
            state.detailSeason = activeIdx;
          }

          /* Episodio por defecto si no hay uno seleccionado */
          if (item.episodes && item.episodes.length && !state.detailEpisode) {
            state.detailEpisode = item.episodes[0];
          }
          applyPendingHistoryEpisode(item);

          item._detailsLoaded = true;
        }
        var wait = item._detailWait || [];
        item._detailWait = [];
        var hadWaiters = wait.length > 0;
        item._detailError = detailError || '';
        for (var i = 0; i < wait.length; i++) { wait[i](detailError ? null : item, detailError || null); }
        if (state.detail === item && state.screen === 'detail') {
          buildDetail(item);
          if (detailError) {
            state.streamError = 'No se pudo cargar el t\u00edtulo: ' + detailError;
            setPlayerStatus(state.streamError);
            return;
          }
          if (!hadWaiters && (!playerVideo || !playerVideo.src || playerVideo.paused)) {
            startPlayerVideo(item, state.detailEpisode);
          }
        }
      });
      return;
    }
    var endpoint = apiUrl('detail');
    if (!vodApi.enabled || !endpoint) { return done(item); }
    if (vodApi.mode === 'xuper' && !hasXuperSession()) { return done(item); }
    item._detailLoading = true;
    var url = endpoint.replace('{id}', encodeURIComponent(item.id));
    apiRequest(url, function (error, payload) {
      item._detailLoading = false;
      if (!error) {
        var records = apiArray(payload);
        var raw = records.length ? records[0] : (payload && (payload.item || payload.movie || payload));
        if (raw && typeof raw === 'object') {
          mergeDetail(item, raw);
          item._detailsLoaded = true;
          if (state.detail === item && state.screen === 'detail') {
            buildDetail(item);
            if (!playerVideo || !playerVideo.src || playerVideo.paused) {
              startPlayerVideo(item, state.detailEpisode);
            }
          }
        }
      }
      done(item);
    }, vodApi.mode === 'xuper' ? { method: 'POST', body: xuperPayload('detail', item.id) } : null);
  }

  /* Live TV is portal-driven.  Do not draw fictitious rows while the local
     service starts: they looked like real channels until the user left and
     returned to the TV tab. */
  var CHANNELS = [];

  /* Tab order and labels observed on the running app (WSA, 1920x1080).
     The APK builds this list from its backend, so the icon artwork is not a
     drawable in the APK; these glyphs are reconstructions of the observed
     shapes (documented in DIFERENCIAS_PENDIENTES.md). */
  var TAB_ICONS = {
    tv: '<svg viewBox="0 0 33 33"><rect x="3.5" y="7" width="26" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M11 24.5v3h11v-3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
    thumb: '<svg viewBox="0 0 33 33"><path d="M12 15.5V28H7.6A2.6 2.6 0 0 1 5 25.4v-7.3a2.6 2.6 0 0 1 2.6-2.6H12z" fill="currentColor"/><path d="M14 15.6l4.3-9.2a2.2 2.2 0 0 1 4 1.6V13h5.6a2.9 2.9 0 0 1 2.8 3.6l-2 9A3.4 3.4 0 0 1 25.4 28H14z" fill="currentColor"/></svg>',
    film: '<svg viewBox="0 0 33 33"><circle cx="16.5" cy="16.5" r="11.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16.5" cy="16.5" r="2.4" fill="currentColor"/><circle cx="16.5" cy="9.5" r="2.1" fill="currentColor"/><circle cx="16.5" cy="23.5" r="2.1" fill="currentColor"/><circle cx="9.5" cy="16.5" r="2.1" fill="currentColor"/><circle cx="23.5" cy="16.5" r="2.1" fill="currentColor"/></svg>',
    strip: '<svg viewBox="0 0 33 33"><rect x="4" y="7" width="25" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M9 7v19M24 7v19" stroke="currentColor" stroke-width="1.8"/><rect x="5.6" y="9" width="2.4" height="2.6" fill="currentColor"/><rect x="5.6" y="15.2" width="2.4" height="2.6" fill="currentColor"/><rect x="5.6" y="21.4" width="2.4" height="2.6" fill="currentColor"/><rect x="25" y="9" width="2.4" height="2.6" fill="currentColor"/><rect x="25" y="15.2" width="2.4" height="2.6" fill="currentColor"/><rect x="25" y="21.4" width="2.4" height="2.6" fill="currentColor"/></svg>',
    kids: '<svg viewBox="0 0 33 33"><circle cx="8.6" cy="8.6" r="4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="24.4" cy="8.6" r="4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="16.5" cy="18" r="9.6" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="13" cy="17" r="1.5" fill="currentColor"/><circle cx="20" cy="17" r="1.5" fill="currentColor"/><ellipse cx="16.5" cy="21.6" rx="2.4" ry="1.7" fill="currentColor"/></svg>',
    anime: '<svg viewBox="0 0 33 33"><circle cx="8.5" cy="9" r="4.5" fill="currentColor"/><circle cx="24.5" cy="9" r="4.5" fill="currentColor"/><path d="M16.5 9c5.8 0 10.5 4.6 10.5 10.3 0 5.7-4.7 9.7-10.5 9.7S6 25 6 19.3C6 13.6 10.7 9 16.5 9z" fill="currentColor"/><circle cx="12.5" cy="18" r="1.6" fill="#0b0b0b"/><circle cx="20.5" cy="18" r="1.6" fill="#0b0b0b"/><ellipse cx="16.5" cy="23" rx="3" ry="2" fill="#0b0b0b"/></svg>',
    compass: '<svg viewBox="0 0 33 33"><circle cx="16.5" cy="16.5" r="11.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M22 11l-3.2 7.8L11 22l3.2-7.8z" fill="currentColor"/></svg>',
    novel: '<svg viewBox="0 0 33 33"><path d="M5 6.5h9.5c2.2 0 3.7 1 4.5 2.3.8-1.3 2.3-2.3 4.5-2.3H28v20h-5.5c-2.1 0-3.4.6-4.5 1.8-1.1-1.2-2.4-1.8-4.5-1.8H5z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M18 9v19" stroke="currentColor" stroke-width="2.2"/></svg>',
    history: '<svg viewBox="0 0 33 33"><circle cx="16.5" cy="17" r="10.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M16.5 10.5V17l5 3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M8 7v6h6" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>'
  };

  var TABS = [
    { label: 'TV', page: 0, icon: 'tv' },
    { label: 'DESTACADOS', page: 1, icon: 'thumb' },
    { label: 'PELICULA', page: 2, icon: 'film' },
    { label: 'SERIES', page: 3, icon: 'strip' },
    { label: 'KIDS', page: 4, icon: 'kids' },
    { label: 'ANIME', page: 5, icon: 'anime' },
    { label: 'NOVELAS', page: 6, icon: 'novel' },
    { label: 'EXPLORAR', page: 7, icon: 'compass' },
    { label: 'HISTORIAL', page: -1, icon: 'history', action: 'history' }
  ];

  var SETTINGS_ITEMS = [
    { id: 'profile', label: 'Mi cuenta' },
    { id: 'history', label: 'Mi lista' },
    { id: 'share', label: 'Compartir APP' },
    { id: 'parent', label: 'Bloqueo' },
    { id: 'playback', label: 'Configuración global' },
    { id: 'netdiag', label: 'Diagnóstico' },
    { id: 'feedback', label: 'Ayuda y Feedback' },
    { id: 'about', label: 'Sobre nosotros' }
  ];

  var SETTINGS_MENU_ICONS = {
    profile: '<svg viewBox="0 0 32 32"><circle cx="16" cy="10" r="5"/><path d="M6 27c.7-6 4.3-9 10-9s9.3 3 10 9"/></svg>',
    history: '<svg viewBox="0 0 32 32"><rect x="4" y="4" width="9" height="9"/><rect x="19" y="4" width="9" height="9"/><rect x="4" y="19" width="9" height="9"/><rect x="19" y="19" width="9" height="9"/></svg>',
    share: '<svg viewBox="0 0 32 32"><circle cx="8" cy="16" r="3"/><circle cx="24" cy="7" r="3"/><circle cx="24" cy="25" r="3"/><path d="M10.6 14.5l10.8-6M10.6 17.5l10.8 6"/></svg>',
    parent: '<svg viewBox="0 0 32 32"><rect x="7" y="14" width="18" height="14" rx="2"/><path d="M11 14V10a5 5 0 0 1 10 0v4"/><path d="M16 19v4"/></svg>',
    playback: '<svg viewBox="0 0 32 32"><rect x="4" y="6" width="24" height="20" rx="3"/><path d="M13 11l8 5-8 5z"/></svg>',
    netdiag: '<svg viewBox="0 0 32 32"><path d="M3 13a19 19 0 0 1 26 0"/><path d="M8 18a12 12 0 0 1 16 0"/><path d="M13 23a6 6 0 0 1 6 0"/><circle cx="16" cy="27.5" r="1.2"/></svg>',
    feedback: '<svg viewBox="0 0 32 32"><path d="M6 4h15l5 5v19H6z"/><path d="M20 4v6h6M10 16h12M10 21h8"/></svg>',
    about: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12"/><path d="M16 14v8M16 10h.1"/></svg>'
  };

  /* ---------------------------------------------------------------- state */
  var state = {
    screen: 'welcome',
    tab: 0,
    channel: 0,
    focus: null,
    detail: null,
    detailReturn: null,
    detailRange: 0,
    detailSeason: 0,
    detailNeedsRebuild: false,
    playerReturn: null,
    playerMode: 'live',
    playerItem: null,
    playerEpisode: null,
    playerSeasonIndex: 0,
    episodeBrowserOpen: false,
    categoryPickerOpen: false,
    browserSeason: 0,
    streamError: '',
    streamMode: 'normal',
    trackIndex: 0,
    channelsOpen: false,
    infobar: true,
    infoTimer: null,
    searchQuery: '',
    searchNumeric: false,
    searchSeq: 0,
    searchFocus: null,
    playback: {
      streamMode: 'normal',
      screen: 0,
      audio: 0,
      subLang: 0,
      size: 0,
      style: 0,
      subtitle: true
    },
    crOn: false,
    favs: {}
  };

  /* A profile belongs to this TV only: no registration, credentials or
     network account is required.  It intentionally stays small because old
     webOS models have limited persistent storage. */
  var LOCAL_PROFILE_KEY = 'xuper_local_profile_v1';
  var LOCAL_PLAYBACK_KEY = 'xuper_global_playback_v1';
  var localProfile = { id: '', createdAt: 0, history: [] };

  function safeLocalRead(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (eRead) { return fallback; }
  }

  function safeLocalWrite(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (eWrite) { /* storage unavailable */ }
  }

  function loadLocalProfile() {
    var savedPlayback = safeLocalRead(LOCAL_PLAYBACK_KEY, null);
    if (savedPlayback) {
      for (var pKey in state.playback) {
        if (state.playback.hasOwnProperty(pKey) && savedPlayback[pKey] !== undefined) {
          state.playback[pKey] = savedPlayback[pKey];
        }
      }
    }
    var savedProfile = safeLocalRead(LOCAL_PROFILE_KEY, null);
    if (savedProfile && savedProfile.id) {
      localProfile = savedProfile;
      if (!localProfile.history || !localProfile.history.length) { localProfile.history = []; }
    } else {
      localProfile.id = 'TV-' + String(Date.now()).slice(-8);
      localProfile.createdAt = Date.now();
      safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
    }
    if (!localProfile.favs) { localProfile.favs = {}; }
    state.favs = localProfile.favs;
  }

  function saveGlobalPlayback() {
    safeLocalWrite(LOCAL_PLAYBACK_KEY, state.playback);
  }

  function toggleFavorite(item) {
    if (!item || !item.id) { return false; }
    var key = String(item.id);
    var on = !state.favs[key];
    if (on) { state.favs[key] = true; }
    else { delete state.favs[key]; }
    localProfile.favs = state.favs;
    safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
    return on;
  }

  loadLocalProfile();

  var homeBuilt = false;
  var pagesEl, pages = [], tabEls = [], notifyEl;
  var liveRows = [], liveInfoText, liveMain, liveFocus, liveList;
  var detailLeft, detailPlayer, detailButtons, detailBottom;
  var searchKeyboard, searchHot, searchResults, searchEmpty, searchHotGrid,
      searchResultGrid, searchInput, searchNav, searchKeys = [];
  var settingsMenu, settingsRight, settingsPanels = {}, settingsItems = [];
  var historyViewTab = 'history';
  var playerStage, playerInfo, playerChannels, playerVideo, playerFrame, playerStatus, nextEpisodeLoading, playerChannelRows = {};
  /* Live category picker (all portal columns in one grid). */
  var categoryPicker = null, pcatGrid = null, pcatSub = null;
  /* Key of the category list currently painted in the rail, so switching a
     category only updates classes instead of rebuilding (and detaching) the
     focused pill. */
  var renderedCategoryKey = '';
  /* Older webOS models cannot keep a full 500–1000-row channel category in
     memory.  The side panel therefore owns only this small moving window. */
  var LIVE_PANEL_WINDOW = 48;
  var playerVodInfo, vodInfobarPoster, vodInfobarTitle, vodTimeCurrent, vodTimeTotal, vodSeekbar, vodSeekProgress, vodSeekBuffered, vodSeekThumb, playerOsdIcon;
  var vodScrubbing = false, vodScrubTime = 0;
  var welcomeTimer = null;

  /* ------------------------------------------------------------ focus core */
  function isVisible(node) {
    if (!node || !node.getBoundingClientRect) { return false; }
    if (node.offsetParent === null) { return false; }
    var r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { return false; }
    if (state.episodeBrowserOpen) {
      return !!closest(node, '#player-episodes');
    }
    if (state.categoryPickerOpen) {
      return !!closest(node, '#player-categories');
    }
    if (dialogPlaySettingsOpen) {
      return !!closest(node, '#dialog-playsettings');
    }
    if (playSettingViewOpen) {
      return !!closest(node, '#player-playsetting-view');
    }
    var page = closest(node, '.home-page');
    if (page && !page.classList.contains('is-current')) { return false; }
    var panel = closest(node, '.settings-panel');
    if (panel && !panel.classList.contains('is-active')) { return false; }
    var hot = closest(node, '.search-hot');
    if (hot && hot.classList.contains('is-hidden')) { return false; }
    var res = closest(node, '.search-results');
    if (res && !res.classList.contains('is-active')) { return false; }
    var pc = closest(node, '.player-channels');
    if (pc && !pc.classList.contains('is-active')) { return false; }
    var ib = closest(node, '.player-infobar');
    if (ib && !ib.classList.contains('is-active')) { return false; }
    return true;
  }

  function focusables() {
    var nodes = document.querySelectorAll('.focusable');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) { out.push(nodes[i]); }
    }
    return out;
  }

  function reveal(node) {
    var box = closest(node, '.scrollable');
    while (box) {
      var er = node.getBoundingClientRect();
      var br = box.getBoundingClientRect();
      if (er.top < br.top) {
        box.scrollTop -= (br.top - er.top) + 12;
      } else if (er.bottom > br.bottom) {
        box.scrollTop += (er.bottom - br.bottom) + 12;
      }
      if (box.scrollWidth > box.clientWidth + 1) {
        if (er.left < br.left) {
          box.scrollLeft -= (br.left - er.left) + 12;
        } else if (er.right > br.right) {
          box.scrollLeft += (er.right - br.right) + 12;
        }
      }
      box = closest(box.parentNode, '.scrollable');
    }
  }

  function setFocus(node, silent) {
    if (!node) { return; }
    if (state.focus === node) {
      if (!silent) { reveal(node); }
      return;
    }
    if (state.focus) { state.focus.classList.remove('is-focused'); }
    state.focus = node;
    node.classList.add('is-focused');
    if (node._onFocus) { node._onFocus(); }
    renderPlaySettingRowFocus();
    /* The tab rail expands while it holds focus and collapses to icons as soon
       as the content takes focus (observed on the running app). */
    var rail = $('home-tabs');
    if (rail && state.screen === 'home') {
      var inRail = closest(node, '.home-tabs');
      rail.classList.toggle('is-expanded', !!inRail);
      rail.classList.toggle('is-collapsed', !inRail);
      var railBg = document.querySelector('.home-sidebar-bg');
      if (railBg) { railBg.classList.toggle('is-on', !!inRail); }
      var homeScreen = $('screen-home');
      if (homeScreen) { homeScreen.classList.toggle('is-rail-open', !!inRail); }
    }
    if (!silent) { reveal(node); }
    schedulePosterMemoryPass();
  }

  function firstIn(container) {
    var nodes = container.querySelectorAll('.focusable');
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) { return nodes[i]; }
    }
    return null;
  }

  function moveFocus(dir) {
    if (!state.focus) {
      var f = focusables();
      if (f.length) { setFocus(f[0]); }
      return;
    }
    if (state.focus._onMove && state.focus._onMove(dir)) { return; }

    var inPage = state.screen === 'home' && closest(state.focus, '.home-page');
    var inSidebar = state.screen === 'home' && closest(state.focus, '.home-tabs');

    var list = focusables();
    var fr = state.focus.getBoundingClientRect();
    var fx = fr.left + fr.width / 2;
    var fy = fr.top + fr.height / 2;
    var best = null;
    var bestScore = 1e9;

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c === state.focus) { continue; }
      /* Don't let sidebar tabs intercept left navigation while inside page content */
      if (inPage && closest(c, '.home-tabs')) { continue; }
      /* Don't let page content intercept navigation while inside sidebar tabs */
      if (inSidebar && !closest(c, '.home-tabs')) { continue; }

      var r = c.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = cx - fx;
      var dy = cy - fy;
      var primary, secondary, overlap;

      if (dir === 'left') {
        if (dx > -4) { continue; }
        primary = Math.max(0, fr.left - r.right);
        secondary = Math.abs(dy);
        overlap = (r.bottom > fr.top + 2 && r.top < fr.bottom - 2);
      } else if (dir === 'right') {
        if (dx < 4) { continue; }
        primary = Math.max(0, r.left - fr.right);
        secondary = Math.abs(dy);
        overlap = (r.bottom > fr.top + 2 && r.top < fr.bottom - 2);
      } else if (dir === 'up') {
        if (dy > -4) { continue; }
        primary = Math.max(0, fr.top - r.bottom);
        secondary = Math.abs(dx);
        overlap = (r.right > fr.left + 2 && r.left < fr.right - 2);
      } else {
        if (dy < 4) { continue; }
        primary = Math.max(0, r.top - fr.bottom);
        secondary = Math.abs(dx);
        overlap = (r.right > fr.left + 2 && r.left < fr.right - 2);
      }
      var score = primary + secondary * 2 + (overlap ? 0 : 320);
      if (score < bestScore) { bestScore = score; best = c; }
    }

    if (best) {
      setFocus(best);
      return;
    }

    /* Leftmost limit reached in page content: now focus sidebar tab */
    if (dir === 'left' && inPage) {
      if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
    }
  }

  /* ---------------------------------------------------------------- screen */
  function showScreen(name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove('is-active');
    }
    var target = $('screen-' + name);
    if (target) { target.classList.add('is-active'); }
    state.screen = name;
    if (name !== 'player' && state.episodeBrowserOpen) { closeEpisodeBrowser(true); }
    if (name !== 'player' && state.categoryPickerOpen) { closeCategoryPicker(true); }
    if (name !== 'player' && name !== 'detail') {
      if (dialogPlaySettingsOpen) { closePlaySettingsDialog(); }
      if (playSettingViewOpen) { closePlaySettingView(); }
      var scrPlayer = $('screen-player');
      if (scrPlayer) {
        scrPlayer.classList.remove('is-mini');
        scrPlayer.classList.remove('is-active');
      }
      stopPlayerVideo();
      /* Really leaving the player: drop the subtitle cues as well. */
      subtitleSeq++;
      activeSubtitleCues = [];
      if (playerSubtitles) { playerSubtitles.innerHTML = ''; }
    }
    schedulePosterMemoryPass();
  }

  var lastBackTime = 0;
  function back() {
    var now = Date.now();
    if (now - lastBackTime < 250) { return; }
    lastBackTime = now;
    /* The audio/subtitle dialog can now open from the details screen too. */
    if (dialogPlaySettingsOpen) {
      closePlaySettingsDialog();
      return;
    }
    if (state.screen === 'player') {
      if (vodScrubbing) {
        leaveVodScrub(false);
        return;
      }
      if (state.categoryPickerOpen) {
        lastBackTime = Date.now();
        closeCategoryPicker();
        return;
      }
      if (state.episodeBrowserOpen) {
        lastBackTime = Date.now();
        closeEpisodeBrowser();
        return;
      }
      if (playSettingViewOpen) {
        closePlaySettingView();
        return;
      }
      if (state.channelsOpen) {
        closeChannelPanel();
      } else if (state.infobar) {
        hideInfobar();
      } else if (state.vodInfobarVisible) {
        hideVodInfobar();
      } else {
        restorePlayerReturn();
      }
      return;
    }
    if (state.screen === 'detail') {
      if (typeof closeSeasonPopup === 'function' && seasonPopup) {
        closeSeasonPopup();
        var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
        if (sBtn) { setFocus(sBtn); }
        return;
      }
      var scr = $('screen-detail');
      if (scr && scr.classList.contains('is-synopsis-open')) {
        toggleSynopsis();
        return;
      }
      stopPlayerVideo();
      var scrPlayer = $('screen-player');
      if (scrPlayer) {
        scrPlayer.classList.remove('is-mini');
        scrPlayer.classList.remove('is-active');
      }
      var ret = state.detailReturn;
      if (ret && ret.screen === 'search') {
        showScreen('search');
        setFocus(ret.focus);
      } else {
        showScreen('home');
        selectTab(state.tab, false);
        if (ret && ret.focus && isVisible(ret.focus)) { setFocus(ret.focus); }
        else if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      }
      return;
    }
    if (state.screen === 'search') {
      clearSearchState();
      showScreen('home');
      selectTab(state.tab, false);
      if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      return;
    }
    if (state.screen === 'settings') {
      showScreen('home');
      selectTab(state.tab, false);
      if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      return;
    }
    if (state.screen === 'home') {
      if (state.tab !== 0) {
        selectTab(0, true);
        if (tabEls[0]) { setFocus(tabEls[0]); }
        return;
      }
      if (window.webOSTV && window.webOSTV.platformBack) {
        window.webOSTV.platformBack();
      } else if (window.PalmSystem && window.PalmSystem.platformBack) {
        window.PalmSystem.platformBack();
      }
    }
  }

  function activate() {
    if (!state.focus) { return; }
    if (state.focus._activate) { state.focus._activate(); }
  }

  function handleKey(e) {
    var k = e.keyCode || e.which;
    var key = e.key || '';
    var handled = true;

    /* Back buttons */
    var isBack = (k === 461 || k === 27 || k === 8 || key === 'Back' || key === 'GoBack' || key === 'Escape');
    if (isBack) {
      if (state.categoryPickerOpen) {
        closeCategoryPicker();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (state.episodeBrowserOpen) {
        closeEpisodeBrowser();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (dialogAddonsOpen) {
        lastBackTime = Date.now();
        closeAddonsDialog();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (dialogPlaySettingsOpen) {
        /* LG sends a keyup after this keydown.  Mark it consumed, otherwise
           that second event sees the dialog closed and exits the detail page. */
        lastBackTime = Date.now();
        closePlaySettingsDialog();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (playSettingViewOpen) {
        lastBackTime = Date.now();
        closePlaySettingView();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      back();
      if (e.preventDefault) { e.preventDefault(); }
      if (e.stopPropagation) { e.stopPropagation(); }
      return;
    }

    /* Live category picker: a full-screen grid owns the d-pad while open. */
    if (state.categoryPickerOpen) {
      if (k === 37) { moveFocus('left'); }
      else if (k === 38) { moveFocus('up'); }
      else if (k === 39) { moveFocus('right'); }
      else if (k === 40) { moveFocus('down'); }
      else if (k === 13 || k === 32) { activate(); }
      else { handled = false; }
      if (handled && e.preventDefault) { e.preventDefault(); }
      return;
    }

    /* Season/episode browser: it owns the d-pad while open. */
    if (state.episodeBrowserOpen) {
      var inSeasons = closest(state.focus, '#pe-seasons');
      var inEpisodes = closest(state.focus, '#pe-episodes');
      if (k === 37) {
        if (inEpisodes && peSeasonsCol && peSeasonsCol.style.display !== 'none') {
          var selSeason = peSeasons ? (peSeasons.children[state.browserSeason] || firstIn(peSeasons)) : null;
          if (selSeason) { setFocus(selSeason); }
        }
      } else if (k === 39) {
        if (inSeasons) {
          var curEp = peEpisodes ? (peEpisodes.querySelector('.pe-ep.is-current') || firstIn(peEpisodes)) : null;
          if (curEp) { setFocus(curEp); }
        }
      } else if (k === 38) {
        moveFocus('up');
      } else if (k === 40) {
        moveFocus('down');
      } else if (k === 13 || k === 32) {
        activate();
      } else {
        handled = false;
      }
      if (handled && e.preventDefault) { e.preventDefault(); }
      return;
    }

    /* Media Play / Pause / Seek keys on webOS & Android TV remotes */
    var isPlay = (k === 415 || key === 'MediaPlay' || key === 'Play');
    var isPause = (k === 19 || key === 'MediaPause' || key === 'Pause');
    var isPlayPause = (k === 10252 || key === 'MediaPlayPause');
    var isFwd = (k === 417 || key === 'MediaFastForward' || key === 'FastForward');
    var isRwd = (k === 412 || key === 'MediaRewind' || key === 'Rewind');
    var isStop = (k === 413 || key === 'MediaStop' || key === 'Stop');

    if (state.screen === 'player') {
      if (isPlay) {
        if (playerVideo && playerVideo.paused) {
          resumePlayerPlayback();
          showOsdIcon('none');
          showInfobar();
        }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isPause) {
        if (playerVideo && !playerVideo.paused) {
          try { playerVideo.pause(); } catch (ePause) {}
          showOsdIcon('pause');
          showInfobar();
        }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isPlayPause) {
        togglePlayerPlayPause();
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isFwd) {
        playerSeek(15);
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isRwd) {
        playerSeek(-15);
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isStop) {
        back();
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
    }

    /* Menu / ContextMenu button to open in-player settings */
    var isMenu = (k === 457 || k === 93 || k === 467 || key === 'Menu' || key === 'ContextMenu');
    if (state.screen === 'player' && state.playerMode === 'vod' && isMenu) {
      if (dialogPlaySettingsOpen) {
        closePlaySettingsDialog();
      } else if (playSettingViewOpen) {
        closePlaySettingView();
      } else {
        openPlaySettingView();
      }
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }

    if (state.screen === 'player' && (k === 37 || k === 38 || k === 39 || k === 40)) {
      if (dialogPlaySettingsOpen) {
        if (k === 37) { moveFocus('left'); }
        else if (k === 38) { moveFocus('up'); }
        else if (k === 39) { moveFocus('right'); }
        else if (k === 40) { moveFocus('down'); }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (playSettingViewOpen) {
        schedulePlaySettingHide();
        if (k === 37) { moveFocus('left'); }
        else if (k === 38) { moveFocus('up'); }
        else if (k === 39) { moveFocus('right'); }
        else if (k === 40) { moveFocus('down'); }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (state.playerMode === 'vod') {
        if (state.focus === vodSeekbar && vodScrubbing) {
          if (k === 37) { moveVodScrub(-1); if (e.preventDefault) { e.preventDefault(); } return; }
          if (k === 39) { moveVodScrub(1); if (e.preventDefault) { e.preventDefault(); } return; }
          if (k === 38 || k === 40) { leaveVodScrub(false); if (e.preventDefault) { e.preventDefault(); } return; }
        }
        if (k === 37) { playerSeek(-10); if (e.preventDefault) { e.preventDefault(); } return; }
        if (k === 39) { playerSeek(10); if (e.preventDefault) { e.preventDefault(); } return; }
        if (k === 40) {
          openPlaySettingView();
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
        if (k === 38) {
          enterVodScrub();
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
      } else {
        /* Some webOS remote events arrive after the panel has painted but
           before its boolean state is restored.  Focus inside the visible
           panel is the authoritative signal, so Up never zaps from channel 1
           to the last channel while the channel list is on screen. */
        var channelPanelHasFocus = state.focus && closest(state.focus, '.player-channels');
        if (state.channelsOpen || channelPanelHasFocus) {
          /* The category rail is a real focus area, not a channel row.  It
             must receive the arrows first; otherwise Right was interpreted as
             "close panel" and Down reused the currently playing channel. */
          var focusIsCategory = state.focus && state.focus.classList &&
            state.focus.classList.contains('pc-cat-pill');
          if (focusIsCategory) {
            if (k === 37) { moveFocus('left'); }
            else if (k === 38) { moveFocus('up'); }
            else if (k === 39) { moveFocus('right'); }
            else if (k === 40) { moveFocus('down'); }
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (k === 38) {
            var curIdx = (state.focus && state.focus._channel !== undefined) ? state.focus._channel : state.channel;
            if (curIdx === 0) {
              var selCat = playerChannels ? (playerChannels.querySelector('.pc-cat-pill.is-selected') || playerChannels.querySelector('.pc-cat-pill')) : null;
              if (selCat) { setFocus(selCat); }
            } else {
              var prev = curIdx - 1;
              focusPlayerChannel(prev);
            }
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (k === 40) {
            var curIdx = (state.focus && state.focus._channel !== undefined) ? state.focus._channel : state.channel;
            var next = Math.min(CHANNELS.length - 1, curIdx + 1);
            focusPlayerChannel(next);
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (k === 39) { closeChannelPanel(); if (e.preventDefault) { e.preventDefault(); } return; }
        } else {
          if (k === 38) {
            if (state.channel > 0) { setChannel(state.channel - 1, false); }
            else if (CHANNELS.length) { setChannel(CHANNELS.length - 1, false); }
            showInfobar();
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (k === 40) {
            if (state.channel < CHANNELS.length - 1) { setChannel(state.channel + 1, false); }
            else if (CHANNELS.length) { setChannel(0, false); }
            showInfobar();
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (k === 37) {
            openChannelPanel();
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (state.infobar) { scheduleInfoHide(); } else { showInfobar(); }
        }
      }
    }

    if (k === 37) { moveFocus('left'); }
    else if (k === 38) { moveFocus('up'); }
    else if (k === 39) { moveFocus('right'); }
    else if (k === 40) { moveFocus('down'); }
    else if (k === 13 || k === 32) {
      if (state.episodeBrowserOpen) {
        activate();
        return;
      }
      if (dialogPlaySettingsOpen) {
        activate();
      } else if (playSettingViewOpen) {
        schedulePlaySettingHide();
        activate();
      } else if (state.screen === 'player' && state.playerMode === 'vod' &&
                 state.focus === vodSeekbar && vodScrubbing) {
        /* OK belongs to the focused timeline, not to Play/Pause. */
        leaveVodScrub(true);
      } else if (state.screen === 'player' && state.streamError && playerVideo && playerVideo.src &&
                 !closest(state.focus, '.player-channels')) {
        /* OK retries the failed stream, but only from the video surface: with
           the channel panel open it must activate the focused row/pill, or a
           dead channel made every category unfilterable. */
        resumePlayerPlayback();
        state.streamError = '';
        setPlayerStatus('');
      } else if (state.screen === 'player' && state.playerMode === 'vod') {
        togglePlayerPlayPause();
      } else {
        activate();
      }
    }
    else { handled = false; }
    if (handled && e.preventDefault) { e.preventDefault(); }
  }

  /* ================================================================ WELCOME */
  function startWelcome() {
    var img = $('welcome-loading-img');
    var frame = 1;
    welcomeTimer = setInterval(function () {
      frame++;
      if (frame > 16) { finishWelcome(); return; }
      img.src = 'assets/original/welcome/img_welcome_loading' + frame + '.png';
    }, 250);
  }

  function finishWelcome() {
    if (welcomeTimer) { clearInterval(welcomeTimer); welcomeTimer = null; }
    if (!homeBuilt) { buildHome(); }
    showScreen('home');
    selectTab(0, false);
    setFocus(liveFocus);
    /* The first launch shows the full tab labels even though the video holds
       focus; the rail collapses on the first focus change. */
    var rail = $('home-tabs');
    if (rail) { rail.classList.add('is-expanded'); rail.classList.remove('is-collapsed'); }
    var railBg = document.querySelector('.home-sidebar-bg');
    if (railBg) { railBg.classList.add('is-on'); }
    var homeScreen = $('screen-home');
    if (homeScreen) { homeScreen.classList.add('is-rail-open'); }
  }

  /* =================================================================== HOME */
  var pageDefs = [buildLivePage, buildFeaturedPage, buildMoviesPage, buildSeriesPage,
                  buildKidsPage, buildAnimePage, buildNovelsPage, buildExplorePage];
  var pagesBuilt = {};

  function ensurePageBuilt(idx) {
    if (pagesBuilt[idx] || !pages[idx] || !pageDefs[idx]) { return; }
    pagesBuilt[idx] = true;
    pageDefs[idx](pages[idx]);
  }

  function buildHome() {
    homeBuilt = true;
    pagesEl = $('home-pages');
    notifyEl = $('home-notify');
    clear(pagesEl);
    pages = [];
    pagesBuilt = {};

    /* Create placeholder wrappers for each tab, but build DOM only on demand */
    for (var i = 0; i < pageDefs.length; i++) {
      var page = el('div', 'home-page scrollable');
      if (i === 0) { page.classList.add('is-current'); }
      pagesEl.appendChild(page);
      pages.push(page);
    }

    var initialTab = (TABS[state.tab] && TABS[state.tab].page >= 0) ? TABS[state.tab].page : 0;
    ensurePageBuilt(initialTab);

    buildTabs();
    buildNotify();
  }

  function buildTabs() {
    var host = $('home-tabs');
    clear(host);
    host.classList.add('scrollable');
    host.classList.add('is-expanded');
    tabEls = [];
    for (var i = 0; i < TABS.length; i++) {
      var item = el('div', 'tab-item focusable');
      item.appendChild(el('div', 'tab-pill'));
      var icon = el('div', 'tab-icon');
      icon.innerHTML = TAB_ICONS[TABS[i].icon] || '';
      item.appendChild(icon);
      var title = el('div', 'tab-title', TABS[i].label);
      item.appendChild(title);
      item._tab = i;
      item._activate = (function (idx) {
        return function () {
          if (TABS[idx].action === 'history') {
            historyViewTab = 'history';
            openSettings();
            showSettingsPanel(1, true);
            return;
          }
          selectTab(idx, false);
          if (idx === 0) {
            var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
            if (row) { setFocus(row); }
            else if (liveRows.length) { setFocus(liveRows[0]); }
            else if (liveFocus) { setFocus(liveFocus); }
          } else if (TABS[idx].page >= 0) {
            var page = pages[TABS[idx].page];
            var f = firstIn(page);
            if (f) { setFocus(f); }
          }
        };
      })(i);
      item._onMove = (function (idx) {
        return function (dir) {
          if (dir === 'up') {
            if (idx > 0 && tabEls[idx - 1]) {
              setFocus(tabEls[idx - 1]);
              selectTab(idx - 1, false);
            }
            return true;
          }
          if (dir === 'down') {
            if (idx < tabEls.length - 1 && tabEls[idx + 1]) {
              setFocus(tabEls[idx + 1]);
              selectTab(idx + 1, false);
            }
            return true;
          }
          if (dir === 'left') {
            return true;
          }
          if (dir === 'right') {
            if (TABS[idx].action === 'history') {
              historyViewTab = 'history';
              openSettings();
              showSettingsPanel(1, true);
              return true;
            }
            selectTab(idx, false);
            if (idx === 0) {
              var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
              if (row) { setFocus(row); }
              else if (liveRows.length) { setFocus(liveRows[0]); }
              else if (liveFocus) { setFocus(liveFocus); }
            } else if (TABS[idx].page >= 0) {
              var page = pages[TABS[idx].page];
              var f = firstIn(page);
              if (f) { setFocus(f); }
            }
            return true;
          }
          return false;
        };
      })(i);
      host.appendChild(item);
      tabEls.push(item);
    }
  }

  function buildNotify() {
    clear(notifyEl);
    /* Keep the compact controls used in the home screen: search, filter and
       profile.  The record shortcut and message bell are intentionally not
       shown here; history lives under Mi lista. */
    var defs = [
      { cls: 'search', icon: 'assets/original/home/icon_notify_search.png', small: true },
      { cls: 'filter', icon: 'assets/original/search/icon_category_filter_n.png', small: true },
      { cls: 'personal', icon: 'assets/original/home/icon_notify_personal.png', small: true }
    ];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var item = el('div', 'notify-item focusable ' + d.cls + (d.small ? ' is-small' : ''));
      var nn = el('div', 'n-normal');
      nn.style.backgroundImage = 'url(' + d.icon + ')';
      item.appendChild(nn);
      if (d.cls === 'personal') {
        item._activate = function () { openSettings(); };
      } else if (d.cls === 'search') {
        item._activate = function () { openSearch(); };
      } else {
        item._activate = function () { /* destination not reconstructed */ };
      }
      notifyEl.appendChild(item);
    }
    var div = el('div', 'notify-divider');
    notifyEl.appendChild(div);
    var wifi = el('div', 'notify-wifi');
    wifi.innerHTML = '<svg viewBox="0 0 30 22"><path d="M15 19.5a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2z" fill="currentColor"/><path d="M8.4 12.2a9.6 9.6 0 0 1 13.2 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4.2 7.6a15.6 15.6 0 0 1 21.6 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    notifyEl.appendChild(wifi);
    var time = el('div', 'notify-time');
    time.id = 'notify-time';
    notifyEl.appendChild(time);
    updateClock();
    setInterval(updateClock, 30000);
  }

  function updateClock() {
    var t = $('notify-time');
    if (!t) { return; }
    var d = new Date();
    var h = d.getHours();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) { h = 12; }
    var m = d.getMinutes();
    t.textContent = h + ':' + pad2(m) + ' ' + ap;
  }

  function selectTab(index, focusContent) {
    var def = TABS[index];
    /* Action rows are opened with OK/Right. Merely moving through the rail
       must not throw the user out of Home before they confirm the choice. */
    if (!def || def.action) { return; }
    var prevPage = TABS[state.tab] ? TABS[state.tab].page : def.page;
    state.tab = index;
    for (var i = 0; i < tabEls.length; i++) {
      tabEls[i].classList.toggle('is-selected', i === index);
    }
    if (def.page >= 0) {
      ensurePageBuilt(def.page);
    }
    if (def.page === 0) {
      scheduleLivePreview(CHANNELS[state.channel]);
    } else {
      stopLivePreview();
    }
    for (var p = 0; p < pages.length; p++) {
      pages[p].classList.remove('is-entering', 'from-left', 'from-right');
      pages[p].classList.toggle('is-current', p === def.page);
    }
    /* Same slide direction as the ViewPager; the page itself is the only
       visible layer, which keeps its raster sharp on webOS. */
    if (def.page !== prevPage && pages[def.page]) {
      var pg = pages[def.page];
      pg.classList.add('is-entering', def.page > prevPage ? 'from-right' : 'from-left');
      setTimeout(function () {
        pg.classList.remove('is-entering', 'from-left', 'from-right');
      }, 320);
    }
    if (focusContent) {
      if (def.page === 0) {
        var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
        if (row) { setFocus(row); }
        else if (liveRows.length) { setFocus(liveRows[0]); }
        else if (liveFocus) { setFocus(liveFocus); }
      } else {
        var f = firstIn(pages[def.page]);
        if (f) { setFocus(f); }
      }
    }
    schedulePosterMemoryPass();
  }

  /* --------------------------------------------------------------- posters */
  /* Chromium 53 retains decoded poster bitmaps very aggressively.  Keep the
     DOM/focus graph intact, but attach each source only when its tile is near
     the visible viewport and release it again when changing page/screen. */
  var posterMemoryTimer = null;
  function schedulePosterMemoryPass() {
    if (posterMemoryTimer) { clearTimeout(posterMemoryTimer); }
    posterMemoryTimer = setTimeout(function () {
      posterMemoryTimer = null;
      refreshPosterMemory();
    }, 80);
  }
  function posterBelongsToVisiblePage(img) {
    if (state.screen === 'home') {
      var homePage = closest(img, '.home-page');
      return !!(homePage && homePage.classList.contains('is-current'));
    }
    if (state.screen === 'search') {
      var results = closest(img, '.search-results');
      var hot = closest(img, '.search-hot');
      return !!((results && results.classList.contains('is-active')) ||
                (hot && !hot.classList.contains('is-hidden')));
    }
    if (state.screen === 'detail') {
      /* Related titles live inside the active detail screen, not a home page. */
      var detailScreen = closest(img, '#screen-detail');
      return !!(detailScreen && detailScreen.classList.contains('is-active'));
    }
    return false;
  }
  function refreshPosterMemory() {
    var imgs = document.querySelectorAll('img[data-poster-src]');
    var viewW = window.innerWidth || 1920;
    var viewH = window.innerHeight || 1080;
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var tile = closest(img, '.poster, .bento');
      var r = tile && tile.getBoundingClientRect ? tile.getBoundingClientRect() : null;
      var near = posterBelongsToVisiblePage(img) && r &&
        r.bottom > -420 && r.top < viewH + 420 && r.right > -320 && r.left < viewW + 320;
      if (near) {
        if (!img.getAttribute('src')) {
          img.style.display = '';
          img.src = img.getAttribute('data-poster-src');
        }
      } else if (img.getAttribute('src')) {
        /* Removing the source gives Starfish a chance to release the decoded
           texture instead of keeping whole catalog pages resident in RAM. */
        img.removeAttribute('src');
        try { img.src = ''; } catch (eRelease) { /* ignore */ }
      }
    }
  }

  function makePoster(item, x, y, w, h, opts) {
    opts = opts || {};
    var p = el('div', 'poster focusable' + (opts.gold ? ' gold' : '') + (opts.type3 ? ' type3' : ''));
    abs(p, x, y, w, h);
    if (item.poster) {
      /* Keep the original no-data bitmap underneath: if the remote poster
         fails, removing the <img> reveals the authentic placeholder. */
      var pimg = el('img', 'p-img');
      pimg.setAttribute('data-poster-src', item.poster);
      pimg.onerror = function () { this.style.display = 'none'; };
      p.appendChild(pimg);
    }
    /* sel_poster_nohalo items (free, search, related) draw their own title,
       so the PosterView title/shadow children stay hidden. */
    if (!opts.gold) {
      p.appendChild(el('div', 'p-shade'));
      p.appendChild(el('div', 'p-title', item.title));
    }
    p._item = item;
    p._activate = function () { openDetail(item); };
    schedulePosterMemoryPass();
    return p;
  }

  function addPosters(page, areaLeft, areaTop, list, items) {
    var area = el('div', 'poster-area');
    abs(area, areaLeft, areaTop, 1830, 940.5);
    var source = (items && items.length) ? items : VOD;
    if (!source.length) { page.appendChild(area); return area; }
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      area.appendChild(makePoster(source[i % source.length], d.x, d.y, d.w, d.h, d.opts));
    }
    page.appendChild(area);
    return area;
  }

  /* ------------------------------------------------------------- home live */
  function buildLivePage(page) {
    liveMain = el('div', 'live-main');
    livePreviewVideo = document.createElement('video');
    livePreviewVideo.className = 'live-preview-video';
    livePreviewVideo.preload = 'auto';
    livePreviewVideo.muted = true;
    livePreviewVideo.volume = 0;
    livePreviewVideo.setAttribute('muted', 'muted');
    livePreviewVideo.setAttribute('playsinline', '');
    livePreviewVideo.setAttribute('webkit-playsinline', '');
    liveMain.appendChild(livePreviewVideo);
    liveMain.appendChild(el('div', 'live-frame'));
    liveMain.appendChild(el('div', 'live-logo'));
    livePreviewStatus = el('div', 'live-preview-status');
    liveMain.appendChild(livePreviewStatus);
    page.appendChild(liveMain);

    var info = el('div', 'live-info');
    liveInfoText = el('div', 'live-channel');
    /* mTvChannel is layout_toLeftOf mIvFullScreen (alignParentRight), so the
       channel name is right-aligned, not left-aligned. */
    liveInfoText.style.right = '112.5px';
    info.appendChild(liveInfoText);
    var full = el('div', 'live-fullscreen');
    full._activate = function () { openPlayer('live'); };
    info.appendChild(full);
    liveMain.appendChild(info);

    var up = el('div', 'live-arrow-up');
    var down = el('div', 'live-arrow-down');
    page.appendChild(up);
    page.appendChild(down);

    liveList = el('div', 'live-list scrollable');
    page.appendChild(liveList);
    renderLiveRows(false);
    loadLiveCategories();
    loadLiveChannels();

    liveFocus = el('div', 'live-focus focusable');
    liveFocus._onMove = function (dir) {
      if (dir === 'up') {
        if (state.channel > 0) { setChannel(state.channel - 1); }
        return true;
      }
      if (dir === 'down') {
        if (state.channel < CHANNELS.length - 1) { setChannel(state.channel + 1); }
        return true;
      }
      if (dir === 'right') {
        var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
        if (row) { setFocus(row); }
        else if (liveRows.length) { setFocus(liveRows[0]); }
        return true;
      }
      if (dir === 'left') {
        if (tabEls[0]) { setFocus(tabEls[0]); }
        return true;
      }
      return false;
    };
    liveFocus._activate = function () { openPlayer('live'); };
    page.appendChild(liveFocus);
  }

  /* --- Live TV Categories & Addons (M3U / IPTV) --- */
  var PRESET_ADDONS = [
    {
      id: 'es_tdt',
      name: 'España - Canales Nacionales y TDT',
      url: 'https://iptv-org.github.io/iptv/countries/es.m3u',
      desc: '320+ canales: La 1, La 2, Antena 3, Telecinco, laSexta, autonómicas'
    },
    {
      id: 'latam_spa',
      name: 'Latinoamérica y Deportes (Hispano)',
      url: 'https://iptv-org.github.io/iptv/languages/spa.m3u',
      desc: 'Canales en español de Colombia, México, Argentina, Chile y Perú'
    },
    {
      id: 'sports_iptv',
      name: 'Deportes Internacionales',
      url: 'https://iptv-org.github.io/iptv/categories/sports.m3u',
      desc: 'Transmisiones deportivas y canales de competiciones'
    },
    {
      id: 'movies_iptv',
      name: 'Cine y Series 24/7',
      url: 'https://iptv-org.github.io/iptv/categories/movies.m3u',
      desc: 'Cine clásico, cine de acción y canales continuos de series'
    }
  ];

  function getSavedAddons() {
    try {
      var raw = localStorage.getItem('xuper_m3u_addons');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) { return parsed; }
      }
    } catch (e) {}
    /* Default seed: España TDT so user has working external addon out of the box */
    var initial = [PRESET_ADDONS[0]];
    try { localStorage.setItem('xuper_m3u_addons', JSON.stringify(initial)); } catch (e2) {}
    return initial;
  }

  function saveSavedAddons(list) {
    try { localStorage.setItem('xuper_m3u_addons', JSON.stringify(list || [])); } catch (e) {}
  }

  var liveCategories = [];
  var currentLiveCategory = null;
  var liveCategoriesLoaded = false;
  var liveChannelsLoaded = false;
  var liveChannelsLoading = false;
  var liveChannelRequestSeq = 0;
  var liveChannelLoadColumnId = null;
  /* Home only keeps one muted live preview alive.  This warms the channel
     without creating a second full player or playing sound in the menu. */
  var livePreviewVideo = null;
  var livePreviewStatus = null;
  var livePreviewSeq = 0;
  var livePreviewTimer = null;
  var livePreviewChannel = '';
  var livePreviewHls = null;
  var livePreviewRefreshTimer = null;
  var dialogAddonsOpen = false;

  function stopLivePreview() {
    livePreviewSeq++;
    livePreviewChannel = '';
    if (livePreviewTimer) { clearTimeout(livePreviewTimer); livePreviewTimer = null; }
    if (livePreviewRefreshTimer) { clearTimeout(livePreviewRefreshTimer); livePreviewRefreshTimer = null; }
    if (liveMain) { liveMain.classList.remove('is-preview-playing', 'is-preview-loading'); }
    if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
    if (livePreviewHls) {
      try { livePreviewHls.destroy(); } catch (eHls) { /* ignore */ }
      livePreviewHls = null;
    }
    if (!livePreviewVideo) { return; }
    try { livePreviewVideo.pause(); } catch (ePause) { /* ignore */ }
    livePreviewVideo.removeAttribute('src');
    try { livePreviewVideo.src = ''; livePreviewVideo.load(); } catch (eClear) { /* ignore */ }
  }

  function scheduleLivePreviewRefresh(ch, payload, mySeq, retryAttempt) {
    if (window.PalmServiceBridge) { return; }
    if (livePreviewRefreshTimer) { clearTimeout(livePreviewRefreshTimer); livePreviewRefreshTimer = null; }
    var expires = Number(payload && payload.mediaExpiresAt);
    if (!retryAttempt && (!isFinite(expires) || expires <= 0)) { return; }
    var delay = retryAttempt ? 15000 : Math.max(1000, expires - Date.now() - 60000);
    livePreviewRefreshTimer = setTimeout(function () {
      livePreviewRefreshTimer = null;
      if (mySeq !== livePreviewSeq || state.screen !== 'home' || state.tab !== 0) { return; }
      startLivePreview(ch, retryAttempt || 1);
    }, delay);
  }

  function startLivePreview(ch, refreshAttempt) {
    if (!livePreviewVideo || !ch || (!ch.channelCode && !ch.streamUrl)) { return; }
    var browserMode = !window.PalmServiceBridge;
    /* A preview belongs only to the TV tab on the home screen. */
    if (state.screen !== 'home' || state.tab !== 0) { return; }
    /* Browser previews use portal channel identifiers, never a raw URL from
       a saved addon. The API resolves and signs the persistent media proxy. */
    if (browserMode && (!vodApi.devServiceUrl || !ch.channelCode)) { return; }
    var key = ch.channelCode || ch.streamUrl;
    if (!refreshAttempt && key === livePreviewChannel && liveMain &&
        (liveMain.classList.contains('is-preview-loading') || liveMain.classList.contains('is-preview-playing'))) {
      return;
    }
    stopLivePreview();
    livePreviewChannel = key;
    var mySeq = ++livePreviewSeq;
    liveMain.classList.add('is-preview-loading');
    if (livePreviewStatus) { livePreviewStatus.textContent = 'Cargando ' + (ch.name || 'canal') + '…'; }
    var params = !browserMode && ch.streamUrl ? { streamUrl: ch.streamUrl } : { channelCode: ch.channelCode };
    portalServiceCall('resolveLive', params, function (err, payload) {
      if (mySeq !== livePreviewSeq || state.screen !== 'home' || state.tab !== 0) { return; }
      if (!err && payload) { rememberCdnProbe('live', payload); }
      var url = !err && payload && payload.returnValue !== false && (payload.proxyPath || payload.url);
      if (browserMode) {
        url = '';
        if (!err && payload && payload.returnValue !== false && payload.mediaToken) {
          var candidate = payload.mediaUrl || payload.url || '/api/media?token=' + encodeURIComponent(payload.mediaToken) + '&manifest=1';
          try {
            var parsed = new window.URL(candidate, window.location.href);
            var localHttp = parsed.protocol === 'http:' && parsed.origin === window.location.origin;
            if ((parsed.protocol === 'https:' || localHttp) && !parsed.username && !parsed.password && parsed.pathname === '/api/media' && parsed.searchParams.get('token') === payload.mediaToken) {
              url = parsed.href;
            }
          } catch (eProxyUrl) { /* A malformed or unsigned source is not played. */ }
        }
      }
      if (!url) {
        liveMain.classList.remove('is-preview-loading');
        if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
        if (refreshAttempt && refreshAttempt < 3 && (err || !payload || payload.returnValue === false)) {
          scheduleLivePreviewRefresh(ch, null, mySeq, refreshAttempt + 1);
        } else if (refreshAttempt && livePreviewStatus) {
          livePreviewStatus.textContent = 'No se pudo renovar la señal';
        }
        return;
      }
      livePreviewVideo.onloadeddata = function () {
        if (mySeq !== livePreviewSeq) { return; }
        liveMain.classList.remove('is-preview-loading');
        liveMain.classList.add('is-preview-playing');
        if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
      };
      livePreviewVideo.onerror = function () {
        if (mySeq !== livePreviewSeq) { return; }
        liveMain.classList.remove('is-preview-loading', 'is-preview-playing');
        if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
        if (livePreviewHls) { livePreviewHls.destroy(); livePreviewHls = null; }
        if (livePreviewRefreshTimer) { clearTimeout(livePreviewRefreshTimer); livePreviewRefreshTimer = null; }
      };
      if (browserMode && payload.isHls && window.Hls && window.Hls.isSupported()) {
        try {
          var hls = new window.Hls({ enableWorker: false, progressive: true, maxBufferLength: 15 });
          livePreviewHls = hls;
          hls.on(window.Hls.Events.ERROR, function (event, data) {
            if (mySeq !== livePreviewSeq || livePreviewHls !== hls || !data || !data.fatal) { return; }
            hls.destroy();
            livePreviewHls = null;
            liveMain.classList.remove('is-preview-loading', 'is-preview-playing');
            if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
            if (livePreviewRefreshTimer) { clearTimeout(livePreviewRefreshTimer); livePreviewRefreshTimer = null; }
          });
          hls.on(window.Hls.Events.MEDIA_ATTACHED, function () {
            if (mySeq === livePreviewSeq && livePreviewHls === hls) { hls.loadSource(url); }
          });
          hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
            if (mySeq !== livePreviewSeq || livePreviewHls !== hls) { return; }
            var play = livePreviewVideo.play();
            if (play && play.catch) { play.catch(function () {
              if (mySeq === livePreviewSeq) { liveMain.classList.remove('is-preview-loading'); }
            }); }
          });
          hls.attachMedia(livePreviewVideo);
          if (livePreviewHls === hls) { scheduleLivePreviewRefresh(ch, payload, mySeq, 0); }
          return;
        } catch (ePreviewHls) {
          if (livePreviewHls) { livePreviewHls.destroy(); livePreviewHls = null; }
          liveMain.classList.remove('is-preview-loading');
          return;
        }
      }
      if (browserMode && payload.isHls && !livePreviewVideo.canPlayType('application/vnd.apple.mpegurl')) {
        liveMain.classList.remove('is-preview-loading');
        if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
        return;
      }
      try {
        livePreviewVideo.src = url;
        livePreviewVideo.load();
        var promise = livePreviewVideo.play();
        if (promise && promise.catch) { promise.catch(function () {}); }
        scheduleLivePreviewRefresh(ch, payload, mySeq, 0);
      } catch (ePlay) { liveMain.classList.remove('is-preview-loading'); }
    });
  }

  function scheduleLivePreview(ch) {
    if (livePreviewTimer) { clearTimeout(livePreviewTimer); }
    livePreviewTimer = setTimeout(function () {
      livePreviewTimer = null;
      startLivePreview(ch || CHANNELS[state.channel]);
    }, 220);
  }

  function loadLiveCategories(done) {
    if (liveCategoriesLoaded && liveCategories.length) {
      if (done) { done(null, liveCategories); }
      return;
    }
    portalServiceCall('liveCategories', {}, function (err, payload) {
      var cats = [];
      if (payload && payload.categories && payload.categories.length) {
        for (var i = 0; i < payload.categories.length; i++) {
          var c = payload.categories[i];
          var nm = c.name;
          if (nm === 'ChannelList' || c.id === 76182) { nm = 'Todos'; }
          cats.push({ id: c.id, name: nm, code: c.code, isAddon: false });
        }
      }
      if (vodApi.mode !== 'portal') { cats.push({ id: 'addons', name: '➕ Addons M3U', isAddon: true }); }
      liveCategories = cats;
      liveCategoriesLoaded = true;
      if (!currentLiveCategory) { currentLiveCategory = liveCategories[0]; }
      renderPlayerCategories();
      if (done) { done(null, liveCategories); }
    });
  }

  function switchLiveCategory(cat, done) {
    if (!cat) { return; }
    currentLiveCategory = cat;
    renderPlayerCategories();
    if (cat.isAddon) {
      loadAddonChannels(function () {
        if (done) { done(); }
      });
    } else {
      loadLiveChannels(cat.id, function () {
        if (done) { done(); }
      });
    }
  }

  function loadAddonChannels(done) {
    var addons = getSavedAddons();
    if (!addons || !addons.length) {
      CHANNELS.splice(0, CHANNELS.length);
      renderLiveRows(false);
      renderPlayerChannels();
      if (done) { done(); }
      return;
    }
    setPlayerStatus('Cargando canales de Addon…');
    var allChannels = [];
    var pending = addons.length;
    for (var a = 0; a < addons.length; a++) {
      (function (ad) {
        portalServiceCall('fetchM3u', { url: ad.url }, function (err, payload) {
          if (payload && payload.channels && payload.channels.length) {
            for (var c = 0; c < payload.channels.length; c++) {
              allChannels.push(payload.channels[c]);
            }
          }
          pending--;
          if (pending <= 0) {
            setPlayerStatus('');
            CHANNELS.splice(0, CHANNELS.length);
            for (var k = 0; k < allChannels.length; k++) {
              allChannels[k].index = k + 1;
              CHANNELS.push(allChannels[k]);
            }
            state.channel = 0;
            renderLiveRows(false);
            renderPlayerChannels();
            if (CHANNELS[0] && liveInfoText) {
              liveInfoText.textContent = CHANNELS[0].name;
            }
            if (state.screen === 'player' && state.playerMode === 'live') {
              updatePlayer();
              startLiveChannel(CHANNELS[0], true);
            }
            if (done) { done(); }
          }
        });
      })(addons[a]);
    }
  }

  function loadLiveChannels(columnId, done) {
    var requestedColumnId = columnId || 76182;
    /* buildLivePage and the initial boot can both ask for Todos.  Keep the
       existing request instead of clearing the first page while it streams. */
    if (liveChannelsLoading && liveChannelLoadColumnId === requestedColumnId) { return; }
    var requestSeq = ++liveChannelRequestSeq;
    liveChannelLoadColumnId = requestedColumnId;
    liveChannelsLoading = true;
    liveChannelsLoaded = false;
    CHANNELS.splice(0, CHANNELS.length);
    state.channel = 0;
    renderLiveRows(false);
    renderPlayerChannels();

    var pageNum = 1;
    var didReturnFirstPage = false;
    function fetchNextPage() {
      portalServiceCall('liveChannels', {
        columnId: requestedColumnId,
        pageNum: pageNum,
        pageSize: 20
      }, function (err, payload) {
        /* A category was selected while this page was in flight. */
        if (requestSeq !== liveChannelRequestSeq) { return; }
        var pageChannels = payload && payload.channels ? payload.channels : [];
        if (!err && pageChannels.length) {
          var known = {};
          for (var k = 0; k < CHANNELS.length; k++) {
            if (CHANNELS[k] && CHANNELS[k].channelCode) {
              known[CHANNELS[k].channelCode] = true;
            }
          }
          for (var c = 0; c < pageChannels.length; c++) {
            var channel = pageChannels[c];
            if (channel && (!channel.channelCode || !known[channel.channelCode])) {
              if (channel.channelCode) { known[channel.channelCode] = true; }
              CHANNELS.push(channel);
            }
          }
          liveChannelsLoaded = true;
          renderLiveRows(false);
          renderPlayerChannels();
          if (state.channel >= CHANNELS.length) { state.channel = 0; }
          if (CHANNELS[state.channel] && liveInfoText) {
            liveInfoText.textContent = CHANNELS[state.channel].name;
          }
          if (state.screen === 'player' && state.playerMode === 'live') {
            updatePlayer();
          } else {
            scheduleLivePreview(CHANNELS[state.channel]);
          }
        }

        if (!didReturnFirstPage) {
          didReturnFirstPage = true;
          if (!liveCategoriesLoaded) { loadLiveCategories(); }
          if (done) { done(err, payload); }
        }

        if (!err && payload && payload.hasMore && pageChannels.length) {
          pageNum++;
          /* Yield to webOS between pages so navigating the first block stays
             responsive while the rest of the catalogue arrives. */
          setTimeout(fetchNextPage, 25);
          return;
        }

        liveChannelsLoading = false;
        if (err && !liveChannelsLoaded) {
          setTimeout(function () {
            if (requestSeq === liveChannelRequestSeq) { loadLiveChannels(requestedColumnId); }
          }, 2500);
        }
      });
    }
    fetchNextPage();
  }

  function renderLiveRows(favOnly) {
    if (!liveList) { return; }
    clear(liveList);
    liveRows = [];
    if (!CHANNELS.length) {
      liveList.appendChild(el('div', 'live-list-status',
        liveChannelsLoaded ? 'No se encontraron canales' : 'Cargando canales…'));
      return;
    }
    for (var i = 0; i < CHANNELS.length; i++) {
      if (favOnly && !CHANNELS[i].fav) { continue; }
      var row = el('div', 'live-row focusable');
      row._channel = i;
      var icon = el('div', 'row-icon');
      if (CHANNELS[i].logo) {
        icon.style.backgroundImage = 'url(' + CHANNELS[i].logo + ')';
        icon.style.backgroundSize = 'contain';
        icon.style.backgroundRepeat = 'no-repeat';
        icon.style.backgroundPosition = 'center';
      }
      var play = el('div', 'row-play');
      var name = el('div', 'row-name', CHANNELS[i].name);
      row.appendChild(icon);
      row.appendChild(play);
      row.appendChild(name);
      if (i === state.channel) { row.classList.add('is-current'); }
      row._activate = (function (idx) {
        return function () { setChannel(idx, true); openPlayer('live'); };
      })(i);
      row._onMove = (function (idx) {
        return function (dir) {
          if (dir === 'left') {
            if (liveFocus) { setFocus(liveFocus); }
            else if (tabEls[0]) { setFocus(tabEls[0]); }
            return true;
          }
          if (dir === 'up') {
            if (idx > 0 && liveRows[idx - 1]) {
              setFocus(liveRows[idx - 1]);
            }
            return true;
          }
          if (dir === 'down') {
            if (idx < liveRows.length - 1 && liveRows[idx + 1]) {
              setFocus(liveRows[idx + 1]);
            }
            return true;
          }
          return false;
        };
      })(i);
      liveList.appendChild(row);
      liveRows.push(row);
    }
    if (CHANNELS[state.channel] && liveInfoText) {
      liveInfoText.textContent = CHANNELS[state.channel].name;
    }
    scrollLiveList();
  }

  function scrollLiveList() {
    if (!liveRows.length) { return; }
    var visible = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
    if (!visible) { return; }
    var idx = liveRows.indexOf(visible);
    var top = idx * 120;
    var max = Math.max(0, liveList.scrollHeight - liveList.clientHeight);
    var target = liveList.scrollTop;
    if (top < target) { target = top; }
    if (top + 100.5 > target + liveList.clientHeight) {
      target = top + 100.5 - liveList.clientHeight;
    }
    liveList.scrollTop = Math.max(0, Math.min(max, target));
  }

  function setChannel(index, immediate) {
    if (index < 0) { index = 0; }
    if (index > CHANNELS.length - 1) { index = CHANNELS.length - 1; }
    state.channel = index;
    for (var i = 0; i < liveRows.length; i++) {
      liveRows[i].classList.toggle('is-current', liveRows[i]._channel === index);
    }
    if (CHANNELS[index] && liveInfoText) {
      liveInfoText.textContent = CHANNELS[index].name;
    }
    scrollLiveList();
    if (state.screen === 'player') {
      updatePlayerChannel();
      if (state.playerMode === 'live') {
        startLiveChannel(CHANNELS[index], !!immediate);
      }
    } else if (state.screen === 'home' && state.tab === 0) {
      scheduleLivePreview(CHANNELS[index]);
    }
  }

  /* --- Addon Manager Dialog logic --- */
  function openAddonsDialog() {
    dialogAddonsOpen = true;
    var dlg = $('dialog-addons');
    if (!dlg) { return; }
    dlg.classList.add('is-active');
    renderAddonsDialog();
    var firstBtn = dlg.querySelector('.focusable');
    if (firstBtn) { setFocus(firstBtn); }
  }

  function closeAddonsDialog() {
    dialogAddonsOpen = false;
    var dlg = $('dialog-addons');
    if (!dlg) { return; }
    dlg.classList.remove('is-active');
    if (state.channelsOpen) {
      var btn = playerChannels ? playerChannels.querySelector('#pc-btn-addons') : null;
      if (btn) { setFocus(btn); }
      else { setFocus(playerStage); }
    }
  }

  function renderAddonsDialog() {
    var presetsBox = $('da-presets-list');
    var installedBox = $('da-installed-list');
    var saved = getSavedAddons();
    var savedUrls = {};
    for (var s = 0; s < saved.length; s++) { savedUrls[saved[s].url] = true; }

    if (presetsBox) {
      clear(presetsBox);
      for (var p = 0; p < PRESET_ADDONS.length; p++) {
        (function (preset) {
          var item = el('div', 'da-preset-item');
          var info = el('div', 'da-preset-info');
          info.appendChild(el('div', 'da-preset-name', preset.name));
          info.appendChild(el('div', 'da-preset-desc', preset.desc));
          item.appendChild(info);

          var isInst = !!savedUrls[preset.url];
          var btn = el('button', 'da-preset-btn focusable' + (isInst ? ' is-installed' : ''), isInst ? '✔ Instalado' : '+ Instalar');
          btn._activate = function () {
            if (isInst) { return; }
            btn.textContent = 'Instalando…';
            installAddon(preset, function (err, count) {
              if (err) {
                btn.textContent = 'Error';
                setTimeout(function () { btn.textContent = '+ Instalar'; }, 2000);
              } else {
                renderAddonsDialog();
                if (currentLiveCategory && currentLiveCategory.isAddon) {
                  loadAddonChannels();
                }
              }
            });
          };
          item.appendChild(btn);
          presetsBox.appendChild(item);
        })(PRESET_ADDONS[p]);
      }
    }

    if (installedBox) {
      clear(installedBox);
      if (!saved.length) {
        installedBox.appendChild(el('div', 'da-installed-empty', 'No hay addons personalizados instalados aún. Instala una lista recomendada arriba o escribe una URL.'));
      } else {
        for (var i = 0; i < saved.length; i++) {
          (function (ad, idx) {
            var row = el('div', 'da-installed-item');
            var info = el('div', 'da-installed-info');
            var nm = el('div', 'da-preset-name', ad.name);
            var sub = el('div', 'da-preset-desc', (ad.count ? (ad.count + ' canales • ') : '') + ad.url);
            info.appendChild(nm);
            info.appendChild(sub);
            row.appendChild(info);

            var delBtn = el('button', 'da-del-btn focusable', 'Eliminar');
            delBtn._activate = function () {
              saved.splice(idx, 1);
              saveSavedAddons(saved);
              renderAddonsDialog();
              if (currentLiveCategory && currentLiveCategory.isAddon) {
                loadAddonChannels();
              }
            };
            row.appendChild(delBtn);
            installedBox.appendChild(row);
          })(saved[i], i);
        }
      }
    }

    var addCustomBtn = $('da-btn-add-custom');
    if (addCustomBtn) {
      addCustomBtn._activate = function () {
        var inp = $('da-custom-url');
        var url = inp ? (inp.value || '').trim() : '';
        if (!url || !/^https?:\/\//i.test(url)) {
          alert('Por favor introduce una URL válida (http:// o https://)');
          return;
        }
        addCustomBtn.textContent = 'Descargando…';
        installAddon({ id: 'custom_' + Date.now(), name: 'Lista Personalizada', url: url }, function (err, count) {
          addCustomBtn.textContent = 'Agregar';
          if (err) {
            alert('No se pudo cargar la lista M3U: ' + err);
          } else {
            if (inp) { inp.value = ''; }
            renderAddonsDialog();
            if (currentLiveCategory && currentLiveCategory.isAddon) {
              loadAddonChannels();
            }
          }
        });
      };
    }

    var exitBtn = $('da-btn-exit');
    if (exitBtn) {
      exitBtn._activate = function () { closeAddonsDialog(); };
    }
  }

  function installAddon(addon, done) {
    portalServiceCall('fetchM3u', { url: addon.url }, function (err, payload) {
      if (err || !payload || !payload.channels || !payload.channels.length) {
        if (done) { done(err || 'No se encontraron canales en la lista'); }
        return;
      }
      var saved = getSavedAddons();
      /* Check duplicate */
      var exists = false;
      for (var s = 0; s < saved.length; s++) {
        if (saved[s].url === addon.url) {
          saved[s].count = payload.channels.length;
          exists = true;
          break;
        }
      }
      if (!exists) {
        saved.push({
          id: addon.id || ('addon_' + Date.now()),
          name: addon.name || 'Lista M3U',
          url: addon.url,
          count: payload.channels.length
        });
      }
      saveSavedAddons(saved);
      if (done) { done(null, payload.channels.length); }
    });
  }

  /* ---------------------------------------------------------- home posters */
  /* Bento mosaic measured on the running app (WSA, 1920x1080):
       mRecommend01 831x534 @ 192,212   mRecommend02 831x534 @ 1029,212
       mRecommend03..06 413x222 @ y 752, x 192/609/1028/1446
       pagination dots around 843,723 (screen) -> page coords subtract 173.5.
     The page grid is identical for DESTACADOS, PELICULA, SERIES and ANIME. */
  var BENTO = {
    bigW: 831, bigH: 534, bigY: 38.5,
    smallW: 413, smallH: 222, smallY: 578.5,
    bigX: [192, 1029],
    smallX: [192, 609, 1028, 1446]
  };

  function makeBento(item, x, y, w, h, opts) {
    opts = opts || {};
    var t = el('div', 'bento focusable');
    abs(t, x, y, w, h);
    var art = item ? (item.landscape || item.poster) : '';
    if (art) {
      var img = el('img', 'bento-img');
      img.setAttribute('data-poster-src', art);
      img.onerror = function () { this.style.display = 'none'; };
      t.appendChild(img);
    }
    if (opts.shade) { t.appendChild(el('div', 'bento-shade')); }
    if (opts.title && item) { t.appendChild(el('div', 'bento-title', item.title)); }
    if (opts.badge) { t.appendChild(el('div', 'bento-badge', opts.badge)); }
    t._item = item;
    if (item) { t._activate = function () { openDetail(item); }; }
    schedulePosterMemoryPass();
    return t;
  }

  function bentoDots(x, y, count, active) {
    var d = el('div', 'bento-dots');
    abs(d, x, y, 21 + Math.max(0, count - 1) * 40, 11);
    for (var i = 0; i < count; i++) {
      d.appendChild(el('span', 'bento-dot' + (i === active ? ' is-active' : '')));
    }
    return d;
  }

  function bentoPage(page, items, opts) {
    opts = opts || {};
    var source = items.length ? items : VOD;
    if (!source.length) { return; }
    var i;
    for (i = 0; i < 2; i++) {
      page.appendChild(makeBento(source[i % source.length], BENTO.bigX[i], BENTO.bigY,
                                 BENTO.bigW, BENTO.bigH,
                                 { shade: opts.shade !== false, title: opts.titles }));
    }
    for (i = 0; i < 4; i++) {
      page.appendChild(makeBento(source[(i + 2) % source.length], BENTO.smallX[i], BENTO.smallY,
                                 BENTO.smallW, BENTO.smallH, {}));
    }
    if (opts.dots) { page.appendChild(bentoDots(848, 535.5, opts.dots, 0)); }
  }

  /* DESTACADOS / PELICULA: the observed 831x534 crops already contain the
     real title bar and pagination dots drawn by the APK, so the port must not
     paint a second copy over them. Portal artwork is plain 16:9 art, so the
     title and dots have to be drawn. */
  function allVodFor(category) {
    var out = [], i;
    if (category) {
      for (i = 0; i < VOD.length; i++) {
        var cats = norm(VOD[i].category || '').split(',');
        if (cats.indexOf(category) !== -1 || (VOD[i].kind && norm(VOD[i].kind).indexOf(category) !== -1)) {
          out.push(VOD[i]);
        }
      }
    }
    return out;
  }

  function appendCatalogGrid(page, items, startY, titleText) {
    if (!items || !items.length) { return; }
    var y = startY || 860;
    var sub = el('div', 'kids-subtitle', titleText || 'Catálogo');
    abs(sub, 192, y, 1249, 40);
    page.appendChild(sub);
    y += 50;

    var colW = 276;
    var colH = 390;
    var maxCols = 6;
    var limit = Math.min(items.length, 60);
    for (var k = 0; k < limit; k++) {
      var col = k % maxCols;
      var row = Math.floor(k / maxCols);
      var px = 192 + col * colW;
      var py = y + row * colH;
      page.appendChild(makePoster(items[k], px, py, 250, 360, { gold: true }));
    }
  }

  function buildFeaturedPage(page) {
    var all = allVodFor('destacado');
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, items, { titles: real, dots: real ? 4 : 0, shade: real });
    var rest = all.slice(6);
    if (rest.length) {
      appendCatalogGrid(page, rest, 860, 'Títulos destacados');
    }
  }

  function buildMoviesPage(page) {
    var all = allVodFor('pelicula');
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, items, { titles: real, dots: real ? 4 : 0, shade: real });
    var rest = all.slice(6);
    if (rest.length) {
      appendCatalogGrid(page, rest, 860, 'Más películas');
    }
  }

  function buildSeriesPage(page) {
    var all = allVodFor('serie');
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, items, { titles: real, dots: real ? 3 : 2, shade: real });
    var rest = all.slice(6);
    if (rest.length) {
      appendCatalogGrid(page, rest, 860, 'Más series');
    }
  }

  function buildAnimePage(page) {
    var all = allVodFor('anime');
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, items, { titles: real, dots: real ? 3 : 2, shade: real });
    var rest = all.slice(6);
    if (rest.length) {
      appendCatalogGrid(page, rest, 860, 'Anime y animación');
    }
  }

  function novelCatalogItems() {
    var out = [];
    for (var i = 0; i < VOD.length; i++) {
      var item = VOD[i];
      var text = norm([
        item.row || '', item.category || '', item.kind || '', item.title || '', item.alias || '',
        item.genres && item.genres.join ? item.genres.join(' ') : (item.genres || '')
      ].join(' '));
      if (text.indexOf('novela') !== -1 || text.indexOf('telenovela') !== -1) {
        out.push(item);
      }
    }
    return out;
  }

  function buildNovelsPage(page) {
    /* The portal already includes its novela rows in the loaded home roots.
       Filter those exact records only: no synthetic catalog and no secondary
       query that could return a different host/list.

       Keep the six featured tiles above, but do not remove those titles from
       the catalogue below.  The portal currently delivers ten items in its
       official "Telenovelas" row; slicing at six made "Más novelas" look as
       if the category only had four titles. */
    var all = novelCatalogItems();
    if (!all.length) {
      var empty = el('div', 'catalog-empty', 'No se encontraron novelas en el catálogo actual.');
      abs(empty, 192, 170, 1500, 80);
      page.appendChild(empty);
    } else {
      var items = all.slice(0, 6);
      var real = !!(items[0] && items[0]._portal);
      bentoPage(page, items, { titles: real, dots: real ? 3 : 2, shade: real });
      appendCatalogGrid(page, all, 860, 'Más novelas');
    }
  }

  /* KIDS: hero 831x534 + 2x2 grid 413x222 on the right, a subtitle line and a
     horizontal poster row (7 columns, last one clipped by the screen edge). */
  function buildKidsPage(page) {
    var source = vodFor('infantil', 12, 0);
    if (!source.length) { source = VOD; }
    var real = !!(source[0] && source[0]._portal);
    page.appendChild(makeBento(source[0], 192, 38.5, 831, 534, { shade: true, title: real }));
    var cells = [
      [1029, 38.5], [1446, 38.5], [1029, 269.5], [1446, 269.5]
    ];
    for (var i = 0; i < cells.length; i++) {
      page.appendChild(makeBento(source[(i + 1) % source.length], cells[i][0], cells[i][1],
                                 413, 222, {}));
    }
    page.appendChild(bentoDots(833, 468.5, 4, 0));
    if (source[0]) {
      var sub = el('div', 'kids-subtitle', source[0].tagline || source[0].title);
      abs(sub, 192, 526.5, 1249, 40);
      page.appendChild(sub);
    }
    var row = el('div', 'poster-row');
    abs(row, 192, 578.5, 1920, 310);
    for (var k = 0; k < 7; k++) {
      var it = source[k % source.length];
      if (!it) { break; }
      row.appendChild(makePoster(it, k * 266, 0, 266, 310, { gold: true }));
    }
    page.appendChild(row);
  }

  /* EXPLORAR: hero 1249x703 + three stacked 413x226 tiles on the right,
     provider row label and logo strip underneath. */
  function buildExplorePage(page) {
    var source = VOD.length ? VOD : [];
    page.appendChild(makeBento(source[0], 192, 38.5, 1249, 703, { shade: true }));
    for (var i = 0; i < 3; i++) {
      page.appendChild(makeBento(source[(i + 1) % source.length], 1446, 38.5 + i * 231,
                                 413, 226, { badge: i === 2 ? 'Adult' : '' }));
    }
    page.appendChild(el('div', 'explore-row-title', 'Netflix'));
    var strip = el('div', 'explore-strip');
    abs(strip, 192, 811.5, 1920, 130);
    for (var k = 0; k < 8; k++) {
      var cell = el('div', 'explore-logo');
      abs(cell, k * 272, 0, 260, 120);
      strip.appendChild(cell);
    }
    page.appendChild(strip);
  }

  /* ============================================================ VOD DETAIL */
  function openDetail(item) {
    state.detail = item;
    state.detailReturn = { screen: state.screen, focus: state.focus };
    state.detailRange = 0;
    state.detailSeason = 0;
    state.detailEpisode = null;

    if (item.seasons && item.seasons.length) {
      for (var s = 0; s < item.seasons.length; s++) {
        if (item.seasons[s].id === item.id) {
          state.detailSeason = s;
          break;
        }
      }
    }
    if (item.episodes && item.episodes.length) {
      state.detailEpisode = item.episodes[0];
    }
    applyPendingHistoryEpisode(item);

    /* New title: forget the previous audio/subtitle/rendition choice and ask
       the portal for this one's real tracks (cached for the dialog/panel). */
    resetMediaSelection();
    restoreSmoothMode(item);
    if (window.PalmServiceBridge) { ensureMediaInfo(item); }

    buildDetail(item);
    showScreen('detail');

    /* Mostrar reproductor en recuadro mini */
    if (!playerStage) { buildPlayer(); }
    var scrPlayer = $('screen-player');
    if (scrPlayer) {
      scrPlayer.classList.add('is-mini');
      scrPlayer.classList.add('is-active');
    }

    var f = detailButtons ? detailButtons.querySelector('.focusable') : null;
    if (f) { setFocus(f); }

    if (item._detailsLoaded) {
      startPlayerVideo(item, state.detailEpisode);
    } else {
      setPlayerStatus('Preparando la reproducción…');
      loadVodDetail(item, function (loaded) {
        if (loaded && state.screen === 'detail' && state.detail === loaded) {
          applyPendingHistoryEpisode(loaded);
          startPlayerVideo(loaded, state.detailEpisode);
        }
      });
    }
  }

  function toggleSynopsis() {
    var screen = $('screen-detail');
    if (!screen) { return; }
    var open = !screen.classList.contains('is-synopsis-open');
    screen.classList.toggle('is-synopsis-open', open);
    var more = document.querySelector('.detail-more');
    if (more) { more.textContent = open ? 'Menos' : 'Más'; }
  }

  function buildDetail(item) {
    detailLeft = $('detail-left');
    detailPlayer = $('detail-player');
    detailButtons = $('detail-buttons');
    detailBottom = $('detail-bottom');
    clear(detailLeft); clear(detailButtons); clear(detailBottom);

    /* left column: 806px at 80/50 */
    var tw = el('div', 'detail-titlewrap');
    tw.appendChild(el('div', 'detail-title', item.title));
    tw.appendChild(el('div', 'detail-score', item.score));
    detailLeft.appendChild(tw);

    var metaText;
    if (item.country || item.releaseDate || item.tagline) {
      /* mTextTimeType: "country | release date | viewpoint" (reference). */
      var bits = [];
      if (item.country) { bits.push(item.country); }
      if (item.releaseDate) { bits.push(item.releaseDate); }
      if (item.tagline) { bits.push(item.tagline); }
      metaText = bits.join(' | ');
    } else {
      var parts = [];
      if (item.year && item.year !== '—') { parts.push(item.year); }
      if (item.duration && item.duration !== '—') { parts.push(item.duration); }
      parts.push('HD');
      metaText = parts.join('  ·  ');
    }
    detailLeft.appendChild(el('div', 'detail-meta', metaText));

    /* mTextUpdate: gold "T10 - E73", series only. The season comes from the
       alias ("... S10") or the season list; the count is the episode total. */
    if (isSeriesItem(item)) {
      var seasonNo = 0;
      var sm = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
      if (sm) { seasonNo = parseInt(sm[1], 10) || 0; }
      if (!seasonNo && item.seasons && item.seasons.length) {
        var curSeason = item.seasons[state.detailSeason] || item.seasons[0];
        seasonNo = (curSeason && curSeason.number) || 1;
      }
      if (!seasonNo) { seasonNo = 1; }
      var epTotal = item.updateCount || item.volumeCount || (item.episodes ? item.episodes.length : 0);
      if (epTotal) {
        detailLeft.appendChild(el('div', 'detail-update', 'T' + seasonNo + ' - E' + epTotal));
      }
    }

    var genres = el('div', 'detail-genres');
    genres.appendChild(el('span', 'label', 'Género : '));
    for (var g = 0; g < item.genres.length; g++) {
      /* Informational metadata must not take D-pad focus on the detail page. */
      var chip = el('div', 'chip', item.genres[g]);
      genres.appendChild(chip);
    }
    detailLeft.appendChild(genres);

    var dir = el('div', 'detail-row');
    dir.appendChild(document.createTextNode('Director : '));
    var dirV = el('span', 'val', item.director);
    dir.appendChild(dirV);
    detailLeft.appendChild(dir);

    var act = el('div', 'detail-row');
    act.appendChild(document.createTextNode('Actors : '));
    var actV = el('span', 'val', item.actors);
    act.appendChild(actV);
    detailLeft.appendChild(act);

    var syn = el('div', 'detail-synopsis');
    syn.appendChild(el('span', 'label', 'Sinopsis : '));
    syn.appendChild(el('div', 'text', item.synopsis));
    /* mTextIntroduction + tvMore: the APK expands the 2-line preview in place.
       Here the expanded block overlays the button row (documented). */
    var more = el('div', 'detail-more', 'Más');
    syn.appendChild(more);
    detailLeft.appendChild(syn);

    /* player window 765x430 at right 80 / top 50. */
    clear(detailPlayer);
    detailPlayer.classList.add('focusable');
    detailPlayer._activate = function () { expandToFullscreen(item, state.detailEpisode); };
    detailPlayer._onMove = function () { return false; };

    /* buttons 276x68, gap 30 */
    var btnDefs = [
      { icon: 'icon_detail_fullscreen.png', label: 'Pantalla completa', kind: 'fullscreen' },
      { icon: 'icon_detail_subtitle_audio.png', label: 'Idioma', kind: 'language' },
      { icon: 'icon_detail_favorite.png', label: 'Favorito', kind: 'favorite' }
    ];
    if (isSeriesItem(item)) {
      btnDefs.push({ icon: 'icon_detail_subscribe.png', label: 'Notificaciones', kind: 'subscribe' });
    }
    for (var b = 0; b < btnDefs.length; b++) {
      var btn = el('div', 'detail-btn focusable');
      var ico = el('img');
      ico.src = 'assets/original/vod/' + btnDefs[b].icon;
      ico.alt = '';
      btn.appendChild(ico);
      btn.appendChild(el('span', null, btnDefs[b].label));
      btn._kind = btnDefs[b].kind;
      if (btnDefs[b].kind === 'favorite' && state.favs[String(item.id)]) {
        btn.classList.add('is-selected');
        btn.querySelector('span').textContent = 'En favoritos';
      }
      btn._activate = (function (kind, it) {
        return function () {
          if (kind === 'fullscreen') { expandToFullscreen(it, state.detailEpisode); }
          else if (kind === 'language') { openPlaySettingsDialog(it); }
          else if (kind === 'favorite') {
            var enabled = toggleFavorite(it);
            this.classList.toggle('is-selected', enabled);
            var label = this.querySelector('span');
            if (label) { label.textContent = enabled ? 'En favoritos' : 'Favorito'; }
          } else if (kind === 'subscribe') {
            var img = this.querySelector('img');
            var on = img.src.indexOf('subscribed') === -1;
            img.src = 'assets/original/vod/icon_detail_' + (on ? 'subscribed' : 'subscribe') + '.png';
          }
        };
      })(btnDefs[b].kind, item);
      detailButtons.appendChild(btn);
    }
    var modeBtn = el('div', 'detail-btn focusable');
    var modeIcon = el('img');
    modeIcon.src = 'assets/original/vod/icon_detail_quality.png';
    modeIcon.alt = '';
    modeBtn.appendChild(modeIcon);
    var modeLabel = el('span', null, state.streamMode === 'smooth' ? 'Modo fluido: Sí' : 'Modo fluido: No');
    modeBtn.appendChild(modeLabel);
    modeBtn._activate = function () {
      setSmoothMode(item, state.streamMode !== 'smooth');
      modeLabel.textContent = state.streamMode === 'smooth' ? 'Modo fluido: Sí' : 'Modo fluido: No';
    };
    detailButtons.appendChild(modeBtn);

    renderDetailBottom(item);
  }

  /* Episode ranges are chunks of 20 ("1-20", "21-40", ...) as observed. */
  function detailRanges(count) {
    var out = [];
    for (var s = 0; s < count; s += 20) {
      out.push({ start: s, end: Math.min(count, s + 20) });
    }
    return out;
  }

  function detailSeasonLabel(item) {
    var n = 0;
    if (item.seasons && item.seasons.length > 0) {
      var cur = item.seasons[state.detailSeason] || item.seasons[0];
      n = cur && cur.number ? cur.number : state.detailSeason + 1;
    }
    if (!n) {
      var m = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
      if (m) { n = parseInt(m[1], 10) || 0; }
    }
    return 'Temporada ' + (n || 1);
  }

  function selectDetailRange(index, item) {
    state.detailRange = index;
    buildDetail(item);
    var f = detailBottom.querySelector('.detail-range.is-selected');
    if (f) { setFocus(f); }
  }

  var seasonPopup = null;
  function closeSeasonPopup() {
    if (seasonPopup && seasonPopup.parentNode) {
      seasonPopup.parentNode.removeChild(seasonPopup);
      seasonPopup = null;
    }
    var arrow = detailBottom ? detailBottom.querySelector('.season-arrow') : null;
    if (arrow) { arrow.classList.remove('is-open'); }
  }

  function toggleSeasonPopup(anchorBtn, item) {
    if (seasonPopup) {
      closeSeasonPopup();
      return;
    }
    if (!item.seasons || item.seasons.length < 2) { return; }

    var arrow = anchorBtn.querySelector('.season-arrow');
    if (arrow) { arrow.classList.add('is-open'); }

    seasonPopup = el('div', 'season-popup');
    abs(seasonPopup, 80, 100, 280, Math.min(320, item.seasons.length * 54));

    for (var s = 0; s < item.seasons.length; s++) {
      (function (sIndex) {
        var sData = item.seasons[sIndex];
        var isSelected = sIndex === state.detailSeason;
        var pItem = el('div', 'season-popup-item focusable' + (isSelected ? ' is-selected' : ''));
        var sText = 'Temporada ' + (sData.number || (sIndex + 1));
        pItem.appendChild(el('span', 'season-item-text', sText));

        var check = el('img', 'season-item-check');
        check.src = 'assets/original/vod/icon_nation_selected.png';
        check.alt = '';
        pItem.appendChild(check);

        pItem._activate = function () {
          closeSeasonPopup();
          if (state.detailSeason !== sIndex) {
            state.detailSeason = sIndex;
            state.detailRange = 0;
            state.detailEpisode = null;
            var targetSeason = item.seasons[sIndex];
            if (targetSeason && targetSeason.id) {
              setPlayerStatus('Cargando temporada…');
              portalServiceCall('detail', { contentId: targetSeason.id }, function (err, payload) {
                if (!err && payload && payload.returnValue !== false) {
                  if (payload.item) { mergeDetail(item, payload.item); }
                  item.episodes = payload.episodes || [];
                  item.seasonId = targetSeason.id;
                  targetSeason._episodes = item.episodes;
                  state.detailEpisode = item.episodes[0] || null;
                }
                buildDetail(item);
                if (state.detailEpisode) {
                  startPlayerVideo(item, state.detailEpisode);
                }
                var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
                if (sBtn) { setFocus(sBtn); }
              });
            }
          } else {
            var sBtn2 = detailBottom ? detailBottom.querySelector('.detail-season') : null;
            if (sBtn2) { setFocus(sBtn2); }
          }
        };

        seasonPopup.appendChild(pItem);
      })(s);
    }

    detailBottom.appendChild(seasonPopup);
    var focusedChild = seasonPopup.children[state.detailSeason] || seasonPopup.children[0];
    if (focusedChild) { setFocus(focusedChild); }
  }

  function renderDetailBottom(item) {
    var episodes = (isSeriesItem(item) && item.episodes) ? item.episodes : [];
    var hasEpisodes = episodes.length > 0;
    var ranges = detailRanges(episodes.length);
    if (state.detailRange >= ranges.length) { state.detailRange = 0; }

    /* Season dropdown button (flChoose / llSeanson) */
    if (isSeriesItem(item)) {
      var seasonBtn = el('div', 'detail-season focusable');
      abs(seasonBtn, 80, 42, 280, 53);
      seasonBtn.appendChild(el('span', 'season-text', detailSeasonLabel(item)));
      var arrow = el('img', 'season-arrow');
      arrow.src = 'assets/original/vod/ic_down_icon.png';
      arrow.alt = '▼';
      seasonBtn.appendChild(arrow);
      seasonBtn._activate = function () {
        if (!item.seasons || item.seasons.length < 2) { return; }
        toggleSeasonPopup(seasonBtn, item);
      };
      detailBottom.appendChild(seasonBtn);
    }

    /* Range tabs (1-20, 21-40...) */
    if (hasEpisodes && episodes.length > 20) {
      var rangeRow = el('div', 'detail-ranges');
      abs(rangeRow, 398, 51, 1522, 46);
      for (var i = 0; i < ranges.length; i++) {
        (function (idx) {
          var tab = el('div', 'detail-range focusable' + (idx === state.detailRange ? ' is-selected' : ''),
                       (ranges[idx].start + 1) + '-' + ranges[idx].end);
          abs(tab, idx * 160, 0, 150, 46);
          tab._activate = function () { selectDetailRange(idx, item); };
          rangeRow.appendChild(tab);
        })(i);
      }
      detailBottom.appendChild(rangeRow);
    }

    /* Episode grid */
    if (hasEpisodes) {
      var current = ranges[state.detailRange] || { start: 0, end: episodes.length };
      var row = el('div', 'detail-episodes scrollable');
      abs(row, 80, 149, 1840, 65);
      for (var e = current.start; e < current.end; e++) {
        (function (ep, index) {
          var isPlaying = state.detailEpisode && (state.detailEpisode.id === ep.id || state.detailEpisode === ep);
          var tile = el('div', 'detail-episode focusable' + (isPlaying ? ' is-playing' : ''));
          abs(tile, index * 160, 0, 150, 65);
          var numText = (ep.number !== undefined && ep.number !== null) ? String(ep.number) : String(e + 1);
          tile.appendChild(el('span', 'ep-num', numText));
          tile._ep = ep;
          tile._activate = function () {
            playEpisode(item, ep);
          };
          row.appendChild(tile);
        })(episodes[e], e - current.start);
      }
      detailBottom.appendChild(row);
    }

    /* mTextRelated + mGridRelated. The series layout pushes them below the
       episode selector, so the poster row is clipped by the screen edge. */
    var relatedTop = hasEpisodes ? 240 : 25;
    var gridTop = hasEpisodes ? 290 : 91;
    var heading = el('div', 'detail-related', 'Quizás te guste');
    abs(heading, 80, relatedTop, 400, 44);
    detailBottom.appendChild(heading);

    var grid = el('div', 'detail-grid scrollable');
    abs(grid, 80, gridTop, 1750, hasEpisodes ? 180 : 380);
    var seed = parseInt(item.id, 10);
    if (isNaN(seed)) {
      seed = 0;
      for (var s = 0; s < VOD.length; s++) { if (VOD[s] === item) { seed = s; break; } }
    }
    var start = (seed * 3) % Math.max(1, VOD.length - 6);
    for (var r = 0; r < 8; r++) {
      var rel = VOD[(start + r) % VOD.length];
      if (!rel) { continue; }
      var cell = el('div', 'cell');
      cell.appendChild(makePoster(rel, 0, 0, 210, 308, { gold: true }));
      cell.appendChild(el('div', 'd-name', rel.title));
      grid.appendChild(cell);
    }
    detailBottom.appendChild(grid);
  }

  /* ================================================================ SEARCH */
  function hotSearches() {
    return [];
  }

  function buildSearch() {
    searchKeyboard = $('search-keyboard');
    searchHot = $('search-hot');
    searchResults = $('search-results');
    searchEmpty = $('search-empty');
    searchHotGrid = $('search-hot-grid');
    searchResultGrid = $('search-result-grid');
    searchNav = $('search-nav');
    clear(searchKeyboard); clear(searchHotGrid); clear(searchResultGrid);
    /* Result rows can extend beyond the first screen.  Mark their viewport as
       scrollable so reveal() follows D-pad focus down through every result. */
    if (searchResults) { searchResults.classList.add('scrollable'); }

    /* --- keyboard panel (layout_search_keybord_full_uni) --- */
    searchInput = el('div', 'kb-edit focusable');
    searchInput._activate = function () { /* edit field */ };
    searchKeyboard.appendChild(searchInput);

    var actions = el('div', 'kb-actions');
    var actionDefs = [
      { cls: 'switch', w: 100.5 },
      { cls: 'clear', w: 100.5 },
      { cls: 'del', w: 100.5 },
      { cls: 'go', w: 120 }
    ];
    for (var a = 0; a < actionDefs.length; a++) {
      var act = el('div', 'kb-action focusable ' + actionDefs[a].cls);
      act.style.width = actionDefs[a].w + 'px';
      if (actionDefs[a].cls === 'go') {
        act.textContent = 'Busca';
      } else {
        act.appendChild(el('div', 'ico'));
      }
      act._kind = actionDefs[a].cls;
      act._activate = (function (kind) {
        return function () {
          if (kind === 'switch') { toggleSearchNumeric(); }
          else if (kind === 'clear') { setSearchQuery(''); }
          else if (kind === 'del') { setSearchQuery(state.searchQuery.slice(0, -1)); }
          else { runSearch(); }
        };
      })(actionDefs[a].cls);
      actions.appendChild(act);
    }
    searchKeyboard.appendChild(actions);

    searchKeys = [];
    var rows = [
      ['A', 'Á', 'B', 'C', 'D', 'E', 'É'],
      ['F', 'G', 'H', 'I', 'Í', 'J', 'K'],
      ['L', 'M', 'N', 'Ñ', 'O', 'Ó', 'P'],
      ['Q', 'R', 'S', 'T', 'U', 'Ú', 'Ü'],
      ['V', 'W', 'X', 'Y', 'Z', ' ']
    ];
    for (var r = 0; r < rows.length; r++) {
      var row = el('div', 'kb-row');
      row.style.top = (264 + r * 88.5) + 'px';
      for (var c = 0; c < rows[r].length; c++) {
        var key = el('div', 'kb-key focusable' + (rows[r][c] === ' ' ? ' space' : ''),
          rows[r][c] === ' ' ? '' : rows[r][c]);
        key._char = rows[r][c];
        key._activate = (function (ch) {
          return function () { setSearchQuery(state.searchQuery + ch); };
        })(rows[r][c]);
        row.appendChild(key);
        searchKeys.push(key);
      }
      searchKeyboard.appendChild(row);
    }

    var feedback = el('div', 'kb-feedback focusable', 'Feedback');
    feedback._activate = function () { /* feedback form not reconstructed */ };
    searchKeyboard.appendChild(feedback);

    /* --- hot search grid (observed "Búsqueda popular", 10 portrait cells) --- */
    renderPopularSearch();

    searchResults.classList.remove('is-active');
    searchEmpty.classList.remove('is-active');
    searchHot.classList.remove('is-hidden');
    updateSearchInput();
  }

  function makeSearchCell(item, index) {
    var cell = el('div', 'search-cell');
    abs(cell, (index % 5) * 246, Math.floor(index / 5) * 437, 246, 437);
    cell.appendChild(makePoster(item, 0, 0, 222, 329, { gold: true }));
    cell.appendChild(el('div', 's-name', item.title));
    return cell;
  }

  function openSearch() {
    if (!searchKeyboard) { buildSearch(); }
    showScreen('search');
    if (!state.searchQuery) { renderPopularSearch(); }
    setFocus(searchInput);
  }

  function popularSearchItems() {
    var featured = allVodFor('destacado');
    var out = featured && featured.length ? featured.slice(0, 10) : [];
    if (!out.length) { out = hotSearches(); }
    return out;
  }

  function renderPopularSearch() {
    if (!searchHotGrid || state.searchQuery) { return; }
    clear(searchHotGrid);
    var hotItems = popularSearchItems();
    for (var h = 0; h < hotItems.length; h++) {
      searchHotGrid.appendChild(makeSearchCell(hotItems[h], h));
    }
    schedulePosterMemoryPass();
  }

  function updateSearchInput() {
    if (!searchInput) { return; }
    if (state.searchQuery) {
      searchInput.textContent = state.searchQuery;
      searchInput.classList.remove('is-placeholder');
    } else {
      searchInput.textContent = 'Buscar películas, series, directores y actores.';
      searchInput.classList.add('is-placeholder');
    }
  }

  function setSearchQuery(q) {
    state.searchQuery = q;
    updateSearchInput();
    runSearch();
  }

  function clearSearchState() {
    if (state.searchTimer) { clearTimeout(state.searchTimer); state.searchTimer = null; }
    state.searchQuery = '';
    updateSearchInput();
    if (searchResultGrid) { clear(searchResultGrid); }
    state.searchMatches = [];
    state.searchPage = 0;
    if (searchNav) { searchNav.textContent = ''; }
    if (searchResults) { searchResults.classList.remove('is-active'); }
    if (searchEmpty) { searchEmpty.classList.remove('is-active'); }
    if (searchHot) { searchHot.classList.remove('is-hidden'); }
  }

  function runSearch() {
    var rawQ = state.searchQuery || '';
    var q = norm(rawQ.trim());
    if (!q) {
      clearSearchState();
      return;
    }
    /* Instant local matches (0ms response) */
    var localMatches = [];
    for (var i = 0; i < VOD.length; i++) {
      var tNorm = norm(VOD[i].title || '');
      var aNorm = VOD[i].alias ? norm(VOD[i].alias) : '';
      if (tNorm.indexOf(q) !== -1 || (aNorm && aNorm.indexOf(q) !== -1)) {
        localMatches.push(VOD[i]);
      }
    }
    renderSearchResults(localMatches);

    /* Debounced remote portal search (350ms) */
    if (state.searchTimer) { clearTimeout(state.searchTimer); }
    if (vodApi.mode === 'portal' && q.length >= 2) {
      var seq = ++state.searchSeq;
      state.searchTimer = setTimeout(function () {
        portalServiceCall('search', { value: rawQ.trim() }, function (error, payload) {
          if (seq !== state.searchSeq) { return; }
          if (error || !payload || payload.returnValue === false || !payload.items || !payload.items.length) {
            /* Keep existing local matches, never clear on empty remote response */
            return;
          }
          var merged = localMatches.slice();
          var seen = {};
          for (var m = 0; m < merged.length; m++) { seen[String(merged[m].id)] = true; }
          for (var p = 0; p < payload.items.length; p++) {
            var item = normalizeVod(payload.items[p], merged.length + 1);
            if (!seen[String(item.id)]) {
              seen[String(item.id)] = true;
              merged.push(item);
            }
          }
          renderSearchResults(merged);
        });
      }, 350);
    }
  }

  var SEARCH_PAGE_SIZE = 10;

  function renderSearchResults(matches) {
    /* A short query can match hundreds of portal titles.  webOS 4 runs out
       of media/UI memory if every poster is inserted at once, so retain the
       complete result list in JS but render one 2-row page at a time. */
    state.searchMatches = matches || [];
    state.searchPage = 0;
    renderSearchResultPage(0, -1);
  }

  function renderSearchResultPage(requestedPage, focusIndex) {
    var matches = state.searchMatches || [];
    searchHot.classList.add('is-hidden');
    searchResults.classList.add('is-active');
    clear(searchResultGrid);
    if (matches.length === 0) {
      searchEmpty.classList.add('is-active');
      if (searchNav) { searchNav.textContent = ''; }
      return;
    }
    searchEmpty.classList.remove('is-active');
    var pageCount = Math.ceil(matches.length / SEARCH_PAGE_SIZE);
    var page = Math.max(0, Math.min(pageCount - 1, requestedPage || 0));
    state.searchPage = page;
    var start = page * SEARCH_PAGE_SIZE;
    var end = Math.min(matches.length, start + SEARCH_PAGE_SIZE);
    if (searchNav) {
      searchNav.textContent = 'Resultados ' + (start + 1) + '-' + end + ' de ' + matches.length +
        (pageCount > 1 ? '  ·  Página ' + (page + 1) + '/' + pageCount : '');
    }
    for (var m = start; m < end; m++) {
      var localIndex = m - start;
      var cell = makeSearchCell(normalizeVod(matches[m], m + 1), localIndex);
      var poster = cell.querySelector('.poster');
      if (poster) {
        (function (indexOnPage, column) {
          poster._onMove = function (dir) {
            if (dir === 'down' && indexOnPage >= 5 && end < matches.length) {
              renderSearchResultPage(page + 1, column);
              return true;
            }
            if (dir === 'up' && indexOnPage < 5 && start > 0) {
              renderSearchResultPage(page - 1, 5 + column);
              return true;
            }
            return false;
          };
        })(localIndex, localIndex % 5);
      }
      searchResultGrid.appendChild(cell);
    }
    searchResultGrid.style.height = '874px';
    if (focusIndex >= 0) {
      var requested = searchResultGrid.querySelectorAll('.poster.focusable')[focusIndex];
      if (!requested) { requested = firstIn(searchResultGrid); }
      if (requested) { setFocus(requested); }
    } else if (state.screen === 'search' && (closest(state.focus, '.search-hot') || closest(state.focus, '.search-results'))) {
      var f = firstIn(searchResultGrid);
      if (f) { setFocus(f); }
    }
  }

  function toggleSearchNumeric() {
    state.searchNumeric = !state.searchNumeric;
    var sw = searchKeyboard.querySelector('.kb-action.switch .ico');
    if (sw) {
      sw.style.backgroundImage = 'url(assets/original/search/' +
        (state.searchNumeric ? 'ic_vod_search_abc.png' : 'ic_vod_search_123.png') + ')';
    }
    var rows = searchKeyboard.querySelectorAll('.kb-row:not(.kb-row-num)');
    if (!state.searchNumeric) {
      for (var i = 0; i < rows.length; i++) { rows[i].classList.remove('hidden'); }
      searchKeys.forEach(function (k) { k.classList.remove('hidden'); });
      var old = searchKeyboard.querySelectorAll('.kb-row-num');
      for (var o = 0; o < old.length; o++) { old[o].classList.add('hidden'); }
      return;
    }
    for (var r = 0; r < rows.length; r++) { rows[r].classList.add('hidden'); }
    if (!searchKeyboard.querySelector('.kb-row-num')) {
      var digits = [['1', '2', '3', '4', '5', '6', '7'], ['8', '9', '0', ' ']];
      for (var d = 0; d < digits.length; d++) {
        var row = el('div', 'kb-row kb-row-num');
        row.style.top = (264 + d * 88.5) + 'px';
        for (var c = 0; c < digits[d].length; c++) {
          var key = el('div', 'kb-key focusable' + (digits[d][c] === ' ' ? ' space' : ''),
            digits[d][c] === ' ' ? '' : digits[d][c]);
          key._activate = (function (ch) {
            return function () { setSearchQuery(state.searchQuery + ch); };
          })(digits[d][c]);
          row.appendChild(key);
        }
        searchKeyboard.appendChild(row);
      }
    }
    var numRows = searchKeyboard.querySelectorAll('.kb-row-num');
    for (var n = 0; n < numRows.length; n++) { numRows[n].classList.remove('hidden'); }
  }

  /* ============================================================== SETTINGS */
  function buildSettings() {
    settingsMenu = $('settings-menu');
    settingsRight = $('settings-right');
    clear(settingsMenu); clear(settingsRight);

    settingsItems = [];
    for (var i = 0; i < SETTINGS_ITEMS.length; i++) {
      var item = el('div', 'settings-item focusable');
      item.innerHTML = '<span class="settings-icon">' + (SETTINGS_MENU_ICONS[SETTINGS_ITEMS[i].id] || '') + '</span>' +
        '<span class="settings-label">' + SETTINGS_ITEMS[i].label + '</span>';
      item._index = i;
      item._activate = (function (idx) {
        return function () { showSettingsPanel(idx, true); };
      })(i);
      item._onMove = function (dir) {
        if (dir === 'right') {
          var f = firstIn(settingsRight.querySelector('.settings-panel.is-active'));
          if (f) { setFocus(f); }
          return true;
        }
        return false;
      };
      settingsMenu.appendChild(item);
      settingsItems.push(item);
    }

    settingsPanels = {};
    settingsPanels.profile = buildProfilePanel();
    settingsPanels.history = buildHistoryPanel();
    settingsPanels.share = buildSharePanel();
    settingsPanels.playback = buildPlaybackPanel();
    settingsPanels.netdiag = buildNetdiagPanel();
    settingsPanels.parent = buildParentPanel();
    settingsPanels.feedback = buildFeedbackPanel();
    settingsPanels.about = buildAboutPanel();

    for (var k in settingsPanels) {
      if (settingsPanels.hasOwnProperty(k)) { settingsRight.appendChild(settingsPanels[k]); }
    }
  }

  function openSettings() {
    if (!settingsMenu) { buildSettings(); }
    showScreen('settings');
    showSettingsPanel(0, false);
    setFocus(settingsItems[0]);
  }

  function showSettingsPanel(index, focus) {
    var activeId = (SETTINGS_ITEMS[index] && SETTINGS_ITEMS[index].id) || 'profile';
    var settingsScreen = $('screen-settings');
    if (settingsScreen) { settingsScreen.classList.toggle('is-history-view', activeId === 'history'); }
    if (activeId === 'profile' && settingsPanels.profile && settingsRight) {
      var refreshedProfile = buildProfilePanel();
      settingsRight.replaceChild(refreshedProfile, settingsPanels.profile);
      settingsPanels.profile = refreshedProfile;
    } else if (activeId === 'history' && settingsPanels.history && settingsRight) {
      var refreshedHistory = buildHistoryPanel();
      settingsRight.replaceChild(refreshedHistory, settingsPanels.history);
      settingsPanels.history = refreshedHistory;
    } else if (activeId === 'netdiag' && settingsPanels.netdiag && settingsPanels.netdiag._ensureDiag) {
      settingsPanels.netdiag._ensureDiag();
    }
    for (var i = 0; i < settingsItems.length; i++) {
      settingsItems[i].classList.toggle('is-selected', i === index);
    }
    for (var k in settingsPanels) {
      if (settingsPanels.hasOwnProperty(k)) {
        settingsPanels[k].classList.toggle('is-active', k === activeId);
      }
    }
    if (focus) {
      var f = firstIn(settingsPanels[activeId]);
      /* Panels such as "Sobre nosotros" have no focusable control. In that
         case keep the focus on the selected menu entry instead of leaving a
         different, unrelated entry highlighted. */
      setFocus(f || settingsItems[index]);
    }
  }

  function panelBase(title) {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'sp-title', title));
    return p;
  }

  function buildPlaybackPanel() {
    var p = panelBase('Configuración global de reproducción');
    p.appendChild(el('div', 'sp-hr'));

    p.appendChild(el('div', 'sp-global-note', 'Estas preferencias se aplican automáticamente a todas las películas y series nuevas.'));
    addOptionRow(p, 198, 'Reproductor', ['Normal (directo)', 'Modo fluido'],
      'streamMode', state.playback.streamMode === 'smooth' ? 1 : 0);
    addOptionRow(p, 307, 'Formato de pantalla', ['Pantalla completa', 'Normal', '16:9', '4:3'],
      'screen', state.playback.screen);
    addOptionRow(p, 416, 'Audio preferido', ['Español', 'Portugués', 'Inglés'],
      'audio', state.playback.audio);

    p.appendChild(abs(el('div', 'sp-hr'), 0, 535, 1498, 1));
    p.appendChild(el('div', 'sp-subtitle-h', 'Subtitulos'));
    var sw = el('div', 'sp-switch focusable ' + (state.playback.subtitle ? 'on' : 'off'));
    sw._activate = function () {
      state.playback.subtitle = !state.playback.subtitle;
      sw.className = 'sp-switch focusable ' + (state.playback.subtitle ? 'on' : 'off');
      saveGlobalPlayback();
      setFocus(sw);
    };
    p.appendChild(sw);

    addOptionRow(p, 680, 'Idioma', ['Español', 'Portugués', 'Inglés'],
      'subLang', state.playback.subLang);
    addOptionRow(p, 793, 'Tamaño', ['Normal', 'Grande', 'Pequeño'],
      'size', state.playback.size);
    addStyleRow(p, 906);
    return p;
  }

  function addOptionRow(panel, top, label, options, group, selected) {
    var row = el('div', 'pb-row');
    row.style.top = top + 'px';
    row.appendChild(el('div', 'pb-label', label));
    for (var i = 0; i < options.length; i++) {
      var opt = el('div', 'pb-opt focusable' + (i === selected ? ' is-checked' : ''));
      opt.style.marginLeft = (i === 0 ? 0 : 28) + 'px';
      opt.appendChild(el('div', 'radio'));
      opt.appendChild(el('span', null, options[i]));
      opt._group = group;
      opt._index = i;
      opt._activate = function () {
        if (this._group === 'streamMode') {
          state.playback.streamMode = this._index === 1 ? 'smooth' : 'normal';
          /* A deliberate global choice supersedes temporary per-title
             overrides from this session. */
          smoothModeByTitle = {};
          if (state.playerItem) { restoreSmoothMode(state.playerItem); }
        } else {
          state.playback[this._group] = this._index;
        }
        applyGlobalPlaybackPreferences();
        saveGlobalPlayback();
        var opts = panel.querySelectorAll('.pb-opt');
        for (var o = 0; o < opts.length; o++) {
          if (opts[o]._group === this._group) {
            opts[o].classList.toggle('is-checked', opts[o]._index === this._index);
          }
        }
      };
      row.appendChild(opt);
    }
    panel.appendChild(row);
  }

  function addStyleRow(panel, top) {
    var row = el('div', 'pb-row');
    row.style.top = top + 'px';
    row.appendChild(el('div', 'pb-label', 'Estilo'));
    var colors = ['#ffffff', '#f6e33f', '#ffffff'];
    for (var i = 0; i < 3; i++) {
      var opt = el('div', 'pb-opt focusable' + (i === state.playback.style ? ' is-checked' : ''));
      opt.style.marginLeft = (i === 0 ? 0 : 28) + 'px';
      opt.appendChild(el('div', 'radio'));
      var aa = el('span', null, 'Aa');
      aa.style.color = colors[i];
      if (i === 2) {
        aa.style.background = '#000000';
        aa.style.display = 'inline-block';
        aa.style.width = '94px';
        aa.style.height = '50px';
        aa.style.lineHeight = '50px';
        aa.style.fontSize = '28px';
      }
      opt.appendChild(aa);
      opt._group = 'style';
      opt._index = i;
      opt._activate = function () {
        state.playback.style = this._index;
        applyGlobalPlaybackPreferences();
        saveGlobalPlayback();
        var opts = panel.querySelectorAll('.pb-opt');
        for (var o = 0; o < opts.length; o++) {
          if (opts[o]._group === 'style') {
            opts[o].classList.toggle('is-checked', opts[o]._index === this._index);
          }
        }
      };
      row.appendChild(opt);
    }
    panel.appendChild(row);
  }

  function buildProfilePanel() {
    var p = el('div', 'settings-panel account-panel');
    var avatar = el('div', 'account-avatar');
    avatar.innerHTML = SETTINGS_MENU_ICONS.profile;
    p.appendChild(avatar);
    p.appendChild(el('div', 'account-number', localProfile.id));
    p.appendChild(el('div', 'account-type', 'Perfil local de este televisor'));
    var summary = el('div', 'account-card');
    summary.appendChild(el('div', 'account-card-title', 'Tu cuenta está lista'));
    summary.appendChild(el('div', 'account-card-text', 'Las preferencias, el historial y el capítulo que estabas viendo se guardan automáticamente en este TV.'));
    p.appendChild(summary);
    var goHistory = el('div', 'account-history-btn focusable', 'Ver mi lista');
    goHistory._activate = function () { showSettingsPanel(1, true); };
    p.appendChild(goHistory);
    var privacy = el('div', 'account-card account-card-small');
    privacy.appendChild(el('div', 'account-card-title', 'Sin registro ni contraseña'));
    privacy.appendChild(el('div', 'account-card-text', 'Este perfil no envía tus datos a ningún servidor.'));
    p.appendChild(privacy);
    return p;
  }

  function buildHistoryPanel() {
    var p = el('div', 'settings-panel history-panel');
    var tabs = el('div', 'history-tabs');
    var tabDefs = [
      { id: 'history', label: 'Historia' },
      { id: 'favs', label: 'Mi favoritos' }
    ];
    for (var t = 0; t < tabDefs.length; t++) {
      (function (tab) {
        var tabEl = el('div', 'history-tab focusable' + (historyViewTab === tab.id ? ' is-selected' : ''), tab.label);
        tabEl._activate = function () {
          historyViewTab = tab.id;
          showSettingsPanel(1, true);
        };
        tabs.appendChild(tabEl);
      })(tabDefs[t]);
    }
    p.appendChild(tabs);
    p.appendChild(el('div', 'history-rule'));

    var records = [];
    if (historyViewTab === 'history') {
      records = localProfile.history || [];
    } else if (historyViewTab === 'favs') {
      for (var v = 0; v < VOD.length; v++) {
        if (state.favs && state.favs[VOD[v].id]) {
          records.push({ id: VOD[v].id, title: VOD[v].title, poster: VOD[v].poster || VOD[v].cover, series: isSeriesItem(VOD[v]), position: 0 });
        }
      }
    }
    var total = el('div', 'history-total', 'Total ');
    total.appendChild(el('span', null, String(records.length)));
    p.appendChild(total);
    var grid = el('div', 'history-grid');
    if (!records.length) {
      grid.appendChild(el('div', 'history-grid-empty', 'No hay títulos para mostrar todavía.'));
    } else {
      for (var i = 0; i < records.length && i < 15; i++) {
        (function (record) {
          var card = el('div', 'history-card focusable');
          var img = document.createElement('img');
          img.className = 'history-poster';
          img.alt = '';
          img.src = record.poster || 'assets/original/common/bg_placehoder_vertical.png';
          card.appendChild(img);
          var progress = record.series ? ('Ya miró hasta ' + (record.episodeNumber ? ('epis. ' + record.episodeNumber) : 'un episodio')) : ('Ya miró hasta ' + formatTime(record.position || 0));
          card.appendChild(el('div', 'history-progress', progress));
          card.appendChild(el('div', 'history-card-title', record.title || 'Contenido'));
          card._activate = function () { openHistoryRecord(record); };
          grid.appendChild(card);
        })(records[i]);
      }
    }
    p.appendChild(grid);
    return p;
  }

  function buildSharePanel() {
    var p = panelBase('Compartir APP');
    p.appendChild(el('div', 'sp-hr'));
    p.appendChild(el('div', 'share-copy', 'Instala XuperTV en otro televisor desde tu propia IPK. El historial de este perfil permanece privado en este TV.'));
    return p;
  }

  function buildCrPanel() {
    var p = el('div', 'settings-panel');
    var head = el('div', 'cr-head');
    head.appendChild(el('span', 't', 'Contenido adulto'));
    var sw = el('div', 'sw focusable ' + (state.crOn ? 'on' : 'off'));
    sw._activate = function () {
      state.crOn = !state.crOn;
      sw.className = 'sw focusable ' + (state.crOn ? 'on' : 'off');
      setFocus(sw);
    };
    head.appendChild(sw);
    p.appendChild(head);

    p.appendChild(el('div', 'cr-tip', '(LIVE-18+，Explorar-Adult)'));
    var btn = el('div', 'cr-btn focusable', 'Cambiar contraseña de control parental');
    btn._activate = function () { /* password dialog not reconstructed */ };
    p.appendChild(btn);
    p.appendChild(el('div', 'cr-warn', 'Establecer contraseña para activar contenidos para adultos'));
    return p;
  }

  function buildParentPanel() {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'pl-title', 'Configuraciones del Control Parental'));
    p.appendChild(el('div', 'pl-tip', 'Ingrese la contraseña de cuatro dígitos e ingrese viendo el programa de bloqueo.'));
    p.appendChild(el('div', 'pl-label', 'Contraseña inicial:'));
    var boxes = el('div', 'pl-boxes');
    for (var i = 0; i < 4; i++) {
      var b = el('div', 'pl-box focusable');
      b._activate = function () { /* numeric capture not reconstructed */ };
      boxes.appendChild(b);
      if (i < 3) { boxes.appendChild(el('div', 'pl-sep')); }
    }
    p.appendChild(boxes);
    p.appendChild(el('div', 'pl-note', ''));
    var ok = el('div', 'pl-ok focusable', 'OK');
    ok._activate = function () { /* password validation not reconstructed */ };
    p.appendChild(ok);
    return p;
  }

  function buildFeedbackPanel() {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'fb-title', 'Ayuda y Feedback'));
    p.appendChild(el('div', 'fb-hr'));
    p.appendChild(el('div', 'fb-contact',
      'Si tiene alguna duda, puede ponerse en contacto con nosotros a través de los siguientes medios:'));
    p.appendChild(el('div', 'fb-qr-note', 'Escanee el código QR para enviar sugerencias o comentarios.'));
    var qr = el('div', 'fb-qr');
    p.appendChild(qr);
    var help = el('div', 'fb-help focusable', 'Ayuda');
    help._activate = function () { /* help center not reconstructed */ };
    p.appendChild(help);
    return p;
  }

  function buildUpgradePanel() {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'sp-title plain', 'Settings'));
    p.appendChild(abs(el('div', 'sp-hr soft'), 0, 165, 1498, 1));

    var cache = el('div', 'sp-card');
    abs(cache, 30, 198, 1360, 461);
    cache.appendChild(el('h3', null, 'Limpiar cache'));
    var rows = [
      { y: 139, label: 'Historia' },
      { y: 246, label: 'Cache de foto' },
      { y: 353, label: 'Limpiar todos' }
    ];
    for (var i = 0; i < rows.length; i++) {
      var row = el('div', 'sp-clear-row');
      row.style.top = rows[i].y + 'px';
      row.appendChild(el('span', 'lbl', rows[i].label));
      var btn = el('div', 'btn focusable', 'Limpiar');
      btn._activate = function () { /* cache clearing not implemented */ };
      row.appendChild(btn);
      cache.appendChild(row);
    }
    p.appendChild(cache);

    var upd = el('div', 'sp-card');
    abs(upd, 30, 689, 1360, 291);
    upd.appendChild(el('h3', null, 'Actualización'));
    var ver = el('div', 'sp-version', 'v4.34.4');
    upd.appendChild(ver);
    p.appendChild(upd);
    return p;
  }

  function buildAboutPanel() {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'sp-title plain', 'Sobre nosotros'));
    p.appendChild(abs(el('div', 'sp-hr soft'), 0, 165, 1498, 1));
    p.appendChild(el('div', 'sp-about-body',
      'Xuper TV se dedica a ofrecer a los usuarios una amplia variedad de recursos de alta calidad. ' +
      'Aquí encontrarás miles de películas, series, animes y canales en vivo, todo reunido en un solo lugar. ' +
      'Brindamos una experiencia estable, diversa y siempre actualizada, además de contenidos gratuitos para disfrutar.'));
    p.appendChild(el('div', 'sp-about-port', 'Port para LG webOS realizado por CristiancoDEV'));
    var mail = el('div', 'sp-about-mail');
    var ico = el('img');
    ico.src = 'assets/original/settings/vod_email_icon.png';
    ico.alt = '';
    mail.appendChild(ico);
    mail.appendChild(el('span', null, 'escuchamos-tv@outlook.com'));
    p.appendChild(mail);
    return p;
  }

  /* ------------------------------------------------------- network diagnostics
     Reads only: it asks the service for the local DNS answer and the DoH answer
     of every portal/CDN host and shows where the connection breaks.  The
     bypass itself lives in the service (dnsx.js) and needs no user action. */
  var netdiagState = { running: false, report: null, error: null, runId: 0 };
  var netdiagEnv = null;

  function netdiagStateText(host) {
    if (!host) { return 'Sin datos'; }
    switch (host.verdict) {
      case 'ok': return 'Correcto';
      case 'dns-distinto': return 'DNS alterado';
      case 'dns-local-falla': return 'Bloqueado';
      case 'sin-tcp': return 'Sin conexión';
      case 'tls-falla': return 'HTTPS falla';
      case 'sin-tiempo': return 'Sin respuesta';
      default: return 'Sin datos';
    }
  }

  function netdiagStateClass(host) {
    if (!host) { return ''; }
    if (host.verdict === 'ok') { return 'ok'; }
    if (host.verdict === 'dns-distinto' || host.verdict === 'dns-local-falla' ||
        host.verdict === 'sin-tiempo' || host.timeout) { return 'warn'; }
    return 'bad';
  }

  function netdiagSummary(verdict) {
    switch (verdict) {
      case 'ok':
        return { cls: 'ok', text: 'La conexión está bien: el catálogo y los servidores de vídeo responden.' };
      case 'dns-distinto':
        return { cls: 'warn', text: 'Tu operador devuelve direcciones distintas a las reales (bloqueo por DNS). La app ya las esquiva sola.' };
      case 'dns-local-falla':
        return { cls: 'warn', text: 'Tu operador bloquea el DNS del televisor (no devuelve estos dominios). La app ya lo esquiva con su DNS seguro.' };
      case 'doh-sin-respuesta':
        return { cls: 'bad', text: 'El DNS seguro no devolvió respuesta. Revisa la conexión del televisor.' };
      case 'doh-bloqueado':
        return { cls: 'bad', text: 'La red bloquea el DNS seguro (Cloudflare y Google por HTTPS).' };
      case 'sin-salida':
        return { cls: 'bad', text: 'Los servidores no aceptan la conexión desde esta red.' };
      case 'algun-servidor':
        return { cls: 'warn', text: 'Un servidor de vídeo no respondió (suele rotar). El resto del catálogo sí responde: vuelve a analizar.' };
      case 'incompleto':
        return { cls: 'warn', text: 'La prueba no terminó: la TV no recibió respuesta de ningún servidor a tiempo. Vuelve a analizar; si se repite, apaga y enciende la TV.' };
      case 'servicio-sin-respuesta':
        return { cls: 'bad', text: 'El servicio de fondo no respondió. El reporte indica si fue el servicio completo o solo el diagnóstico.' };
      default:
        return { cls: '', text: 'Sin resultado todavía.' };
    }
  }

  function renderNetdiag(summary, list, report) {
    clear(list);
    var summaryInfo = netdiagSummary(report.verdict);
    summary.textContent = summaryInfo.text;
    summary.className = 'dg-summary' + (summaryInfo.cls ? ' ' + summaryInfo.cls : '');

    var hosts = report.hosts || [];
    for (var i = 0; i < hosts.length; i++) {
      var host = hosts[i];
      var row = el('div', 'dg-row ' + netdiagStateClass(host));
      var ips = (host.doh && host.doh.ok && host.doh.ips.length) ? host.doh.ips : (host.system.ips || []);
      var local = (host.system && host.system.ok) ? host.system.ips.join(', ') : 'sin respuesta';
      row.appendChild(el('span', 'dg-host', host.host));
      row.appendChild(el('span', 'dg-local', local));
      row.appendChild(el('span', 'dg-state', netdiagStateText(host)));
      row.appendChild(el('span', 'dg-ip', ips.join(', ')));
      list.appendChild(row);
    }

    var providers = report.providers || [];
    var okProviders = [];
    var badProviders = [];
    for (var p = 0; p < providers.length; p++) {
      if (providers[p].reachable) { okProviders.push(providers[p].ip); }
      else { badProviders.push(providers[p].ip); }
    }
    var providersKnown = providers.length > 0;
    var dnsRow = el('div', 'dg-row dns');
    dnsRow.appendChild(el('span', 'dg-host', 'DNS seguro (DoH)'));
    dnsRow.appendChild(el('span', 'dg-local', providersKnown ? (okProviders.length + '/' + providers.length + ' disponibles') : 'sin datos'));
    dnsRow.appendChild(el('span', 'dg-state', providersKnown ? (okProviders.length ? 'Correcto' : 'Bloqueado') : 'No evaluado'));
    dnsRow.appendChild(el('span', 'dg-ip', okProviders.join(', ')));
    if (!providersKnown) { dnsRow.className = 'dg-row dns warn'; }
    else if (okProviders.length) { dnsRow.className = 'dg-row dns ok'; }
    else { dnsRow.className = 'dg-row dns bad'; }
    list.appendChild(dnsRow);

    /* ── Codec row ─────────────────────────────────────────────────────── */
    var codec = report.codec || {};
    /* canPlayType() is unreliable on several Starfish/webOS builds: it may
       return an empty string even when native playback works. It is evidence
       about the browser API only, never a verdict about the TV hardware. */
    var codecKnown = !!(codec.h264 || codec.hevc || codec.hls);
    var codecRow = el('div', 'dg-row' + (codecKnown ? ' ok' : ' warn'));
    var codecDesc = [
      'H.264: ' + (codec.h264 || 'no informado'),
      'HEVC: '  + (codec.hevc || 'no informado'),
      'HLS: '   + (codec.hls  || 'no informado')
    ].join('  ');
    codecRow.appendChild(el('span', 'dg-host', 'Códec'));
    codecRow.appendChild(el('span', 'dg-local', ''));
    codecRow.appendChild(el('span', 'dg-state', codecKnown ? 'Informado' : 'No confirmado'));
    codecRow.appendChild(el('span', 'dg-ip', codecDesc));
    list.appendChild(codecRow);

    /* ── Layer rows: portal / sesión / live / VOD ───────────────────── */
    var layers = report.layers || {};
    var layerDefs = [
      { key: 'portal',  label: 'Portal' },
      { key: 'session', label: 'Sesión' },
      { key: 'live',    label: 'Live CDN' },
      { key: 'vod',     label: 'VOD CDN' }
    ];
    var liveFail = false;
    var vodFail = false;
    for (var li = 0; li < layerDefs.length; li++) {
      var ldef = layerDefs[li];
      var ldata = layers[ldef.key];
      if (!ldata) { continue; }
      /* A probe that hit the deadline proves nothing about the carrier: it must
         not be reported as a block, only as "no answer". */
      if (ldef.key === 'live' && !ldata.ok && !ldata.timeout) { liveFail = true; }
      if (ldef.key === 'vod' && !ldata.ok && !ldata.timeout) { vodFail = true; }
      var lrow = el('div', 'dg-row ' + (ldata.ok ? 'ok' : (ldata.timeout ? 'warn' : 'bad')));
      var ldesc = ldata.error || (ldata.status ? 'HTTP ' + ldata.status : (ldata.ok ? 'OK' : 'Error'));
      if (ldef.key === 'session') {
        ldesc = 'userId ' + (ldata.userId || '?') + '  token ' + (ldata.token || '?');
      }
      var lms = ldata.ms ? (' ' + ldata.ms + ' ms') : '';
      lrow.appendChild(el('span', 'dg-host', ldef.label));
      lrow.appendChild(el('span', 'dg-local', ''));
      lrow.appendChild(el('span', 'dg-state', ldata.ok ? 'OK' : (ldata.timeout ? 'Sin respuesta' : 'Error')));
      lrow.appendChild(el('span', 'dg-ip', ldesc + lms));
      list.appendChild(lrow);
    }

    /* A green DNS test with dead media CDNs is the classic carrier block:
       the operator answers DNS but drops the video hosts by IP or TLS SNI.
       Without this override the viewer reads "todo bien" and still sees a
       black screen, which is exactly the report we get from Chile/Colombia. */
    if (summaryInfo.cls === 'ok' && (liveFail || vodFail)) {
      var broken = (liveFail && vodFail) ? 'los canales en vivo y las películas'
        : (liveFail ? 'los canales en vivo' : 'las películas');
      summaryInfo = {
        cls: 'bad',
        text: 'El DNS responde bien, pero ' + broken + ' no se pueden abrir: ' +
          'tu operador bloquea las direcciones de vídeo (bloqueo por IP/SNI). ' +
          'Ese bloqueo no se arregla desde la app; hace falta una VPN en el router.'
      };
      summary.textContent = summaryInfo.text;
      summary.className = 'dg-summary ' + summaryInfo.cls;
    }

    if (report.partial && summaryInfo.cls !== 'bad') {
      summary.textContent += ' (La prueba no terminó a tiempo: vuelve a analizar.)';
    }

    if (netdiagEnv) {
      var s = report.screen || {};
      var parts = [];
      if (s.w && s.h) { parts.push('Pantalla ' + s.w + '×' + s.h); }
      if (s.panelW && s.panelH) { parts.push('panel ' + s.panelW + '×' + s.panelH); }
      if (s.scale) { parts.push('escala ' + (Math.round(s.scale * 100) / 100)); }
      if (report.version) { parts.push('versión ' + report.version); }
      netdiagEnv.textContent = parts.join(' · ');
    }
  }

  function reportSafeText(value) {
    /* A support photo must never expose a playable URL, signed query, token or
       request header. Keep only a short, human-readable error classification. */
    var text = String(value == null ? '' : value);
    text = text.replace(/https?:\/\/[^\s"']+/ig, '[URL OCULTA]');
    text = text.replace(/(token|signature|authorization|cookie|key)=?[^\s,&]*/ig, '$1=[OCULTO]');
    text = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
    return text.slice(0, 150);
  }

  function layerReportState(layer) {
    if (!layer) { return 'sin datos'; }
    if (layer.ok) { return layer.status ? ('OK (HTTP ' + layer.status + ')') : 'OK'; }
    if (layer.timeout) { return 'sin respuesta'; }
    return 'error' + (layer.error ? (': ' + reportSafeText(layer.error)) : '');
  }

  function buildSupportReport(report) {
    var lines = [];
    var env = report.screen || {};
    var layers = report.layers || {};
    var hosts = report.hosts || [];
    lines.push('REPORTE DE SOPORTE XUPERTV');
    lines.push('Versión: ' + (report.version || 'desconocida'));
    lines.push('Pantalla: ' + ((env.w && env.h) ? (env.w + '×' + env.h) : 'sin datos') +
      ((env.panelW && env.panelH) ? (' | panel ' + env.panelW + '×' + env.panelH) : '') +
      (env.scale ? (' | escala ' + env.scale) : ''));
    lines.push('Red: ' + (report.verdict || 'sin resultado') + (report.partial ? ' (parcial)' : ''));
    if (report.pending) { lines.push('Diagnóstico: sin respuesta / detenido para generar este reporte'); }
    if (report.serviceError) { lines.push('Servicio: ' + reportSafeText(report.serviceError)); }
    lines.push('Portal: ' + layerReportState(layers.portal));
    lines.push('Sesión: ' + layerReportState(layers.session));
    lines.push('TV en vivo: ' + layerReportState(layers.live));
    lines.push('Películas/series: ' + layerReportState(layers.vod));
    lines.push('Reproductor: ' + (state.playerMode || 'sin reproducción') +
      ' | modo ' + (state.streamMode || 'normal') +
      (state.streamError ? (' | error ' + reportSafeText(state.streamError)) : ''));
    for (var i = 0; i < hosts.length && i < 5; i++) {
      lines.push('Host ' + (i + 1) + ': ' + reportSafeText(hosts[i].host) +
        ' — ' + reportSafeText(hosts[i].verdict || 'sin datos'));
    }
    lines.push('');
    lines.push('Privacidad: este reporte no incluye enlaces, tokens, cabeceras ni historial.');
    lines.push('Toma una foto de esta pantalla y envíala al soporte.');
    return lines.join('\n');
  }

  function showSupportReport(summary, list) {
    if (!netdiagState.report) {
      /* A frozen service must not prevent a user from contacting support.
         Stop only this UI run and make a report from the known local facts. */
      netdiagState.runId++;
      netdiagState.running = false;
      var vp = window.__xuperViewport || {};
      netdiagState.report = {
        version: (document.querySelector('.welcome-version') || {}).textContent || 'desconocida',
        verdict: 'sin respuesta', partial: true, pending: true,
        screen: { w: vp.w || 0, h: vp.h || 0, scale: vp.scale || 0,
          panelW: vp.panelW || 0, panelH: vp.panelH || 0 },
        layers: {}, hosts: []
      };
    }
    clear(list);
    var report = el('div', 'dg-report', buildSupportReport(netdiagState.report));
    list.appendChild(report);
    summary.className = 'dg-summary ok';
    summary.textContent = 'Reporte listo. Toma una foto de esta pantalla y envíala al soporte.';
  }

  function runNetdiag(button, summary, list) {
    if (!window.PalmServiceBridge) {
      netdiagState.running = false;
      netdiagState.report = {
        version: 'HTML', verdict: 'web', partial: true,
        serviceError: 'El diagnóstico de red detallado requiere el servicio nativo webOS.',
        screen: { w: window.innerWidth || 0, h: window.innerHeight || 0 },
        layers: {}, hosts: [], providers: []
      };
      button.textContent = 'Analizar de nuevo';
      renderNetdiag(summary, list, netdiagState.report);
      return;
    }
    /* Settings can be rebuilt while a slow TV still has a diagnostic request
       open. Give the new visible panel its own run and ignore the old reply;
       otherwise the reply paints an already-detached panel and viewers see
       an apparently empty Diagnóstico screen. */
    var runId = netdiagState.runId + 1;
    netdiagState.runId = runId;
    netdiagState.running = true;
    netdiagState.error = null;
    button.textContent = 'Analizando…';
    summary.className = 'dg-summary';
    summary.textContent = 'Consultando el DNS del televisor, el DNS seguro y los servidores…';
    clear(list);
    /* The list must never look empty while the test runs: some TVs take a while
       and "nothing happened" is the report we keep getting. */
    list.appendChild(el('div', 'dg-row', 'Analizando…'));

    function localFailure(reason) {
      if (netdiagState.runId !== runId || !netdiagState.running) { return; }
      netdiagState.running = false;
      /* Ignore the late callback from the request that just timed out. */
      netdiagState.runId++;
      netdiagState.report = {
        version: (document.querySelector('.welcome-version') || {}).textContent || 'desconocida',
        verdict: 'servicio-sin-respuesta', partial: true, serviceError: reason,
        screen: (function () {
          var vp = window.__xuperViewport || {};
          return { w: vp.w || 0, h: vp.h || 0, scale: vp.scale || 0,
            panelW: vp.panelW || 0, panelH: vp.panelH || 0 };
        })(),
        layers: {}, hosts: [], providers: []
      };
      button.textContent = 'Analizar de nuevo';
      renderNetdiag(summary, list, netdiagState.report);
    }

    /* First prove that Luna can reach our service. This is deliberately tiny
       and local: it distinguishes a missing/blocked service from a network
       diagnostic that itself is slow, instead of leaving a blank spinner. */
    /* Allow up to 25 seconds for the Node.js service to cold-boot on slower
       dual-core TVs (webOS 3.5 / 2017 models like LJ550 need 8-12 seconds). */
    var pingDone = false;
    var pingTimer = setTimeout(function () {
      if (!pingDone) { pingDone = true; localFailure('ping no respondió en 25 segundos (el servicio no arrancó)'); }
    }, 25000);
    portalServiceCall('ping', {}, function (pingError, pingPayload) {
      if (pingDone) { return; }
      pingDone = true;
      clearTimeout(pingTimer);
      if (pingError || !pingPayload) {
        localFailure('ping falló: ' + reportSafeText(pingError || 'sin respuesta'));
      }
    }, 24000);

    /* Two safety nets: one explains a slow network, the other gives the button
       back if the service never answers at all. */
    var slowTimer = setTimeout(function () {
      if (!netdiagState.running || netdiagState.runId !== runId) { return; }
      summary.textContent = 'Analizando… tu red está respondiendo lento, espera un momento.';
    }, 9000);
    var guardTimer = setTimeout(function () {
      if (!netdiagState.running || netdiagState.runId !== runId) { return; }
      localFailure('ping respondió, pero netdiag no devolvió resultado en 32 segundos');
    }, 32000);

    portalServiceCall('netdiag', (function () {
      var vp = window.__xuperViewport || {};
      var vid = playerVideo || document.querySelector('video');
      function cp(t) { return vid ? (vid.canPlayType(t) || '') : ''; }
      return {
        screenW: vp.w || 0, screenH: vp.h || 0, screenScale: vp.scale || 0,
        panelW: vp.panelW || 0, panelH: vp.panelH || 0,
        codecH264: cp('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
        codecHEVC: cp('video/mp4; codecs="hvc1.1.6.L93.B0"'),
        codecHLS:  cp('application/x-mpegURL'),
        /* Last real CDN URLs so the service can prove whether the carrier
           drops live/VOD by IP or SNI even when DNS looks perfect. */
        liveUrl: (lastCdnProbe.live && lastCdnProbe.live.url) || '',
        liveHeaders: (lastCdnProbe.live && lastCdnProbe.live.headers) || {},
        vodUrl: (lastCdnProbe.vod && lastCdnProbe.vod.url) || '',
        vodHeaders: (lastCdnProbe.vod && lastCdnProbe.vod.headers) || {}
      };
    })(), function (error, payload) {
      if (netdiagState.runId !== runId) { return; }
      clearTimeout(slowTimer);
      clearTimeout(guardTimer);
      netdiagState.running = false;
      button.textContent = 'Analizar de nuevo';
      if (button.parentNode && button.parentNode.className.indexOf('is-active') !== -1) { setFocus(button); }
      if (error || !payload) {
        netdiagState.error = error || 'sin respuesta';
        summary.className = 'dg-summary bad';
        var errMsg = String(error || '');
        if (/denied|permission|not permitted|bloqueado el servicio/i.test(errMsg)) {
          summary.textContent = SERVICE_BLOCKED_HINT;
        } else if (/exist|not found|no disponible/i.test(errMsg)) {
          summary.textContent = 'El servicio de fondo no está instalado en la TV. Reinstala la app usando el instalador .bat';
        } else if (/timeout|tiempo|espera/i.test(errMsg)) {
          summary.textContent = 'Tiempo de espera agotado. La conexión es muy lenta o el DNS de tu operador no responde.';
        } else {
          summary.textContent = 'No se pudo ejecutar la prueba (' + (errMsg || 'el servicio no respondió') + ').';
        }
        return;
      }
      netdiagState.report = payload;
      renderNetdiag(summary, list, payload);
    }, 45000);
  }

  function buildNetdiagPanel() {
    var p = panelBase('Diagnóstico de red');
    p.appendChild(el('div', 'dg-note',
      'Comprueba si tu operador de internet está bloqueando los servidores de XuperTV. ' +
      'La app ya usa un DNS seguro (DNS-over-HTTPS) para evitarlo; esta prueba solo lo muestra.'));
    p.appendChild(abs(el('div', 'sp-hr'), 0, 216, 1478, 1));

    var button = el('div', 'dg-btn focusable', 'Analizar red');
    abs(button, 52, 242, 330, 66);
    var reportButton = el('div', 'dg-btn dg-report-btn focusable', 'Generar reporte');
    abs(reportButton, 400, 242, 330, 66);
    var summary = el('div', 'dg-summary', 'Pulsa "Analizar red" para empezar.');
    abs(summary, 750, 242, 676, 66);

    var head = el('div', 'dg-head');
    abs(head, 52, 336, 1380, 40);
    head.appendChild(el('span', 'dg-host', 'Dominio'));
    head.appendChild(el('span', 'dg-local', 'DNS del televisor'));
    head.appendChild(el('span', 'dg-state', 'Estado'));
    head.appendChild(el('span', 'dg-ip', 'Dirección real (DNS seguro)'));

    var list = el('div', 'dg-list');
    abs(list, 52, 378, 1380, 450);

    var envLine = el('div', 'dg-env', '');
    abs(envLine, 52, 832, 1380, 32);
    netdiagEnv = envLine;

    var foot = el('div', 'dg-foot',
      'Si el estado dice "Bloqueado", tu operador está interceptando el nombre del servidor, pero la app ya conecta por la dirección real. ' +
      'El reproductor Normal y el Modo Fluido usan este mismo DNS seguro. ' +
      'Si el vídeo sigue sin abrir con la conexión en verde, el bloqueo es por dirección: hace falta un túnel (VPN local).');
    abs(foot, 52, 872, 1380, 150);

    button._activate = function () { runNetdiag(button, summary, list); };
    reportButton._activate = function () { showSupportReport(summary, list); };
    /* Opening the panel runs the test once: the people who need it are not
       going to press a button they do not understand. */
    p._ensureDiag = function () {
      if (netdiagState.report) {
        renderNetdiag(summary, list, netdiagState.report);
        return;
      }
      runNetdiag(button, summary, list);
    };

    p.appendChild(button);
    p.appendChild(reportButton);
    p.appendChild(summary);
    p.appendChild(head);
    p.appendChild(list);
    p.appendChild(envLine);
    p.appendChild(foot);
    return p;
  }

  function buildPendingPanel(title, text) {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'sp-title', title));
    p.appendChild(el('div', 'sp-hr'));
    p.appendChild(el('div', 'sp-pending', text));
    return p;
  }

  /* ================================================================ PLAYER */
  /* The player controller hides itself after a few seconds without input.
     The constant is not exposed in the decoded resources; 5000 ms is used
     until it can be measured on the running app (WSA/Android TV). */
  var INFO_HIDE_MS = 5000;
  var osdHideTimer = null;

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function durationToSeconds(value) {
    if (typeof value === 'number' && isFinite(value) && value > 0) { return value; }
    if (typeof value !== 'string') { return 0; }
    var str = value.trim();
    if (!str || str === '—' || str === '-') { return 0; }

    var hMatch = str.match(/(\d+)\s*h(?:our|ora|s)?/i);
    var mMatch = str.match(/(\d+)\s*m(?:in|uto|s)?/i);
    var sMatch = str.match(/(\d+)\s*s(?:ec|eg)?/i);
    if (hMatch || mMatch || sMatch) {
      var h = hMatch ? parseInt(hMatch[1], 10) : 0;
      var m = mMatch ? parseInt(mMatch[1], 10) : 0;
      var s = sMatch ? parseInt(sMatch[1], 10) : 0;
      return (h * 3600) + (m * 60) + s;
    }

    if (str.indexOf(':') !== -1) {
      var parts = str.split(':');
      if (parts.length === 2) {
        var p0 = Number(parts[0]);
        var p1 = Number(parts[1]);
        if (isFinite(p0) && isFinite(p1) && p0 >= 0 && p1 >= 0) {
          return (p0 * 60) + p1;
        }
      } else if (parts.length === 3) {
        var p0 = Number(parts[0]);
        var p1 = Number(parts[1]);
        var p2 = Number(parts[2]);
        if (isFinite(p0) && isFinite(p1) && isFinite(p2) && p0 >= 0 && p1 >= 0 && p2 >= 0) {
          return (p0 * 3600) + (p1 * 60) + p2;
        }
      }
    }

    var num = Number(str);
    if (isFinite(num) && num > 0) {
      return num;
    }
    return 0;
  }

  var vodProgressInterval = null;
  function startVodProgressTicker() {
    stopVodProgressTicker();
    vodProgressInterval = setInterval(function () {
      if (state.screen === 'player' && state.playerMode === 'vod' && playerVideo && !playerVideo.paused) {
        var cur = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
        var vidDur = (playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0) ? playerVideo.duration : 0;
        var epDur = (state.playerEpisode && state.playerEpisode.duration) ? durationToSeconds(state.playerEpisode.duration) : 0;
        var itemDur = (state.playerItem && state.playerItem.duration) ? durationToSeconds(state.playerItem.duration) : 0;
        var totalDur = vidDur || epDur || itemDur || 0;
        updateVodProgress(cur, totalDur);
        updateSubtitleDisplay(cur);
        rememberWatchProgress(cur, totalDur);
      }
    }, 500);
  }
  function stopVodProgressTicker() {
    if (vodProgressInterval) {
      clearInterval(vodProgressInterval);
      vodProgressInterval = null;
    }
  }

  function updateVodProgress(current, duration) {
    if (!vodTimeCurrent || !vodTimeTotal || !vodSeekProgress) { return; }
    if (vodScrubbing) { current = vodScrubTime; }
    var knownDuration = durationToSeconds(duration);
    if (!knownDuration && state.playerEpisode && state.playerEpisode.duration) {
      knownDuration = durationToSeconds(state.playerEpisode.duration);
    }
    if (!knownDuration && state.playerItem && state.playerItem.duration) {
      knownDuration = durationToSeconds(state.playerItem.duration);
    }
    if (!knownDuration && playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0) {
      knownDuration = playerVideo.duration;
    }
    if (!knownDuration && activeSubtitleCues && activeSubtitleCues.length) {
      var lastCue = activeSubtitleCues[activeSubtitleCues.length - 1];
      if (lastCue && lastCue.end > 0) {
        knownDuration = Math.round(lastCue.end + 60);
      }
    }

    current = Number(current) || 0;
    vodTimeCurrent.textContent = formatTime(current);

    if (!knownDuration || knownDuration <= 0) {
      var isSeries = isSeriesItem(state.playerItem);
      knownDuration = isSeries ? 2700 : 6300;
      if (current > knownDuration) {
        knownDuration = Math.round(current * 1.15);
      }
    }

    vodTimeTotal.textContent = formatTime(knownDuration);
    var pct = Math.min(100, Math.max(0, (current / knownDuration) * 100));
    vodSeekProgress.style.width = pct.toFixed(2) + '%';
    if (vodSeekThumb) {
      vodSeekThumb.style.left = pct.toFixed(2) + '%';
    }
    if (playerVideo && playerVideo.buffered && playerVideo.buffered.length > 0) {
      try {
        var bufEnd = playerVideo.buffered.end(playerVideo.buffered.length - 1);
        if (relayBaseUrl) { bufEnd += relayStartOffset; }
        var bufPct = Math.min(100, Math.max(0, (bufEnd / knownDuration) * 100));
        if (vodSeekBuffered) { vodSeekBuffered.style.width = bufPct.toFixed(2) + '%'; }
      } catch (eB) { /* ignore */ }
    }
  }


  function showOsdIcon(type) {
    if (!playerOsdIcon) { playerOsdIcon = $('player-osd-icon'); }
    if (!playerOsdIcon) { return; }
    if (osdHideTimer) { clearTimeout(osdHideTimer); osdHideTimer = null; }
    if (type === 'pause') {
      playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_pause.png)';
      playerOsdIcon.classList.add('is-active');
    } else if (type === 'forward') {
      playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_forward.png)';
      playerOsdIcon.classList.add('is-active');
      osdHideTimer = setTimeout(function () {
        playerOsdIcon.classList.remove('is-active');
      }, 900);
    } else if (type === 'backward') {
      playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_backward.png)';
      playerOsdIcon.classList.add('is-active');
      osdHideTimer = setTimeout(function () {
        playerOsdIcon.classList.remove('is-active');
      }, 900);
    } else {
      playerOsdIcon.classList.remove('is-active');
    }
  }

  function playerSeek(delta) {
    if (!playerVideo) { return; }
    var dur = playerVideo.duration;
    if (isNaN(dur) || dur <= 0) {
      dur = 86400;
    }
    var cur = playerVideo.currentTime || 0;
    var target = Math.max(0, Math.min(dur, cur + delta));
    try {
      playerVideo.currentTime = target;
    } catch (eSk) { /* ignore */ }
    updateVodProgress(target, playerVideo.duration);
    showInfobar();
    showOsdIcon(delta > 0 ? 'forward' : 'backward');
  }

  function togglePlayerPlayPause() {
    if (!playerVideo) { return; }
    if (playerVideo.paused) {
      resumePlayerPlayback();
      showOsdIcon('none');
      showInfobar();
    } else {
      try {
        playerVideo.pause();
      } catch (eP2) {}
      showOsdIcon('pause');
      showInfobar();
    }
  }

  function scheduleInfoHide() {
    if (state.infoTimer) { clearTimeout(state.infoTimer); }
    state.infoTimer = setTimeout(function () {
      state.infoTimer = null;
      if (state.screen !== 'player' || state.channelsOpen) { return; }
      hideInfobar();
    }, INFO_HIDE_MS);
  }

  function showInfobar() {
    state.infobar = true;
    if (state.playerMode === 'vod') {
      if (playerVodInfo) { playerVodInfo.classList.add('is-active'); }
      if (playerInfo) { playerInfo.classList.remove('is-active'); }
    } else {
      if (playerInfo) { playerInfo.classList.add('is-active'); }
      if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
    }
    scheduleInfoHide();
  }

  function hideInfobar() {
    if (state.infoTimer) { clearTimeout(state.infoTimer); state.infoTimer = null; }
    state.infobar = false;
    if (playerInfo) { playerInfo.classList.remove('is-active'); }
    if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
  }

  function showVodInfobar() {
    showInfobar();
  }

  function hideVodInfobar() {
    hideInfobar();
  }

  /* --- PlaySettingView (Bottom Drawer) & SelectSubTitleAndAudioDialog Controller --- */
  var playSettingView = null;
  var dialogPlaySettings = null;
  var psvSecSelection = null;
  var psvEpisodesRow = null;
  var psvBtnConfig = null;
  var psvBtnP1 = null;
  var psvBtnP2 = null;
  var psvSecAudio = null;
  var psvSecQuality = null;
  var psvQualityRow = null;
  var psvSecAspect = null;
  var psvSecPlayer = null;
  var psvBtnFeedback = null;
  var psvAspectRow = null;

  /* Season/episode browser (in-player). */
  var psvBtnEpisodes = null;
  var episodeBrowser = null;
  var peTitle = null, peSub = null, peSeasons = null, peSeasonsCol = null,
      peEpisodes = null, peSeasonLabel = null;

  var dpsAudioOptions = null;
  var dpsSubSwitch = null;
  var dpsRowLang = null;
  var dpsRowSize = null;
  var dpsRowStyle = null;
  var dpsLangOptions = null;
  var dpsSizeOptions = null;
  var dpsStyleOptions = null;
  var dpsBtnExit = null;
  var playerSubtitles = null;

  var playSettingViewOpen = false;
  var dialogPlaySettingsOpen = false;
  var playSettingTimer = null;
  var vodCurrentAudioTrack = 0;
  /* Once the user picks a language we stop auto-selecting the preferred one. */
  var vodAudioChosen = false;
  /* Older Starfish builds can report MEDIA_ERR_SRC_NOT_SUPPORTED while they
     apply a native audio PID.  It is not a failed movie and must never turn
     Normal (Directo) into Modo Fluido. */
  var audioTrackSwitchUntil = 0;
  var vodCurrentSubtitle = null;
  var vodSubActive = false;
  /* True once the user flips the switch or picks a language; from then on the
     default (Spanish when available) no longer overrides the choice. */
  var vodSubChosen = false;
  var subtitleSeq = 0;
  var vodSubSize = 'normal';
  var vodSubStyle = 'white';
  var playerCurrentAspect = 'contain';
  var lastHistorySaveAt = 0;

  function globalAspectValue() {
    return ['cover', 'contain', '16-9', '4-3'][Number(state.playback.screen) || 0] || 'contain';
  }

  function globalSubtitleSize() {
    return ['normal', 'big', 'small'][Number(state.playback.size) || 0] || 'normal';
  }

  function globalSubtitleStyle() {
    return ['white', 'yellow', 'black'][Number(state.playback.style) || 0] || 'white';
  }

  function applyGlobalPlaybackPreferences() {
    vodSubSize = globalSubtitleSize();
    vodSubStyle = globalSubtitleStyle();
    if (!vodSubChosen) { vodSubActive = !!state.playback.subtitle; }
    setPlayerAspect(globalAspectValue());
    applySubtitleStyles();
  }

  function preferredLanguageCode() {
    return ['es', 'pt', 'en'][Number(state.playback.audio) || 0] || 'es';
  }

  function preferredSubtitleCode() {
    return ['es', 'pt', 'en'][Number(state.playback.subLang) || 0] || 'es';
  }

  function languageMatchesPreference(label, code) {
    var value = String(label || code || '').toLowerCase();
    var wanted = code || 'es';
    if (wanted === 'es') {
      return /^(es|spa|esp|lat|cast)|espa|latino|latin|castell/i.test(value);
    }
    if (wanted === 'pt') { return /^(pt|por)|portu/.test(value); }
    if (wanted === 'en') { return /^(en|eng|ing)|ingl/.test(value); }
    return false;
  }

  function rememberWatchProgress(current, duration, force) {
    var item = state.playerItem;
    if (!item || !item.id || current < 3) { return; }
    var now = Date.now();
    if (!force && now - lastHistorySaveAt < 15000) { return; }
    lastHistorySaveAt = now;
    var episode = state.playerEpisode;
    var key = String(item.id);
    var record = {
      id: key,
      title: item.title || item.name || 'Contenido',
      poster: item.poster || item.cover || '',
      series: !!isSeriesItem(item),
      episodeId: episode && episode.id ? String(episode.id) : '',
      episodeNumber: episode ? (episode.number || episode.seriesNumber || '') : '',
      position: Math.floor(current),
      duration: Math.floor(duration || item.duration || 0),
      updatedAt: now
    };
    var next = [record];
    var old = localProfile.history || [];
    for (var i = 0; i < old.length && next.length < 30; i++) {
      if (String(old[i].id) !== key) { next.push(old[i]); }
    }
    localProfile.history = next;
    safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
  }

  var pendingHistoryRecord = null;
  function applyPendingHistoryEpisode(item) {
    var record = pendingHistoryRecord;
    if (!record || !item || String(record.id) !== String(item.id) || !record.episodeId || !item.episodes) { return; }
    for (var i = 0; i < item.episodes.length; i++) {
      if (String(item.episodes[i].id) === record.episodeId) {
        state.detailEpisode = item.episodes[i];
        state.playerEpisode = item.episodes[i];
        return;
      }
    }
  }

  function openHistoryRecord(record) {
    if (!record) { return; }
    for (var i = 0; i < VOD.length; i++) {
      if (String(VOD[i].id) === String(record.id)) {
        pendingHistoryRecord = record;
        openDetail(VOD[i]);
        return;
      }
    }
    /* Catalog refreshes can group seasons or replace the visible root list.
       Recover by grouped season id/title, and finally recreate a portal item
       from the durable history record so its real id can still be resolved. */
    var wantedTitle = norm(record.title || '');
    for (var v = 0; v < VOD.length; v++) {
      var candidate = VOD[v];
      var seasons = candidate._catalogSeasons || [];
      var seasonMatch = false;
      for (var s = 0; s < seasons.length; s++) {
        if (String(seasons[s].id) === String(record.id)) { seasonMatch = true; break; }
      }
      if (seasonMatch || (wantedTitle && norm(candidate.title || '') === wantedTitle)) {
        pendingHistoryRecord = record;
        openDetail(candidate);
        return;
      }
    }
    var recovered = normalizeVod({
      id: record.id,
      title: record.title,
      poster: record.poster,
      type: record.series ? 'teleplay' : 'movie',
      portal: true
    }, 0);
    recovered._portal = true;
    pendingHistoryRecord = record;
    openDetail(recovered);
  }
  var activeSubtitleCues = [];
  /* mediaInfo payloads keyed by episode/movie content id. */
  var mediaInfoCache = {};
  var mediaInfoPending = {};
  var dialogReturnFocus = null;

  function parseTimestamp(s) {
    if (!s) return 0;
    var p = s.replace(',', '.').split(':');
    if (p.length === 3) {
      return (parseFloat(p[0]) * 3600) + (parseFloat(p[1]) * 60) + parseFloat(p[2]);
    }
    return 0;
  }

  function parseSRT(data) {
    var cues = [];
    if (!data) return cues;
    var blocks = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].trim().split('\n');
      if (lines.length >= 2) {
        var timeLine = (lines[0].indexOf('-->') !== -1) ? lines[0] : lines[1];
        var textLines = (lines[0].indexOf('-->') !== -1) ? lines.slice(1) : lines.slice(2);
        if (timeLine && timeLine.indexOf('-->') !== -1) {
          var m = timeLine.split('-->');
          var start = parseTimestamp(m[0].trim());
          var end = parseTimestamp(m[1].trim());
          var txt = textLines.join('<br>').replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '').trim();
          if (txt) cues.push({ start: start, end: end, text: txt });
        }
      }
    }
    return cues;
  }

  function loadSubtitleTrack(sub) {
    subtitleSeq++;
    var mySeq = subtitleSeq;
    if (!sub || !sub.url) {
      activeSubtitleCues = [];
      if (playerSubtitles) playerSubtitles.innerHTML = '';
      return;
    }
    try {
      var xhr = new XMLHttpRequest();
      var subtitleUrl = sub.url;
      if (!window.PalmServiceBridge && state.playerItem && state.playerItem._htmlSubtitleUrls) {
        var subtitleItems = subtitleLanguageList(state.playerItem.streamAudioInfo || {});
        for (var si = 0; si < subtitleItems.length; si++) {
          if (subtitleItems[si].url === sub.url && state.playerItem._htmlSubtitleUrls[si]) {
            subtitleUrl = state.playerItem._htmlSubtitleUrls[si];
            break;
          }
        }
      }
      xhr.open('GET', subtitleUrl, true);
      xhr.onload = function () {
        if (mySeq !== subtitleSeq) { return; }
        if (xhr.status >= 200 && xhr.status < 300) {
          activeSubtitleCues = parseSRT(xhr.responseText);
        }
      };
      xhr.send();
    } catch (eSub) { /* ignore */ }
  }

  function applySubtitleStyles() {
    if (!playerSubtitles) return;
    playerSubtitles.classList.remove('size-small', 'size-normal', 'size-big');
    playerSubtitles.classList.add('size-' + vodSubSize);
    playerSubtitles.classList.remove('color-white', 'color-yellow', 'color-black');
    playerSubtitles.classList.add('color-' + vodSubStyle);
  }

  function updateSubtitleDisplay(currentSec) {
    if (!playerSubtitles) return;
    if (!vodSubActive || !activeSubtitleCues || !activeSubtitleCues.length) {
      if (playerSubtitles.innerHTML !== '') playerSubtitles.innerHTML = '';
      return;
    }
    var cue = null;
    for (var i = 0; i < activeSubtitleCues.length; i++) {
      if (currentSec >= activeSubtitleCues[i].start && currentSec <= activeSubtitleCues[i].end) {
        cue = activeSubtitleCues[i];
        break;
      }
    }
    if (cue) {
      var html = '<span class="player-subtitles-text">' + cue.text + '</span>';
      if (playerSubtitles.innerHTML !== html) {
        playerSubtitles.innerHTML = html;
      }
    } else {
      if (playerSubtitles.innerHTML !== '') {
        playerSubtitles.innerHTML = '';
      }
    }
  }

  /* ---- Real portal audio/subtitle metadata -------------------------------
     PlaySettingView and the "Ajuste de reproducir" dialog read the same data
     the portal returns for startPlayVOD: the audio PID list and the subtitle
     file list.  It is fetched once per episode/movie and cached; playback
     still goes through resolve(). */
  function playSettingsItem() {
    if (state.screen === 'detail') { return state.detail || null; }
    return state.playerItem || state.detail || null;
  }

  /* "Modo fluido" is a per-title preference: turning it on for one movie must
     not leak into the next one, while a series keeps it across its episodes
     (same series id). */
  var smoothModeByTitle = {};
  /* Stops an automatic Normal -> Fluido retry from looping if FFmpeg itself
     cannot open a particular title. Cleared when the viewer opens a title. */
  var autoSmoothFallbackKey = '';

  function smoothModeKey(item) {
    if (!item) { return ''; }
    /* A manual mode is a series preference while chapters are playing.  The
       previous key used the current episode id, so selecting Fluido in E1
       silently reverted to Normal in E2 and could leave its resolver waiting
       on an incompatible direct pipeline. */
    if (isSeriesItem(item)) {
      return 'series:' + (item.seriesContentId || item.seriesId || item.seasonId || item.id || '');
    }
    var ep = mediaInfoEpisode(item);
    return (ep && ep.id) ? ep.id : (item.id || '');
  }

  function restoreSmoothMode(item) {
    var key = smoothModeKey(item);
    if (key && smoothModeByTitle.hasOwnProperty(key)) {
      state.streamMode = smoothModeByTitle[key] ? 'smooth' : 'normal';
    } else {
      state.streamMode = state.playback.streamMode === 'smooth' ? 'smooth' : 'normal';
    }
  }

  function setSmoothMode(item, on) {
    var key = smoothModeKey(item);
    state.streamMode = on ? 'smooth' : 'normal';
    if (key) { smoothModeByTitle[key] = !!on; }
  }

  /* Called when a different title is opened, never when zapping episodes. */
  function resetMediaSelection() {
    autoSmoothFallbackKey = '';
    vodCurrentAudioTrack = 0;
    vodAudioChosen = false;
    vodCurrentSubtitle = null;
    vodSubActive = false;
    vodSubChosen = false;
    subtitleSeq++;
    state.trackIndex = 0;
    activeSubtitleCues = [];
    if (playerSubtitles) { playerSubtitles.innerHTML = ''; }
  }

  function mediaInfoEpisode(item) {
    if (!item) { return null; }
    if (isSeriesItem(item)) {
      if (state.screen === 'player' && state.playerEpisode) { return state.playerEpisode; }
      if (state.detailEpisode) { return state.detailEpisode; }
      return (item.episodes && item.episodes[0]) || null;
    }
    return null;
  }

  function mediaInfoKey(item) {
    if (!item) { return ''; }
    var ep = mediaInfoEpisode(item);
    return (ep && ep.id) ? ep.id : (item.id || '');
  }

  function ensureMediaInfo(item, done) {
    done = done || function () {};
    if (!item) { return done(null); }
    var key = mediaInfoKey(item);
    if (!key) { return done(null); }
    if (mediaInfoCache[key]) {
      applySubtitleDefaults(mediaInfoCache[key]);
      return done(mediaInfoCache[key]);
    }
    if (mediaInfoPending[key]) { mediaInfoPending[key].push(done); return; }
    mediaInfoPending[key] = [done];

    var ep = mediaInfoEpisode(item);
    var params = { contentId: key };
    var seriesRef = item.seasonId || item.id;
    if (ep && ep.id && seriesRef && ep.id !== seriesRef) { params.seriesContentId = seriesRef; }
    portalServiceCall('mediaInfo', params, function (error, payload) {
      var waiters = mediaInfoPending[key] || [];
      delete mediaInfoPending[key];
      var info = (!error && payload && payload.returnValue !== false) ? payload : null;
      if (info) {
        mediaInfoCache[key] = info;
        applySubtitleDefaults(info);
      }
      for (var i = 0; i < waiters.length; i++) {
        try { waiters[i](info); } catch (eWaiter) { /* ignore */ }
      }
    });
  }

  /* The portal lists audio PIDs in stream order ("por,spa,eng").  The real
     app preselects Spanish when present, so do the same. */
  function preferredAudioIndex(rawAudio) {
    var parts = (rawAudio || '').split(/[,\/]/);
    var preferred = preferredLanguageCode();
    for (var i = 0; i < parts.length; i++) {
      if (languageMatchesPreference(parts[i].trim(), preferred)) { return i; }
    }
    return 0;
  }

  function audioLanguageList(info) {
    var out = [];
    var parts = ((info && info.audio) || '').split(/[,\/]/);
    for (var i = 0; i < parts.length; i++) {
      var code = parts[i].trim();
      if (!code) { continue; }
      out.push({ index: i, code: code, label: formatAudioLang(code) });
    }
    return out;
  }

  function subtitleLanguageList(info) {
    var out = [];
    var subs = (info && info.subtitles) || [];
    for (var i = 0; i < subs.length; i++) {
      out.push({ lang: subs[i].lang, url: subs[i].url, format: subs[i].format });
    }
    /* The real dialog lists Español before Inglés for this catalog. */
    out.sort(function (a, b) {
      var pa = /^(es|spa|esp)$/i.test(a.lang || '') ? 0 : 1;
      var pb = /^(es|spa|esp)$/i.test(b.lang || '') ? 0 : 1;
      return pa - pb;
    });
    return out;
  }

  /* The real app opens with subtitles ON and Spanish selected when the portal
     returns subtitle files. Keep the user's choice once they touch the switch
     or pick a language. */
  function applySubtitleDefaults(info) {
    var list = subtitleLanguageList(info);
    if (!vodSubChosen) {
      if (!state.playback.subtitle) {
        vodSubActive = false;
        vodCurrentSubtitle = null;
        loadSubtitleTrack(null);
        return;
      }
      if (!list.length) {
        vodSubActive = false;
        vodCurrentSubtitle = null;
        loadSubtitleTrack(null);
        return;
      }
      vodSubActive = true;
      vodCurrentSubtitle = list[0];
      for (var pref = 0; pref < list.length; pref++) {
        if (languageMatchesPreference(list[pref].lang, preferredSubtitleCode())) {
          vodCurrentSubtitle = list[pref];
          break;
        }
      }
      loadSubtitleTrack(vodCurrentSubtitle);
      return;
    }
    if (!vodSubActive) { return; }
    if (!list.length) {
      vodSubActive = false;
      vodCurrentSubtitle = null;
      loadSubtitleTrack(null);
      return;
    }
    /* New episode with the same preference: keep the language if the new
       episode ships it, otherwise fall back to the first file. */
    var stillThere = false;
    if (vodCurrentSubtitle) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === vodCurrentSubtitle.url) {
          vodCurrentSubtitle = list[i];
          stillThere = true;
          break;
        }
      }
    }
    if (!stillThere) {
      vodCurrentSubtitle = list[0];
      loadSubtitleTrack(vodCurrentSubtitle);
    }
  }

  function qualityLabel(track) {
    var q = String((track && track.quality) || '').trim().toUpperCase();
    var h = track && track.height;
    if (!q && h) { q = String(h) + 'P'; }
    if (q === '4K' || q === '2160P' || q === 'UHD') { return '4K'; }
    if (/^\d+$/.test(q)) { return q + 'P'; }
    return q || 'AUTO';
  }

  function schedulePlaySettingHide() {
    if (playSettingTimer) { clearTimeout(playSettingTimer); }
    playSettingTimer = setTimeout(function () {
      closePlaySettingView();
    }, 8000);
  }

  function openPlaySettingView() {
    if (!playSettingView) { buildPlayer(); }
    if (!playSettingView) return;
    playSettingViewOpen = true;
    dialogPlaySettingsOpen = false;
    hideInfobar();

    renderPlaySettingView();
    playSettingView.classList.add('is-active');
    if (playerSubtitles) { playerSubtitles.classList.add('shift-up'); }

    /* Audio languages, subtitle files and renditions come from the portal;
       refresh the rows as soon as the service answers. */
    ensureMediaInfo(state.playerItem, function () {
      if (playSettingViewOpen) { renderPlaySettingView(); }
    });

    schedulePlaySettingHide();

    /* Seasons are selected in detail; this panel contains only chapters. */
    var item = state.playerItem;
    if (isSeriesItem(item) && psvEpisodesRow) {
      var chapter = psvEpisodesRow.querySelector('.psv-ep-btn');
      if (chapter) { setFocus(chapter); return; }
    }
    if (isSeriesItem(item) && psvBtnEpisodes) {
      setFocus(psvBtnEpisodes);
      return;
    }
    if (psvBtnConfig) { setFocus(psvBtnConfig); }
  }

  function closePlaySettingView() {
    if (playSettingTimer) { clearTimeout(playSettingTimer); playSettingTimer = null; }
    playSettingViewOpen = false;
    if (playSettingView) { playSettingView.classList.remove('is-active'); }
    if (playerSubtitles) { playerSubtitles.classList.remove('shift-up'); }
    if (state.screen === 'player' && !dialogPlaySettingsOpen) {
      setFocus(playerStage);
    }
  }

  function renderPlaySettingView() {
    /* Keep the d-pad where the user was: the rows rebuild their pills, so a
       plain re-render used to leave focus on a detached node (the OK press
       then did nothing and the panel closed by timeout). */
    var focusRow = state.focus ? closest(state.focus, '.psv-row') : null;
    var focusRowId = focusRow ? focusRow.id : '';
    var focusText = (focusRow && state.focus) ? state.focus.textContent : '';

    renderPlaySettingSelection();
    renderPlaySettingAudio();
    renderPlaySettingQuality();
    renderPlaySettingPlayerOptions();
    renderPlaySettingAspectOptions();
    renderPlaySettingRowFocus();

    if (!playSettingViewOpen || !focusRowId || !playSettingView) { return; }
    var rows = playSettingView.querySelectorAll('.psv-row');
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].id !== focusRowId) { continue; }
      var btns = rows[r].querySelectorAll('.focusable');
      var match = null;
      for (var b = 0; b < btns.length; b++) {
        if (btns[b].textContent === focusText) { match = btns[b]; break; }
      }
      var target = match || firstIn(rows[r]);
      if (target) { setFocus(target, true); }
      break;
    }
  }

  function renderPlaySettingAudio() {
    if (!psvSecAudio) { return; }
    /* Always present: it is the entry point to "Ajuste de reproducir". */
    psvSecAudio.classList.remove('is-hidden');
  }

  /* ud/n1.dd() builds the RESOLUCIÓN row from the portal's quality map and
     shows shifted labels: the 720p copy is titled "1080P" and the 1080p copy
     "4K". Mirror that so the row matches the real app. */
  function qualityChoices(info) {
    var tracks = (info && info.tracks) || [];
    var out = [];
    var seen = {};
    for (var i = 0; i < tracks.length; i++) {
      var raw = String(tracks[i].quality || '').toLowerCase().replace(/p$/, '');
      var label = raw === '480' ? '480P'
                : raw === '720' ? '1080P'
                : raw === '1080' ? '4K'
                : qualityLabel(tracks[i]);
      if (seen[label]) { continue; }
      seen[label] = true;
      out.push({ label: label, trackIndex: i });
    }
    /* The APK adds a "4K" pill whenever the 720p copy is present and the
       portal has no separate 1080p entry. */
    if (seen['1080P'] && !seen['4K']) { out.push({ label: '4K', trackIndex: -1 }); }
    return out;
  }

  function renderPlaySettingQuality() {
    /* Retired: the portal exposes no alternative video tracks for VOD.
       The row has been replaced by "RESOLUCIÓN / MODO" (Normal vs Modo Fluido). */
  }

  /* The APK turns the title of the row that holds focus white and 40px. */
  function renderPlaySettingRowFocus() {
    if (!playSettingView) { return; }
    var rows = playSettingView.querySelectorAll('.psv-row');
    for (var i = 0; i < rows.length; i++) { rows[i].classList.remove('is-row-focused'); }
    var row = state.focus ? closest(state.focus, '.psv-row') : null;
    if (row) { row.classList.add('is-row-focused'); }
  }

  function renderPlaySettingSelection() {
    if (!psvSecSelection) return;
    var item = state.playerItem;
    if (!item || !isSeriesItem(item)) {
      psvSecSelection.style.display = 'none';
      return;
    }
    psvSecSelection.style.display = 'block';
    if (!psvEpisodesRow) return;

    clear(psvEpisodesRow);

    var seasons = seriesSeasons(item);
    var season = seasons[state.playerSeasonIndex] || seasons[0];
    var episodes = (season && season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length)
      ? item.episodes : ((season && season._episodes) || item.episodes || []);
    if (!episodes.length) {
      psvEpisodesRow.appendChild(el('div', 'psv-selection-empty', 'Temporadas y episodios'));
      return;
    }
    var currentIndex = 0;
    for (var c = 0; c < episodes.length; c++) {
      if (state.playerEpisode && (episodes[c].id === state.playerEpisode.id || episodes[c].number === state.playerEpisode.number)) { currentIndex = c; break; }
    }
    var ranges = detailRanges(episodes.length);
    if (state.playerEpisodeRange === undefined || state.playerEpisodeRange >= ranges.length) {
      state.playerEpisodeRange = Math.floor(currentIndex / 20);
    }
    var range = ranges[state.playerEpisodeRange] || ranges[0];
    /* reveal() only follows .scrollable containers.  Without this class the
       d-pad could focus episode 16+ outside the visible row, making a
       20-episode page look capped around fifteen entries. */
    var numberRow = el('div', 'psv-episode-numbers scrollable');
    for (var i = range.start; i < range.end; i++) {
      (function (ep, idx) {
        var label = idx === currentIndex ? '▶' : String(ep.number !== undefined && ep.number !== null ? ep.number : idx + 1);
        var btn = el('button', 'psv-ep-btn focusable' + (idx === currentIndex ? ' is-selected' : ''), label);
        btn._activate = function () { chooseEpisode(ep); };
        numberRow.appendChild(btn);
      })(episodes[i], i);
    }
    psvEpisodesRow.appendChild(numberRow);
    var rangeRow = el('div', 'psv-episode-ranges scrollable');
    for (var r = 0; r < ranges.length; r++) {
      (function (idx, part) {
        var btn = el('button', 'psv-range-btn focusable' + (idx === state.playerEpisodeRange ? ' is-selected' : ''),
          (part.start + 1) + '-' + part.end);
        btn._activate = function () {
          state.playerEpisodeRange = idx;
          renderPlaySettingSelection();
          var first = psvEpisodesRow.querySelector('.psv-ep-btn');
          if (first) { setFocus(first); }
        };
        rangeRow.appendChild(btn);
      })(r, ranges[r]);
    }
    psvEpisodesRow.appendChild(rangeRow);
  }

  /* ================= Season/episode browser (in-player) =================
     Netflix-style list: season rail on the left, episode rows on the right.
     Episodes for other seasons are fetched once from the portal and cached on
     the season object.  The series id (item.id) is never overwritten, so the
     resolver keeps sending seriesContentId = the real series. */
  function seriesSeasons(item) {
    if (item && item.seasons && item.seasons.length) { return item.seasons; }
    return [{ id: item ? item.id : '', number: 1 }];
  }

  function seasonEpisodes(item, season, done) {
    done = done || function () {};
    if (!item || !season) { return done([]); }
    if (season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) {
      season._episodes = item.episodes;
      return done(item.episodes);
    }
    if (season._episodes) { return done(season._episodes); }
    if (season._loading) {
      season._wait = season._wait || [];
      season._wait.push(done);
      return;
    }
    season._loading = true;
    season._wait = [done];
    portalServiceCall('detail', { contentId: season.id }, function (error, payload) {
      season._loading = false;
      var eps = (!error && payload && payload.returnValue !== false && payload.episodes)
        ? payload.episodes : [];
      if (eps.length) { season._episodes = eps; }
      var waiters = season._wait || [];
      season._wait = [];
      for (var i = 0; i < waiters.length; i++) {
        try { waiters[i](eps); } catch (eWaiter) { /* ignore */ }
      }
    });
  }

  function episodeDisplayTitle(item, ep, index) {
    var num = (ep && ep.number !== undefined && ep.number !== null) ? ep.number : (index + 1);
    var raw = String((ep && (ep.title || ep.name)) || '').trim();
    var base = String((item && item.title) || '').trim()
      .replace(/[\s\-–_]*[TtSs]\d+$/, '');   /* "Serie T10" -> "Serie" */
    if (base && raw.indexOf(base) === 0) {
      raw = raw.substring(base.length);
    }
    raw = raw.replace(/^[\s\-–_:.]+/, '').trim();
    /* Only a season/episode code left ("T1_06", "S01E06", "6")? Use a clean
       label instead of repeating the series name. */
    if (!raw || /^(?:[TtSs]?\d+[\s\-–_.:]*)+$/.test(raw)) {
      raw = 'Episodio ' + num;
    }
    return raw;
  }

  function episodeDurationLabel(ep) {
    var raw = String((ep && ep.duration) || '').trim();
    var m = /^(\d+):(\d+)(?::(\d+))?$/.exec(raw);
    if (!m) { return raw; }
    if (m[3]) {
      var h = parseInt(m[1], 10) || 0;
      var min = parseInt(m[2], 10) || 0;
      return h + ' h ' + min + ' min';
    }
    return (parseInt(m[1], 10) || 0) + ' min';
  }

  function openEpisodeBrowser() {
    var item = state.playerItem;
    if (!item || !isSeriesItem(item)) { return; }
    if (playSettingViewOpen) { closePlaySettingView(); }
    if (!episodeBrowser) { buildPlayer(); }
    if (!episodeBrowser) { return; }

    if ((!item.episodes || !item.episodes.length) && !item._detailsLoaded) {
      setPlayerStatus('Cargando capítulos…');
      loadVodDetail(item, function () {
        if (state.screen !== 'player') { return; }
        if (!state.playerEpisode && item.episodes && item.episodes.length) {
          state.playerEpisode = item.episodes[0];
          state.detailEpisode = item.episodes[0];
        }
        openEpisodeBrowser();
      });
      return;
    }

    if (!state.playerEpisode && item.episodes && item.episodes.length) {
      state.playerEpisode = item.episodes[0];
      state.detailEpisode = item.episodes[0];
      state.playerSeasonIndex = state.detailSeason || 0;
    }

    state.episodeBrowserOpen = true;
    state.browserSeason = state.playerSeasonIndex || 0;
    episodeBrowser.classList.add('is-active');
    hideVodInfobar();
    renderEpisodeBrowser();

    var cur = peEpisodes ? peEpisodes.querySelector('.pe-ep.is-current') : null;
    var f = cur || (peEpisodes ? firstIn(peEpisodes) : null) ||
            (peSeasonsCol && peSeasonsCol.style.display !== 'none' ? firstIn(peSeasons) : null);
    if (f) { setFocus(f); }
  }

  function closeEpisodeBrowser(keepFocus) {
    if (!episodeBrowser || !state.episodeBrowserOpen) { return; }
    state.episodeBrowserOpen = false;
    episodeBrowser.classList.remove('is-active');
    if (!keepFocus && state.screen === 'player' && playerStage) { setFocus(playerStage); }
  }

  function renderEpisodeBrowser() {
    var item = state.playerItem;
    if (!item || !episodeBrowser) { return; }
    var seasons = seriesSeasons(item);
    if (state.browserSeason >= seasons.length) { state.browserSeason = 0; }
    if (state.browserSeason < 0) { state.browserSeason = 0; }
    var season = seasons[state.browserSeason];
    var playingSeason = seasons[state.playerSeasonIndex] || seasons[0];
    var ep = state.playerEpisode;

    if (peTitle) { peTitle.textContent = item.title || ''; }
    if (peSub) {
      if (ep) {
        var tag = [];
        if (playingSeason && playingSeason.number) { tag.push('T' + playingSeason.number); }
        if (ep.number) { tag.push('E' + ep.number); }
        peSub.textContent = 'Reproduciendo ' + tag.join(' ') + ' · ' + episodeDisplayTitle(item, ep);
      } else {
        peSub.textContent = 'Elige un episodio';
      }
    }
    if (peSeasonLabel) {
      peSeasonLabel.textContent = 'Episodios · Temporada ' + ((season && season.number) || (state.browserSeason + 1));
    }

    renderBrowserSeasons(item, seasons);
    renderBrowserEpisodes(item, season);
  }

  function renderBrowserSeasons(item, seasons) {
    if (!peSeasons || !peSeasonsCol) { return; }
    clear(peSeasons);
    peSeasonsCol.style.display = 'flex';
    for (var i = 0; i < seasons.length; i++) {
      (function (idx) {
        var s = seasons[idx];
        var b = el('div', 'pe-season focusable', 'Temporada ' + (s.number || (idx + 1)));
        if (idx === state.browserSeason) { b.classList.add('is-selected'); }
        /* Netflix behaviour: just moving the season rail already shows that
           season's episodes, so OK is only needed to jump into the list. */
        b._onFocus = function () {
          if (state.browserSeason !== idx) { selectBrowserSeason(idx, false); }
        };
        b._activate = function () { selectBrowserSeason(idx, true); };
        peSeasons.appendChild(b);
      })(i);
    }
  }

  function renderBrowserEpisodes(item, season) {
    if (!peEpisodes || !season) { return; }
    clear(peEpisodes);
    var cached = (season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length)
      ? item.episodes : (season._episodes || []);

    if (!cached.length) {
      peEpisodes.appendChild(el('div', 'pe-loading', 'Cargando episodios…'));
      seasonEpisodes(item, season, function (eps) {
        if (!state.episodeBrowserOpen) { return; }
        var now = seriesSeasons(item)[state.browserSeason];
        if (now !== season) { return; }
        renderBrowserEpisodes(item, season);
        /* Only re-anchor focus when the user is already inside the list; when
           they are browsing seasons the rail keeps the d-pad. */
        if (closest(state.focus, '#pe-episodes')) {
          var cur = peEpisodes.querySelector('.pe-ep.is-current');
          var f = cur || firstIn(peEpisodes);
          if (f) { setFocus(f); }
        }
      });
      return;
    }

    /* Keep the drawer within the small webOS 4 renderer budget.  A full
       season can contain dozens of poster images; decoding all of them while
       video is active can make the system kill the app for memory. */
    var visibleEpisodes = Math.min(cached.length, 24);
    for (var i = 0; i < visibleEpisodes; i++) {
      (function (ep, idx) {
        var row = el('div', 'pe-ep focusable');
        var num = (ep.number !== undefined && ep.number !== null) ? ep.number : (idx + 1);
        row.appendChild(el('div', 'pe-num', String(num)));

        var thumb = el('div', 'pe-thumb');
        /* Deliberately no <img> per episode: remote artwork is the dominant
           memory cost in this overlay on a 1 GB webOS 4 TV. */
        var playIcon = el('div', 'pe-thumb-play', '▶');
        thumb.appendChild(playIcon);
        row.appendChild(thumb);

        var info = el('div', 'pe-info');
        info.appendChild(el('div', 'pe-name', episodeDisplayTitle(item, ep, idx)));
        var bits = [];
        var dur = episodeDurationLabel(ep);
        if (dur) { bits.push(dur); }
        if (ep.quality) { bits.push(String(ep.quality).split(',')[0].toUpperCase()); }
        info.appendChild(el('div', 'pe-meta', bits.join('   ·   ')));
        if (ep.description) {
          info.appendChild(el('div', 'pe-desc', ep.description));
        }
        row.appendChild(info);

        var isPlaying = state.playerEpisode && (state.playerEpisode.id === ep.id || (state.playerEpisode.number !== undefined && state.playerEpisode.number === ep.number));
        row.appendChild(el('div', 'pe-badge', '▶ REPRODUCIENDO'));
        if (isPlaying) {
          row.classList.add('is-current');
        }
        row._activate = function () { chooseEpisode(ep); };
        peEpisodes.appendChild(row);
      })(cached[i], i);
    }
    if (cached.length > visibleEpisodes) {
      peEpisodes.appendChild(el('div', 'pe-loading', 'Mostrando los primeros ' + visibleEpisodes + ' capítulos'));
    }
  }

  /* Repaints the rail's selection without rebuilding the nodes, so the
     focused season keeps the d-pad while the list on the right updates. */
  function updateBrowserSeasonSelection() {
    if (!peSeasons) { return; }
    var rows = peSeasons.children;
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('is-selected', i === state.browserSeason);
    }
  }

  function selectBrowserSeason(idx, moveFocus) {
    var item = state.playerItem;
    var seasons = seriesSeasons(item);
    if (!seasons[idx]) { return; }
    state.browserSeason = idx;
    updateBrowserSeasonSelection();
    if (peSeasonLabel) {
      peSeasonLabel.textContent = 'Episodios · Temporada ' + (seasons[idx].number || (idx + 1));
    }
    renderBrowserEpisodes(item, seasons[idx]);
    if (moveFocus) {
      var cur = peEpisodes ? (peEpisodes.querySelector('.pe-ep.is-current') || firstIn(peEpisodes)) : null;
      if (cur) { setFocus(cur); }
    }
  }

  function chooseEpisode(ep) {
    var item = state.playerItem;
    if (!item || !ep) { return; }
    var seasons = seriesSeasons(item);
    var prev = seasons[state.playerSeasonIndex];
    if (prev && prev.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) {
      prev._episodes = item.episodes;
    }
    var sIdx = (state.playerSeasonIndex !== undefined && state.playerSeasonIndex !== null)
      ? state.playerSeasonIndex : (state.browserSeason || 0);
    var season = seasons[sIdx];
    if (season) {
      if (state.detailSeason !== sIdx) {
        state.detailSeason = sIdx;
        state.detailNeedsRebuild = true;
      }
      if (season.id) { item.seasonId = season.id; }
      if (season._episodes) { item.episodes = season._episodes; }
    }
    closeEpisodeBrowser();
    if (playSettingViewOpen) { closePlaySettingView(); }
    playEpisode(item, ep);
  }

  /* Single path for changing episode while watching: keeps the detail screen,
     the infobar and the resolver on the same episode. */
  function playEpisode(item, ep) {
    if (!item || !ep) { return; }
    state.playerItem = item;
    state.playerEpisode = ep;
    state.detailEpisode = ep;
    state.playerSeasonIndex = state.detailSeason || 0;
    if (playerStage && playerInfo) { updatePlayer(); }
    syncDetailEpisodeHighlight(item);
    /* Starfish retains the old UMS/video pipeline briefly after src is
       cleared.  Starting a new episode in the same turn can exceed the RAM
       budget of webOS 4, especially with the FFmpeg relay.  Release first,
       then create exactly one replacement pipeline. */
    if (state.episodeSwitchTimer) { clearTimeout(state.episodeSwitchTimer); }
    state.episodeSwitchSeq = (state.episodeSwitchSeq || 0) + 1;
    var switchSeq = state.episodeSwitchSeq;
    stopPlayerVideo();
    setPlayerStatus('Cambiando capítulo…');
    state.episodeSwitchTimer = setTimeout(function () {
      state.episodeSwitchTimer = null;
      if (switchSeq !== state.episodeSwitchSeq || (state.screen !== 'player' && state.screen !== 'detail')) { return; }
      startPlayerVideo(item, ep);
    }, 600);
  }

  function episodeListForCurrentSeason(item) {
    var seasons = seriesSeasons(item);
    var season = seasons[state.playerSeasonIndex] || seasons[0];
    if (!season) { return []; }
    if (season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) { return item.episodes; }
    return season._episodes || [];
  }

  function showNextEpisodeLoading(item) {
    if (!nextEpisodeLoading) { nextEpisodeLoading = $('next-episode-loading'); }
    if (!nextEpisodeLoading) { return; }
    var image = (item && (item.backdrop || item.landscape || item.poster)) || '';
    nextEpisodeLoading.style.backgroundImage = image ? 'url("' + String(image).replace(/"/g, '%22') + '")' : '';
    nextEpisodeLoading.classList.add('is-active');
  }

  function hideNextEpisodeLoading() {
    if (!nextEpisodeLoading) { nextEpisodeLoading = $('next-episode-loading'); }
    if (!nextEpisodeLoading) { return; }
    nextEpisodeLoading.classList.remove('is-active');
    nextEpisodeLoading.style.backgroundImage = '';
  }

  function advanceToNextEpisode() {
    var item = state.playerItem;
    if (!item || !isSeriesItem(item) || state.screen !== 'player') { return; }
    var episodes = episodeListForCurrentSeason(item);
    var current = state.playerEpisode;
    var index = -1;
    for (var i = 0; i < episodes.length; i++) {
      if (current && (episodes[i].id === current.id || episodes[i].number === current.number)) { index = i; break; }
    }
    if (index < 0) { return; }
    showNextEpisodeLoading(item);
    if (index + 1 < episodes.length) {
      playEpisode(item, episodes[index + 1]);
      return;
    }
    /* At the end of a season, fetch only the first chapter of the next one.
       The previous season's episode array stays cached, so this does not turn
       the compact player selector into a full all-season list. */
    var seasons = seriesSeasons(item);
    var nextSeasonIndex = (state.playerSeasonIndex || 0) + 1;
    var nextSeason = seasons[nextSeasonIndex];
    if (!nextSeason) { hideNextEpisodeLoading(); return; }
    var endedEpisode = current;
    seasonEpisodes(item, nextSeason, function (nextEpisodes) {
      if (state.playerItem !== item || state.playerEpisode !== endedEpisode || state.screen !== 'player') {
        return;
      }
      if (!nextEpisodes || !nextEpisodes.length) { hideNextEpisodeLoading(); return; }
      state.detailSeason = nextSeasonIndex;
      state.playerSeasonIndex = nextSeasonIndex;
      item.seasonId = nextSeason.id || item.seasonId;
      item.episodes = nextEpisodes;
      nextSeason._episodes = nextEpisodes;
      playEpisode(item, nextEpisodes[0]);
    });
  }

  function syncDetailEpisodeHighlight(item) {
    if (!detailBottom) { return; }
    var tiles = detailBottom.querySelectorAll('.detail-episode');
    for (var i = 0; i < tiles.length; i++) {
      var on = !!(tiles[i]._ep && state.detailEpisode && tiles[i]._ep.id === state.detailEpisode.id);
      tiles[i].classList.toggle('is-playing', on);
    }
  }

  function renderPlaySettingPlayerOptions() {
    /* 'normal' is the default direct path; only 'relay'/'smooth' means FFmpeg. */
    var isRelay = (state.streamMode === 'relay' || state.streamMode === 'smooth');
    if (psvBtnP1) {
      if (!window.PalmServiceBridge) { psvBtnP1.style.display = 'none'; }
      psvBtnP1.classList.toggle('is-selected', isRelay);
      var chk1 = psvBtnP1.querySelector('.psv-check');
      if (chk1) chk1.style.display = isRelay ? 'block' : 'none';
    }
    if (psvBtnP2) {
      psvBtnP2.classList.toggle('is-selected', !isRelay);
      var chk2 = psvBtnP2.querySelector('.psv-check');
      if (chk2) chk2.style.display = !isRelay ? 'block' : 'none';
    }
  }

  function renderPlaySettingAspectOptions() {
    if (!psvAspectRow) return;
    var btns = psvAspectRow.querySelectorAll('.psv-btn');
    for (var i = 0; i < btns.length; i++) {
      var asp = btns[i].getAttribute('data-aspect');
      var isSel = (asp === playerCurrentAspect);
      btns[i].classList.toggle('is-selected', isSel);
      var chk = btns[i].querySelector('.psv-check');
      if (chk) chk.style.display = isSel ? 'block' : 'none';
    }
  }

  function setPlayerAspect(aspect) {
    playerCurrentAspect = aspect || 'contain';
    if (playerVideo) {
      playerVideo.classList.remove('aspect-cover', 'aspect-contain', 'aspect-16-9', 'aspect-4-3');
      playerVideo.classList.add('aspect-' + playerCurrentAspect);
    }
    renderPlaySettingAspectOptions();
  }

  function openPlaySettingsDialog(fromItem) {
    if (!dialogPlaySettings) { buildPlayer(); }
    if (!dialogPlaySettings) return;
    if (playSettingTimer) { clearTimeout(playSettingTimer); playSettingTimer = null; }
    dialogPlaySettingsOpen = true;
    dialogReturnFocus = state.focus;

    var item = fromItem || playSettingsItem();
    if (state.screen === 'detail') { item = state.detail || item; }

    renderDialogAudio();
    renderDialogSubtitle();
    applySubtitleStyles();

    dialogPlaySettings.classList.add('is-active');

    ensureMediaInfo(item, function () {
      if (!dialogPlaySettingsOpen) { return; }
      renderDialogAudio();
      renderDialogSubtitle();
    });

    /* Focus first audio pill or switch */
    var firstFocus = (dpsAudioOptions && dpsAudioOptions.querySelector('.focusable')) || dpsSubSwitch || dpsBtnExit;
    if (firstFocus) { setFocus(firstFocus); }
  }

  function closePlaySettingsDialog() {
    dialogPlaySettingsOpen = false;
    if (dialogPlaySettings) { dialogPlaySettings.classList.remove('is-active'); }
    if (playSettingViewOpen) {
      if (psvBtnConfig) { setFocus(psvBtnConfig); }
      schedulePlaySettingHide();
    } else if (dialogReturnFocus && isVisible(dialogReturnFocus)) {
      setFocus(dialogReturnFocus);
    } else if (state.screen === 'player') {
      setFocus(playerStage);
    }
    dialogReturnFocus = null;
  }

  function renderDialogAudio() {
    if (!dpsAudioOptions) return;
    clear(dpsAudioOptions);

    var info = mediaInfoCache[mediaInfoKey(playSettingsItem())];
    if (info && !vodAudioChosen) {
      vodCurrentAudioTrack = preferredAudioIndex(info.audio);
    }
    var tracks = audioLanguageList(info);
    if (!tracks.length) {
      /* mediaInfo has not answered yet: keep the current language visible. */
      tracks = [{ index: vodCurrentAudioTrack || 0, label: 'Español' }];
    }
    for (var t = 0; t < tracks.length; t++) {
      (function (track) {
        var btn = el('button', 'dps-btn focusable');
        btn.textContent = track.label;
        if (vodCurrentAudioTrack === track.index) { btn.classList.add('is-selected'); }
        btn._activate = function () {
          switchAudioTrack(track.index);
          renderDialogAudio();
          schedulePlaySettingHide();
        };
        dpsAudioOptions.appendChild(btn);
      })(tracks[t]);
    }
  }

  function renderDialogSubtitle() {
    var info = mediaInfoCache[mediaInfoKey(playSettingsItem())];
    var list = subtitleLanguageList(info);

    if (dpsSubSwitch) {
      /* Without subtitle files there is nothing to switch on. */
      var switchRow = dpsSubSwitch.parentNode;
      if (switchRow) { switchRow.classList.toggle('is-hidden', !list.length); }
      dpsSubSwitch.classList.toggle('is-on', vodSubActive);
      var dotText = dpsSubSwitch.querySelector('.dps-switch-text');
      if (dotText) dotText.textContent = vodSubActive ? 'ON' : 'OFF';
    }

    if (dpsRowLang) dpsRowLang.classList.toggle('is-visible', vodSubActive && list.length > 0);
    if (dpsRowSize) dpsRowSize.classList.toggle('is-visible', vodSubActive && list.length > 0);
    if (dpsRowStyle) dpsRowStyle.classList.toggle('is-visible', vodSubActive && list.length > 0);

    if (!vodSubActive) return;

    /* Render languages */
    if (dpsLangOptions) {
      clear(dpsLangOptions);
      for (var s = 0; s < list.length; s++) {
        (function (sub) {
          var btn = el('button', 'dps-btn focusable');
          btn.textContent = formatAudioLang(sub.lang || 'Sub');
          if (vodCurrentSubtitle && vodCurrentSubtitle.url === sub.url) {
            btn.classList.add('is-selected');
          }
          btn._activate = function () {
            vodCurrentSubtitle = sub;
            vodSubActive = true;
            vodSubChosen = true;
            loadSubtitleTrack(sub);
            renderDialogSubtitle();
            schedulePlaySettingHide();
          };
          dpsLangOptions.appendChild(btn);
        })(list[s]);
      }
    }

    /* Size buttons */
    if (dpsSizeOptions) {
      var sBtns = dpsSizeOptions.querySelectorAll('.dps-btn');
      for (var si = 0; si < sBtns.length; si++) {
        var sz = sBtns[si].getAttribute('data-size');
        sBtns[si].classList.toggle('is-selected', sz === vodSubSize);
      }
    }

    /* Style buttons */
    if (dpsStyleOptions) {
      var stBtns = dpsStyleOptions.querySelectorAll('.dps-btn');
      for (var sti = 0; sti < stBtns.length; sti++) {
        var st = stBtns[sti].getAttribute('data-style');
        stBtns[sti].classList.toggle('is-selected', st === vodSubStyle);
      }
    }
  }

  function formatAudioLang(code) {
    var c = (code || '').toLowerCase().trim().split(/[-_]/)[0];
    if (/^(spa|esp|es|castellano|latino|lat|latam)$/.test(c)) return 'Español';
    if (/^(eng|ing|en)$/.test(c)) return 'Inglés';
    if (/^(jpn|jap|ja)$/.test(c)) return 'Japonés';
    if (/^(kor|cor|ko)$/.test(c)) return 'Coreano';
    if (/^(por|pt)$/.test(c)) return 'Portugués';
    if (/^(fra|fre|fr|franc)$/.test(c)) return 'Francés';
    if (/^(ita|it)$/.test(c)) return 'Italiano';
    if (/^(deu|ger|de)$/.test(c)) return 'Alemán';
    if (/^(chi|zho|zh)$/.test(c)) return 'Chino';
    return c ? (c.charAt(0).toUpperCase() + c.slice(1)) : 'Pista';
  }

  /* A direct MP4/TS source must stay direct when the viewer selects an audio
     language.  Some webOS media pipelines expose the native AudioTrackList;
     in that case the change is immediate and does not need FFmpeg.  Older
     sets expose no writable list, so we leave the existing source untouched
     instead of silently changing the player to Modo Fluido. */
  function selectNativeAudioTrack(trackIndex) {
    if (!playerVideo) { return false; }
    var tracks;
    try { tracks = playerVideo.audioTracks; } catch (eTracks) { return false; }
    if (!tracks || !tracks.length || !(trackIndex >= 0 && trackIndex < tracks.length)) {
      return false;
    }
    try {
      for (var i = 0; i < tracks.length; i++) {
        tracks[i].enabled = (i === trackIndex);
      }
      return true;
    } catch (eSelect) {
      return false;
    }
  }

  function switchAudioTrack(trackIndex) {
    /* On the detail screen the choice is only remembered for the next play. */
    if (state.screen !== 'player' || !playerVideo) {
      vodCurrentAudioTrack = trackIndex;
      vodAudioChosen = true;
      return;
    }
    /* Normal (Directo) must never be converted to Fluido merely by opening
       the audio selector.  Use the native track list when webOS provides it.
       A TV without that API keeps its playing source and clearly tells the
       viewer that a remux is required for per-track selection. */
    if (state.streamMode !== 'relay' && state.streamMode !== 'smooth') {
      if (selectNativeAudioTrack(trackIndex)) {
        vodCurrentAudioTrack = trackIndex;
        vodAudioChosen = true;
        audioTrackSwitchUntil = Date.now() + 5000;
        setPlayerStatus('Idioma cambiado');
      } else {
        setPlayerStatus('Esta TV no permite cambiar audio en Normal. Usa Modo Fluido para esa pista.');
      }
      return;
    }
    vodCurrentAudioTrack = trackIndex;
    vodAudioChosen = true;
    /* HTML5 cannot pick a PID inside a TS/MP4, so the FFmpeg relay maps it
       with -map 0:a:<n>. */
    if (relayBaseUrl) {
      var curSec = relayStartOffset + (playerVideo.currentTime || 0);
      playUrl(relayBaseUrl + '?start=' + Math.floor(curSec) + '&a=' + trackIndex);
      return;
    }
    restartCurrentPlayback();
  }

  function restartCurrentPlayback() {
    if (!playerVideo) return;
    var curSec = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
    var item = state.playerItem;
    stopPlayerVideo();
    setPlayerStatus('Cambiando reproductor…');
    resolvePlayerStream(item, function (url) {
      if (url) {
        if (url.indexOf(':8787/s/') !== -1) {
          var seekUrl = url + '?start=' + Math.floor(curSec);
          if (vodCurrentAudioTrack) { seekUrl += '&a=' + vodCurrentAudioTrack; }
          playUrl(seekUrl);
        } else {
          playUrl(url);
          if (curSec > 0) {
            try { playerVideo.currentTime = curSec; } catch (e) {}
          }
        }
      } else if (!state.streamError) {
        setPlayerStatus('Sin fuente de reproducción');
      }
    });
  }

  function buildPlayer() {
    playerStage = $('player-stage');
    playerInfo = $('player-infobar');
    playerVodInfo = $('player-vod-infobar');
    playerChannels = $('player-channels');
    categoryPicker = $('player-categories');
    pcatGrid = $('pcat-grid');
    pcatSub = $('pcat-sub');
    playerVideo = $('player-video');
    playerStatus = $('player-status');
    nextEpisodeLoading = $('next-episode-loading');
    playerOsdIcon = $('player-osd-icon');
    playerFrame = playerStage ? playerStage.querySelector('.player-frame') : null;

    vodInfobarPoster = $('vod-infobar-poster');
    vodInfobarTitle = $('vod-infobar-title');
    vodTimeCurrent = $('vod-time-current');
    vodTimeTotal = $('vod-time-total');
    vodSeekbar = $('vod-seekbar');
    vodSeekProgress = $('vod-seek-progress');
    vodSeekBuffered = $('vod-seek-buffered');
    vodSeekThumb = $('vod-seek-thumb');

    if (vodSeekbar) {
      vodSeekbar.classList.add('focusable');
      vodSeekbar._activate = function () { leaveVodScrub(true); };
      vodSeekbar._onMove = function (dir) {
        if (dir === 'left') { moveVodScrub(-1); return true; }
        if (dir === 'right') { moveVodScrub(1); return true; }
        if (dir === 'down' || dir === 'up') { leaveVodScrub(false); return true; }
        return false;
      };
    }

    /* PlaySettingView elements */
    playSettingView = $('player-playsetting-view');
    psvSecSelection = $('psv-sec-selection');
    psvEpisodesRow = $('psv-episodes-row');
    psvBtnEpisodes = $('psv-btn-episodes');
    psvBtnConfig = $('psv-btn-config');
    psvBtnP1 = $('psv-btn-p1');
    psvBtnP2 = $('psv-btn-p2');
    psvSecAudio = $('psv-sec-audio');
    psvSecQuality = $('psv-sec-quality');
    psvQualityRow = $('psv-quality-row');
    psvSecAspect = $('psv-sec-aspect');
    psvSecPlayer = $('psv-sec-player');
    psvBtnFeedback = $('psv-btn-feedback');
    psvAspectRow = $('psv-aspect-row');

    /* Season/episode browser */
    episodeBrowser = $('player-episodes');
    peTitle = $('pe-title');
    peSub = $('pe-sub');
    peSeasons = $('pe-seasons');
    peSeasonsCol = $('pe-seasons-col');
    peEpisodes = $('pe-episodes');
    peSeasonLabel = $('pe-season-label');

    if (psvBtnEpisodes) {
      psvBtnEpisodes._activate = function () { openEpisodeBrowser(); };
    }

    if (psvBtnFeedback) {
      psvBtnFeedback._activate = function () { schedulePlaySettingHide(); };
    }

    if (psvBtnConfig) {
      psvBtnConfig._activate = function () {
        openPlaySettingsDialog();
      };
    }
    if (psvBtnP1) {
      psvBtnP1._activate = function () {
        if (!window.PalmServiceBridge) {
          return;
        }
        /* Explicit user action must always recreate the source.  Never use
           the visual selection or a stale URL as a reason to skip it. */
        setSmoothMode(playSettingsItem(), true);
        renderPlaySettingPlayerOptions();
        schedulePlaySettingHide();
        restartCurrentPlayback();
      };
    }
    if (psvBtnP2) {
      psvBtnP2._activate = function () {
        setSmoothMode(playSettingsItem(), false);
        renderPlaySettingPlayerOptions();
        schedulePlaySettingHide();
        restartCurrentPlayback();
      };
    }
    if (psvAspectRow) {
      var aBtns = psvAspectRow.querySelectorAll('.psv-btn');
      for (var ai = 0; ai < aBtns.length; ai++) {
        (function (b) {
          b._activate = function () {
            var asp = b.getAttribute('data-aspect');
            setPlayerAspect(asp);
          };
        })(aBtns[ai]);
      }
    }

    /* Modal Dialog elements */
    dialogPlaySettings = $('dialog-playsettings');
    dpsAudioOptions = $('dps-audio-options');
    dpsSubSwitch = $('dps-sub-switch');
    dpsRowLang = $('dps-row-lang');
    dpsRowSize = $('dps-row-size');
    dpsRowStyle = $('dps-row-style');
    dpsLangOptions = $('dps-lang-options');
    dpsSizeOptions = $('dps-size-options');
    dpsStyleOptions = $('dps-style-options');
    dpsBtnExit = $('dps-btn-exit');
    playerSubtitles = $('player-subtitles');

    if (dpsSubSwitch) {
      dpsSubSwitch._activate = function () {
        vodSubChosen = true;
        vodSubActive = !vodSubActive;
        if (!vodSubActive) {
          loadSubtitleTrack(null);
        } else {
          var info = mediaInfoCache[mediaInfoKey(playSettingsItem())];
          var subs = subtitleLanguageList(info);
          if (!vodCurrentSubtitle && subs.length) {
            vodCurrentSubtitle = subs[0];
          }
          if (vodCurrentSubtitle) {
            loadSubtitleTrack(vodCurrentSubtitle);
          }
        }
        renderDialogSubtitle();
        schedulePlaySettingHide();
      };
    }

    if (dpsSizeOptions) {
      var sBtns = dpsSizeOptions.querySelectorAll('.dps-btn');
      for (var si = 0; si < sBtns.length; si++) {
        (function (b) {
          b._activate = function () {
            vodSubSize = b.getAttribute('data-size') || 'normal';
            applySubtitleStyles();
            renderDialogSubtitle();
          };
        })(sBtns[si]);
      }
    }

    if (dpsStyleOptions) {
      var stBtns = dpsStyleOptions.querySelectorAll('.dps-btn');
      for (var sti = 0; sti < stBtns.length; sti++) {
        (function (b) {
          b._activate = function () {
            vodSubStyle = b.getAttribute('data-style') || 'white';
            applySubtitleStyles();
            renderDialogSubtitle();
          };
        })(stBtns[sti]);
      }
    }

    if (dpsBtnExit) {
      dpsBtnExit._activate = function () {
        closePlaySettingsDialog();
      };
    }

    applySubtitleStyles();
    applyGlobalPlaybackPreferences();

    clear(playerInfo); clear(playerChannels);

    playerStage.classList.add('focusable');
    playerStage._onMove = function (dir) {
      if (state.playerMode === 'vod') {
        if (dir === 'left') { playerSeek(-10); return true; }
        if (dir === 'right') { playerSeek(10); return true; }
        if (dir === 'down') {
          openPlaySettingView();
          return true;
        }
        if (dir === 'up') {
          enterVodScrub();
          return true;
        }
        return false;
      }
      if (dir === 'left') { openChannelPanel(); return true; }
      if (dir === 'right') { closeChannelPanel(); return true; }
      if (dir === 'up') { setChannel(state.channel - 1); return true; }
      if (dir === 'down') { setChannel(state.channel + 1); return true; }
      return false;
    };
    playerStage._activate = function () {
      if (state.playerMode === 'vod') {
        togglePlayerPlayPause();
        return;
      }
      if (state.infobar) { hideInfobar(); }
      else { showInfobar(); }
    };

    /* --- infobar (layout_live_infobar, 160dp = 240px) --- */
    playerInfo.appendChild(el('div', 'pi-logo'));
    playerInfo.appendChild(el('div', 'pi-index'));
    var nameRow = el('div', 'pi-namerow');
    var nm = el('div', 'pi-name');
    nameRow.appendChild(nm);
    var uhd = el('div', 'pi-uhd');
    uhd.style.left = '20px';
    nameRow.appendChild(uhd);
    playerInfo.appendChild(nameRow);
    playerInfo.appendChild(el('div', 'pi-date'));
    playerInfo.appendChild(el('div', 'pi-range'));
    playerInfo.appendChild(el('div', 'pi-now'));
    playerInfo.appendChild(el('div', 'pi-next'));
    var seek = el('div', 'pi-seek');
    seek.appendChild(el('div', 'bar'));
    playerInfo.appendChild(seek);
    playerInfo.appendChild(el('div', 'pi-menu', 'info'));
    playerInfo.appendChild(el('div', 'pi-quality', 'HD'));
    playerInfo.appendChild(el('div', 'pi-scale', 'Normal'));
    playerInfo.appendChild(el('div', 'pi-func', 'Selecion de función'));

    var actions = el('div', 'pi-actions');
    var actDefs = [
      { label: 'Pip', right: 446, w: 67, hidden: true },
      { label: 'HD', right: 389, w: 67 },
      { label: 'Anterior', right: 333, w: 67 },
      { label: 'Formato', right: 249, w: 120 },
      { label: 'Favorito', right: 219, w: 67 },
      { label: 'Reproductor 1', right: 151, w: 90 },
      { label: 'Bloquear', right: 107, w: 67 },
      { label: 'Feedback', right: 50, w: 67 }
    ];
    for (var i = 0; i < actDefs.length; i++) {
      var d = actDefs[i];
      if (d.hidden) { continue; }
      var b = el('div', 'pi-act focusable', d.label);
      b.style.width = (d.w * 1.5) + 'px';
      b.style.left = (1920 - d.right * 1.5 - d.w * 1.5) + 'px';
      b._kind = d.label;
      b._activate = (function (label) {
        return function () {
          if (label === 'Anterior') { setChannel(state.channel - 1); }
          else if (label === 'Formato') {
            var sc = playerInfo.querySelector('.pi-scale');
            sc.textContent = sc.textContent === 'Normal' ? '16:9' : (sc.textContent === '16:9' ? '4:3' : 'Normal');
            layoutInfoTexts();
          } else if (label === 'Favorito') {
            var ch = CHANNELS[state.channel];
            ch.fav = !ch.fav;
          }
        };
      })(d.label);
      actions.appendChild(b);
    }
    playerInfo.appendChild(actions);

    /* --- channel panel (frag_live_channel) with category bar and addons --- */
    var pcHeader = el('div', 'pc-header');
    pcHeader.appendChild(el('div', 'pc-title', 'Canales de TV'));
    playerChannels.appendChild(pcHeader);

    var pcCategories = el('div', 'pc-categories scrollable');
    pcCategories.id = 'pc-categories';
    playerChannels.appendChild(pcCategories);

    playerChannels.appendChild(el('div', 'pc-div'));
    var list = el('div', 'pc-list scrollable');
    playerChannels.appendChild(list);
    renderPlayerCategories();
    renderPlayerChannels();

    var menu = el('div', 'pc-menu');
    menu.appendChild(el('div', 'ic'));
    menu.appendChild(el('div', 'l1', 'Presione [OK] para reproducir'));
    menu.appendChild(el('div', 'l2', '(Arriba: Categorías · OK: Filtrar)'));
    playerChannels.appendChild(menu);
  }

  function renderPlayerCategories() {
    if (!playerChannels) { return; }
    var bar = playerChannels.querySelector('.pc-categories');
    if (!bar) { return; }
    var cats = liveCategories || [];

    /* The portal returns 38 columns.  Rebuilding all 39 pills on every filter
       detached the focused node mid-keypress, so the rail looked alive but the
       d-pad had nowhere to go ("no puedo navegar hacia las categorías").
       The bar is now rebuilt only when the column list itself changes;
       selecting a category just swaps the is-selected class. */
    var key = '';
    for (var kk = 0; kk < cats.length; kk++) { key += cats[kk].id + '|'; }
    var focusedCat = (state.focus && state.focus._cat) ? state.focus._cat : null;

    if (key !== renderedCategoryKey) {
      clear(bar);
      var pills = [];
      for (var i = 0; i < cats.length; i++) {
        var cat = cats[i];
        var pill = el('button', 'pc-cat-pill focusable', cat.name);
        pill._cat = cat;
        pill._idx = i;
        pill._activate = (function (c) {
          return function () { switchLiveCategory(c); };
        })(cat);
        pill._onMove = (function (idx) {
          return function (dir) {
            if (dir === 'left') {
              if (idx > 0 && pills[idx - 1]) {
                setFocus(pills[idx - 1]);
                scrollPillIntoView(bar, pills[idx - 1]);
              }
              return true;
            }
            if (dir === 'right') {
              if (idx < pills.length - 1 && pills[idx + 1]) {
                setFocus(pills[idx + 1]);
                scrollPillIntoView(bar, pills[idx + 1]);
              } else {
                setFocus(playerStage);
              }
              return true;
            }
            if (dir === 'up') {
              /* All portal columns do not fit in the rail, so Up opens the
                 full-screen category grid (the reference app's "all columns"). */
              openCategoryPicker();
              return true;
            }
            if (dir === 'down') {
              var promo = playerChannels.querySelector('.pc-row-addon-promo');
              if (promo) { setFocus(promo); return true; }
              if (CHANNELS.length) { focusPlayerChannel(state.channel); return true; }
            }
            return false;
          };
        })(i);
        bar.appendChild(pill);
        pills.push(pill);
      }
      bar._pills = pills;
      renderedCategoryKey = key;
    }

    var current = currentLiveCategory || cats[0];
    var now = bar._pills || [];
    for (var j = 0; j < now.length; j++) {
      var p = now[j];
      if (p._cat && current && p._cat.id === current.id) { p.classList.add('is-selected'); }
      else { p.classList.remove('is-selected'); }
    }

    /* Filtering must leave the d-pad on the rail, on the same pill. */
    if (focusedCat) {
      var same = null;
      for (var m = 0; m < now.length; m++) {
        if (now[m]._cat && now[m]._cat.id === focusedCat.id) { same = now[m]; break; }
      }
      if (same) {
        if (state.focus !== same) { setFocus(same); }
        scrollPillIntoView(bar, same);
      }
    }
  }

  function scrollSelectedCategoryPill() {
    if (!playerChannels) { return; }
    var bar = playerChannels.querySelector('.pc-categories');
    var pill = bar ? bar.querySelector('.pc-cat-pill.is-selected') : null;
    if (bar && pill) { scrollPillIntoView(bar, pill); }
  }

  /* Full-screen column picker.  The reference APK opens a separate "all
     columns" screen from the live home (mIvAllColumn); 38 portal categories
     cannot fit in the 453dp in-player rail, so Up on the rail opens this grid. */
  function openCategoryPicker() {
    if (!categoryPicker) {
      categoryPicker = $('player-categories');
      pcatGrid = $('pcat-grid');
      pcatSub = $('pcat-sub');
    }
    if (!categoryPicker || !pcatGrid) { return; }
    state.categoryPickerOpen = true;
    categoryPicker.classList.add('is-active');
    hideInfobar();
    renderCategoryPicker();
    var cur = pcatGrid.querySelector('.pcat-tile.is-selected') || firstIn(pcatGrid);
    if (cur) { setFocus(cur); }
  }

  function closeCategoryPicker(keepFocus) {
    if (!categoryPicker || !state.categoryPickerOpen) { return; }
    state.categoryPickerOpen = false;
    categoryPicker.classList.remove('is-active');
    if (keepFocus) { return; }
    var pill = playerChannels ? playerChannels.querySelector('.pc-cat-pill.is-selected') : null;
    if (pill) { setFocus(pill); scrollSelectedCategoryPill(); }
    else if (state.screen === 'player' && playerStage) { setFocus(playerStage); }
  }

  function renderCategoryPicker() {
    if (!pcatGrid) { return; }
    var cats = liveCategories && liveCategories.length ? liveCategories : [];
    clear(pcatGrid);
    if (pcatSub) {
      pcatSub.textContent = cats.length
        ? (cats.length + ' categorías · elige una para filtrar los canales')
        : 'Cargando categorías…';
    }
    for (var i = 0; i < cats.length; i++) {
      (function (cat) {
        var tile = el('div', 'pcat-tile focusable');
        tile.appendChild(el('div', 'pcat-name', cat.name));
        if (currentLiveCategory && currentLiveCategory.id === cat.id) { tile.classList.add('is-selected'); }
        tile._cat = cat;
        tile._activate = function () {
          switchLiveCategory(cat);
          closeCategoryPicker(true);
          var pill = playerChannels ? playerChannels.querySelector('.pc-cat-pill.is-selected') : null;
          if (pill) { setFocus(pill); scrollSelectedCategoryPill(); }
          else { closeChannelPanel(); }
        };
        pcatGrid.appendChild(tile);
      })(cats[i]);
    }
  }

  function scrollPillIntoView(bar, pill) {
    if (!bar || !pill) { return; }
    var pl = pill.offsetLeft;
    var pw = pill.offsetWidth;
    var bl = bar.scrollLeft;
    var bw = bar.clientWidth;
    if (pl < bl) { bar.scrollLeft = pl - 20; }
    else if (pl + pw > bl + bw) { bar.scrollLeft = pl + pw - bw + 20; }
  }

  function focusPlayerChannel(index) {
    if (!CHANNELS.length) { return; }
    index = Math.max(0, Math.min(CHANNELS.length - 1, Number(index) || 0));
    if (!playerChannelRows[index]) { renderPlayerChannels(index); }
    if (playerChannelRows[index]) { setFocus(playerChannelRows[index]); }
  }

  function renderPlayerChannels(anchorIndex) {
    if (!playerChannels) { return; }
    var list = playerChannels.querySelector('.pc-list');
    if (!list) { return; }
    clear(list);
    playerChannelRows = {};

    /* If in Addons category, display manage promo header at top */
    if (currentLiveCategory && currentLiveCategory.isAddon) {
      var promo = el('div', 'pc-row-addon-promo focusable');
      promo.appendChild(el('div', 'promo-icon', '⚙️'));
      var promoInfo = el('div', 'promo-info');
      promoInfo.appendChild(el('div', 'promo-text', '➕ Administrar Addons y Listas M3U'));
      promoInfo.appendChild(el('div', 'promo-sub', 'Instala listas recomendadas o agrega tu enlace'));
      promo.appendChild(promoInfo);
      promo._activate = function () { openAddonsDialog(); };
      promo._onMove = function (dir) {
        if (dir === 'up') {
          var selCat = playerChannels.querySelector('.pc-cat-pill.is-selected') || playerChannels.querySelector('.pc-cat-pill');
          if (selCat) { setFocus(selCat); }
          return true;
        }
        if (dir === 'down') {
          if (CHANNELS.length) { focusPlayerChannel(0); }
          return true;
        }
        if (dir === 'right') { setFocus(playerStage); return true; }
        return false;
      };
      list.appendChild(promo);
    }

    if (!CHANNELS.length) {
      var emptyRow = el('div', 'pc-empty-channels', 'No hay canales disponibles en esta categoría');
      emptyRow.style.padding = '30px';
      emptyRow.style.color = '#888';
      emptyRow.style.fontSize = '20px';
      list.appendChild(emptyRow);
      return;
    }

    anchorIndex = Number(anchorIndex);
    if (!isFinite(anchorIndex)) { anchorIndex = state.channel; }
    anchorIndex = Math.max(0, Math.min(CHANNELS.length - 1, anchorIndex || 0));
    var firstChannel = Math.max(0, anchorIndex - Math.floor(LIVE_PANEL_WINDOW / 2));
    var lastChannel = Math.min(CHANNELS.length, firstChannel + LIVE_PANEL_WINDOW);
    firstChannel = Math.max(0, lastChannel - LIVE_PANEL_WINDOW);

    for (var c = firstChannel; c < lastChannel; c++) {
      var row = el('div', 'pc-row focusable');
      row._channel = c;
      var ic = el('div', 'ic');
      if (CHANNELS[c].logo) {
        ic.style.backgroundImage = 'url(' + CHANNELS[c].logo + ')';
        ic.style.backgroundSize = 'contain';
        ic.style.backgroundRepeat = 'no-repeat';
        ic.style.backgroundPosition = 'center';
      }
      var num = el('div', 'num', pad2(CHANNELS[c].index || (c + 1)));
      var nm2 = el('div', 'nm', CHANNELS[c].name);
      var epg = el('div', 'epg', CHANNELS[c].now || 'En vivo');
      row.appendChild(ic); row.appendChild(num); row.appendChild(nm2); row.appendChild(epg);
      if (c === state.channel) { row.classList.add('is-current'); }
      row._activate = (function (idx) {
        return function () {
          setChannel(idx, true);
          closeChannelPanel();
          setFocus(playerStage);
        };
      })(c);
      row._onMove = (function (idx) {
        return function (dir) {
          if (dir === 'right') { setFocus(playerStage); return true; }
          if (dir === 'up') {
            if (idx > 0) {
              focusPlayerChannel(idx - 1);
            } else if (idx === 0) {
              var promo = playerChannels.querySelector('.pc-row-addon-promo');
              if (promo) { setFocus(promo); }
              else {
                var selCat = playerChannels.querySelector('.pc-cat-pill.is-selected') || playerChannels.querySelector('.pc-cat-pill');
                if (selCat) { setFocus(selCat); }
              }
            }
            return true;
          }
          if (dir === 'down') {
            if (idx < CHANNELS.length - 1) { focusPlayerChannel(idx + 1); }
            return true;
          }
          return false;
        };
      })(c);
      list.appendChild(row);
      playerChannelRows[c] = row;
    }
  }

  var lastProxyOrigin = '';
  var lastPlayingUrl = '';
  /* Generation counter: incremented every time we start a new stream.
     Async resolve callbacks check this before calling playUrl() so that
     stale responses from previously-selected items are silently dropped. */
  var resolveSeq = 0;
  var relayBaseUrl = '';
  var relayStartOffset = 0;
  /* A fragmented MP4 relay is a one-way HTTP stream.  Several older webOS
     players do not resume that socket after a long pause; opening its local
     URL again at the same offset is the reliable native resume operation. */
  var relayPaused = false;

  function resumePlayerPlayback() {
    if (!playerVideo) { return; }
    if (relayPaused && relayBaseUrl && state.playerMode === 'vod') {
      var base = relayBaseUrl;
      var position = Math.max(0, Math.floor(relayStartOffset + (playerVideo.currentTime || 0)));
      relayPaused = false;
      var resumeUrl = base + '?start=' + position;
      if (vodCurrentAudioTrack) { resumeUrl += '&a=' + vodCurrentAudioTrack; }
      setPlayerStatus('Reanudando vídeo…');
      playUrl(resumeUrl);
      return;
    }
    try {
      var p = playerVideo.play();
      if (p && p.catch) { p.catch(function () {}); }
    } catch (ePlay) { /* native player rejected resume */ }
  }

  /* Accumulated seek delta + timer for debouncing rapid seek keypresses.
     webOS Starfish fires a full setPreload/dispatchBufferingStart cycle
     for every currentTime assignment, so we batch rapid presses. */
  var seekPending = 0;
  var seekTimer = null;
  /* Starfish emits transient waiting/stalled events even when its HLS buffer
     recovers before a frame is missed.  Delay the visual notice so those
     micro-events do not flash "Cargando vídeo" over a healthy channel. */
  var bufferingNoticeTimer = null;
  function clearBufferingNotice() {
    if (bufferingNoticeTimer) {
      clearTimeout(bufferingNoticeTimer);
      bufferingNoticeTimer = null;
    }
  }
  function scheduleBufferingNotice(text) {
    if (bufferingNoticeTimer || state.streamError) { return; }
    bufferingNoticeTimer = setTimeout(function () {
      bufferingNoticeTimer = null;
      if (!state.streamError && playerVideo && !playerVideo.paused && playerVideo.readyState < 3) {
        setPlayerStatus(text);
      }
    }, 700);
  }
  /* Fragmented-MP4 seeks restart the native video pipeline on webOS 4.  Do
     not start a second one until that pipeline has acknowledged the first. */
  var relaySeekInFlight = false;
  var relaySeekWatchdog = null;
  function releaseRelaySeek() {
    relaySeekInFlight = false;
    if (relaySeekWatchdog) { clearTimeout(relaySeekWatchdog); relaySeekWatchdog = null; }
  }
  function flushSeek() {
    seekTimer = null;
    if (!playerVideo || !seekPending) { seekPending = 0; return; }
    if (relayBaseUrl) {
      if (relaySeekInFlight) { seekPending = 0; return; }
      relaySeekInFlight = true;
      var curSec = relayStartOffset + (playerVideo.currentTime || 0);
      var target = Math.max(0, curSec + seekPending);
      seekPending = 0;
      var totalDur = (state.playerItem && state.playerItem.duration) || playerVideo.duration || 0;
      if (totalDur > 0 && target > totalDur - 2) { target = Math.max(0, totalDur - 2); }
      relayStartOffset = Math.floor(target);
      var seekUrl = relayBaseUrl + '?start=' + relayStartOffset;
      /* A failed upstream request must not leave controls locked forever. */
      relaySeekWatchdog = setTimeout(releaseRelaySeek, 12000);
      playUrl(seekUrl);
      return;
    }
    var t = (playerVideo.currentTime || 0) + seekPending;
    seekPending = 0;
    var dur = playerVideo.duration || 0;
    if (t < 0) { t = 0; }
    if (dur > 0 && t > dur - 1) { t = dur - 1; }
    try { playerVideo.currentTime = t; } catch (eSeek) { /* ignore */ }
  }
  function playerSeek(delta) {
    if (!playerVideo) { return; }
    seekPending += delta;
    if (seekTimer) { clearTimeout(seekTimer); }
    seekTimer = setTimeout(flushSeek, 800);
    /* OSD feedback while seeking */
    showOsdIcon(delta > 0 ? 'fwd' : 'rew');
    setTimeout(function () { showOsdIcon('none'); }, 600);
  }

  function vodPlaybackPosition() {
    if (!playerVideo) { return 0; }
    return relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
  }

  function vodPlaybackDuration() {
    var duration = (playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0) ? playerVideo.duration : 0;
    if (!duration && state.playerEpisode && state.playerEpisode.duration) { duration = durationToSeconds(state.playerEpisode.duration); }
    if (!duration && state.playerItem && state.playerItem.duration) { duration = durationToSeconds(state.playerItem.duration); }
    return duration || 0;
  }

  function leaveVodScrub(apply) {
    if (!vodScrubbing) { return; }
    var target = vodScrubTime;
    var before = vodPlaybackPosition();
    vodScrubbing = false;
    if (vodSeekbar) { vodSeekbar.classList.remove('is-scrubbing'); }
    if (apply && Math.abs(target - before) >= 1) { playerSeek(target - before); }
    updateVodProgress(vodPlaybackPosition(), vodPlaybackDuration());
    setFocus(playerStage);
    scheduleInfoHide();
  }

  function enterVodScrub() {
    var duration = vodPlaybackDuration();
    if (!vodSeekbar || !duration) { showInfobar(); return; }
    vodScrubTime = Math.max(0, Math.min(duration - 1, vodPlaybackPosition()));
    vodScrubbing = true;
    vodSeekbar.classList.add('is-scrubbing');
    showInfobar();
    if (state.infoTimer) { clearTimeout(state.infoTimer); state.infoTimer = null; }
    updateVodProgress(vodScrubTime, duration);
    setFocus(vodSeekbar);
  }

  function moveVodScrub(direction) {
    var duration = vodPlaybackDuration();
    if (!vodScrubbing || !duration) { return; }
    var step = Math.max(60, Math.min(300, Math.round(duration * 0.05)));
    vodScrubTime = Math.max(0, Math.min(duration - 1, vodScrubTime + (direction * step)));
    updateVodProgress(vodScrubTime, duration);
  }

  function stopPlayerVideo() {
    if (!window.PalmServiceBridge) { cancelBrowserLivePlayback(); }
    if (state.playerMode === 'vod' && playerVideo) {
      var stopPosition = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
      var stopDuration = (playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0) ? playerVideo.duration :
        durationToSeconds((state.playerEpisode && state.playerEpisode.duration) || (state.playerItem && state.playerItem.duration) || 0);
      rememberWatchProgress(stopPosition, stopDuration, true);
    }
    state.streamError = '';
    clearBufferingNotice();
    setPlayerStatus('');
    showOsdIcon('none');
    stopVodProgressTicker();
    if (window.__xuperHls) {
      window.__xuperHls.destroy();
      window.__xuperHls = null;
    }
    /* Keep the settings panel/dialog open across an audio/quality restart;
       back() and screen changes close them. Keep the loaded cues too: an
       audio/quality switch replaces the source but not the subtitles, and
       showScreen() clears them when the player is really left. */
    /* Cancel any pending seek */
    if (seekTimer) { clearTimeout(seekTimer); seekTimer = null; seekPending = 0; }
    releaseRelaySeek();
    relayPaused = false;
    relayBaseUrl = '';
    relayStartOffset = 0;
    /* Increment generation so any in-flight resolve() callback is ignored */
    resolveSeq++;
    var proxyToAbort = lastProxyOrigin;
    if (!proxyToAbort && lastPlayingUrl && lastPlayingUrl.indexOf('127.0.0.1') !== -1) {
      var m = /^(http:\/\/127\.0\.0\.1:\d+)/.exec(lastPlayingUrl);
      if (m) { proxyToAbort = m[1]; }
    }
    if (proxyToAbort) {
      try {
        var abortXhr = new XMLHttpRequest();
        abortXhr.open('GET', proxyToAbort + '/media/abort', true);
        abortXhr.send();
      } catch (eAbort) { /* ignore */ }
    }
    try {
      portalServiceCall('abortMedia', {}, function () {});
    } catch (eSvc) { /* ignore */ }
    lastPlayingUrl = '';
    lastProxyOrigin = '';
    if (!playerVideo) { return; }
    /* Detach the old Starfish pipeline callbacks before clearing its source.
       Otherwise an asynchronous error from the previous episode can invoke
       the new episode's handler and briefly paint a misleading código 4. */
    playerVideo.onerror = null;
    playerVideo.onwaiting = null;
    playerVideo.onstalled = null;
    playerVideo.onloadeddata = null;
    playerVideo.oncanplay = null;
    playerVideo.onloadedmetadata = null;
    playerVideo.ondurationchange = null;
    playerVideo.onplaying = null;
    playerVideo.onended = null;
    playerVideo.ontimeupdate = null;
    playerVideo.onpause = null;
    playerVideo.onplay = null;
    try { playerVideo.pause(); } catch (e) { /* ignore */ }
    try { playerVideo.currentTime = 0; } catch (e) { /* ignore */ }
    playerVideo.removeAttribute('src');
    try { playerVideo.src = ''; } catch (e) { /* ignore */ }
    while (playerVideo.firstChild) {
      playerVideo.removeChild(playerVideo.firstChild);
    }
    /* NOTE: do NOT call playerVideo.load() here.
       A bare load() with no <source> briefly creates a WebMediaPlayerUMS
       pipeline in Starfish (AID=N) that gets destroyed milliseconds later
       when the real load() arrives, wasting one ACB slot and ~70ms. */
    playerVideo.classList.remove('is-active');
    if (playerFrame) { playerFrame.style.display = 'block'; }
  }

  function setPlayerStatus(text) {
    if (!playerStatus) { playerStatus = $('player-status'); }
    if (!playerStatus) { return; }
    if (text) {
      playerStatus.textContent = text;
      playerStatus.classList.add('is-active');
    } else {
      playerStatus.textContent = '';
      playerStatus.classList.remove('is-active');
    }
  }

  function playUrl(url, playOptions) {
    if (!playerVideo || !url) { return; }
    playOptions = playOptions || {};
    var useNativeHlsFallback = !!playOptions.nativeHls;
    var browserMode = !window.PalmServiceBridge;
    stopPlayerVideo();
    relayPaused = false;
    lastPlayingUrl = url;
    var mOrigin = /^(http:\/\/127\.0\.0\.1:\d+)/.exec(url);
    if (mOrigin) { lastProxyOrigin = mOrigin[1]; }
    if (url.indexOf(':8787/s/') !== -1) {
      relayBaseUrl = url.split('?')[0];
      var mStart = /[?&]start=(\d+)/.exec(url);
      relayStartOffset = mStart ? parseInt(mStart[1], 10) : 0;
    } else {
      relayBaseUrl = '';
      relayStartOffset = 0;
    }
    setPlayerStatus('Conectando con el vídeo…');
    state.streamError = '';

    /* The markup defaults to auto too, but set it again because Starfish can
       retain the previous resource's preload mode after source replacement. */
    try { playerVideo.preload = 'auto'; } catch (ePreload) { /* ignore */ }

    var rawMime = (state.playerItem && state.playerItem.streamMime) || '';
    var isHls = (url.indexOf('.m3u8') !== -1) || (rawMime.indexOf('mpegurl') !== -1) || !!(state.playerItem && state.playerItem.isHls) || (browserMode && /[?&]manifest=1(?:&|$)/.test(url));
    var mime = isHls ? 'application/vnd.apple.mpegurl' : ((url.indexOf('.mp4') !== -1 || rawMime.indexOf('mp4') !== -1) ? 'video/mp4' : 'video/mp2t');
    var useBrowserHls = !!(browserMode && isHls && window.Hls && window.Hls.isSupported());

    playerVideo.onerror = function () {
      hideNextEpisodeLoading();
      releaseRelaySeek();
      var code = playerVideo.error && playerVideo.error.code;
      /* Some newer webOS releases reject Starfish's legacy mediaOption
         parameter for every HLS channel and report MEDIA_ERR_SRC_NOT_SUPPORTED
         (4). Retry only live HLS once with the standard HTML5 HLS source.
         VOD and the FFmpeg Modo Fluido path are intentionally untouched. */
      if (code === 4 && state.playerMode === 'live' && isHls && !useNativeHlsFallback) {
        var failedChannelSeq = liveChannelSeq;
        setPlayerStatus('Reintentando señal con compatibilidad webOS…');
        setTimeout(function () {
          if (state.playerMode === 'live' && liveChannelSeq === failedChannelSeq) {
            playUrl(url, { nativeHls: true });
          }
        }, 0);
        return;
      }
      /* A manual language change on the direct pipeline must preserve Normal
         mode.  Do not mistake the transient native-track error for an
         unsupported stream and silently restart through the FFmpeg relay. */
      if (code === 4 && state.playerMode === 'vod' && state.streamMode === 'normal' &&
          audioTrackSwitchUntil && Date.now() < audioTrackSwitchUntil) {
        audioTrackSwitchUntil = 0;
        state.streamError = 'No fue posible cambiar el idioma en reproducción Normal';
        setPlayerStatus(state.streamError);
        return;
      }
      /* Some portal VOD files are rejected by a TV's direct TS pipeline even
         though the same HEVC/AAC content plays when remuxed as fragmented MP4.
         Retry once through the protected Modo Fluido route, never in a loop.
         The retry belongs to this episode only: remembering it for the whole
         series opened every following episode in Modo Fluido even after the
         viewer picked Normal. */
      if (window.PalmServiceBridge && code === 4 && state.playerMode === 'vod' && state.streamMode === 'normal' && state.playerItem) {
        var failedItem = state.playerItem;
        var failedKey = mediaInfoKey(failedItem) || smoothModeKey(failedItem);
        if (autoSmoothFallbackKey !== failedKey) {
          autoSmoothFallbackKey = failedKey;
          state.streamMode = 'smooth';
          setPlayerStatus('Reintentando película en modo compatible…');
          setTimeout(function () {
            if (state.playerMode === 'vod' && state.playerItem === failedItem && state.streamMode === 'smooth') {
              restartCurrentPlayback();
            }
          }, 0);
          return;
        }
      }
      state.streamError = 'No se pudo abrir el stream (código ' + (code || 'error') + ')';
      playerVideo.classList.remove('is-active');
      if (playerFrame) { playerFrame.style.display = 'block'; }
      setPlayerStatus(state.streamError);
    };
    function clearStatus() {
      clearBufferingNotice();
      setPlayerStatus('');
    }
    playerVideo.onloadeddata = function () {
      if (state.playerMode !== 'vod') { clearStatus(); }
    };
    playerVideo.oncanplay = function () {
      releaseRelaySeek();
      if (state.playerMode !== 'vod') { clearStatus(); }
    };
    playerVideo.onloadedmetadata = function () {
      /* Prefer Spanish on the direct path as well.  Android chooses this PID
         internally; on webOS it is exposed only when the native AudioTrackList
         becomes available with the loaded media metadata. */
      if (state.playerMode === 'vod' && state.streamMode === 'normal') {
        var audioInfo = (state.playerItem && state.playerItem.streamAudioInfo);
        var nativeTrack = vodAudioChosen ? vodCurrentAudioTrack : preferredAudioIndex(audioInfo);
        if (selectNativeAudioTrack(nativeTrack)) {
          vodCurrentAudioTrack = nativeTrack;
        }
      }
      if (state.playerMode === 'vod') {
        var cur = relayBaseUrl ? relayStartOffset : (playerVideo.currentTime || 0);
        var vidDur = (playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0) ? playerVideo.duration : 0;
        var epDur = (state.playerEpisode && state.playerEpisode.duration) ? durationToSeconds(state.playerEpisode.duration) : 0;
        var itemDur = (state.playerItem && state.playerItem.duration) ? durationToSeconds(state.playerItem.duration) : 0;
        var totalDur = vidDur || epDur || itemDur || 0;
        updateVodProgress(cur, totalDur);
      }
    };
    playerVideo.ondurationchange = function () {
      if (state.playerMode === 'vod') {
        var cur = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
        var vidDur = (playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0) ? playerVideo.duration : 0;
        var epDur = (state.playerEpisode && state.playerEpisode.duration) ? durationToSeconds(state.playerEpisode.duration) : 0;
        var itemDur = (state.playerItem && state.playerItem.duration) ? durationToSeconds(state.playerItem.duration) : 0;
        var totalDur = vidDur || epDur || itemDur || 0;
        updateVodProgress(cur, totalDur);
      }
    };
    playerVideo.onplaying = function () {
      hideNextEpisodeLoading();
      clearStatus();
    };
    playerVideo.onended = function () {
      if (state.playerMode === 'vod') { advanceToNextEpisode(); }
    };
    playerVideo.ontimeupdate = function () {
      if (playerVideo.currentTime > 0) { clearStatus(); }
      if (state.playerMode === 'vod') {
        var cur = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
        var vidDur = (playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0) ? playerVideo.duration : 0;
        var epDur = (state.playerEpisode && state.playerEpisode.duration) ? durationToSeconds(state.playerEpisode.duration) : 0;
        var itemDur = (state.playerItem && state.playerItem.duration) ? durationToSeconds(state.playerItem.duration) : 0;
        var totalDur = vidDur || epDur || itemDur || 0;
        updateVodProgress(cur, totalDur);
        updateSubtitleDisplay(cur);
        rememberWatchProgress(cur, totalDur);
      }
    };
    playerVideo.onpause = function () {
      stopVodProgressTicker();
      if (state.playerMode === 'vod') {
        var pausePosition = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
        var pauseDuration = (playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0) ? playerVideo.duration :
          durationToSeconds((state.playerEpisode && state.playerEpisode.duration) || (state.playerItem && state.playerItem.duration) || 0);
        rememberWatchProgress(pausePosition, pauseDuration, true);
        showOsdIcon('pause');
        if (relayBaseUrl) { relayPaused = true; }
      }
    };
    playerVideo.onplay = function () {
      if (state.playerMode === 'vod') {
        showOsdIcon('none');
        startVodProgressTicker();
      }
    };
    playerVideo.onwaiting = function () {
      scheduleBufferingNotice('Cargando vídeo…');
    };
    playerVideo.onstalled = function () {
      scheduleBufferingNotice('Conectando…');
    };

    var transportOptions = {
      mediaTransportType: isHls ? 'HLS' : 'URI',
      option: {
        transmission: {
          playTime: { start: 0 }
        }
      }
    };
    var mediaOption = encodeURI(JSON.stringify(transportOptions));
    var typeStr = (browserMode || useNativeHlsFallback) ? mime : (mime + ';mediaOption=' + mediaOption);

    while (playerVideo.firstChild) {
      playerVideo.removeChild(playerVideo.firstChild);
    }
    playerVideo.removeAttribute('src');
    /* Newer webOS uses the MIME type and rejects the old custom property.
       Older sets retain the existing path above as their first attempt. */
    if (!browserMode && !useNativeHlsFallback) {
      try { playerVideo.mediaOption = transportOptions; } catch (eOpt) {}
    } else if (!browserMode) {
      try { playerVideo.mediaOption = null; } catch (eClearOpt) {}
    }

    var srcNode = document.createElement('source');
    srcNode.setAttribute('src', url);
    srcNode.setAttribute('type', typeStr);
    if (isHls && !browserMode) {
      /* LG's HLS pipeline reads mediaOption from the source element. Setting
         video.src afterwards replaces that source and silently drops HLS mode
         on recent webOS releases, resulting in MEDIA_ERR_SRC_NOT_SUPPORTED. */
      try { playerVideo.load(); } catch (eHlsReset) { /* ignore */ }
    }
    if (!useBrowserHls) { playerVideo.appendChild(srcNode); }

    if ((!isHls || browserMode) && !useBrowserHls) {
      /* Starfish on webOS 3–6 does not reliably start a non-HLS <source>
         alone.  Keep the source node (for mediaOption) AND assign src, also
         for the local Fluent relay.  This is the proven 1.6.15 behaviour and
         prevents the player from staying forever at “Conectando…”. */
      try { playerVideo.src = url; } catch (eSrc) {}
    }
    try { playerVideo.currentTime = 0; } catch (eCt) {}

    playerVideo.classList.add('is-active');
    if (playerFrame) { playerFrame.style.display = 'none'; }
    var nativeHls = !!playerVideo.canPlayType('application/vnd.apple.mpegurl');
    if (browserMode && isHls && !nativeHls && !useBrowserHls) {
      state.streamError = 'Esta fuente requiere HLS.js y el navegador no pudo cargarlo.';
      playerVideo.classList.remove('is-active');
      if (playerFrame) { playerFrame.style.display = 'block'; }
      setPlayerStatus(state.streamError);
      return;
    }
    if (useBrowserHls) {
      try {
        window.__xuperHls = window.__xuperHls || null;
        if (window.__xuperHls) { window.__xuperHls.destroy(); }
        var hls = new window.Hls({ enableWorker: false, progressive: true, maxBufferLength: 30 });
        window.__xuperHls = hls;
        hls.on(window.Hls.Events.ERROR, function (event, data) {
          if (!data || !data.fatal || window.__xuperHls !== hls) { return; }
          hideNextEpisodeLoading();
          clearBufferingNotice();
          releaseRelaySeek();
          var httpCode = data.response && data.response.code;
          state.streamError = 'No se pudo reproducir el video: ' + (data.details || 'error HLS') +
            (httpCode ? (' (HTTP ' + httpCode + ')') : '') +
            (state.playerItem && state.playerItem.streamCodec ? (' · Códec: ' + state.playerItem.streamCodec) : '');
          hls.destroy();
          window.__xuperHls = null;
          playerVideo.classList.remove('is-active');
          if (playerFrame) { playerFrame.style.display = 'block'; }
          setPlayerStatus(state.streamError);
        });
        hls.on(window.Hls.Events.MEDIA_ATTACHED, function () {
          if (window.__xuperHls === hls) { hls.loadSource(url); }
        });
        hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
          if (window.__xuperHls !== hls) { return; }
          var p = playerVideo.play();
          if (p && p.catch) { p.catch(function () { if (window.__xuperHls === hls) { setPlayerStatus('Pulsa OK para iniciar la reproducción'); } }); }
        });
        hls.attachMedia(playerVideo);
      } catch (eHls) {
        state.streamError = 'No se pudo iniciar HLS: ' + (eHls.message || eHls);
        setPlayerStatus(state.streamError);
      }
    } else try {
      playerVideo.load();
      var p = playerVideo.play();
      if (p && p.catch) {
        p.catch(function () {
          if (playerVideo.error) { return; }
          state.streamError = 'Pulsa OK para iniciar la reproducción';
          setPlayerStatus(state.streamError);
        });
      }
    } catch (e2) {
      state.streamError = 'Pulsa OK para iniciar la reproducción';
      setPlayerStatus(state.streamError);
    }
  }

  /* Portal titles need a license + CDN auth that <video> cannot send: the
     service resolves them and exposes a loopback proxy URL.
     We capture the current resolveSeq at call time; if it changes before
     the async response arrives (user navigated away), we discard the result. */
  function resolvePlayerStream(item, done) {
    var mySeq = resolveSeq;
    function resolveNow() {
      var params = { contentId: item.id };
      params.playbackMode = state.streamMode;
      params.forceRelay = state.streamMode === 'smooth' || state.streamMode === 'relay';
      params.trackIndex = state.trackIndex || 0;
      /* Prefer the Spanish PID like the real app when mediaInfo already
         answered; the relay maps it with ffmpeg -map 0:a:<n>. */
      var ep = state.playerEpisode;
      var epKey = (ep && ep.id) || (item && item.id) || '';
      var cachedInfo = mediaInfoCache[epKey] || mediaInfoCache[mediaInfoKey(item)];
      /* Spanish is the default for every episode.  Index 0 is NOT Spanish:
         the portal lists the PIDs in stream order ("por,spa,eng"), so sending
         0 after an episode change made playback start in Portuguese (and the
         FFmpeg relay map the Portuguese PID). */
      var audioList = (cachedInfo && cachedInfo.audio) || (ep && ep.streamAudioInfo) || item.streamAudioInfo || '';
      if (vodAudioChosen) {
        vodCurrentAudioTrack = Math.max(0, Number(vodCurrentAudioTrack) || 0);
      } else {
        vodCurrentAudioTrack = preferredAudioIndex(audioList);
      }
      params.audioTrack = vodCurrentAudioTrack || 0;
      if (isSeriesItem(item)) {
        var epSeries = state.playerEpisode;
        var seriesRef = item.seasonId || item.id;
        if (epSeries && epSeries.id) {
          params.contentId = epSeries.id;
          params.seriesContentId = seriesRef;
        } else {
          if (!item.episodes || !item.episodes.length) { return done(''); }
          state.playerEpisode = item.episodes[0];
          params.contentId = item.episodes[0].id;
          params.seriesContentId = seriesRef;
        }
      }
      var resolveMethod = params.forceRelay ? 'resolveSmooth' : 'resolve';
      if (!window.PalmServiceBridge && params.forceRelay) {
        state.streamError = 'Modo Fluido necesita FFmpeg en el servicio nativo webOS.';
        setPlayerStatus(state.streamError);
        return done('');
      }
      portalServiceCall(resolveMethod, params, function (error, payload) {
        /* Stale response: user already navigated to something else */
        if (mySeq !== resolveSeq) { return; }
        if (error || !payload || payload.returnValue === false) {
          state.streamError = 'No se pudo resolver el título' + (error ? ': ' + error : '');
          setPlayerStatus(state.streamError);
          return done('');
        }
        rememberCdnProbe('vod', payload);
        item.streamMime = payload.mime || '';
        item.streamCodec = payload.codec || '';
        item._htmlMediaToken = payload.mediaToken || '';
        if (payload.duration > 0) {
          item.duration = payload.duration;
          if (state.playerEpisode) { state.playerEpisode.duration = payload.duration; }
        } else {
          item.duration = item.duration || 0;
        }
        item.subtitles = payload.subtitles || [];
        item.streamAudioInfo = payload.audio || item.streamAudioInfo || '';
        if (state.playerEpisode) { state.playerEpisode.streamAudioInfo = payload.audio || ''; }
        item.isHls = !!payload.isHls;
        if (!vodAudioChosen && payload.audio) {
          vodCurrentAudioTrack = preferredAudioIndex(payload.audio);
        }
        /* resolve already completed startPlayVOD.  Reuse its audio/subtitle
           metadata in the panel instead of requesting the same episode a
           second time when the viewer changes chapters. */
        var resolvedInfo = {
          audio: payload.audio || item.streamAudioInfo,
          subtitles: item.subtitles,
          tracks: payload.availableTracks || [],
          selected: payload.selectedTrack || {},
          duration: payload.duration || 0
        };
        mediaInfoCache[mediaInfoKey(item)] = resolvedInfo;
        applySubtitleDefaults(resolvedInfo);
        /* Read-only local diagnostics for the webOS inspector.  Do not place
           the stream URL, licence or headers here. */
        try {
          window.__xuperStreamInfo = {
            selectedTrack: payload.selectedTrack || {},
            availableTracks: payload.availableTracks || []
          };
        } catch (eDiag) { /* ignore */ }
        var playUrlValue = payload.proxyPath || payload.url || '';
        if (!window.PalmServiceBridge && payload.mediaToken) {
          playUrlValue = payload.mediaUrl || payload.url || '/api/media?token=' + encodeURIComponent(payload.mediaToken) + (payload.isHls ? '&manifest=1' : '');
        }
        item._htmlSubtitleUrls = (payload.subtitles || []).map(function (sub) { return sub.url; });
        done(playUrlValue);
      });
    }
    if (isSeriesItem(item) && !state.playerEpisode && (!item.episodes || !item.episodes.length) && !item._detailsLoaded) {
      setPlayerStatus('Cargando capítulos…');
      loadVodDetail(item, function () {
        if (mySeq !== resolveSeq) { return; }
        resolveNow();
      });
      return;
    }
    resolveNow();
  }

  function startPlayerVideo(item, episode) {
    if (!playerVideo) { return; }
    if (episode) {
      state.playerEpisode = episode;
      state.playerSeasonIndex = state.detailSeason || 0;
    }
    if (item) { state.playerItem = item; }
    var it = item || state.playerItem;
    if (it) { restoreSmoothMode(it); }
    stopPlayerVideo();
    if (!it) { return; }
    vodAudioChosen = false;
    vodCurrentAudioTrack = 0;
    /* resolvePlayerStream returns the same audio/subtitle metadata needed by
       the dialog.  Do not issue mediaInfo in parallel here: on every episode
       change that duplicated startPlayVOD and delayed the next chapter.  It is
       only requested while the audio PID order is still unknown, because the
       portal lists it in stream order (index 0 is not Spanish) and Modo Fluido
       maps that index inside FFmpeg. */
    var currentEp = episode || state.playerEpisode;
    var epKey = (currentEp && currentEp.id) || (it && it.id) || '';
    var epInfo = epKey ? mediaInfoCache[epKey] : null;
    var knownAudio = (epInfo && epInfo.audio) || (currentEp && currentEp.streamAudioInfo) || '';
    if (it._portal && window.PalmServiceBridge && !vodAudioChosen && !knownAudio) {
      var started = false;
      var startSeq = resolveSeq;
      var proceed = function () {
        if (started || startSeq !== resolveSeq) { return; }
        started = true;
        var epNum = episode ? (episode.number || episode.seriesNumber || '') : '';
        setPlayerStatus(isSeriesItem(it) ? (epNum ? ('Cargando capítulo ' + epNum + '…') : 'Cargando capítulo…') : 'Cargando película…');
        resolvePlayerStream(it, function (url) {
          if (url) { playUrl(url); }
          else if (!state.streamError) { state.streamError = 'El portal no entregó una fuente para este título.'; setPlayerStatus(state.streamError); }
        });
      };
      /* Never hold playback on the metadata call: after 2.5 s resolve anyway. */
      setTimeout(proceed, 2500);
      ensureMediaInfo(it, function (info) {
        proceed();
      });
      return;
    }
    if (it._portal) {
      var epNum = episode ? (episode.number || episode.seriesNumber || '') : '';
      setPlayerStatus(isSeriesItem(it) ? (epNum ? ('Cargando capítulo ' + epNum + '…') : 'Cargando capítulo…') : 'Cargando película…');
      resolvePlayerStream(it, function (url) {
        if (url) { playUrl(url); }
        else if (!state.streamError) { state.streamError = 'El portal no entregó una fuente para este título.'; setPlayerStatus(state.streamError); }
      });
      return;
    }
    if (!it.streamUrl) { return; }
    playUrl(it.streamUrl);
  }

  function expandToFullscreen(item, episode) {
    if (!playerStage) { buildPlayer(); }
    /* The detail screen already owns a mini player.  Moving that exact stream
       to fullscreen must not resolve it again, otherwise direct and relay
       VOD both restart from zero. */
    var sameEpisode = !episode || !state.playerEpisode ||
      state.playerEpisode === episode || state.playerEpisode.id === episode.id;
    var keepCurrentVideo = state.screen === 'detail' && playerVideo &&
      !!playerVideo.src && state.playerItem === item && sameEpisode;
    state.playerMode = 'vod';
    if (item && state.playerItem !== item) { resetMediaSelection(); }
    if (item) { state.playerItem = item; }
    if (episode) { state.playerEpisode = episode; }
    if (item) { restoreSmoothMode(item); }
    state.playerReturn = { screen: 'detail', focus: state.focus };

    var scrPlayer = $('screen-player');
    var scrDetail = $('screen-detail');
    if (scrPlayer) {
      scrPlayer.classList.remove('is-mini');
      scrPlayer.classList.add('is-active');
    }
    if (scrDetail) {
      scrDetail.classList.remove('is-active');
    }
    state.screen = 'player';
    playerStage.classList.add('is-vod');
    updatePlayer();
    setFocus(playerStage);
    showVodInfobar();

    if (!keepCurrentVideo) {
      startPlayerVideo(state.playerItem, state.playerEpisode);
    }
  }

  function openPlayer(mode, item, episode) {
    if (mode === 'vod' && state.screen === 'detail') {
      expandToFullscreen(item, episode);
      return;
    }
    if (!playerStage) { buildPlayer(); }
    if (mode === 'live') { stopLivePreview(); }
    state.playerMode = mode;
    if (item && state.playerItem !== item) { resetMediaSelection(); }
    state.playerItem = item || null;
    state.playerEpisode = episode || null;
    if (mode === 'vod' && item) { restoreSmoothMode(item); }
    state.playerReturn = { screen: state.screen, focus: state.focus };
    state.channelsOpen = false;
    playerInfo.classList.remove('is-active');
    playerChannels.classList.remove('is-active');
    playerStage.classList.toggle('is-vod', mode === 'vod');
    updatePlayer();
    showScreen('player');
    setFocus(playerStage);
    updatePlayer();                 /* re-measure now that the screen is visible */
    if (mode === 'vod') {
      showVodInfobar();
      startPlayerVideo(state.playerItem, state.playerEpisode);
    } else {
      showInfobar();
      startLiveChannel(CHANNELS[state.channel]);
    }
  }

  var liveChannelSeq = 0;
  var liveChannelDebounceTimer = null;
  var liveRefreshTimer = null;

  function cancelBrowserLivePlayback() {
    if (window.PalmServiceBridge) { return; }
    liveChannelSeq++;
    if (liveRefreshTimer) { clearTimeout(liveRefreshTimer); liveRefreshTimer = null; }
    if (liveChannelDebounceTimer) { clearTimeout(liveChannelDebounceTimer); liveChannelDebounceTimer = null; }
  }

  function scheduleLiveRefresh(ch, payload, mySeq, retryAttempt) {
    if (window.PalmServiceBridge) { return; }
    if (liveRefreshTimer) { clearTimeout(liveRefreshTimer); liveRefreshTimer = null; }
    var expires = Number(payload && payload.mediaExpiresAt);
    if (!retryAttempt && (!isFinite(expires) || expires <= 0)) { return; }
    var delay = retryAttempt ? 15000 : Math.max(1000, expires - Date.now() - 60000);
    liveRefreshTimer = setTimeout(function () {
      liveRefreshTimer = null;
      if (mySeq !== liveChannelSeq || state.playerMode !== 'live' || state.screen !== 'player') { return; }
      startLiveChannel(ch, true, retryAttempt || 1);
    }, delay);
  }

  function startLiveChannel(ch, immediate, refreshAttempt) {
    if (!window.PalmServiceBridge) { cancelBrowserLivePlayback(); }
    if (liveChannelDebounceTimer) {
      clearTimeout(liveChannelDebounceTimer);
      liveChannelDebounceTimer = null;
    }
    if (!ch) { ch = CHANNELS[state.channel]; }
    if (!ch) { return; }
    if (!ch.channelCode && !ch.streamUrl) { return; }
    var doStart = function () {
      var mySeq = ++liveChannelSeq;
      if (!refreshAttempt) { setPlayerStatus('Cargando señal ' + (ch.name || '') + '…'); }
      var resolveParams = ch.streamUrl ? { streamUrl: ch.streamUrl } : { channelCode: ch.channelCode };
      portalServiceCall('resolveLive', resolveParams, function (err, payload) {
        if (mySeq !== liveChannelSeq) { return; }
        if (err || !payload || payload.returnValue === false) {
          state.streamError = 'No se pudo conectar con la señal' + (err ? ': ' + err : '');
          setPlayerStatus(state.streamError);
          if (refreshAttempt && refreshAttempt < 3) { scheduleLiveRefresh(ch, null, mySeq, refreshAttempt + 1); }
          return;
        }
        rememberCdnProbe('live', payload);
        var streamUrl = payload.mediaToken
          ? (payload.mediaUrl || payload.url || '/api/media?token=' + encodeURIComponent(payload.mediaToken) + '&manifest=1')
          : (payload.proxyPath || payload.url);
        if (!streamUrl) {
          state.streamError = 'Señal no disponible';
          setPlayerStatus(state.streamError);
          return;
        }
        setPlayerStatus('');
        showInfobar();
        playUrl(streamUrl);
        scheduleLiveRefresh(ch, payload, liveChannelSeq, 0);
      });
    };

    if (immediate) {
      doStart();
    } else {
      liveChannelDebounceTimer = setTimeout(doStart, 180);
    }
  }

  function updatePlayerChannel() {
    if (!playerStage) { return; }
    updatePlayer();
  }

  function updatePlayer() {
    var live = state.playerMode === 'live';
    var ch = CHANNELS[state.channel] || {};
    var idx = playerInfo.querySelector('.pi-index');
    var name = playerInfo.querySelector('.pi-name');
    var date = playerInfo.querySelector('.pi-date');
    var range = playerInfo.querySelector('.pi-range');
    var now = playerInfo.querySelector('.pi-now');
    var next = playerInfo.querySelector('.pi-next');
    var uhd = playerInfo.querySelector('.pi-uhd');
    var logo = playerInfo.querySelector('.pi-logo');

    if (live) {
      if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
      if (playerInfo) { playerInfo.style.display = ''; }
      idx.style.display = 'block';
      idx.textContent = pad2(ch.index || (state.channel + 1));
      name.textContent = ch.name || '';
      nameRowPosition();
      date.textContent = 'Hoy';
      range.textContent = ch.time || '';
      now.style.display = 'block';
      now.textContent = ch.now || 'En vivo';
      next.style.display = ch.next ? 'block' : 'none';
      if (ch.next) { next.textContent = 'Siguiente: ' + ch.next; }
      uhd.style.display = ch.uhd ? 'block' : 'none';
      logo.style.display = 'block';
      if (logo) {
        if (ch.logo) {
          logo.style.backgroundImage = 'url(' + ch.logo + ')';
        } else {
          logo.style.backgroundImage = '';
        }
      }
    } else {
      if (playerInfo) { playerInfo.classList.remove('is-active'); playerInfo.style.display = 'none'; }
      var item = state.playerItem || VOD[0];
      if (vodInfobarTitle) {
        if (isSeriesItem(item) && state.playerEpisode) {
          var epTitle = state.playerEpisode.title || state.playerEpisode.name;
          var epNum = state.playerEpisode.number || state.playerEpisode.seriesNumber;
          var epLabel = epTitle || (epNum ? ('Capítulo ' + epNum) : '');
          vodInfobarTitle.textContent = epLabel ? (item.title + ' - ' + epLabel) : item.title;
        } else {
          vodInfobarTitle.textContent = item.title;
        }
      }
      if (vodInfobarPoster) {
        vodInfobarPoster.src = item.poster || item.cover || 'assets/original/common/bg_placehoder_vertical.png';
      }
      updateVodProgress(playerVideo ? playerVideo.currentTime : 0, playerVideo ? playerVideo.duration : 0);
    }
    for (var rowIndex in playerChannelRows) {
      if (playerChannelRows.hasOwnProperty(rowIndex)) {
        playerChannelRows[rowIndex].classList.toggle('is-current', playerChannelRows[rowIndex]._channel === state.channel);
      }
    }
    layoutInfoTexts();
  }

  function nameRowPosition() {
    var row = playerInfo.querySelector('.pi-namerow');
    if (!row) { return; }
    var idx = playerInfo.querySelector('.pi-index');
    var nm = row.querySelector('.pi-name');
    var uhd = row.querySelector('.pi-uhd');
    /* Keep a fixed lane for the channel number.  Measuring an auto-width
       number while Starfish is animating the infobar returns inconsistent
       values and can place the name on top of it. */
    var base = 165;

    row.style.position = 'absolute';
    row.style.left = (367.5 + base) + 'px';
    row.style.top = '13.5px';
    row.style.width = '480px';
    row.style.height = '58px';
    row.style.display = 'block';

    nm.style.position = 'absolute';
    nm.style.left = '0px';
    nm.style.top = '8px';                       /* alignBottom with mTextChannelIndex */
    nm.style.width = '480px';
    nm.style.height = '50px';
    nm.style.lineHeight = '50px';

    if (uhd) {
      uhd.style.left = (nm.offsetWidth + 30) + 'px';   /* 20dp */
      uhd.style.top = '18.5px';                        /* alignTop name + 7dp */
    }
  }

  function layoutInfoTexts() {
    var q = playerInfo.querySelector('.pi-quality');
    var s = playerInfo.querySelector('.pi-scale');
    var f = playerInfo.querySelector('.pi-func');
    if (!q || !s || !f) { return; }
    q.style.left = '517.5px';                   /* 345dp */
    s.style.left = (q.offsetLeft + q.offsetWidth + 30) + 'px';   /* 20dp */
    f.style.left = (s.offsetLeft + s.offsetWidth + 30) + 'px';   /* 20dp */
  }

  function openChannelPanel() {
    if (state.playerMode !== 'live') { return; }
    state.channelsOpen = true;
    playerChannels.classList.add('is-active');
    renderPlayerCategories();
    renderPlayerChannels(state.channel);
    /* Bring the active column into view: with 38 portal categories the rail
       is 5000px wide and the selected pill is usually off-screen. */
    scrollSelectedCategoryPill();
    var row = playerChannelRows[state.channel];
    if (row) {
      setFocus(row);
      var list = row.parentNode;
      var top = state.channel * 111;
      if (top < list.scrollTop || top + 109.5 > list.scrollTop + list.clientHeight) {
        list.scrollTop = Math.max(0, top - 120);
      }
    }
  }

  function closeChannelPanel() {
    state.channelsOpen = false;
    playerChannels.classList.remove('is-active');
    if (state.screen === 'player') { setFocus(playerStage); }
  }

  function restorePlayerReturn() {
    hideInfobar();
    hideVodInfobar();
    var ret = state.playerReturn;
    if (ret && ret.screen === 'detail') {
      var scrPlayer = $('screen-player');
      var scrDetail = $('screen-detail');
      if (scrPlayer) {
        scrPlayer.classList.add('is-mini');
        scrPlayer.classList.add('is-active');
      }
      if (scrDetail) {
        scrDetail.classList.add('is-active');
      }
      state.screen = 'detail';
      var rebuiltDetail = false;
      if (state.detailNeedsRebuild && state.detail) {
        /* The episode browser switched season: rebuild the detail list so the
           season dropdown and the episode grid match what is playing. */
        state.detailNeedsRebuild = false;
        buildDetail(state.detail);
        rebuiltDetail = true;
        var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
        if (sBtn) { setFocus(sBtn); }
      } else if (state.detail) {
        syncDetailEpisodeHighlight(state.detail);
      }
      if (!rebuiltDetail) {
        if (ret.focus && isVisible(ret.focus)) {
          setFocus(ret.focus);
        } else {
          var firstBtn = detailButtons ? detailButtons.querySelector('.focusable') : null;
          if (firstBtn) { setFocus(firstBtn); }
        }
      }
    } else {
      stopPlayerVideo();
      var scrP = $('screen-player');
      if (scrP) {
        scrP.classList.remove('is-mini');
        scrP.classList.remove('is-active');
      }
      if (ret && ret.screen === 'search') {
        showScreen('search');
        setFocus(ret.focus);
      } else {
        showScreen('home');
        selectTab(state.tab, false);
        if (ret && ret.focus && isVisible(ret.focus)) { setFocus(ret.focus); }
        else if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      }
    }
  }

  /* ---------------------------------------------------------------- display */
  /* The reference UI is authored at 1920×1080. Older sets expose that exact
     logical viewport, whereas some UHD webOS 22/25 sets expose 3840×2160.
     Without this fit pass only the left half of the fixed canvas is painted
     and the right half of the TV remains black. */
  function viewportSize() {
    /* Most webOS builds report the CSS viewport here. Some 2K/4K firmware
       reports a legacy 1280×720 inner viewport while compositing to its full
       physical 1920/3840 panel; using that value alone paints the left part
       of the TV and leaves the right side black. */
    var vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
    var vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
    if (!vw || !vh) { vw = 1920; vh = 1080; }
    var panelW = Math.floor((screen && screen.width) || 0);
    var panelH = Math.floor((screen && screen.height) || 0);
    var cssRatio = vw / vh;
    var panelRatio = panelW && panelH ? panelW / panelH : 0;
    /* Only trust screen.* when it is a true UHD/4K panel (>= 2560).
       Never override an HD/720p viewport (1280×720) with a virtual 1920 panel,
       which would force scale=1.0 and crop 640px on the right and 360px on the bottom. */
    if (panelW >= 2560 && panelW >= vw * 1.25 && panelH >= vh * 1.25 &&
        Math.abs(cssRatio - panelRatio) < 0.03) {
      vw = panelW;
      vh = panelH;
    }
    var panel = (panelW > 0 && panelH > 0) ? { w: panelW, h: panelH } : null;
    return { w: vw, h: vh, panel: panel };
  }

  function fitDesignViewport() {
    var app = $('app');
    if (!app) { return; }
    var size = viewportSize();
    var vw = size.w;
    var vh = size.h;
    var scale = Math.min(vw / 1920, vh / 1080);
    if (!isFinite(scale) || scale <= 0) { scale = 1; }
    scale = Math.round(scale * 10000) / 10000;
    /* Keep a non-16:9 display letterboxed instead of stretching the design. */
    var left = Math.max(0, Math.round((vw - (1920 * scale)) / 2));
    var top = Math.max(0, Math.round((vh - (1080 * scale)) / 2));
    app.style.left = left + 'px';
    app.style.top = top + 'px';
    app.style.webkitTransform = 'scale(' + scale + ')';
    app.style.transform = 'scale(' + scale + ')';
    /* Read by the network diagnostics panel: a photo of that screen tells
       which viewport the TV really gave the app (720p / 2K / 4K sets differ). */
    window.__xuperViewport = {
      w: vw, h: vh, scale: scale,
      panelW: size.panel ? size.panel.w : 0,
      panelH: size.panel ? size.panel.h : 0
    };
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    fitDesignViewport();
    window.addEventListener('resize', fitDesignViewport, false);
    window.addEventListener('orientationchange', fitDesignViewport, false);
    document.addEventListener('visibilitychange', fitDesignViewport, false);
    /* Some webOS builds only report the final window size after the splash
       animation, and 720p / 2K sets take longer than 1080p ones. */
    setTimeout(fitDesignViewport, 250);
    setTimeout(fitDesignViewport, 1200);
    setTimeout(fitDesignViewport, 3000);
    document.addEventListener('keydown', handleKey, false);
    document.addEventListener('keyup', function (e) {
      var code = e.keyCode || e.which;
      if (code === 461 || e.key === 'Back' || e.key === 'GoBack') {
        handleKey(e);
      }
    }, false);
    window.addEventListener('popstate', function () {
      back();
    }, false);
    document.addEventListener('click', function (e) {
      var f = closest(e.target, '.focusable');
      if (!f) { return; }
      setFocus(f, true);
      if (f._activate) { f._activate(); }
    });
    buildSearch();
    if (window.PalmServiceBridge) {
      startServiceKeepAlive();
    }
    if (window.PalmServiceBridge || vodApi.devServiceUrl) {
      portalServiceCall('prewarm', {}, function () {});
    }
    startWelcome();
    loadVodCatalog();
    loadLiveCategories();
    loadLiveChannels();

    window.__xuper = {
      version: '4.34.4',
      state: state,
      vod: VOD,
      channels: CHANNELS,
      api: vodApiState,
      portal: portalState,
      service: portalServiceCall,
      refreshPortal: refreshPortalCatalog,
      reloadVod: loadVodCatalog,
      skipWelcome: finishWelcome,
      show: function (name) {
        if (name === 'home') { finishWelcome(); }
        else if (name === 'detail') { openDetail(VOD[0]); }
        else if (name === 'search') { openSearch(); }
        else if (name === 'settings') { openSettings(); }
        else if (name === 'player') { openPlayer('live'); }
        else { showScreen(name); }
      },
      selectTab: function (i) { finishWelcome(); selectTab(i, true); },
      openDetail: function (i) { openDetail(VOD[i] || VOD[0]); },
      openSearch: openSearch,
      openSettings: openSettings,
      openPlayer: function (mode, i) { openPlayer(mode || 'live', VOD[i] || null); },
      focus: function (sel) {
        var n = typeof sel === 'string' ? document.querySelector(sel) : sel;
        if (n) { setFocus(n); }
      },
      key: function (code) { handleKey({ keyCode: code, preventDefault: function () {} }); },
      search: function (q) { openSearch(); setSearchQuery(q); },
      settingsPanel: function (i) { openSettings(); showSettingsPanel(i, true); }
    };

    applyQuery();
  }

  /* Deep-link support for the visual comparison harness, e.g.
     index.html?screen=home&tab=2   index.html?screen=detail&vod=3
     index.html?screen=search&q=demo index.html?screen=settings&panel=1
     index.html?screen=player&ch=2&channels=1                            */
  function applyQuery() {
    var raw = String(location.search || '').replace(/^\?/, '');
    if (!raw) { return; }
    var map = {};
    var parts = raw.split('&');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) { continue; }
      var kv = parts[i].split('=');
      map[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=') || '');
    }
    if (map.ch !== undefined) {
      var ch = parseInt(map.ch, 10) || 0;
      state.channel = Math.max(0, Math.min(CHANNELS.length - 1, ch));
    }
    var screen = map.screen || 'home';
    if (screen === 'welcome') { return; }

    finishWelcome();
    if (map.tab !== undefined) {
      selectTab(parseInt(map.tab, 10) || 0, true);
    } else {
      selectTab(0, false);
      setFocus(liveFocus);
    }

    if (screen === 'detail') {
      openDetail(VOD[parseInt(map.vod, 10) || 0]);
    } else if (screen === 'search') {
      openSearch();
      if (map.q) { setSearchQuery(map.q); }
    } else if (screen === 'settings') {
      openSettings();
      if (map.panel !== undefined) { showSettingsPanel(parseInt(map.panel, 10) || 0, true); }
    } else if (screen === 'player') {
      openPlayer(map.mode === 'vod' ? 'vod' : 'live', VOD[parseInt(map.vod, 10) || 0]);
      if (map.channels === '1') { openChannelPanel(); }
    }

    if (map.focus) {
      var n = document.querySelector(map.focus);
      if (n) { setFocus(n); }
    }
  }

  function purgeMemoryCache() {
    stopPlayerVideo();
    clearSearchState();
  }

  window.addEventListener('pagehide', purgeMemoryCache);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      purgeMemoryCache();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
