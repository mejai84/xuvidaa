'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

const BODY_LIMIT = 32 * 1024;
const URL_LIMIT = 32 * 1024;
const SESSION_COOKIE = 'xuvidaa_session';
const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const PUBLIC_FILES = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['config/api.js', 'text/javascript; charset=utf-8'],
  ['js/access.js', 'text/javascript; charset=utf-8'],
  ['js/app.js', 'text/javascript; charset=utf-8'],
  ['js/webOSTV.js', 'text/javascript; charset=utf-8'],
  ['css/access.css', 'text/css; charset=utf-8'],
  ['css/style.css', 'text/css; charset=utf-8']
]);
const ASSET_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'], ['.otf', 'font/otf']
]);

function originOf(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('PUBLIC_BASE_URL debe ser un origen HTTPS, sin ruta ni credenciales.');
  }
  return parsed;
}

function json(res, status, value, headers) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(headers || {}) });
  res.end(JSON.stringify(value));
}

function responseHelpers(res) {
  res.status = function (status) { this.statusCode = status; return this; };
  res.json = function (value) {
    if (!this.hasHeader('Content-Type')) this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.end(JSON.stringify(value));
    return this;
  };
  res.send = function (value) {
    if (!this.hasHeader('Content-Type')) this.setHeader('Content-Type', Buffer.isBuffer(value) ? 'application/octet-stream' : 'text/plain; charset=utf-8');
    this.end(value);
    return this;
  };
}

function safeEqual(left, right) {
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(left), digest(right));
}

function sessionSignature(expiry, secret) {
  return crypto.createHmac('sha256', secret).update(String(expiry)).digest('base64url');
}

function hasSession(req, secret) {
  if (!secret) return true;
  const raw = String(req.headers.cookie || '').split(';').map((item) => item.trim())
    .find((item) => item.startsWith(SESSION_COOKIE + '='));
  if (!raw) return false;
  const value = raw.slice(SESSION_COOKIE.length + 1);
  const separator = value.indexOf('.');
  if (separator < 1) return false;
  const expiry = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!/^\d{10,}$/.test(expiry) || !/^[A-Za-z0-9_-]{40,}$/.test(signature)) return false;
  if (!safeEqual(signature, sessionSignature(expiry, secret))) return false;
  return Number(expiry) > Math.floor(Date.now() / 1000);
}

function forwardedClientAddress(req) {
  const values = String(req.headers['x-forwarded-for'] || '').split(',').map((value) => value.trim());
  const candidate = values.length ? values[values.length - 1] : '';
  return net.isIP(candidate) ? candidate : (req.socket.remoteAddress || 'unknown');
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function sanitizeProxyHeaders(req) {
  // nginx must overwrite X-Forwarded-For with $remote_addr. Only a local
  // reverse proxy is trusted; remote clients cannot choose their rate-limit IP.
  const candidate = String(req.headers['x-forwarded-for'] || '').trim();
  const source = isLoopback(req.socket.remoteAddress) && net.isIP(candidate)
    ? candidate : req.socket.remoteAddress;
  req.headers['x-forwarded-for'] = source;
  delete req.headers['x-forwarded-host'];
  delete req.headers['x-forwarded-proto'];
  // The existing LG relay is not installed by this standalone HTTP runtime.
  delete req.headers['x-xuper-runtime'];
}

async function readJson(req) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) {
    throw Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
    throw Object.assign(new Error('Se requiere application/json'), { status: 415 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 });
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch (_) { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Se requiere un objeto JSON'), { status: 400 });
  }
  return value;
}

async function staticFile(root, relative, req, res) {
  let mime = PUBLIC_FILES.get(relative);
  if (!mime && /^(assets|images)\//.test(relative)) mime = ASSET_TYPES.get(path.extname(relative).toLowerCase());
  if (!mime) return json(res, 404, { error: 'No encontrado' });
  const filename = path.join(root, ...relative.split('/'));
  // Reject every symlink component, including links inside an allowed assets
  // directory that would otherwise expose a private source file.
  let component = root;
  try {
    for (const part of relative.split('/')) {
      component = path.join(component, part);
      if ((await fs.promises.lstat(component)).isSymbolicLink()) return json(res, 404, { error: 'No encontrado' });
    }
    const handle = await fs.promises.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile()) { await handle.close(); return json(res, 404, { error: 'No encontrado' }); }
    const etag = 'W/"' + stat.size.toString(16) + '-' + Math.trunc(stat.mtimeMs).toString(16) + '"';
    res.setHeader('Content-Type', mime);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', /^(assets|images)\//.test(relative) ? 'public, max-age=86400' : 'no-cache');
    if (req.headers['if-none-match'] === etag) { await handle.close(); res.statusCode = 304; return res.end(); }
    res.setHeader('Content-Length', stat.size);
    if (req.method === 'HEAD') { await handle.close(); return res.end(); }
    const stream = handle.createReadStream();
    stream.on('error', () => { if (!res.headersSent) json(res, 500, { error: 'No se pudo leer el recurso' }); else res.destroy(); });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) json(res, err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 404 : 500, { error: 'No se pudo leer el recurso' });
    else res.destroy();
  }
}

function createServer(options) {
  const publicUrl = originOf(options.publicOrigin);
  const root = fs.realpathSync(options.root);
  const accessPassword = options.accessPassword || '';
  const sessionSecret = options.sessionSecret || '';
  const loginAttempts = new Map();
  const apiHandler = options.apiHandler;
  const mediaHandler = options.mediaHandler;
  if (!!accessPassword !== !!sessionSecret) throw new Error('La clave web y el secreto de sesión deben configurarse juntos.');
  if (accessPassword && Buffer.byteLength(accessPassword) < 14) throw new Error('XUPER_WEB_PASSWORD debe tener al menos 14 caracteres.');
  if (sessionSecret && Buffer.byteLength(sessionSecret) < 32) throw new Error('XUPER_SESSION_SECRET debe tener al menos 32 bytes.');
  if (typeof apiHandler !== 'function' || typeof mediaHandler !== 'function') throw new Error('Faltan los handlers HTTP.');

  const server = http.createServer({ maxHeaderSize: 48 * 1024, requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https: blob:; connect-src 'self' https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    responseHelpers(res);
    try {
      if (!req.url || req.url.length > URL_LIMIT) return json(res, 414, { error: 'URL demasiado larga' });
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return json(res, 400, { error: 'Ruta inválida' });
      let decoded;
      try { decoded = decodeURIComponent(req.url.split('?')[0]); }
      catch (_) { return json(res, 400, { error: 'Ruta inválida' }); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((part) => part === '.' || part === '..')) {
        return json(res, 400, { error: 'Ruta inválida' });
      }
      const url = new URL(req.url, publicUrl);
      if (decoded === '/healthz' && req.method === 'GET') return json(res, 200, { ready: true });
      if (String(req.headers.host || '').toLowerCase() !== publicUrl.host.toLowerCase()) return json(res, 421, { error: 'Host no permitido' });
      const clientAddress = forwardedClientAddress(req);
      sanitizeProxyHeaders(req);
      if (decoded === '/api/session') {
        if (req.method !== 'GET') return json(res, 405, { error: 'Método no permitido' });
        return json(res, 200, { authenticated: hasSession(req, sessionSecret) });
      }
      if (decoded === '/api/login') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
        const origin = req.headers.origin;
        if (origin && origin !== publicUrl.origin) return json(res, 403, { error: 'Origen no permitido' });
        const ip = clientAddress;
        const now = Date.now();
        const attempts = loginAttempts.get(ip);
        if (attempts && attempts.until > now && attempts.failures >= LOGIN_MAX_FAILURES) {
          return json(res, 429, { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }, { 'Retry-After': String(Math.ceil((attempts.until - now) / 1000)) });
        }
        const body = await readJson(req);
        const supplied = typeof body.password === 'string' && body.password.length <= 256 ? body.password : '';
        if (!accessPassword || !safeEqual(supplied, accessPassword)) {
          const previous = attempts && attempts.until > now ? attempts : { failures: 0, until: now + LOGIN_WINDOW_MS };
          previous.failures += 1;
          previous.until = now + LOGIN_WINDOW_MS;
          loginAttempts.set(ip, previous);
          if (loginAttempts.size > 4096) {
            for (const [key, value] of loginAttempts) if (value.until <= now) loginAttempts.delete(key);
            while (loginAttempts.size > 4096) loginAttempts.delete(loginAttempts.keys().next().value);
          }
          return json(res, 401, { error: 'La clave no es correcta.' });
        }
        loginAttempts.delete(ip);
        const expiry = Math.floor(now / 1000) + SESSION_SECONDS;
        const cookie = `${SESSION_COOKIE}=${expiry}.${sessionSignature(expiry, sessionSecret)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
        return json(res, 200, { authenticated: true }, { 'Set-Cookie': cookie });
      }
      if (decoded === '/api/logout') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
        const origin = req.headers.origin;
        if (origin && origin !== publicUrl.origin) return json(res, 403, { error: 'Origen no permitido' });
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
        return json(res, 200, { authenticated: false });
      }
      const isProtectedApi = decoded === '/api/media' || decoded.startsWith('/api/');
      if (isProtectedApi && !hasSession(req, sessionSecret)) {
        return json(res, 401, { error: 'Inicia sesión para continuar.' });
      }
      if (decoded === '/api/media') {
        req.query = Object.fromEntries(url.searchParams);
        return Promise.resolve(mediaHandler(req, res)).catch(() => json(res, 502, { error: 'No se pudo servir el medio' }));
      }
      const apiMatch = /^\/api\/([A-Za-z][A-Za-z0-9]*)$/.exec(decoded);
      if (apiMatch) {
        if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
        const origin = req.headers.origin;
        if (origin && origin !== publicUrl.origin) return json(res, 403, { error: 'Origen no permitido' });
        req.query = Object.assign(Object.fromEntries(url.searchParams), { method: apiMatch[1] });
        req.body = req.method === 'POST' ? await readJson(req) : undefined;
        return Promise.resolve(apiHandler(req, res)).catch(() => json(res, 502, { error: 'No se pudo completar la solicitud' }));
      }
      if (decoded.startsWith('/api/')) return json(res, 404, { error: 'No encontrado' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método no permitido' });
      return staticFile(root, decoded === '/' ? 'index.html' : decoded.slice(1), req, res);
    } catch (err) {
      json(res, err.status || 500, { error: err.status ? err.message : 'Error del servidor' });
    }
  });
  server.maxHeadersCount = 64;
  server.keepAliveTimeout = 5000;
  return server;
}

function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Se requiere Node.js 22 o posterior.');
  const accessPassword = process.env.XUPER_WEB_PASSWORD || '';
  const sessionSecret = process.env.XUPER_SESSION_SECRET || '';
  if (Buffer.byteLength(accessPassword) < 14) throw new Error('Configura XUPER_WEB_PASSWORD con al menos 14 caracteres.');
  if (Buffer.byteLength(sessionSecret) < 32) throw new Error('Configura XUPER_SESSION_SECRET con al menos 32 bytes aleatorios.');
  if (process.env.XUPER_BACKEND_URL) throw new Error('XUPER_BACKEND_URL no se utiliza; la interfaz y la API se alojan juntas en este VPS.');
  const secret = process.env.MEDIA_TOKEN_SECRET || process.env.XUPER_MEDIA_SECRET || '';
  if (secret.length < 32) throw new Error('Configura MEDIA_TOKEN_SECRET con al menos 32 caracteres aleatorios.');
  const publicOrigin = process.env.PUBLIC_BASE_URL || process.env.PUBLIC_ORIGIN || '';
  const bind = process.env.BIND_HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1', '0.0.0.0'].includes(bind)) throw new Error('BIND_HOST inválido.');
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT debe estar entre 1024 y 65535.');
  const server = createServer({
    publicOrigin,
    root: path.join(__dirname, '../webos/fidelity'),
    accessPassword,
    sessionSecret,
    apiHandler: require('../webos/fidelity/api/[method].js'),
    mediaHandler: require('../webos/fidelity/api/media.js')
  });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? 'El puerto ya está ocupado. Elige otro PORT para Xuper.' : 'No se pudo iniciar Xuper.');
    process.exitCode = 1;
  });
  server.listen(port, bind, () => console.log('Xuper HTTP listo, puerto interno ' + port));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.close();
    setTimeout(() => server.closeAllConnections(), 10000).unref();
  });
}

module.exports = { createServer };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
