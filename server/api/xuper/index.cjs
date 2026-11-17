'use strict';

const { createRegistry, ID, SECTIONS } = require('../../providers/xuper/adapters.cjs');
const { validateUrl } = require('../../providers/xuper/safe-http.cjs');
const defaultMediaRegistry = require('../media-registry.cjs');

const ACTIONS = new Set(['bootstrap', 'catalog', 'detail', 'resolve', 'providers', 'refresh', 'guide']);
const SECTION_TYPES = { movies: 'movie', series: 'series', live: 'live', radio: 'radio', music: 'music' };
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const list = (value) => Array.isArray(value) ? value : [];

function createXuperApi(options = {}) {
  const env = options.env || process.env;
  const providers = options.providers || createRegistry(env, options);
  const mediaRegistry = options.mediaRegistry || defaultMediaRegistry;
  const secret = env.MEDIA_TOKEN_SECRET || env.XUPER_MEDIA_SECRET || '';
  const limits = new Map();
  const refreshes = new Map();
  const secrets = providers.flatMap((provider) => provider.secrets || []);
  const now = options.now || Date.now;

  function publicId(value) {
    const id = String(value || '');
    return ID.test(id) && !secrets.some((item) => item.length >= 3 ? id.includes(item) || id.includes(encodeURIComponent(item)) : id === item);
  }

  function cleanText(value, max = 300) {
    let text = typeof value === 'string' || typeof value === 'number' ? String(value).replace(/[\x00-\x1f\x7f]/g, ' ') : '';
    text = text.replace(/https?:\/\/[^\s<>]+/gi, '[enlace privado]');
    for (const item of secrets) {
      if (item.length >= 3) { text = text.split(item).join('[privado]').split(encodeURIComponent(item)).join('[privado]'); }
      else if (text === item) text = '[privado]';
    }
    return text.slice(0, max);
  }

  function sourceUrls(item) {
    if (!item || typeof item !== 'object') return [];
    const values = [item.url, item.streamUrl];
    for (const value of list(item.signals).concat(list(item.subtitles))) if (value) values.push(value.url, value.streamUrl);
    for (const season of list(item.seasons)) for (const episode of list(season.episodes)) values.push(...sourceUrls(episode));
    return values.filter((value) => typeof value === 'string');
  }

  function safeImage(raw, forbidden = []) {
    if (typeof raw !== 'string' || secrets.some((value) => raw.includes(value) || raw.includes(encodeURIComponent(value)))) return '';
    try {
      const url = validateUrl(raw);
      if (Array.from(url.searchParams.keys()).some((key) => !/^(?:w|h|width|height|fit|format|quality)$/i.test(key)) ||
          !/\.(?:jpe?g|png|webp|avif|gif|svg)$/i.test(url.pathname) ||
          /\/(?:movie|series|live)\//i.test(url.pathname) || forbidden.some((value) => {
            try { return new URL(value).href === url.href; } catch (_) { return false; }
          })) return '';
      return url.href;
    } catch (_) { return ''; }
  }

  function number(value, fallback = 0, maximum = 10000000) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.min(maximum, parsed) : fallback;
  }

  function playbackRestriction(stream, type) {
    let pathname = '';
    try {
      if (stream.streamUrl || stream.url) pathname = new URL(stream.streamUrl || stream.url).pathname;
      else if (typeof stream.streamPath === 'string') pathname = stream.streamPath;
    } catch (_) { return undefined; }

    const mime = String(stream.mime || '').split(';')[0].trim().toLowerCase();
    let format;
    if (/\.mkv$/i.test(pathname) || /^(?:video|application)\/(?:x-)?matroska$/.test(mime)) format = 'MKV';
    else if (/\.avi$/i.test(pathname) || /^video\/(?:x-msvideo|avi)$/.test(mime)) format = 'AVI';
    else if ((type === 'live' || type === 'radio') && !/\.m3u8$/i.test(pathname) && !/mpegurl/i.test(mime) &&
      (/\.ts$/i.test(pathname) || mime === 'video/mp2t')) format = 'TS';
    if (!format) return undefined;

    return {
      code: 'UNSUPPORTED_FORMAT',
      message: format === 'TS'
        ? 'Esta señal usa TS directo. Pide al proveedor una señal HLS compatible.'
        : `Esta fuente usa ${format}. Pide al proveedor una versión en HLS o MP4 compatible con tu navegador o TV.`
    };
  }

  function episodeDto(item, provider, index = 0) {
    const restriction = list(item.signals).length ? undefined : playbackRestriction(item, 'episode');
    return { id: String(item.id || ''), providerId: provider.id, title: cleanText(item.title || item.name || 'Episodio ' + (index + 1)),
      number: number(item.number || item.episode, index + 1, 100000), season: number(item.season, 1, 10000),
      duration: number(item.duration), poster: safeImage(item.poster || item.logo, sourceUrls(item)), type: 'episode',
      ...(restriction ? { playbackRestriction: restriction } : {}) };
  }

  function card(item, provider, detail = false) {
    const type = item.type === 'teleplay' || item.isSeries || item.seasons ? 'series' : item.type;
    const forbidden = sourceUrls(item);
    const dto = { id: String(item.id || ''), providerId: provider.id, title: cleanText(item.title || item.name || 'Sin título'),
      type: ['movie', 'series', 'live', 'radio', 'music'].includes(type) ? type : 'movie',
      poster: safeImage(item.poster || item.logo || item.tvgLogo, forbidden), backdrop: safeImage(item.backdrop, forbidden),
      synopsis: cleanText(item.synopsis || item.description, 4000), category: cleanText(item.category || item.groupTitle || 'General', 128),
      year: cleanText(item.year, 8), country: cleanText(item.country, 64), genre: cleanText(item.genre, 120),
      duration: number(item.duration), seasonCount: list(item.seasons).length,
      episodeCount: list(item.seasons).reduce((sum, season) => sum + list(season.episodes).length, 0),
      signalCount: Math.max(1, Math.min(16, list(item.signals).length)),
      downloadable: false };
    if (detail) dto.signals = list(item.signals).slice(0, 16).map((signal, index) => ({ id: String(index), label: cleanText(signal.label || 'Señal ' + (index + 1), 64) }));
    if (detail && dto.type !== 'series' && !dto.signals.length) {
      const restriction = playbackRestriction(item, dto.type);
      if (restriction) dto.playbackRestriction = restriction;
    }
    if (detail) dto.seasons = list(item.seasons).slice(0, 200).map((season, index) => ({
      id: publicId(season.id) ? String(season.id) : 'season-' + (index + 1), number: number(season.number, index + 1, 10000),
      title: cleanText(season.title || 'Temporada ' + (index + 1)),
      episodes: list(season.episodes).slice(0, 5000).filter((episode) => publicId(episode.id)).map((episode, i) => episodeDto(episode, provider, i))
    }));
    return dto;
  }

  function providerDto(provider) {
    return { id: provider.id, name: cleanText(provider.name, 100), format: provider.format, configured: !!provider.configured,
      origin: ['desktop', 'tvvidaa', 'existing_configuration', 'server_configuration'].includes(provider.origin) ? provider.origin : 'server_configuration',
      role: ['original', 'legacy', 'supplementary', 'user_configured', 'custom'].includes(provider.role) ? provider.role : 'custom',
      status: provider.status || (provider.configured ? 'configured' : 'not_configured'), message: cleanText(provider.message, 400),
      sections: list(provider.sections).filter((section) => SECTIONS.includes(section) || section === 'videoteca'),
      ...(provider.officialUrl === 'https://music.youtube.com/' ? { officialUrl: provider.officialUrl } : {}), updatedAt: number(provider.updatedAt, 0, 9e15) };
  }

  function reply(res, status, value) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(status).json(value);
  }
  const ok = (res, value) => reply(res, 200, { returnValue: true, ...value });
  const fail = (res, status, errorText, errorCode) => reply(res, status, { returnValue: false, errorText, errorCode });

  function boundedString(value, maximum, fallback = '') {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw new Error('INVALID_INPUT');
    return value.trim();
  }

  function integer(value, fallback, max) {
    if (value === undefined || value === '') return fallback;
    if (!/^\d{1,7}$/.test(String(value)) || Number(value) < 1 || Number(value) > max) throw new Error('INVALID_INPUT');
    return Number(value);
  }

  function allItems(catalog) { return SECTIONS.flatMap((section) => list(catalog[section])); }

  async function selectedItem(input) {
    const providerId = boundedString(input.providerId, 48);
    const id = boundedString(input.id, 161);
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(providerId) || !ID.test(id)) throw new Error('INVALID_INPUT');
    if (!publicId(id)) return null;
    const provider = providers.find((entry) => entry.id === providerId);
    if (!provider || ['pending_verification', 'official_link'].includes(provider.status)) return null;
    if (typeof provider.getItem === 'function') {
      const item = await provider.getItem(id);
      return item ? { provider, catalog: {}, item, id } : null;
    }
    const catalog = await provider.load(false);
    let item = allItems(catalog).find((entry) => String(entry.id) === id);
    if (!item) for (const series of list(catalog.series)) {
      for (const season of list(series.seasons)) {
        item = list(season.episodes).find((entry) => String(entry.id) === id);
        if (item) break;
      }
      if (item) break;
    }
    return item ? { provider, catalog, item, id } : null;
  }

  function mimeOf(stream, url) {
    const path = url.pathname.toLowerCase();
    if (/\.m3u8$/.test(path) || /mpegurl/i.test(String(stream.mime || ''))) return 'application/vnd.apple.mpegurl';
    if (/\.ts$/.test(path)) return 'video/mp2t';
    if (/\.mp3$/.test(path)) return 'audio/mpeg';
    if (/\.aac$/.test(path)) return 'audio/aac';
    if (/\.(?:ogg|opus)$/.test(path)) return 'audio/ogg';
    if (/\.m4a$/.test(path)) return 'audio/mp4';
    if (/\.wav$/.test(path)) return 'audio/wav';
    if (/\.flac$/.test(path)) return 'audio/flac';
    if (/\.webm$/.test(path)) return 'video/webm';
    const supplied = String(stream.mime || '');
    return /^(?:audio\/(?:mpeg|aac|ogg|mp4|wav|flac)|video\/(?:mp4|webm|mp2t))$/.test(supplied) ? supplied : (stream.type === 'radio' || stream.type === 'music' ? 'audio/mpeg' : 'video/mp4');
  }

  return async function xuperHandler(req, res) {
    try {
      const action = String((req.query || {}).action || '');
      if (!ACTIONS.has(action)) return fail(res, 404, 'Función no encontrada.', 'NOT_FOUND');
      if (req.method !== (action === 'refresh' ? 'POST' : 'GET')) return fail(res, 405, 'Método no permitido.', 'INVALID_METHOD');
      const input = action === 'refresh' ? (req.body || {}) : (req.query || {});
      const address = String((req.headers || {})['x-forwarded-for'] || (req.socket || {}).remoteAddress || 'unknown');
      const timestamp = now();
      let rate = limits.get(address);
      if (!rate || timestamp - rate.at >= 60000) rate = { at: timestamp, count: 0 };
      if (++rate.count > 120) return fail(res, 429, 'Demasiadas solicitudes. Espera un minuto.', 'RATE_LIMIT');
      limits.set(address, rate);
      if (limits.size > 4096) {
        for (const [key, value] of limits) if (timestamp - value.at >= 60000) limits.delete(key);
        while (limits.size > 4096) limits.delete(limits.keys().next().value);
      }

      if (action === 'bootstrap') return ok(res, { providers: providers.map(providerDto), capabilities: {
        sections: ['home', ...SECTIONS, 'kids', 'anime', 'videoteca'], profiles: 'device', favorites: 'device', history: 'device', playlists: 'device',
        providerAdministration: 'server_environment', epg: 'provider_json', downloads: false,
        transcode: false, youtubeMusic: { enabled: false, officialUrl: 'https://music.youtube.com/' },
        formats: ['hls', 'mp4', 'ts-vod', 'mp3', 'aac', 'ogg', 'webm'],
        notice: 'Los catálogos y la reproducción dependen de proveedores autorizados configurados.'
      } });
      if (action === 'providers') return ok(res, { providers: providers.map(providerDto) });
      if (action === 'refresh') {
        const id = boundedString(input.providerId, 48);
        const provider = providers.find((entry) => entry.id === id);
        if (!provider || !provider.configured || provider.status === 'pending_verification') return fail(res, 409, 'Este proveedor necesita configuración o verificación.', 'PROVIDER_NOT_CONFIGURED');
        const previous = refreshes.get(id);
        if (previous !== undefined && timestamp - previous < 60000) return fail(res, 429, 'Espera un minuto antes de actualizar otra vez.', 'REFRESH_LIMIT');
        refreshes.set(id, timestamp);
        try { await provider.load(true); }
        catch (_) { return fail(res, 503, 'No se pudo conectar al proveedor. Verifica su configuración en el servidor.', 'PROVIDER_UNAVAILABLE'); }
        return ok(res, { provider: providerDto(provider), providers: providers.map(providerDto) });
      }
      if (action === 'catalog') {
        const section = boundedString(input.section, 12, 'home');
        if (!['home', 'kids', 'anime', 'videoteca', ...SECTIONS].includes(section)) throw new Error('INVALID_INPUT');
        const providerId = boundedString(input.provider, 48, 'all');
        if (providerId !== 'all' && !providers.some((entry) => entry.id === providerId)) throw new Error('INVALID_INPUT');
        const searchText = boundedString(input.q, 120);
        const query = normalize(searchText);
        const category = boundedString(input.category, 128, 'all');
        const country = boundedString(input.country, 64, 'all');
        const page = integer(input.page, 1, 1000000);
        const pageSize = integer(input.pageSize, 40, 100);
        const selected = providers.filter((provider) => (providerId === 'all' || provider.id === providerId) && !['pending_verification', 'official_link'].includes(provider.status) &&
          (section === 'videoteca' ? provider.id === 'internet_archive' :
            (provider.id !== 'internet_archive' || providerId !== 'all') &&
            (section !== 'home' || provider.includeOnHome !== false || providerId !== 'all') &&
            (['home', 'kids', 'anime'].includes(section) ? (section === 'home' || list(provider.sections).some((scope) => scope === 'movies' || scope === 'series')) : list(provider.sections).includes(section))));
        const loaded = await Promise.all(selected.map(async (provider) => {
          try {
            const catalog = await provider.load(false, { section, q: searchText, category, country, page, pageSize });
            let pool = section === 'home' ? allItems(catalog) : list(catalog[section === 'videoteca' ? 'movies' : section]);
            if (section === 'kids' || section === 'anime') {
              const matches = section === 'kids' ? /\b(?:infantil(?:es)?|kids|ninos|children|cartoons?|dibujos)\b/ : /\banime\b/;
              pool = list(catalog.movies).concat(list(catalog.series)).filter((item) => matches.test(normalize([item.category, item.groupTitle, item.genre].join(' '))));
            }
            return { provider, catalog, items: pool.filter((item) => item && publicId(item.id)).map((item) => card(item, provider)) };
          } catch (_) { return { provider, catalog: {}, items: [] }; }
        }));
        let items = loaded.flatMap((result) => result.items);
        if (query) items = items.filter((item) => normalize([item.title, item.synopsis, item.genre].join(' ')).includes(query));
        const categories = Array.from(new Set(items.map((item) => item.category).concat(loaded.flatMap((result) => list(result.catalog.categories).map((value) => cleanText(value, 128)))).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es')).slice(0, 500);
        const countries = Array.from(new Set(items.map((item) => item.country).concat(loaded.flatMap((result) => list(result.catalog.countries).map((value) => cleanText(value, 64)))).filter(Boolean))).sort().slice(0, 300);
        if (category && category !== 'all') items = items.filter((item) => normalize(item.category) === normalize(category));
        if (country && country !== 'all') items = items.filter((item) => normalize(item.country) === normalize(country));
        const pagination = loaded.length === 1 && loaded[0].catalog.pagination;
        const total = pagination ? number(pagination.total, items.length) : items.length;
        const warnings = loaded.filter((result) => result.provider.message || result.catalog.warning).map((result) => cleanText(result.provider.name, 100) + ': ' + cleanText(result.provider.message || result.catalog.warning, 400));
        if (!total && !warnings.length) warnings.push('No hay contenido disponible en esta sección de los proveedores configurados.');
        return ok(res, { items: pagination ? items : items.slice((page - 1) * pageSize, page * pageSize), total,
          page: pagination ? Math.max(1, number(pagination.page, page)) : page,
          pageSize: pagination ? Math.max(1, number(pagination.pageSize, pageSize, 100)) : pageSize,
          hasMore: pagination ? !!pagination.hasMore : page * pageSize < total, categories, countries, providers: providers.map(providerDto),
          stale: loaded.some((result) => result.catalog.stale), warning: warnings.join(' '), section });
      }

      const selected = await selectedItem(input);
      if (!selected) return fail(res, 404, 'Contenido no encontrado en el proveedor.', 'CONTENT_NOT_FOUND');
      const { provider, item, id } = selected;
      if (action === 'detail') {
        const dto = item.type === 'episode' ? episodeDto(item, provider) : card(item, provider, true);
        return ok(res, { item: dto, seasons: dto.seasons || [], provider: providerDto(provider) });
      }
      if (action === 'guide') {
        const programmes = list(item.programmes).slice(0, 200).map((programme) => ({
          title: cleanText(programme.title), synopsis: cleanText(programme.synopsis, 1000),
          start: Date.parse(programme.start), end: Date.parse(programme.end)
        })).filter((programme) => Number.isFinite(programme.start) && Number.isFinite(programme.end) && programme.end > programme.start);
        return ok(res, { programmes, available: programmes.length > 0,
          message: programmes.length ? '' : 'Este proveedor no ofrece guía para este canal.' });
      }
      if (!provider.configured) return fail(res, 409, 'Configura las credenciales autorizadas en el servidor para reproducir.', 'PROVIDER_NOT_CONFIGURED');
      const signalInput = input.signal === undefined ? input.signalId : input.signal;
      const signalValue = signalInput === undefined ? 0 : Number(signalInput);
      if (!Number.isInteger(signalValue) || signalValue < 0 || signalValue > 15) throw new Error('INVALID_INPUT');
      const stream = await provider.resolve(id, signalValue);
      if (!stream || !stream.streamUrl) return fail(res, 404, 'No hay una señal disponible para este contenido.', 'STREAM_NOT_FOUND');
      const restriction = playbackRestriction(stream, item.type);
      if (restriction) return fail(res, 415, restriction.message, restriction.code);
      let url;
      try { url = validateUrl(stream.streamUrl); }
      catch (_) { return fail(res, 415, 'El origen de esta señal requiere una URL HTTPS pública y compatible del proveedor.', 'UNSUPPORTED_SOURCE'); }
      const mime = mimeOf(stream, url);
      const live = item.type === 'live' || item.type === 'radio' || !!stream.live;
      const expiresAt = timestamp + (live ? 30 * 60 * 1000 : Math.min(6 * 3600 * 1000, Math.max(3600 * 1000, (number(stream.duration, 14400) + 1800) * 1000)));
      const hosts = Array.from(new Set([url.hostname, ...list(provider.streamHosts)])).slice(0, 64);
      const headers = {};
      for (const [key, value] of Object.entries(stream.headers || {})) {
        if (/^(?:Referer|User-Agent)$/i.test(key) && typeof value === 'string' && value.length <= 2048 && !/[\r\n]/.test(value)) headers[key] = value;
      }
      const registered = mediaRegistry.register({ url: url.href, hosts, source: live ? 'live' : 'vod', mime,
        headers, duration: number(stream.duration) }, expiresAt);
      if (!registered || !registered.token) return fail(res, 503, 'El servidor necesita configurar el relay multimedia.', 'MEDIA_NOT_CONFIGURED');
      const token = registered.token;
      const isHls = /mpegurl/i.test(mime) || mime === 'video/mp2t';
      const mediaUrl = '/api/media?token=' + encodeURIComponent(token) + (isHls ? '&manifest=1' : '');
      // Subtitle media URLs use independent encrypted relay tokens, so the
      // browser never receives the provider's subtitle address or credentials.
      const subtitles = [];
      for (const [index, subtitle] of list(stream.subtitles).slice(0, 16).entries()) {
        try {
          const source = validateUrl(subtitle.url, hosts);
          if (!/\.vtt$/i.test(source.pathname)) continue;
          const subtitleMedia = mediaRegistry.register({ url: source.href, hosts, source: live ? 'live' : 'vod', mime: 'text/vtt', headers: {}, duration: 0 }, expiresAt);
          if (subtitleMedia && subtitleMedia.token) subtitles.push({ id: 'subtitle-' + index, label: cleanText(subtitle.label || 'Subtítulo ' + (index + 1), 64),
            language: /^[a-z]{2,3}(?:-[A-Za-z]{2})?$/.test(subtitle.language || '') ? subtitle.language : '',
            url: '/api/media?token=' + encodeURIComponent(subtitleMedia.token) });
        } catch (_) { /* Ignore unsupported subtitle destinations. */ }
      }
      return ok(res, { mediaUrl, url: mediaUrl, mime, isHls, live, expiresAt,
        title: cleanText(item.title || item.name), duration: number(stream.duration), subtitles, tracks: [],
        signalCount: number(stream.signalCount, list(item.signals).length || 1, 16) });
    } catch (error) {
      if (error.message === 'INVALID_INPUT') return fail(res, 400, 'Los filtros o identificadores no son válidos.', 'INVALID_INPUT');
      return fail(res, 503, 'No se pudo cargar el proveedor. Vuelve a intentarlo más tarde.', 'PROVIDER_UNAVAILABLE');
    }
  };
}

module.exports = { createXuperApi };
