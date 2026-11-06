(function () {
  'use strict';

  // Remove credentials left by the former implicit GET form before any other
  // request or UI code runs. Replace the history entry instead of preserving it.
  if (/(?:^|[?&])password=/i.test(window.location.search.substring(1))) {
    var cleanUrl = window.location.pathname + window.location.hash;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, document.title, cleanUrl);
    } else {
      window.location.replace(cleanUrl);
      return;
    }
  }

  var loginPanel = document.getElementById('login-panel');
  var appPanel = document.getElementById('app-panel');
  var loginStatus = document.getElementById('login-status');
  var appStatus = document.getElementById('app-status');
  var playerStatus = document.getElementById('player-status');
  var results = document.getElementById('results');
  var liveLayout = document.getElementById('live-layout');
  var detailPanel = document.getElementById('detail-panel');
  var playerPanel = document.getElementById('player-panel');
  var video = document.getElementById('video');
  var activeView = 'live';
  var selectedItem = null;
  var homeViews = { featured: true, movies: true, series: true, kids: true, anime: true, free: true };
  var viewTitles = {
    live: 'TV', featured: 'Destacados', movies: 'Películas', series: 'Series',
    kids: 'Kids', anime: 'Anime', free: 'Gratis', search: 'Buscar'
  };

  function listen(element, type, callback) {
    if (element.addEventListener) element.addEventListener(type, callback, false);
    else if (element.attachEvent) element.attachEvent('on' + type, callback);
  }

  function setClass(element, name, enabled) {
    var parts = String(element.className || '').split(/\s+/);
    var next = [];
    var found = false;
    var i;
    for (i = 0; i < parts.length; i += 1) {
      if (!parts[i] || parts[i] === name) {
        if (parts[i] === name) found = true;
        continue;
      }
      next.push(parts[i]);
    }
    if (enabled && !found) next.push(name);
    element.className = next.join(' ');
  }

  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function request(path, body, callback) {
    var xhr = new XMLHttpRequest();
    var hasBody = typeof body !== 'undefined';
    xhr.open(hasBody ? 'POST' : 'GET', '/api/' + path, true);
    xhr.withCredentials = true;
    if (hasBody) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var payload = {};
      try { payload = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (_) { payload = {}; }
      if (xhr.status >= 200 && xhr.status < 300) callback(null, payload);
      else {
        var error = new Error(payload && payload.error ? payload.error : 'REQUEST_FAILED');
        error.status = xhr.status;
        callback(error);
      }
    };
    xhr.onerror = function () { callback(new Error('NETWORK_ERROR')); };
    xhr.ontimeout = function () { callback(new Error('REQUEST_TIMEOUT')); };
    try {
      xhr.timeout = 90000;
      xhr.send(hasBody ? JSON.stringify(body) : null);
    } catch (error) {
      callback(error);
    }
  }

  function showMessage(target, value) {
    target.textContent = value || '';
  }

  function userMessage(error) {
    if (error && error.status === 401) return 'La sesión terminó. Vuelve a ingresar.';
    if (error && error.message === 'PORTAL_SESSION_UNAVAILABLE') return 'El portal no pudo iniciar sesión desde este servidor.';
    if (error && error.message === 'PORTAL_REGION_BLOCKED') return 'El portal marcó esta región como bloqueada; su catálogo no está visible.';
    if (error && error.message === 'PORTAL_SESSION_TIMEOUT') return 'El portal tardó demasiado en iniciar sesión. Inténtalo otra vez más tarde.';
    if (error && error.message === 'PORTAL_REQUEST_FAILED') return 'El portal no respondió. Inténtalo de nuevo.';
    if (error && error.message === 'PORTAL_REQUEST_TIMEOUT') return 'El portal no respondió a tiempo; los programas no se pudieron cargar.';
    if (error && error.message === 'REQUEST_TIMEOUT') return 'La solicitud tardó demasiado. Inténtalo de nuevo.';
    if (error && error.message === 'MEDIA_PROXY_FAILED') return 'No se pudo preparar el recurso de reproducción.';
    return 'No se pudo completar la solicitud.';
  }

  function listFrom(payload) {
    var keys = ['items', 'channels', 'categories', 'results', 'data'];
    var i;
    if (Object.prototype.toString.call(payload) === '[object Array]') return payload;
    if (!payload || typeof payload !== 'object') return [];
    for (i = 0; i < keys.length; i += 1) {
      if (Object.prototype.toString.call(payload[keys[i]]) === '[object Array]') return payload[keys[i]];
    }
    return [];
  }

  function itemId(item) {
    return item && (item.contentId || item.id || item.channelCode || '');
  }

  function itemTitle(item) {
    return item && (item.title || item.name || item.contentId || item.id || item.channelCode || '');
  }

  function setView(view) {
    var buttons = document.querySelectorAll('.nav-button');
    var i;
    activeView = view;
    setClass(appPanel, 'is-live-view', view === 'live');
    setClass(appPanel, 'is-search-view', view === 'search');
    for (i = 0; i < buttons.length; i += 1) setClass(buttons[i], 'active', buttons[i].getAttribute('data-view') === view);
    document.getElementById('search-panel').hidden = view !== 'search';
    document.getElementById('live-panel').hidden = view !== 'live';
    document.getElementById('view-title').textContent = viewTitles[view] || 'Xuper Hydra';
    document.getElementById('section-title').textContent = viewTitles[view] || 'Xuper Hydra';
    setClass(liveLayout, 'is-live', view === 'live');
    setClass(results, 'is-live', view === 'live');
    setClass(results, 'is-featured', view === 'featured');
    detailPanel.hidden = true;
    playerPanel.hidden = true;
    results.hidden = false;
    if (video.pause) video.pause();
    video.removeAttribute('src');
    if (video.load) video.load();
  }

  function renderItems(items) {
    var position;
    clear(results);
    setClass(results, 'is-live', activeView === 'live');
    setClass(results, 'is-featured', activeView === 'featured');
    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = activeView === 'live' ? 'No hay canales disponibles.' : 'No hay resultados para mostrar.';
      results.appendChild(empty);
      return;
    }

    for (position = 0; position < items.length; position += 1) {
      (function (item, index) {
        if (!item || typeof item !== 'object') return;
        var title = String(itemTitle(item) || '').replace(/^\s+|\s+$/g, '');
        var id = itemId(item);
        var card;
        var heading;
        var kind;
        var artwork;
        var image;
        var isLive;
        if (!title || !id) return;

        card = document.createElement('button');
        card.type = 'button';
        card.className = 'result-card';
        if (activeView === 'featured' && index === 0) setClass(card, 'result-card--hero', true);
        heading = document.createElement('strong');
        heading.textContent = title;
        kind = document.createElement('span');
        isLive = Boolean(item.channelCode);
        kind.textContent = String(item.category || item.kind || '');
        if (!kind.textContent) kind.style.display = 'none';
        artwork = activeView === 'featured'
          ? (item.landscape || item.backdrop || item.poster || item.logo)
          : (item.poster || item.logo || item.landscape);
        if (typeof artwork === 'string' && /^\/api\/image\/[a-f0-9]{24}$/.test(artwork)) {
          image = document.createElement('img');
          image.className = 'card-artwork';
          image.src = artwork;
          image.alt = '';
          image.onerror = function () { image.style.display = 'none'; };
          card.appendChild(image);
        }
        card.appendChild(heading);
        card.appendChild(kind);
        if (activeView === 'live' && item.category) {
          var category = document.createElement('small');
          category.className = 'channel-category';
          category.textContent = String(item.category);
          card.appendChild(category);
        }
        listen(card, 'click', function () {
          if (isLive) playLive(item);
          else openDetail(item);
        });
        results.appendChild(card);
      }(items[position], position));
    }
  }

  function loadHome(root, done) {
    showMessage(appStatus, 'Cargando catálogo…');
    request('home', { root: root }, function (error, payload) {
      if (error) {
        renderItems([]);
        showMessage(appStatus, userMessage(error));
      } else {
        renderItems(listFrom(payload));
        showMessage(appStatus, '');
      }
      if (done) done(error || null);
    });
  }

  function loadLiveCategories(done) {
    var select = document.getElementById('category-select');
    var first = document.createElement('option');
    first.value = '';
    first.textContent = 'Todas las categorías';
    clear(select);
    select.appendChild(first);
    request('live/categories', {}, function (error, payload) {
      var categories = listFrom(payload);
      var i;
      if (!error) {
        for (i = 0; i < categories.length; i += 1) {
          var category = categories[i];
          if (!category || typeof category !== 'object') continue;
          var value = category.columnId || category.id;
          var label = category.name || category.title || value;
          if (value && label) {
            var option = document.createElement('option');
            option.value = String(value);
            option.textContent = String(label);
            select.appendChild(option);
          }
        }
      } else showMessage(appStatus, userMessage(error));
      if (done) done(error || null);
    });
  }

  function loadLiveChannels() {
    showMessage(appStatus, 'Cargando canales…');
    request('live/channels', {
      columnId: document.getElementById('category-select').value || null,
      pageNum: 1,
      pageSize: 100
    }, function (error, payload) {
      if (error) {
        renderItems([]);
        showMessage(appStatus, userMessage(error));
      } else {
        renderItems(listFrom(payload));
        showMessage(appStatus, '');
      }
    });
  }

  function copyItem(base, extra) {
    var result = {};
    var key;
    for (key in base) if (Object.prototype.hasOwnProperty.call(base, key)) result[key] = base[key];
    for (key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) result[key] = extra[key];
    return result;
  }

  function openDetail(item) {
    var contentId = itemId(item);
    if (!contentId) return;
    selectedItem = item;
    detailPanel.hidden = false;
    playerPanel.hidden = true;
    results.hidden = true;
    document.getElementById('detail-title').textContent = String(itemTitle(item) || '');
    renderDetail(item);
    document.getElementById('play-button').disabled = true;
    showMessage(appStatus, 'Cargando detalle…');
    request('detail', { contentId: String(contentId) }, function (error, data) {
      var detail;
      if (error) {
        document.getElementById('play-button').disabled = false;
        showMessage(appStatus, userMessage(error));
        return;
      }
      detail = data && data.item ? data.item : data;
      if (detail && typeof detail === 'object') {
        selectedItem = copyItem(item, detail);
        document.getElementById('detail-title').textContent = String(itemTitle(detail) || itemTitle(item) || '');
        renderDetail(selectedItem);
      }
      document.getElementById('play-button').disabled = false;
      showMessage(appStatus, '');
    });
  }

  function renderDetail(item) {
    var artwork = document.getElementById('detail-artwork');
    var source = item.landscape || item.poster || item.backdrop;
    var genres = Object.prototype.toString.call(item.genres) === '[object Array]' ? item.genres.join(', ') : item.genres;
    var meta = [];
    var credits = [];
    artwork.hidden = true;
    artwork.removeAttribute('src');
    if (typeof source === 'string' && /^\/api\/image\/[a-f0-9]{24}$/.test(source)) {
      artwork.src = source;
      artwork.hidden = false;
      artwork.onerror = function () { artwork.hidden = true; };
    }
    if (item.year) meta.push(item.year);
    if (item.score) meta.push(item.score);
    if (genres) meta.push(genres);
    document.getElementById('detail-meta').textContent = meta.join(' · ');
    document.getElementById('detail-synopsis').textContent = item.synopsis || item.description || '';
    if (item.director) credits.push('Dirección: ' + item.director);
    if (item.actors) credits.push('Reparto: ' + item.actors);
    document.getElementById('detail-credits').textContent = credits.join(' · ');
  }

  function startPlayback(endpoint, body, title) {
    showMessage(playerStatus, 'Preparando reproducción…');
    playerPanel.hidden = false;
    detailPanel.hidden = true;
    results.hidden = true;
    document.getElementById('player-title').textContent = String(title || '');
    request(endpoint, body, function (error, stream) {
      var playResult;
      if (error || !stream || typeof stream.playbackUrl !== 'string' || stream.playbackUrl.indexOf('/api/media/') !== 0) {
        showMessage(playerStatus, userMessage(error || new Error('MEDIA_PROXY_FAILED')));
        return;
      }
      video.src = stream.playbackUrl;
      showMessage(playerStatus, stream.isHls && !video.canPlayType('application/vnd.apple.mpegurl')
        ? 'Este navegador no anuncia reproducción HLS nativa; este sitio no incluye transcodificación.'
        : '');
      try {
        playResult = video.play();
        if (playResult && playResult.catch) playResult.catch(function () { showMessage(playerStatus, 'Pulsa Reproducir en los controles del video.'); });
      } catch (_) {
        showMessage(playerStatus, 'Pulsa Reproducir en los controles del video.');
      }
    });
  }

  function playVod() {
    var contentId;
    if (!selectedItem) return;
    contentId = itemId(selectedItem);
    if (!contentId) return;
    startPlayback('resolve', { contentId: String(contentId) }, itemTitle(selectedItem));
  }

  function playLive(channel) {
    if (!channel || !channel.channelCode) return;
    startPlayback('live/resolve', { channelCode: String(channel.channelCode) }, itemTitle(channel));
  }

  function enterApplication() {
    loginPanel.hidden = true;
    appPanel.hidden = false;
    setView('live');
    loadLiveCategories(function () { loadLiveChannels(); });
  }

  function handleLogin(event) {
    var input = document.getElementById('access-password');
    if (event.preventDefault) event.preventDefault();
    else event.returnValue = false;
    showMessage(loginStatus, 'Verificando acceso…');
    request('login', { password: input.value }, function (error) {
      input.value = '';
      if (error) {
        showMessage(loginStatus, 'No se pudo validar el acceso. Comprueba la clave e inténtalo otra vez.');
        input.focus();
      } else {
        showMessage(loginStatus, '');
        enterApplication();
      }
    });
  }

  listen(document.getElementById('login-form'), 'submit', handleLogin);

  var navButtons = document.querySelectorAll('.nav-button');
  var navIndex;
  for (navIndex = 0; navIndex < navButtons.length; navIndex += 1) {
    (function (button) {
      listen(button, 'click', function () {
        var view = button.getAttribute('data-view');
        setView(view);
        if (homeViews[view]) loadHome(view);
        else if (view === 'live') loadLiveCategories(function () { loadLiveChannels(); });
        else {
          clear(results);
          document.getElementById('search-input').focus();
        }
      });
    }(navButtons[navIndex]));
  }

  listen(document.getElementById('search-shortcut'), 'click', function () {
    setView('search');
    document.getElementById('search-input').focus();
  });
  listen(document.getElementById('category-select'), 'change', loadLiveChannels);
  listen(document.getElementById('search-form'), 'submit', function (event) {
    var value;
    if (event.preventDefault) event.preventDefault();
    else event.returnValue = false;
    value = document.getElementById('search-input').value.substring(0, 160);
    showMessage(appStatus, 'Buscando…');
    request('search', { value: value }, function (error, payload) {
      if (error) {
        renderItems([]);
        showMessage(appStatus, userMessage(error));
      } else {
        renderItems(listFrom(payload));
        showMessage(appStatus, '');
      }
    });
  });
  listen(document.getElementById('play-button'), 'click', playVod);
  listen(document.getElementById('back-button'), 'click', function () {
    detailPanel.hidden = true;
    results.hidden = false;
  });
  listen(document.getElementById('close-player'), 'click', function () {
    if (video.pause) video.pause();
    video.removeAttribute('src');
    if (video.load) video.load();
    playerPanel.hidden = true;
    results.hidden = false;
  });
  listen(video, 'error', function () {
    showMessage(playerStatus, 'El navegador no pudo reproducir este formato. El servidor no transcodifica video.');
  });
  listen(document.getElementById('logout-button'), 'click', function () {
    request('logout', {}, function () {
      if (video.pause) video.pause();
      video.removeAttribute('src');
      if (video.load) video.load();
      appPanel.hidden = true;
      loginPanel.hidden = false;
      setView('live');
      document.getElementById('access-password').focus();
    });
  });

  request('session', undefined, function (error, session) {
    if (!error && session && session.authenticated) enterApplication();
  });
}());
