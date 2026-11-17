(function () {
  'use strict';
  var NAV = [
    ['home', 'Destacados', 'home'], ['live', 'TV en vivo', 'tv'],
    ['music', 'YouMusic', 'music'], ['radio', 'Radio', 'radio'],
    ['providers', 'IPTV', 'list'], ['videoteca', 'Videoteca', 'folder'],
    ['movies', 'Películas', 'film'], ['series', 'Series', 'series'],
    ['kids', 'Infantil', 'home'], ['anime', 'Anime', 'film'],
    ['history', 'Historial', 'clock']
  ];
  var TITLES = { home: 'Destacados', videoteca: 'Videoteca', kids: 'Infantil', anime: 'Anime', movies: 'Películas', series: 'Series', live: 'TV en vivo', radio: 'Radio', music: 'Música', lists: 'Mis listas', favorites: 'Favoritos', history: 'Historial', providers: 'Mis proveedores IPTV', settings: 'Configuración' };
  var TYPES = { movie: 'Película', series: 'Serie', live: 'En vivo', radio: 'Radio', music: 'Música' };
  var PATHS = {
    home: 'M3 10l9-7 9 7v10H7V10m3 10v-7h4v7', tv: 'M3 6h18v14H3zM8 2l4 4 4-4',
    film: 'M3 3h18v18H3zM7 3v18M17 3v18M3 8h4m-4 8h4M17 8h4m-4 8h4',
    series: 'M3 6h15v15H3zM7 2h15v15', radio: 'M3 9h18v12H3zM3 9l16-6M7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4m6 0h5m-5 4h5',
    music: 'M9 18V5l12-3v13M9 5l12-3M5 17c-4 0-4 5 0 5s4-5 0-5m12-3c-4 0-4 5 0 5s4-5 0-5',
    list: 'M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',
    settings: 'M9 3h6l1 3 3 1 2 3-2 3v4l-4 1-2 3-4-2-4-1v-4l-2-3 2-4 4-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    folder: 'M3 5h7l2 3h9v13H3z', play: 'M8 4l12 8-12 8z', search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-2 4 7 7',
    left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', refresh: 'M20 9a8 8 0 1 0-1 9M20 3v6h-6', check: 'M4 12l5 5L20 6'
  };
  var state = { section: 'home', provider: 'all', q: '', category: '', country: '', page: 1, providers: [], items: [], liveItems: [], seq: 0, detailSeq: 0, playSeq: 0, boot: false, heroTimer: null, heroPaused: false, heroIndex: 0, detailItem: null, seasons: [], playing: null, hls: null, retries: 0, retryTimer: null, progressAt: 0, returnFocus: null };
  var storageKey = 'tvvidaa.xuper.preferences.v1';
  var preferences = readPreferences();
  var view = byId('view');
  var video = byId('video');

  function byId(id) { return document.getElementById(id); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function text(value, length) { return String(value == null ? '' : value).slice(0, length || 500); }
  function node(tag, className, content) { var n = document.createElement(tag); if (className) n.className = className; if (content != null) n.textContent = content; return n; }
  function icon(name) { var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.7'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); var path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', PATHS[name] || PATHS.film); svg.appendChild(path); return svg; }
  function button(label, action, className, iconName) { var b = node('button', 'button ' + (className || '')); b.type = 'button'; if (iconName) b.appendChild(icon(iconName)); b.appendChild(node('span', '', label)); b.addEventListener('click', action); return b; }
  function option(select, label, value) { var o = node('option', '', label); o.value = value; select.appendChild(o); return o; }
  function field(label, control, className) { var wrap = node('div', 'field ' + (className || '')); var lab = node('label', '', label); lab.htmlFor = control.id; wrap.appendChild(lab); wrap.appendChild(control); return wrap; }
  function announce(message) { byId('announcement').textContent = text(message, 1000); }
  function matches(el, selector) { var method = el.matches || el.msMatchesSelector || el.webkitMatchesSelector; return !!method && method.call(el, selector); }
  function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function imageUrl(value) { try { var u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || /(?:token|password|username|auth|secret|key)=/i.test(u.search)) return ''; return u.href; } catch (_) { return ''; } }
  function relayUrl(value) { try { var u = new URL(value, window.location.href); return u.origin === window.location.origin && u.pathname === '/api/media' && u.searchParams.has('token') ? u.pathname + u.search : ''; } catch (_) { return ''; } }
  function artwork(parent, value, title, className) { var src = imageUrl(value); parent.classList.add('no-artwork'); if (!src) return; var image = node('img', className || 'poster'); image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; image.addEventListener('load', function () { parent.classList.remove('no-artwork'); }); image.addEventListener('error', function () { image.hidden = true; parent.classList.add('no-artwork'); }); image.src = src; parent.appendChild(image); }
  function safeItem(item) { return { id: text(item.id, 256), providerId: text(item.providerId, 64), title: text(item.title, 220), type: TYPES[item.type] ? item.type : 'movie', year: text(item.year, 8), category: text(item.category, 100) }; }
  function itemKey(item) { return item.providerId + ':' + item.id; }
  function validItem(item) { return item && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 256 && typeof item.providerId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(item.providerId); }
  function readPreferences() {
    var data;
    try { data = JSON.parse(window.localStorage.getItem(storageKey) || 'null'); } catch (_) { data = null; }
    var result = { active: 'default', profiles: [{ id: 'default', name: 'Principal', favorites: [], history: [], playlists: [] }] };
    if (!data || !Array.isArray(data.profiles)) return result;
    var profiles = data.profiles.slice(0, 4).filter(function (p) { return p && /^[a-z0-9_-]{1,50}$/.test(p.id) && typeof p.name === 'string'; }).map(function (p) {
      var out = { id: p.id, name: p.name.slice(0, 30), favorites: [], history: [], playlists: [] };
      out.favorites = (Array.isArray(p.favorites) ? p.favorites : []).filter(validItem).slice(0, 300).map(safeItem);
      out.history = (Array.isArray(p.history) ? p.history : []).filter(validItem).slice(0, 150).map(function (entry) { var i = safeItem(entry); i.position = Math.min(864000, Math.max(0, Number(entry.position) || 0)); i.duration = Math.min(864000, Math.max(0, Number(entry.duration) || 0)); i.updated = Number(entry.updated) || 0; i.parentId = text(entry.parentId, 256); i.parentTitle = text(entry.parentTitle, 220); i.episodeTitle = text(entry.episodeTitle, 220); return i; });
      out.playlists = (Array.isArray(p.playlists) ? p.playlists : []).slice(0, 20).filter(function (l) { return l && /^[a-z0-9_-]{1,50}$/.test(l.id) && typeof l.name === 'string'; }).map(function (l) { return { id: l.id, name: l.name.slice(0, 50), items: (Array.isArray(l.items) ? l.items : []).filter(validItem).slice(0, 300).map(safeItem) }; });
      return out;
    });
    if (profiles.length) { result.profiles = profiles; result.active = profiles.some(function (p) { return p.id === data.active; }) ? data.active : profiles[0].id; }
    return result;
  }
  function profile() { for (var i = 0; i < preferences.profiles.length; i++) if (preferences.profiles[i].id === preferences.active) return preferences.profiles[i]; return preferences.profiles[0]; }
  function save() { try { window.localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch (_) { announce('Este navegador no pudo guardar tus preferencias. Se conservarán mientras esta página permanezca abierta.'); } }
  function favorite(item) { return profile().favorites.some(function (entry) { return itemKey(entry) === itemKey(item); }); }
  function toggleFavorite(item) { var p = profile(); if (favorite(item)) p.favorites = p.favorites.filter(function (entry) { return itemKey(entry) !== itemKey(item); }); else { p.favorites.unshift(safeItem(item)); p.favorites = p.favorites.slice(0, 300); } save(); }
  function progress(item) { var history = profile().history; for (var i = 0; i < history.length; i++) if (itemKey(history[i]) === itemKey(item)) return history[i]; return null; }
  function durationLabel(seconds) { seconds = Math.max(0, Number(seconds) || 0); var h = Math.floor(seconds / 3600); var m = Math.floor((seconds % 3600) / 60); var s = Math.floor(seconds % 60); return (h ? h + ':' : '') + (h && m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }

  function api(action, values, method) {
    var suffix = ''; var params = values || {};
    if (method !== 'POST') Object.keys(params).forEach(function (key) { if (params[key] !== undefined && params[key] !== '') suffix += (suffix ? '&' : '?') + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); });
    var options = { method: method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method === 'POST') { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(params); }
    return window.fetch('/api/xuper/' + action + suffix, options).then(function (response) {
      if (response.status === 401) { showLogin(); throw requestError('Inicia sesión para continuar.', 'AUTH_REQUIRED', 401); }
      return response.json().then(function (data) { if (!data || typeof data !== 'object') throw requestError('El servidor no devolvió una respuesta válida.', 'INVALID_RESPONSE', response.status); if (!response.ok || data.returnValue === false) throw requestError(data.errorText || data.error || 'No se pudo completar la solicitud.', data.errorCode, response.status); return data; }, function () { throw requestError('El servidor no devolvió una respuesta válida. Vuelve a intentarlo más tarde.', 'INVALID_RESPONSE', response.status); });
    });
  }
  function requestError(message, code, status) { var error = new Error(message); error.code = /^[A-Z][A-Z0-9_]{0,63}$/.test(code || '') ? code : ''; error.status = Number(status) || 0; return error; }
  function recoverableError(error) {
    if (/^(?:UNSUPPORTED_FORMAT|UNSUPPORTED_SOURCE|UNSUPPORTED_BROWSER|INVALID_STREAM|INVALID_INPUT|INVALID_METHOD|NOT_FOUND|CONTENT_NOT_FOUND|STREAM_NOT_FOUND|PROVIDER_NOT_CONFIGURED|MEDIA_NOT_CONFIGURED|AUTH_REQUIRED)$/.test(error.code || '')) return false;
    return !error.status || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  function confirmedRestriction(item) {
    var restriction = item && item.playbackRestriction;
    return restriction && restriction.code === 'UNSUPPORTED_FORMAT' && typeof restriction.message === 'string' &&
      (!item.signals || item.signals.length < 2) && !(item.signalCount > 1) ? restriction : null;
  }
  function playAction(item, series, label, className) { var restriction = confirmedRestriction(item); var control = button(restriction ? 'Formato no compatible' : label, function () { play(item, series); }, className, 'play'); if (restriction) { control.disabled = true; control.title = text(restriction.message, 700); } return control; }
  function setBackgroundInert(inert) { var shell = document.querySelector('.app-shell'); var header = document.querySelector('.topbar'); if (inert) { shell.setAttribute('aria-hidden', 'true'); header.setAttribute('aria-hidden', 'true'); } else { shell.removeAttribute('aria-hidden'); header.removeAttribute('aria-hidden'); } }
  function showLogin() { closePlayer(); closeDetail(); byId('login').hidden = false; setBackgroundInert(true); byId('password').focus(); }
  function mountProfiles() { var select = byId('profile-select'); clear(select); preferences.profiles.forEach(function (p) { option(select, p.name, p.id); }); select.value = preferences.active; }
  function mountNav() {
    var nav = byId('navigation'); var restore = nav.contains(document.activeElement); clear(nav);
    NAV.forEach(function (entry) { var link = node('a', 'nav-link'); link.href = '#' + entry[0]; link.setAttribute('data-section', entry[0]); if (entry[0] === state.section) link.setAttribute('aria-current', 'page'); link.appendChild(icon(entry[2])); link.appendChild(node('span', '', entry[1])); nav.appendChild(link); });
    if (restore) { var current = nav.querySelector('[aria-current="page"]'); if (current) current.focus(); }
  }
  function focusFirst() { var h = view.querySelector('h1, h2'); if (h) { h.tabIndex = -1; h.focus(); } }
  function navigate(section) { if (window.location.hash === '#' + section) loadSection(section, true); else window.location.hash = section; }
  function stopHero() { if (state.heroTimer) window.clearInterval(state.heroTimer); state.heroTimer = null; }
  function loadSection(section, reset) {
    if (!TITLES[section]) section = 'home';
    closePlayer(); closeDetail(); stopHero(); state.section = section; state.seq++; if (reset !== false) { state.q = ''; state.category = ''; state.country = ''; state.page = 1; }
    mountNav(); clear(view); announce(''); document.title = TITLES[section] + ' · Xuper Premium';
    if (section === 'settings' || section === 'providers') { renderSettings(section === 'providers'); focusFirst(); return; }
    if (section === 'favorites' || section === 'history' || section === 'lists') { renderLibrary(); focusFirst(); return; }
    renderCatalog();
  }
  function heading(title, description, count) { var head = node('div', 'page-heading'); var copy = node('div'); copy.appendChild(node('h1', '', title)); if (description) copy.appendChild(node('p', '', description)); head.appendChild(copy); if (count !== undefined) head.appendChild(node('span', 'page-count', count + ' contenidos')); return head; }
  function empty(parent, title, description, action) { var box = node('section', 'empty-state'); var symbol = node('div', 'empty-symbol'); symbol.appendChild(icon(state.section === 'radio' ? 'radio' : state.section === 'music' ? 'music' : 'film')); box.appendChild(symbol); box.appendChild(node('h2', '', title)); box.appendChild(node('p', '', description)); if (action) box.appendChild(button(action.label, action.run, 'primary')); parent.appendChild(box); }
  function providerName(id) { for (var i = 0; i < state.providers.length; i++) if (state.providers[i].id === id) return state.providers[i].name; return 'Proveedor'; }
  function placeholder(parent, item) { var fallback = node('span', 'poster-fallback'); fallback.appendChild(icon(item.type === 'live' ? 'tv' : item.type === 'radio' ? 'radio' : item.type === 'music' ? 'music' : 'film')); fallback.appendChild(node('span', '', text(item.title, 220))); parent.appendChild(fallback); }
  function mediaCard(item, removable, collection) {
    var card = node('article', 'media-card ' + text(item.type, 15) + '-card'); var b = node('button', 'card-button'); b.type = 'button'; b.setAttribute('aria-label', text(item.title, 220) + ', ' + (TYPES[item.type] || 'Contenido')); b.title = text(item.title, 220);
    var art = node('span', 'poster-wrap'); placeholder(art, item); artwork(art, item.poster, item.title); if (item.type === 'live') art.appendChild(node('span', 'card-type', 'En vivo'));
    var record = progress(item); if (record && record.duration > 0) { var bar = node('span', 'progress-bar'); var value = node('span', 'progress-value'); value.style.width = Math.min(100, record.position / record.duration * 100) + '%'; bar.appendChild(value); art.appendChild(bar); }
    b.appendChild(art); b.appendChild(node('span', 'card-title', text(item.parentTitle || item.title, 220))); b.appendChild(node('span', 'card-meta', [item.episodeTitle || item.year || TYPES[item.type], item.category].filter(Boolean).join(' · ')));
    b.addEventListener('click', function () { if (item.parentId) openDetail({ id: item.parentId, providerId: item.providerId }, item); else openDetail(item); }); card.appendChild(b);
    if (removable) card.appendChild(button('Quitar', function () { if (collection === 'favorites') toggleFavorite(item); else if (collection === 'history') profile().history = profile().history.filter(function (entry) { return itemKey(entry) !== itemKey(item); }); else { var list = profile().playlists.filter(function (p) { return p.id === collection; })[0]; if (list) list.items = list.items.filter(function (entry) { return itemKey(entry) !== itemKey(item); }); } save(); renderLibrary(); }, 'quiet small remove-item'));
    return card;
  }
  function shelf(parent, title, items) {
    if (!items.length) return; var section = node('section', 'content-section'); var header = node('div', 'section-heading'); header.appendChild(node('h2', '', title)); var scroller = node('div', 'shelf'); var controls = node('div', 'carousel-controls');
    ['left', 'right'].forEach(function (direction) { var b = button(direction === 'left' ? 'Anterior' : 'Siguiente', function () { scroller.scrollLeft += (direction === 'left' ? -1 : 1) * Math.max(250, scroller.clientWidth * .8); }, ''); clear(b); b.className = ''; b.setAttribute('aria-label', title + ': ' + (direction === 'left' ? 'anteriores' : 'siguientes')); b.appendChild(icon(direction)); controls.appendChild(b); });
    header.appendChild(controls); section.appendChild(header); items.forEach(function (item) { scroller.appendChild(mediaCard(item)); }); section.appendChild(scroller); parent.appendChild(section);
  }
  function renderMosaic(parent, items) {
    var mosaic = node('section', 'mosaic'); mosaic.setAttribute('aria-label', 'Contenidos destacados'); var selected = items.slice(0, 6);
    selected.forEach(function (item, index) { var tile = node('button', 'mosaic-tile' + (index < 2 ? ' large' : '')); tile.type = 'button'; tile.setAttribute('aria-label', text(item.title, 220)); placeholder(tile, item); artwork(tile, item.backdrop || item.poster, item.title, 'mosaic-image'); tile.appendChild(node('span', 'mosaic-shade')); tile.appendChild(node('span', 'mosaic-title', text(item.title, 220))); tile.addEventListener('click', function () { openDetail(item); }); mosaic.appendChild(tile); });
    parent.appendChild(mosaic);
    if (items.length > 6) {
      var control = node('div', 'mosaic-controls'); var label = node('span', 'muted', 'Selección del catálogo'); var toggle = button(state.heroPaused ? 'Activar carrusel' : 'Pausar carrusel', function () { state.heroPaused = !state.heroPaused; render(); }, 'quiet small'); control.appendChild(label); control.appendChild(toggle); parent.appendChild(control);
      var offset = 0;
      function rotate() { if (state.heroPaused || document.hidden || reducedMotion() || mosaic.contains(document.activeElement) || control.contains(document.activeElement) || !byId('detail').hidden || !byId('player').hidden) return; offset = (offset + 2) % items.length; var tiles = mosaic.querySelectorAll('.mosaic-tile'); for (var i = 0; i < tiles.length; i++) { var current = items[(offset + i) % items.length]; var old = tiles[i]; var replacement = node('button', old.className); replacement.type = 'button'; replacement.setAttribute('aria-label', text(current.title, 220)); placeholder(replacement, current); artwork(replacement, current.backdrop || current.poster, current.title, 'mosaic-image'); replacement.appendChild(node('span', 'mosaic-shade')); replacement.appendChild(node('span', 'mosaic-title', text(current.title, 220))); (function (value, element) { element.addEventListener('click', function () { openDetail(value); }); })(current, replacement); mosaic.replaceChild(replacement, old); } }
      function render() { clear(toggle); toggle.appendChild(node('span', '', state.heroPaused ? 'Activar carrusel' : 'Pausar carrusel')); }
      if (!reducedMotion()) state.heroTimer = window.setInterval(rotate, 10000);
    }
  }
  function renderFilters(parent, categories, countries) {
    var form = node('form', 'filters'); var input = node('input'); input.type = 'search'; input.id = 'catalog-search'; input.placeholder = 'Título, canal o emisora'; input.maxLength = 120; input.value = state.q; form.appendChild(field('Buscar en el catálogo', input, 'search-field'));
    var providers = node('select'); providers.id = 'catalog-provider'; option(providers, 'Todos los proveedores', 'all'); state.providers.filter(function (p) { return p.configured; }).forEach(function (p) { option(providers, p.name, p.id); }); providers.value = state.provider; form.appendChild(field('Proveedor', providers));
    var country;
    if (state.section === 'radio' && countries && countries.length) { country = node('select'); country.id = 'catalog-country'; option(country, 'Todos los países', ''); countries.forEach(function (c) { var value = typeof c === 'string' ? c : c.id || c.code || c.name; option(country, typeof c === 'string' ? c : c.name || value, value); }); country.value = state.country; form.appendChild(field('País', country)); }
    var submit = node('button', 'button primary', 'Buscar'); submit.type = 'submit'; form.appendChild(submit);
    form.addEventListener('submit', function (event) { event.preventDefault(); state.q = input.value.trim(); state.provider = providers.value; state.country = country ? country.value : ''; state.category = ''; state.page = 1; renderCatalog(); });
    providers.addEventListener('change', function () { state.provider = providers.value; state.q = input.value.trim(); state.category = ''; state.page = 1; renderCatalog(); }); if (country) country.addEventListener('change', function () { state.country = country.value; state.page = 1; renderCatalog(); }); parent.appendChild(form);
    if (categories && categories.length) { var chips = node('div', 'filter-chips'); chips.setAttribute('aria-label', 'Categorías'); var all = [{ id: '', name: 'Todo' }].concat(categories.slice(0, 24)); all.forEach(function (c) { var value = typeof c === 'string' ? c : c.id === undefined ? c.name : c.id; var label = typeof c === 'string' ? c : c.name || c.id; var chip = node('button', 'chip', text(label, 100)); chip.type = 'button'; chip.setAttribute('aria-pressed', String(state.category === value)); chip.addEventListener('click', function () { state.category = value; state.page = 1; renderCatalog(); }); chips.appendChild(chip); }); parent.appendChild(chips); }
  }
  function renderCatalog() {
    stopHero(); var seq = ++state.seq; var section = state.section; var previousFocus = document.activeElement && document.activeElement.id; clear(view); view.appendChild(node('div', 'loading', 'Cargando catálogo…')); view.setAttribute('aria-busy', 'true');
    api('catalog', { section: section, provider: state.provider, q: state.q, category: state.category, country: state.country, page: state.page, pageSize: 48 }).then(function (data) {
      if (seq !== state.seq) return; state.items = (data.items || []).filter(validItem); if (section === 'live') state.liveItems = state.items.slice(); clear(view); view.removeAttribute('aria-busy'); announce((data.stale ? 'Catálogo guardado: puede estar desactualizado. ' : '') + (data.warning || ''));
      if (section !== 'home') view.appendChild(heading(TITLES[section], section === 'live' ? 'Canales de tus proveedores autorizados.' : section === 'radio' ? 'Emisoras disponibles en tus listas.' : section === 'music' ? 'Tu biblioteca musical autorizada.' : '', Number(data.total) || 0));
      if (section === 'home' && state.items.length && !state.q && !state.category) { view.appendChild(node('h1', 'sr-only', 'Destacados')); renderMosaic(view, state.items); }
      else if (section === 'home' && !state.items.length) { var hero = node('section', 'hero hero-empty'); var copy = node('div', 'hero-copy'); copy.appendChild(node('span', 'hero-kicker', 'Xuper Premium')); copy.appendChild(node('h1', '', 'Todo tu entretenimiento. En un solo lugar.')); copy.appendChild(node('p', '', 'Películas, series, TV en vivo, radio y música de los proveedores que tengas autorizados.')); copy.appendChild(button('Ver mis proveedores', function () { navigate('providers'); }, 'primary')); hero.appendChild(copy); view.appendChild(hero); }
      renderFilters(view, data.categories || [], data.countries || []);
      if (section === 'music') { var official = node('div', 'notice'); official.appendChild(node('span', '', 'YouTube Music está disponible a través de su servicio oficial. ')); var link = node('a', '', 'Abrir YouTube Music'); link.href = 'https://music.youtube.com/'; link.target = '_blank'; link.rel = 'noopener noreferrer'; official.appendChild(link); view.appendChild(official); }
      if (!state.items.length) empty(view, state.q ? 'No encontramos resultados' : 'Todavía no hay contenido disponible', state.q ? 'Prueba otro título o elige un proveedor diferente.' : 'El catálogo aparecerá cuando un proveedor autorizado esté configurado y responda. Revisa el estado de tus proveedores para continuar.', { label: 'Revisar proveedores', run: function () { navigate('providers'); } });
      else if (section === 'home' && !state.q && !state.category) { var records = profile().history.filter(function (r) { return r.position > 10 && (!r.duration || r.position < r.duration - 30); }); shelf(view, 'Continuar viendo', records.slice(0, 12)); var movies = state.items.filter(function (i) { return i.type === 'movie'; }); var series = state.items.filter(function (i) { return i.type === 'series'; }); shelf(view, 'Películas para ti', movies.slice(0, 18)); shelf(view, 'Series para seguir', series.slice(0, 18)); shelf(view, 'Tu selección', state.items.filter(function (i) { return i.type !== 'movie' && i.type !== 'series'; }).slice(0, 18)); }
      else { var grid = node('div', 'media-grid'); state.items.forEach(function (item) { grid.appendChild(mediaCard(item)); }); view.appendChild(grid); }
      if (data.hasMore || state.page > 1) { var paging = node('div', 'pagination'); var prev = button('Anterior', function () { state.page--; renderCatalog(); }, 'quiet'); prev.disabled = state.page === 1; paging.appendChild(prev); paging.appendChild(node('span', '', 'Página ' + state.page)); var next = button('Siguiente', function () { state.page++; renderCatalog(); }, ''); next.disabled = !data.hasMore; paging.appendChild(next); view.appendChild(paging); }
      if (state.focusSearch) { state.focusSearch = false; byId('catalog-search').focus(); } else if (previousFocus && byId(previousFocus)) byId(previousFocus).focus();
    }).catch(function (error) { if (seq !== state.seq) return; clear(view); view.removeAttribute('aria-busy'); view.appendChild(heading(TITLES[section])); empty(view, 'El catálogo no está disponible', error.message, recoverableError(error) ? { label: 'Volver a intentar', run: renderCatalog } : { label: 'Revisar proveedores', run: function () { navigate('providers'); } }); });
  }

  function renderLibrary() {
    clear(view); var section = state.section; var p = profile(); var subtitle = 'Guardado en este navegador para el perfil ' + p.name + '.'; view.appendChild(heading(TITLES[section], subtitle));
    if (section === 'lists') {
      var create = node('form', 'inline-form'); var input = node('input'); input.id = 'playlist-name'; input.maxLength = 50; input.required = true; input.placeholder = 'Nombre de la lista'; create.appendChild(field('Crear una lista personal', input)); var submit = node('button', 'button primary', 'Crear lista'); submit.type = 'submit'; create.appendChild(submit); create.addEventListener('submit', function (event) { event.preventDefault(); var name = input.value.trim(); if (!name) return; if (p.playlists.length >= 20) return announce('Puedes guardar hasta 20 listas por perfil.'); p.playlists.push({ id: 'list-' + Date.now().toString(36), name: name, items: [] }); save(); renderLibrary(); }); view.appendChild(create);
      if (!p.playlists.length) empty(view, 'Organiza tu próxima sesión', 'Crea una lista y añade películas, series, canales o música desde su ficha.');
      p.playlists.forEach(function (list) { var head = node('div', 'playlist-heading'); head.appendChild(node('h2', '', list.name)); head.appendChild(button('Eliminar lista', function () { p.playlists = p.playlists.filter(function (entry) { return entry.id !== list.id; }); save(); renderLibrary(); }, 'quiet small danger')); view.appendChild(head); if (!list.items.length) view.appendChild(node('p', 'muted', 'Abre una ficha y elige «Añadir a lista».')); else { var grid = node('div', 'media-grid'); list.items.forEach(function (item) { grid.appendChild(mediaCard(item, true, list.id)); }); view.appendChild(grid); } });
      return;
    }
    var items = section === 'favorites' ? p.favorites : p.history;
    if (!items.length) empty(view, section === 'favorites' ? 'Tus favoritos empiezan aquí' : 'Aún no has reproducido contenido', section === 'favorites' ? 'Abre una ficha y pulsa «Guardar favorito» para encontrarla aquí.' : 'Tu historial y el progreso de cada episodio aparecerán después de reproducirlo.', { label: 'Explorar catálogo', run: function () { navigate('home'); } });
    else { var grid = node('div', 'media-grid'); items.forEach(function (item) { grid.appendChild(mediaCard(item, true, section)); }); view.appendChild(grid); }
  }
  function renderSettings(providersOnly) {
    clear(view); view.appendChild(heading(providersOnly ? 'Mis proveedores IPTV' : 'Configuración', providersOnly ? 'Conexiones y catálogos autorizados.' : 'Personaliza la experiencia de este navegador.'));
    var list = node('div', 'provider-list'); state.providers.forEach(function (provider) { var row = node('article', 'provider-row'); var info = node('div'); info.appendChild(node('h3', '', text(provider.name, 100))); var labels = { configured: 'Configurado', ready: 'Disponible', available: 'Disponible', disabled: 'Desactivado', unconfigured: 'Sin configurar', pending_verification: 'Pendiente de verificación', unavailable: 'No disponible', stale: 'Catálogo guardado', error: 'Conexión no disponible' }; info.appendChild(node('span', 'provider-state', labels[provider.status] || (provider.configured ? 'Configurado' : 'Sin configurar'))); info.appendChild(node('p', '', text(provider.message || (provider.configured ? 'Valida la conexión actualizando el catálogo.' : 'Requiere configuración autorizada en el servidor.'), 600))); if (provider.format) info.appendChild(node('p', '', 'Formato: ' + text(provider.format, 50))); row.appendChild(info); if (provider.configured) row.appendChild(button('Validar y actualizar', function (event) { var b = event.currentTarget; b.disabled = true; b.textContent = 'Validando…'; api('refresh', { providerId: provider.id }, 'POST').then(function (result) { announce(result.message || result.warning || 'Catálogo actualizado.'); return api('providers'); }).then(function (data) { state.providers = data.providers || state.providers; renderSettings(providersOnly); }).catch(function (error) { announce(error.message); b.disabled = false; b.textContent = 'Validar y actualizar'; }); }, '', 'refresh')); list.appendChild(row); }); view.appendChild(list);
    var help = node('div', 'notice'); help.appendChild(node('p', '', 'M3U, M3U8, Xtream y JSON: el administrador añade las listas autorizadas en la configuración privada del servidor. Las claves y las direcciones privadas no se guardan en este navegador.')); help.appendChild(node('p', '', 'Xuper Premium necesita un servicio y una suscripción verificables. El portable no proporciona una licencia de acceso a contenido.')); view.appendChild(help);
    if (providersOnly) return;
    var shortcuts = node('div', 'actions'); shortcuts.appendChild(button('Mis listas', function () { navigate('lists'); }, '', 'folder')); shortcuts.appendChild(button('Favoritos', function () { navigate('favorites'); }, '', 'heart')); view.appendChild(shortcuts);
    var profiles = node('section', 'settings-section'); profiles.appendChild(node('h2', '', 'Perfiles locales')); profiles.appendChild(node('p', '', 'Favoritos, listas e historial se guardan por perfil en este navegador. Los perfiles no tienen claves independientes.')); var form = node('form'); var name = node('input'); name.id = 'new-profile'; name.maxLength = 30; name.required = true; form.appendChild(field('Nombre del perfil', name)); var add = node('button', 'button primary', 'Crear perfil'); add.type = 'submit'; add.disabled = preferences.profiles.length >= 4; form.appendChild(add); form.addEventListener('submit', function (event) { event.preventDefault(); var value = name.value.trim(); if (!value || preferences.profiles.length >= 4) return; var p = { id: 'p-' + Date.now().toString(36), name: value, favorites: [], history: [], playlists: [] }; preferences.profiles.push(p); preferences.active = p.id; save(); mountProfiles(); renderSettings(false); }); profiles.appendChild(form);
    if (preferences.profiles.length > 1) profiles.appendChild(button('Eliminar perfil actual y sus datos', function () { preferences.profiles = preferences.profiles.filter(function (p) { return p.id !== preferences.active; }); preferences.active = preferences.profiles[0].id; save(); mountProfiles(); renderSettings(false); announce('Perfil eliminado de este navegador.'); }, 'quiet danger')); view.appendChild(profiles);
    var privacy = node('section', 'settings-section'); privacy.appendChild(node('h2', '', 'Historial y preferencias')); privacy.appendChild(node('p', '', 'Solo se guardan identificadores, títulos y progreso. Puedes borrar el historial y los favoritos del perfil actual.')); privacy.appendChild(button('Borrar historial y favoritos', function () { profile().history = []; profile().favorites = []; save(); announce('Historial y favoritos borrados para ' + profile().name + '.'); }, 'quiet')); view.appendChild(privacy);
    var compatibility = node('section', 'settings-section'); compatibility.appendChild(node('h2', '', 'Reproducción y compatibilidad')); compatibility.appendChild(node('p', '', 'HLS y MP4 se reproducen cuando el navegador admite sus códecs. Las señales TS necesitan compatibilidad del reproductor. MKV y AVI requieren un servicio de conversión probado; no está habilitado.')); compatibility.appendChild(node('p', '', 'La guía de TV depende de los datos del proveedor. Las descargas permanecen desactivadas hasta contar con permisos y almacenamiento configurados.')); view.appendChild(compatibility);
    var session = node('section', 'settings-section'); session.appendChild(node('h2', '', 'Sesión de TVVIDAA')); session.appendChild(button('Cerrar sesión', function () { window.fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).then(function (response) { if (!response.ok) throw new Error(); showLogin(); }).catch(function () { announce('No se pudo cerrar la sesión. Vuelve a intentarlo.'); }); }, 'quiet')); view.appendChild(session);
  }

  function openDetail(item, resumeRecord) {
    if (!validItem(item)) return; var seq = ++state.detailSeq; state.selectedSignal = '0'; state.returnFocus = document.activeElement; byId('detail').hidden = false; setBackgroundInert(true); var content = byId('detail-content'); clear(content); var close = button('Volver', closeDetail, 'quiet detail-close', 'left'); content.appendChild(close); content.appendChild(node('h2', 'loading', 'Cargando ficha…')); close.focus();
    api('detail', { providerId: item.providerId, id: item.id }).then(function (data) { if (seq !== state.detailSeq || byId('detail').hidden) return; state.detailItem = data.item; state.seasons = data.seasons || (data.item && data.item.seasons) || []; if (!validItem(state.detailItem)) throw new Error('El proveedor no devolvió una ficha válida.'); renderDetail(resumeRecord); }).catch(function (error) { if (seq !== state.detailSeq) return; clear(content); content.appendChild(button('Volver', closeDetail, 'quiet detail-close', 'left')); var title = node('h2', '', 'Ficha no disponible'); title.id = 'detail-title'; content.appendChild(title); content.appendChild(node('p', '', error.message)); });
  }
  function closeDetail() { if (byId('detail').hidden) return; byId('detail').hidden = true; state.detailSeq++; if (byId('player').hidden && byId('login').hidden) setBackgroundInert(false); if (state.returnFocus && document.contains(state.returnFocus)) state.returnFocus.focus(); }
  function renderDetail(resumeRecord) {
    var item = state.detailItem; var content = byId('detail-content'); var focused = document.activeElement; clear(content); var close = button('Volver', closeDetail, 'quiet detail-close', 'left'); content.appendChild(close); var main = node('div', 'detail-main'); var poster = node('div', 'detail-poster'); placeholder(poster, item); artwork(poster, item.poster, item.title); main.appendChild(poster); var info = node('div', 'detail-info'); var title = node('h2', '', text(item.title, 220)); title.id = 'detail-title'; info.appendChild(title); info.appendChild(node('div', 'detail-meta', [TYPES[item.type] || 'Contenido', item.year, item.category, providerName(item.providerId)].filter(Boolean).join(' · '))); info.appendChild(node('p', '', text(item.synopsis || 'El proveedor no incluye una sinopsis para este contenido.', 5000))); var actions = node('div', 'actions detail-actions');
    if (item.signals && item.signals.length > 1) { var signal = node('select'); signal.id = 'detail-signal'; item.signals.forEach(function (s, i) { option(signal, text(s.label || 'Señal ' + (i + 1), 100), String(s.id == null ? i : s.id)); }); signal.value = state.selectedSignal || '0'; signal.addEventListener('change', function () { state.selectedSignal = signal.value; }); info.appendChild(field('Señal de reproducción', signal)); }
    var restriction = confirmedRestriction(item); if (restriction) info.appendChild(node('p', 'notice', text(restriction.message, 700)));
    if (item.type !== 'series') actions.appendChild(playAction(item, null, progress(item) && progress(item).position > 10 ? 'Continuar' : (item.type === 'radio' || item.type === 'music' ? 'Escuchar' : 'Reproducir'), 'primary'));
    else if (resumeRecord && resumeRecord.parentId) { var resumeItem = safeItem(resumeRecord); resumeItem.type = 'series'; state.seasons.forEach(function (season) { (season.episodes || []).forEach(function (episode) { if (episode.id === resumeItem.id) resumeItem.playbackRestriction = episode.playbackRestriction; }); }); var resumeRestriction = confirmedRestriction(resumeItem); if (resumeRestriction) info.appendChild(node('p', 'notice', text(resumeRestriction.message, 700))); actions.appendChild(playAction(resumeItem, item, 'Continuar episodio', 'primary')); }
    var fav = button(favorite(item) ? 'Quitar favorito' : 'Guardar favorito', function () { toggleFavorite(item); clear(fav); fav.appendChild(icon('heart')); fav.appendChild(node('span', '', favorite(item) ? 'Quitar favorito' : 'Guardar favorito')); fav.setAttribute('aria-pressed', String(favorite(item))); }, '', 'heart'); fav.setAttribute('aria-pressed', String(favorite(item))); actions.appendChild(fav); info.appendChild(actions);
    var playlists = profile().playlists; if (playlists.length) { var add = node('div', 'add-playlist'); var select = node('select'); select.id = 'detail-playlist'; playlists.forEach(function (list) { option(select, list.name, list.id); }); add.appendChild(field('Añadir a una lista', select)); add.appendChild(button('Añadir', function () { var list = playlists.filter(function (l) { return l.id === select.value; })[0]; if (list && !list.items.some(function (entry) { return itemKey(entry) === itemKey(item); })) { if (list.items.length >= 300) return detailNotice('La lista ha alcanzado el máximo de 300 elementos.'); list.items.push(safeItem(item)); save(); } detailNotice('Añadido a ' + list.name + '.'); }, 'quiet')); info.appendChild(add); } else info.appendChild(button('Crear una lista personal', function () { closeDetail(); navigate('lists'); }, 'quiet small'));
    if (item.type === 'live') info.appendChild(button('Consultar guía de TV', function () { api('guide', { providerId: item.providerId, id: item.id }).then(function (data) { var programs = data.programmes || []; detailNotice(programs.length ? programs.slice(0, 8).map(function (p) { var at = Number(p.start); return (isFinite(at) && at > 0 ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' : '') + text(p.title, 180); }).join(' · ') : data.message || 'Este proveedor no ofrece una guía de TV.'); }).catch(function (error) { detailNotice(error.message); }); }, 'quiet small'));
    var message = node('p', 'muted'); message.id = 'detail-message'; message.setAttribute('role', 'status'); info.appendChild(message); main.appendChild(info); content.appendChild(main);
    if (item.type === 'series') { var episodes = node('section', 'episode-area'); episodes.appendChild(node('h3', '', 'Temporadas y episodios')); if (!state.seasons.length) episodes.appendChild(node('p', '', 'Este proveedor no incluye episodios disponibles.')); else { var seasons = node('select'); seasons.id = 'season-select'; seasons.setAttribute('aria-label', 'Temporada'); state.seasons.forEach(function (season, index) { option(seasons, season.title || 'Temporada ' + (season.number || index + 1), String(index)); }); episodes.appendChild(seasons); var list = node('div', 'episode-list'); episodes.appendChild(list); seasons.addEventListener('change', function () { renderEpisodes(list, state.seasons[Number(seasons.value)], item); }); renderEpisodes(list, state.seasons[0], item); } content.appendChild(episodes); }
    if (!focused || !document.contains(focused)) close.focus();
  }
  function detailNotice(message) { var n = byId('detail-message'); if (n) n.textContent = text(message, 2000); }
  function renderEpisodes(parent, season, series) { clear(parent); (season.episodes || []).forEach(function (episode, index) { var item = { id: episode.id, providerId: series.providerId, title: episode.title || 'Episodio ' + (episode.number || index + 1), type: 'series', category: series.category, year: series.year, playbackRestriction: episode.playbackRestriction }; var row = node('article', 'episode'); var copy = node('div'); copy.appendChild(node('h3', '', item.title)); var record = progress(item); copy.appendChild(node('p', '', record ? 'Visto hasta ' + durationLabel(record.position) : 'Episodio ' + (episode.number || index + 1))); var restriction = confirmedRestriction(item); if (restriction) copy.appendChild(node('p', '', text(restriction.message, 700))); row.appendChild(copy); row.appendChild(playAction(item, series, record && record.position > 10 ? 'Continuar' : 'Reproducir', 'quiet')); parent.appendChild(row); }); if (!(season.episodes || []).length) parent.appendChild(node('p', '', 'No hay episodios en esta temporada.')); }


  function episodeEntries() {
    return state.playing && state.playing.series && window.XuperEpisodes
      ? window.XuperEpisodes.listEpisodes(state.playing.episodeSeasons) : [];
  }
  function episodeItem(entry, series) {
    return { id: entry.id, providerId: series.providerId, title: entry.title, type: 'series',
      category: series.category, year: series.year, playbackRestriction: entry.playbackRestriction };
  }
  function closeEpisodePicker(restoreFocus) {
    byId('episode-picker').hidden = true;
    byId('episode-picker-toggle').setAttribute('aria-expanded', 'false');
    if (restoreFocus !== false && !byId('episode-picker-toggle').hidden) byId('episode-picker-toggle').focus();
  }
  function renderPlayerEpisodes() {
    var entries = episodeEntries(), seasons = state.playing && state.playing.episodeSeasons || [];
    var selector = byId('player-season'), container = byId('player-episodes');
    clear(selector); clear(container);
    if (!entries.length || !state.playing || !state.playing.series) return;
    var currentId = state.playing.item.id, selectedIndex = 0;
    for (var i = 0; i < entries.length; i++) if (entries[i].id === currentId) { selectedIndex = entries[i].seasonIndex; break; }
    seasons.forEach(function (season, index) {
      if (!season || !Array.isArray(season.episodes) || !entries.some(function (entry) { return entry.seasonIndex === index; })) return;
      option(selector, text(season.title || ('Temporada ' + (season.number || index + 1)), 100), String(index));
    });
    function showSeason() {
      clear(container);
      var seasonIndex = Number(selector.value), series = state.playing.series;
      entries.filter(function (entry) { return entry.seasonIndex === seasonIndex; }).forEach(function (entry) {
        var item = episodeItem(entry, series), restricted = confirmedRestriction(item);
        var label = (entry.number || '') + '. ' + entry.title + (entry.id === currentId ? ' · Reproduciendo' : '');
        var choice = button(label, function () { closeEpisodePicker(false); play(item, series); }, 'episode-choice');
        choice.setAttribute('aria-current', entry.id === currentId ? 'true' : 'false');
        if (restricted) { choice.disabled = true; choice.title = text(restricted.message, 700); }
        container.appendChild(choice);
      });
    }
    selector.value = String(selectedIndex);
    if (!selector.value && selector.options.length) selector.selectedIndex = 0;
    selector.onchange = showSeason;
    showSeason();
  }
  function updatePlayerEpisodeControls() {
    var entries = episodeEntries();
    var available = entries.length > 0;
    byId('episode-picker-toggle').hidden = !available;
    var next = available && window.XuperEpisodes.adjacentEpisode(state.playing.episodeSeasons, state.playing.item.id, 1);
    byId('next-episode').hidden = !next;
    byId('next-episode').disabled = !!(next && confirmedRestriction(episodeItem(next, state.playing.series)));
    if (next && byId('next-episode').disabled) byId('next-episode').title = 'El siguiente episodio necesita un formato compatible.';
    else byId('next-episode').removeAttribute('title');
  }
  function toggleEpisodePicker() {
    if (byId('episode-picker-toggle').hidden) return;
    if (!byId('episode-picker').hidden) return closeEpisodePicker();
    renderPlayerEpisodes();
    byId('episode-picker').hidden = false;
    byId('episode-picker-toggle').setAttribute('aria-expanded', 'true');
    byId('player-season').focus();
  }
  function playNextEpisode() {
    if (!state.playing || !state.playing.series || !window.XuperEpisodes) return;
    var next = window.XuperEpisodes.adjacentEpisode(state.playing.episodeSeasons, state.playing.item.id, 1);
    if (!next) return playerStatus('No hay más episodios disponibles en esta serie.');
    var item = episodeItem(next, state.playing.series);
    if (confirmedRestriction(item)) return playerStatus('El siguiente episodio necesita una versión HLS o MP4 compatible.', true);
    closeEpisodePicker(false);
    play(item, state.playing.series);
  }
  function seekBy(seconds) {
    if (!state.playing || !state.playing.ready || !isFinite(video.duration) || video.duration <= 0) return;
    try { video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds)); }
    catch (_) { playerStatus('No se puede avanzar o retroceder en esta señal.'); }
  }

  function destroyMedia() { if (state.hls) { state.hls.destroy(); state.hls = null; } video.pause(); video.removeAttribute('src'); while (video.firstChild) video.removeChild(video.firstChild); video.load(); if (state.retryTimer) window.clearTimeout(state.retryTimer); state.retryTimer = null; }
  function closePlayer() { if (byId('player').hidden) return; closeEpisodePicker(false); writeProgress(true); state.playSeq++; state.playing = null; destroyMedia(); byId('player').hidden = true; if (byId('detail').hidden && byId('login').hidden) setBackgroundInert(false); else if (!byId('detail').hidden) { byId('detail').removeAttribute('aria-hidden'); var close = byId('detail').querySelector('button'); if (close) close.focus(); } if (document.fullscreenElement && document.exitFullscreen) { var pending = document.exitFullscreen(); if (pending && pending.catch) pending.catch(function () {}); } }
  function playerStatus(message, error) { byId('player-status').textContent = text(message, 700); byId('player-status').className = error ? 'error-text' : ''; }
  function play(item, series, retrying) {
    if (!validItem(item)) return; var restriction = confirmedRestriction(item); if (restriction) { detailNotice(restriction.message); return; }
    var episodeSeasons = [];
    if (series && state.detailItem && itemKey(state.detailItem) === itemKey(series)) episodeSeasons = state.seasons;
    else if (series && state.playing && state.playing.series && itemKey(state.playing.series) === itemKey(series)) episodeSeasons = state.playing.episodeSeasons || [];
    writeProgress(true); var seq = ++state.playSeq; var selectedSignal = retrying && state.playing ? state.playing.signal : state.detailItem && itemKey(state.detailItem) === itemKey(item) ? state.selectedSignal || '0' : '0'; destroyMedia(); if (!retrying) state.retries = 0; state.playing = { item: safeItem(item), series: series ? safeItem(series) : null, episodeSeasons: episodeSeasons, signal: selectedSignal, ready: false, failed: false, canRetry: false }; byId('player').hidden = false; byId('detail').setAttribute('aria-hidden', 'true'); setBackgroundInert(true); byId('player').className = 'overlay player-overlay' + ((item.type === 'radio' || item.type === 'music') ? ' audio-mode' : ''); byId('player-title').textContent = series ? series.title + ' — ' + item.title : item.title;
    closeEpisodePicker(false);
    var isVod = item.type !== 'live' && item.type !== 'radio' && item.type !== 'music';
    byId('seek-back').hidden = byId('seek-forward').hidden = byId('speed-label').hidden = !isVod;
    video.playbackRate = 1;
    byId('playback-speed').value = '1';
    updatePlayerEpisodeControls();
    playerStatus('Preparando reproducción…'); byId('player-toggle').disabled = true; byId('player-retry').hidden = true; ['quality-label', 'audio-label', 'subtitle-label'].forEach(function (id) { byId(id).hidden = true; }); byId('channel-previous').hidden = byId('channel-next').hidden = item.type !== 'live' || state.liveItems.length < 2; byId('player-close').focus();
    api('resolve', { providerId: item.providerId, id: item.id, signal: selectedSignal }).then(function (data) {
      if (seq !== state.playSeq) return; var source = relayUrl(data.mediaUrl || data.url); if (!source) throw requestError('El proveedor no devolvió una fuente de reproducción segura.', 'UNSUPPORTED_SOURCE'); if (/matroska|x-msvideo|avi/i.test(data.mime || '')) throw requestError('Este formato necesita un servicio de conversión compatible. Todavía no está habilitado.', 'UNSUPPORTED_FORMAT');
      state.playing.expiry = Number(data.expiresAt || data.mediaExpiresAt) || 0;
      state.playing.ready = true; byId('player-toggle').disabled = false;
      if (data.isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
        if (!window.Hls || !window.Hls.isSupported()) throw requestError('Este navegador no puede reproducir esta señal HLS. Prueba un navegador compatible.', 'UNSUPPORTED_BROWSER');
        var hls = new window.Hls({ enableWorker: false, maxBufferLength: 30, backBufferLength: 30, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1 }); state.hls = hls; hls.loadSource(source); hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, function () { if (seq !== state.playSeq) return; setupHlsTracks(hls); beginPlayback(); });
        hls.on(window.Hls.Events.ERROR, function (_, event) { if (seq !== state.playSeq || !event.fatal || state.playing.failed) return; var incompatible = /incompatible|codec|manifestParsing/i.test(event.details || ''); playbackError(requestError(incompatible ? 'La señal HLS no incluye un formato o códec compatible.' : 'La señal HLS se interrumpió.', incompatible ? 'UNSUPPORTED_FORMAT' : 'HLS_ERROR', event.response && event.response.code)); });
      } else { video.src = source; beginPlayback(); }
      addSubtitles(data.subtitles || []); playerStatus('Conectando…');
    }).catch(function (error) { if (seq !== state.playSeq) return; playbackError(error); });
  }
  function beginPlayback() { if (!state.playing || !state.playing.ready || state.playing.failed) return; var seq = state.playSeq; var promise = video.play(); if (promise && promise.catch) promise.catch(function () { if (seq === state.playSeq && !state.playing.failed) playerStatus('Pulsa Reproducir para comenzar.'); }); }
  function writeProgress(force) {
    if (!state.playing || (!force && Date.now() - state.progressAt < 10000)) return; var position = Number(video.currentTime); if (!isFinite(position) || position < 1) return; state.progressAt = Date.now(); var record = safeItem(state.playing.item); record.position = Math.min(864000, position); record.duration = isFinite(video.duration) ? Math.min(864000, video.duration) : 0; record.updated = Date.now(); if (state.playing.series) { record.parentId = state.playing.series.id; record.parentTitle = state.playing.series.title; record.episodeTitle = record.title; } var p = profile(); p.history = p.history.filter(function (entry) { return itemKey(entry) !== itemKey(record); }); p.history.unshift(record); p.history = p.history.slice(0, 150); save();
  }
  function playbackError(error) {
    if (!state.playing) return; if (typeof error === 'string') error = requestError(error);
    var recoverable = recoverableError(error); state.playing.failed = true; state.playing.canRetry = recoverable && state.retries < 2;
    var message = error.name === 'TypeError' ? 'No se pudo conectar con el servidor. Comprueba tu conexión.' : error.message || 'No se pudo reproducir esta señal.';
    var next = recoverable ? (state.retries < 2 ? ' Puedes volver a conectar.' : ' Se alcanzó el límite de reintentos. Cierra el reproductor y revisa el proveedor.') : error.code === 'UNSUPPORTED_FORMAT' || error.code === 'UNSUPPORTED_SOURCE' ? ' Elige otra señal o revisa el proveedor.' : error.code === 'UNSUPPORTED_BROWSER' ? '' : ' Cierra el reproductor y revisa el proveedor.';
    playerStatus(message + next, true); byId('player-toggle').disabled = true; byId('player-retry').hidden = !state.playing.canRetry;
  }
  function retryPlayback() { if (!state.playing || !state.playing.canRetry || state.retries >= 2) return; var playing = state.playing; state.retries++; play(playing.item, playing.series, true); }
  function setupHlsTracks(hls) { var quality = byId('quality'); clear(quality); option(quality, 'Automática', '-1'); (hls.levels || []).forEach(function (level, index) { option(quality, level.height ? level.height + 'p' : 'Señal ' + (index + 1), String(index)); }); byId('quality-label').hidden = !hls.levels || hls.levels.length < 2; var audio = byId('audio-track'); clear(audio); (hls.audioTracks || []).forEach(function (track, index) { option(audio, track.name || track.lang || 'Audio ' + (index + 1), String(index)); }); byId('audio-label').hidden = !hls.audioTracks || hls.audioTracks.length < 2; if (hls.subtitleTracks && hls.subtitleTracks.length) { var sub = byId('subtitle-track'); clear(sub); option(sub, 'Desactivados', '-1'); hls.subtitleTracks.forEach(function (track, index) { option(sub, track.name || track.lang || 'Subtítulo ' + (index + 1), String(index)); }); sub.value = '-1'; byId('subtitle-label').hidden = false; } }
  function addSubtitles(tracks) { if (!tracks.length) return; var sub = byId('subtitle-track'); clear(sub); option(sub, 'Desactivados', '-1'); tracks.forEach(function (entry, index) { var src = relayUrl(entry.url || entry.src); if (!src) return; var track = node('track'); track.kind = 'subtitles'; track.label = text(entry.label || entry.name || 'Subtítulo ' + (index + 1), 100); var language = entry.language || entry.lang || ''; track.srclang = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language) ? language : 'es'; track.src = src; video.appendChild(track); option(sub, track.label, String(video.children.length - 1)); }); sub.value = '-1'; byId('subtitle-label').hidden = sub.options.length < 2; }
  function changeChannel(offset) { if (!state.playing || !state.liveItems.length) return; var key = itemKey(state.playing.item); var index = -1; for (var i = 0; i < state.liveItems.length; i++) if (itemKey(state.liveItems[i]) === key) index = i; index = (index + offset + state.liveItems.length) % state.liveItems.length; play(state.liveItems[index]); }
  function currentOverlay() { if (!byId('login').hidden) return byId('login'); if (!byId('player').hidden) return !byId('episode-picker').hidden ? byId('episode-picker') : byId('player'); if (!byId('detail').hidden) return byId('detail'); return null; }
  function visibleFocusables(root) { return Array.prototype.slice.call((root || document).querySelectorAll('a[href],button,input,select,video,[tabindex="0"]')).filter(function (el) { if (el.disabled || el.hidden || el.getAttribute('aria-hidden') === 'true') return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && window.getComputedStyle(el).visibility !== 'hidden'; }); }
  function moveFocus(direction) {
    var root = currentOverlay() || document; var candidates = visibleFocusables(root); var active = document.activeElement; var from = active && active.getBoundingClientRect(); if (!from || !from.width || candidates.indexOf(active) < 0) { if (candidates[0]) candidates[0].focus(); return; }
    var cx = from.left + from.width / 2; var cy = from.top + from.height / 2; var best = null; var score = Infinity;
    candidates.forEach(function (candidate) { if (candidate === active) return; var r = candidate.getBoundingClientRect(); var dx = r.left + r.width / 2 - cx; var dy = r.top + r.height / 2 - cy; var primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy; if (primary <= 1) return; var secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx); var s = primary + secondary * 3 + (secondary > primary ? secondary * 2 : 0); if (s < score) { score = s; best = candidate; } });
    if (best) { best.focus(); try { best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' }); } catch (_) { best.scrollIntoView(false); } }
  }
  function handleKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return; var code = event.keyCode || event.which; var key = event.key; var active = document.activeElement; var editing = active && matches(active, 'input,textarea,select'); var overlay = currentOverlay();
    if (key === 'Tab' && overlay) { var items = visibleFocusables(overlay); if (items.length && (event.shiftKey && active === items[0] || !event.shiftKey && active === items[items.length - 1])) { event.preventDefault(); (event.shiftKey ? items[items.length - 1] : items[0]).focus(); } return; }
    if (key === 'Escape' || code === 10009 || code === 461 || (code === 8 && !editing)) { event.preventDefault(); if (!byId('episode-picker').hidden) closeEpisodePicker(); else if (!byId('player').hidden) closePlayer(); else if (!byId('detail').hidden) closeDetail(); else if (!byId('login').hidden) window.location.href = '/'; else if (state.section !== 'home') navigate('home'); else window.location.href = '/'; return; }
    if (!editing && (code >= 37 && code <= 40)) { event.preventDefault(); if (active === video && !byId('player').hidden && (code === 37 || code === 39) && state.playing && state.playing.item.type !== 'live') { if (isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (code === 37 ? -10 : 10))); } else moveFocus({ 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[code]); return; }
    if (!byId('player').hidden && (code === 179 || code === 415 || code === 19 || key === 'MediaPlayPause' || (key === ' ' && active === video))) { event.preventDefault(); if (code === 415) beginPlayback(); else if (code === 19) video.pause(); else if (video.paused) beginPlayback(); else video.pause(); }
    if (!byId('player').hidden && (code === 427 || code === 428)) { event.preventDefault(); changeChannel(code === 427 ? 1 : -1); }
    if (code === 13 && active === video && !byId('player').hidden) { event.preventDefault(); if (video.paused) beginPlayback(); else video.pause(); }
  }
  function bootstrap() { return api('bootstrap').then(function (data) { state.providers = data.providers || []; state.boot = true; mountProfiles(); var hash = window.location.hash.slice(1); state.section = TITLES[hash] ? hash : 'home'; loadSection(state.section); }).catch(function (error) { mountProfiles(); mountNav(); clear(view); view.appendChild(heading('Xuper Premium')); empty(view, 'No se pudo conectar', error.message, { label: 'Volver a intentar', run: bootstrap }); }); }

  byId('profile-select').addEventListener('change', function () { var nextProfile = this.value; closePlayer(); closeDetail(); preferences.active = nextProfile; save(); loadSection(state.section); });
  byId('header-search').addEventListener('click', function (event) { event.preventDefault(); state.focusSearch = true; if (state.section === 'home' && byId('catalog-search')) { state.focusSearch = false; byId('catalog-search').focus(); byId('catalog-search').scrollIntoView({ block: 'center' }); } else navigate('home'); });
  function updateClock() { var now = new Date(); byId('header-clock').textContent = (now.getHours() < 10 ? '0' : '') + now.getHours() + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes(); }
  updateClock(); window.setInterval(updateClock, 30000);
  byId('login-form').addEventListener('submit', function (event) { event.preventDefault(); var password = byId('password'); var submit = this.querySelector('button'); submit.disabled = true; byId('login-error').textContent = ''; window.fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }) }).then(function (response) { return response.json().then(function (data) { if (!response.ok || !data.authenticated) throw new Error(data.error || 'La clave no es correcta.'); password.value = ''; byId('login').hidden = true; setBackgroundInert(false); return bootstrap(); }); }).catch(function (error) { byId('login-error').textContent = error.message; password.focus(); }).then(function () { submit.disabled = false; }); });
  byId('player-close').addEventListener('click', closePlayer); byId('player-toggle').addEventListener('click', function () { if (video.paused) beginPlayback(); else video.pause(); }); byId('player-retry').addEventListener('click', retryPlayback);
  byId('episode-picker-toggle').addEventListener('click', toggleEpisodePicker);
  byId('episode-picker-close').addEventListener('click', function () { closeEpisodePicker(); });
  byId('next-episode').addEventListener('click', playNextEpisode);
  byId('seek-back').addEventListener('click', function () { seekBy(-10); });
  byId('seek-forward').addEventListener('click', function () { seekBy(10); });
  byId('playback-speed').addEventListener('change', function () {
    if (!state.playing || byId('speed-label').hidden) return;
    var speed = Number(this.value);
    if ([0.75, 1, 1.25, 1.5, 2].indexOf(speed) !== -1) video.playbackRate = speed;
  }); byId('channel-previous').addEventListener('click', function () { changeChannel(-1); }); byId('channel-next').addEventListener('click', function () { changeChannel(1); });
  byId('player-fullscreen').addEventListener('click', function () { var target = byId('player'); var method = target.requestFullscreen || target.webkitRequestFullscreen; if (method) { var result = method.call(target); if (result && result.catch) result.catch(function () { playerStatus('Usa la opción de pantalla completa del navegador.'); }); } else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); else playerStatus('Este navegador no permite activar pantalla completa.'); });
  byId('quality').addEventListener('change', function () { if (state.hls) state.hls.currentLevel = Number(this.value); }); byId('audio-track').addEventListener('change', function () { if (state.hls) state.hls.audioTrack = Number(this.value); else if (video.audioTracks) for (var i = 0; i < video.audioTracks.length; i++) video.audioTracks[i].enabled = i === Number(this.value); }); byId('subtitle-track').addEventListener('change', function () { if (state.hls && state.hls.subtitleTracks.length) { state.hls.subtitleTrack = Number(this.value); state.hls.subtitleDisplay = Number(this.value) >= 0; } else for (var i = 0; i < video.textTracks.length; i++) video.textTracks[i].mode = i === Number(this.value) ? 'showing' : 'disabled'; });
  video.addEventListener('loadedmetadata', function () { if (!state.playing) return; var record = progress(state.playing.item); if (record && record.position > 10 && isFinite(video.duration) && record.position < video.duration - 15) { try { video.currentTime = record.position; } catch (_) {} } if (!state.hls && video.audioTracks && video.audioTracks.length > 1) { var select = byId('audio-track'); clear(select); for (var i = 0; i < video.audioTracks.length; i++) option(select, video.audioTracks[i].label || video.audioTracks[i].language || 'Audio ' + (i + 1), String(i)); byId('audio-label').hidden = false; } });
  video.addEventListener('playing', function () { if (!state.playing || state.playing.failed) return; playerStatus(''); byId('player-retry').hidden = true; }); video.addEventListener('waiting', function () { if (state.playing && !state.playing.failed) playerStatus('Cargando señal…'); }); video.addEventListener('stalled', function () { if (state.playing && !state.playing.failed) playerStatus('La señal tarda en responder.'); }); video.addEventListener('pause', function () { writeProgress(true); }); video.addEventListener('timeupdate', function () { writeProgress(false); }); video.addEventListener('ended', function () { writeProgress(true); playerStatus(!byId('next-episode').hidden && !byId('next-episode').disabled ? 'Reproducción terminada. Pulsa Siguiente episodio para continuar.' : 'Reproducción terminada.'); });
  video.addEventListener('error', function () { if (!state.playing || state.playing.failed || !video.getAttribute('src')) return; var code = video.error && video.error.code; playbackError(requestError(code === 3 || code === 4 ? 'La fuente o sus códecs no son compatibles con este navegador.' : 'La conexión con la señal se interrumpió.', code === 3 ? 'UNSUPPORTED_FORMAT' : code === 4 ? 'UNSUPPORTED_SOURCE' : 'MEDIA_NETWORK_ERROR')); });
  window.addEventListener('hashchange', function () { if (state.boot) loadSection(window.location.hash.slice(1)); }); document.addEventListener('keydown', handleKey); window.addEventListener('pagehide', function () { writeProgress(true); stopHero(); }); document.addEventListener('visibilitychange', function () { if (document.hidden) writeProgress(true); });
  window.fetch('/api/session', { credentials: 'same-origin' }).then(function (response) { if (!response.ok) throw new Error(); return response.json(); }).then(function (data) { if (data.authenticated) bootstrap(); else showLogin(); }).catch(function () { mountProfiles(); mountNav(); empty(view, 'No hay conexión con TVVIDAA', 'Comprueba tu conexión y vuelve a cargar la página.'); });
})();
