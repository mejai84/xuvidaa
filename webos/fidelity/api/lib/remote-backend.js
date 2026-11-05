'use strict';

// Optional server-to-server gateway. Browser requests keep the same /api
// contract; only the fixed, administrator-configured HTTPS origin is contacted.
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 57000;

function failure(status, code, message) {
  return { status, body: { returnValue: false, errorCode: code, errorText: message } };
}

function configuration(env) {
  let url;
  try { url = new URL(env.XUPER_BACKEND_URL); } catch (_) { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
  const token = String(env.XUPER_BACKEND_TOKEN || '');
  if (token.length < 32 || /[\r\n]/.test(token)) return null;
  return { origin: url.origin, token };
}

function mediaResponse(body, method, origin) {
  if (body.returnValue === false || !body.mediaToken || (method !== 'resolve' && method !== 'resolveLive')) return body;
  const media = origin + '/api/media?token=' + encodeURIComponent(body.mediaToken);
  body.mediaUrl = media + (body.isHls ? '&manifest=1' : '');
  body.url = body.mediaUrl;
  // Download subtitle files directly from the persistent media service too.
  body.subtitles = (body.subtitles || []).map((sub, index) => ({
    lang: sub.lang, format: sub.format, url: media + '&subtitle=' + index
  }));
  return body;
}

async function forward(method, input, requestHost, options) {
  options = options || {};
  const env = options.env || process.env;
  const config = configuration(env);
  if (!config || new URL(config.origin).host === requestHost) {
    return failure(503, 'BACKEND_CONFIG', 'La conexión con el servidor persistente no está configurada correctamente.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await (options.fetch || fetch)(config.origin + '/api/' + encodeURIComponent(method), {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
      body: JSON.stringify(input)
    });
    if (!/application\/json/i.test(response.headers.get('content-type') || '')) {
      return failure(502, 'BACKEND_RESPONSE', 'El servidor persistente no devolvió una respuesta válida.');
    }
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      return failure(502, 'BACKEND_RESPONSE', 'La respuesta del servidor persistente es demasiado grande.');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        controller.abort();
        return failure(502, 'BACKEND_RESPONSE', 'La respuesta del servidor persistente es demasiado grande.');
      }
      chunks.push(Buffer.from(result.value));
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {
      return failure(502, 'BACKEND_RESPONSE', 'El servidor persistente no devolvió una respuesta válida.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.returnValue !== 'boolean') {
      return failure(502, 'BACKEND_RESPONSE', 'El servidor persistente no devolvió una respuesta válida.');
    }
    // Preserve portal error codes (including a regional rejection). Never retry
    // silently through a different server when the configured backend rejects.
    return { status: response.status, body: mediaResponse(body, method, config.origin) };
  } catch (_) {
    return controller.signal.aborted
      ? failure(504, 'BACKEND_TIMEOUT', 'El servidor persistente no respondió a tiempo.')
      : failure(502, 'BACKEND_UNREACHABLE', 'No se pudo conectar con el servidor persistente.');
  } finally {
    clearTimeout(timer);
    if (response && response.body && !response.body.locked) {
      try { await response.body.cancel(); } catch (_) { /* already consumed */ }
    }
  }
}

module.exports = { forward, configuration, mediaResponse };
