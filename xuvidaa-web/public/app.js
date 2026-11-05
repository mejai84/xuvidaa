'use strict';

const loginPanel = document.querySelector('#login-panel');
const appPanel = document.querySelector('#app-panel');
const loginStatus = document.querySelector('#login-status');
const appStatus = document.querySelector('#app-status');
const playerStatus = document.querySelector('#player-status');
const results = document.querySelector('#results');
const detailPanel = document.querySelector('#detail-panel');
const playerPanel = document.querySelector('#player-panel');
const video = document.querySelector('#video');

let activeView = 'movies';
let selectedItem = null;

async function request(path, body) {
  const options = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin' };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`/api/${path}`, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(typeof payload.error === 'string' ? payload.error : 'REQUEST_FAILED');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function showMessage(target, value) {
  target.textContent = value || '';
}

function userMessage(error) {
  if (error.status === 401) return 'La sesión terminó. Vuelve a ingresar.';
  if (error.message === 'PORTAL_SESSION_UNAVAILABLE') return 'El portal no pudo iniciar una sesión. Inténtalo más tarde.';
  if (error.message === 'PORTAL_REQUEST_FAILED') return 'El portal no respondió a la solicitud.';
  if (error.message === 'MEDIA_PROXY_FAILED') return 'No se pudo preparar el recurso de reproducción.';
  return 'No se pudo completar la solicitud.';
}

function listFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['items', 'channels', 'categories', 'results', 'data']) {
    if (Array.isArray(payload[key])) return payload[key];
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
  activeView = view;
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  document.querySelector('#search-panel').hidden = view !== 'search';
  document.querySelector('#live-panel').hidden = view !== 'live';
  document.querySelector('#view-title').textContent = ({
    movies: 'Películas', series: 'Series', live: 'TV en vivo', search: 'Buscar'
  })[view];
  detailPanel.hidden = true;
  playerPanel.hidden = true;
  results.hidden = false;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function renderItems(items) {
  results.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No hay resultados para mostrar.';
    results.append(empty);
    return;
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const title = String(itemTitle(item) || '').trim();
    const id = itemId(item);
    if (!title || !id) continue;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'result-card';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const kind = document.createElement('span');
    const isLive = Boolean(item.channelCode);
    kind.textContent = isLive ? 'Canal en vivo' : 'Abrir detalle';
    const artwork = item.poster || item.logo || item.landscape;
    if (typeof artwork === 'string' && /^\/api\/image\/[a-f0-9]{24}$/.test(artwork)) {
      const image = document.createElement('img');
      image.className = 'card-artwork';
      image.src = artwork;
      image.alt = '';
      image.loading = 'lazy';
      image.addEventListener('error', () => { image.hidden = true; });
      card.append(image);
    }
    card.append(heading, kind);
    card.addEventListener('click', () => {
      if (isLive) playLive(item);
      else openDetail(item);
    });
    results.append(card);
  }
}

async function loadHome(root) {
  showMessage(appStatus, 'Cargando catálogo…');
  try {
    const payload = await request('home', { root });
    renderItems(listFrom(payload));
    showMessage(appStatus, '');
  } catch (error) {
    renderItems([]);
    showMessage(appStatus, userMessage(error));
  }
}

async function loadLiveCategories() {
  const select = document.querySelector('#category-select');
  select.replaceChildren(new Option('Todas las categorías', ''));
  try {
    const payload = await request('live/categories', {});
    for (const category of listFrom(payload)) {
      if (!category || typeof category !== 'object') continue;
      const value = category.columnId || category.id;
      const label = category.name || category.title || value;
      if (value && label) select.add(new Option(String(label), String(value)));
    }
  } catch (error) {
    showMessage(appStatus, userMessage(error));
  }
}

async function loadLiveChannels() {
  showMessage(appStatus, 'Cargando canales…');
  try {
    const columnId = document.querySelector('#category-select').value || null;
    const payload = await request('live/channels', { columnId, pageNum: 1, pageSize: 100 });
    renderItems(listFrom(payload));
    showMessage(appStatus, '');
  } catch (error) {
    renderItems([]);
    showMessage(appStatus, userMessage(error));
  }
}

async function openDetail(item) {
  const contentId = itemId(item);
  if (!contentId) return;
  selectedItem = item;
  detailPanel.hidden = false;
  playerPanel.hidden = true;
  results.hidden = true;
  document.querySelector('#detail-title').textContent = String(itemTitle(item) || '');
  renderDetail(item);
  document.querySelector('#play-button').disabled = true;
  showMessage(appStatus, 'Cargando detalle…');
  try {
    const data = await request('detail', { contentId: String(contentId) });
    const detail = data && data.item ? data.item : data;
    if (detail && typeof detail === 'object') {
      selectedItem = { ...item, ...detail };
      document.querySelector('#detail-title').textContent = String(itemTitle(detail) || itemTitle(item) || '');
      renderDetail(selectedItem);
    }
    document.querySelector('#play-button').disabled = false;
    showMessage(appStatus, '');
  } catch (error) {
    showMessage(appStatus, userMessage(error));
  }
}

function renderDetail(item) {
  const artwork = document.querySelector('#detail-artwork');
  const source = item.landscape || item.poster || item.backdrop;
  artwork.hidden = true;
  artwork.removeAttribute('src');
  if (typeof source === 'string' && /^\/api\/image\/[a-f0-9]{24}$/.test(source)) {
    artwork.src = source;
    artwork.hidden = false;
    artwork.onerror = () => { artwork.hidden = true; };
  }
  const genres = Array.isArray(item.genres) ? item.genres.join(', ') : item.genres;
  document.querySelector('#detail-meta').textContent = [item.year, item.score, genres].filter(Boolean).join(' · ');
  document.querySelector('#detail-synopsis').textContent = item.synopsis || item.description || '';
  document.querySelector('#detail-credits').textContent = [
    item.director ? `Dirección: ${item.director}` : '',
    item.actors ? `Reparto: ${item.actors}` : ''
  ].filter(Boolean).join(' · ');
}

async function startPlayback(path, title) {
  showMessage(playerStatus, 'Preparando reproducción…');
  playerPanel.hidden = false;
  detailPanel.hidden = true;
  results.hidden = true;
  document.querySelector('#player-title').textContent = String(title || '');
  try {
    const stream = await request(path.endpoint, path.body);
    if (!stream || typeof stream.playbackUrl !== 'string' || !stream.playbackUrl.startsWith('/api/media/')) {
      throw new Error('MEDIA_PROXY_FAILED');
    }
    video.src = stream.playbackUrl;
    showMessage(playerStatus, stream.isHls && !video.canPlayType('application/vnd.apple.mpegurl')
      ? 'Este navegador no anuncia reproducción HLS nativa; esta edición no incluye un reproductor HLS adicional.'
      : '');
    const playResult = video.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => showMessage(playerStatus, 'Pulsa Reproducir en los controles del video.'));
    }
  } catch (error) {
    showMessage(playerStatus, userMessage(error));
  }
}

function playVod() {
  if (!selectedItem) return;
  const contentId = itemId(selectedItem);
  if (!contentId) return;
  startPlayback({ endpoint: 'resolve', body: { contentId: String(contentId) } }, itemTitle(selectedItem));
}

function playLive(channel) {
  const channelCode = channel && channel.channelCode;
  if (!channelCode) return;
  startPlayback({ endpoint: 'live/resolve', body: { channelCode: String(channelCode) } }, itemTitle(channel));
}

async function enterApplication() {
  loginPanel.hidden = true;
  appPanel.hidden = false;
  setView('movies');
  await loadHome('movies');
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#access-password');
  showMessage(loginStatus, 'Verificando acceso…');
  try {
    await request('login', { password: input.value });
    input.value = '';
    showMessage(loginStatus, '');
    await enterApplication();
  } catch (_) {
    input.value = '';
    showMessage(loginStatus, 'No se pudo validar el acceso.');
    input.focus();
  }
});

document.querySelectorAll('.nav-button').forEach((button) => {
  button.addEventListener('click', async () => {
    const view = button.dataset.view;
    setView(view);
    if (view === 'movies' || view === 'series') await loadHome(view);
    else if (view === 'live') {
      await loadLiveCategories();
      await loadLiveChannels();
    } else {
      results.replaceChildren();
      document.querySelector('#search-input').focus();
    }
  });
});

document.querySelector('#category-select').addEventListener('change', loadLiveChannels);

document.querySelector('#search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = document.querySelector('#search-input').value.slice(0, 160);
  showMessage(appStatus, 'Buscando…');
  try {
    const payload = await request('search', { value });
    renderItems(listFrom(payload));
    showMessage(appStatus, '');
  } catch (error) {
    renderItems([]);
    showMessage(appStatus, userMessage(error));
  }
});

document.querySelector('#play-button').addEventListener('click', playVod);
document.querySelector('#back-button').addEventListener('click', () => {
  detailPanel.hidden = true;
  results.hidden = false;
});
document.querySelector('#close-player').addEventListener('click', () => {
  video.pause();
  video.removeAttribute('src');
  video.load();
  playerPanel.hidden = true;
  results.hidden = false;
});
video.addEventListener('error', () => {
  showMessage(playerStatus, 'El navegador no pudo reproducir este formato. Esta edición no incluye FFmpeg ni transcodificación.');
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try { await request('logout', {}); } catch (_) { /* clear the local view regardless */ }
  video.pause();
  video.removeAttribute('src');
  video.load();
  appPanel.hidden = true;
  loginPanel.hidden = false;
  setView('movies');
  document.querySelector('#access-password').focus();
});

request('session').then((session) => {
  if (session.authenticated) return enterApplication();
}).catch(() => showMessage(loginStatus, 'El servicio de acceso no está disponible.'));
