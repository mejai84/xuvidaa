#!/usr/bin/env node
'use strict';

// Run on the machine whose connection is being diagnosed. No session, license,
// CDN address or authorization header is printed or written to disk.
const crypto = require('node:crypto');
const http = require('node:http');

const MAX_BYTES = 64 * 1024;
const USAGE = [
  'Uso: node tools/check-portal.cjs [--content-id ID] [--series-id ID] [--media] [--timeout-ms 60000]',
  'Sin ID: comprueba una sesión real del portal.',
  'Con --content-id: también resuelve ese título real. --media lee como máximo 64 KiB del medio.',
  'Códigos de salida: 0 correcto, 2 argumentos, 3 rechazo regional, 4 tiempo agotado, 5 portal, 6 medio.'
].join('\n');

function parseArgs(args) {
  const options = { contentId: '', seriesId: '', media: false, timeoutMs: 60000, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--media') { options.media = true; continue; }
    if (arg !== '--content-id' && arg !== '--series-id' && arg !== '--timeout-ms') {
      throw new Error('Argumento desconocido. Consulta --help.');
    }
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Falta el valor de un argumento. Consulta --help.');
    if (arg === '--timeout-ms') {
      const timeout = Number(value);
      if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) {
        throw new Error('--timeout-ms debe estar entre 1000 y 120000.');
      }
      options.timeoutMs = timeout;
    } else {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('El identificador del título no es válido.');
      options[arg === '--content-id' ? 'contentId' : 'seriesId'] = value;
    }
  }
  if (!options.help && (options.media || options.seriesId) && !options.contentId) {
    throw new Error('--media y --series-id requieren --content-id.');
  }
  return options;
}

function classifyError(error, phase) {
  const code = error && (error.portalCode || error.code);
  if (code === 'portal100024') {
    return { codigo: code, mensaje: 'El portal rechazó la región o la IP de este servidor.', exitCode: 3 };
  }
  if (['PORTAL_TIMEOUT', 'ETIMEDOUT', 'PROBE_TIMEOUT'].includes(code)) {
    return { codigo: 'TIMEOUT', mensaje: 'La comprobación agotó su tiempo máximo.', exitCode: 4 };
  }
  // Provider messages may include tokens, URLs or request bodies. Only return
  // recognized protocol/system codes, never error.message or a stack trace.
  const safeCode = /^(?:portal|aaa)\d{3,12}$/.test(code || '') ? code :
    ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code) ? code :
      phase === 'medio' ? 'MEDIA_ERROR' : 'PORTAL_ERROR';
  return {
    codigo: safeCode,
    mensaje: phase === 'medio' ? 'No se pudo leer la muestra del medio.' : 'El portal no completó esta solicitud.',
    exitCode: phase === 'medio' ? 6 : 5
  };
}

function timeoutError() {
  return Object.assign(new Error('probe deadline'), { code: 'PROBE_TIMEOUT' });
}

function deadlineCall(magis, milliseconds, operation) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => complete(timeoutError()), milliseconds);
    function complete(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    }
    try { magis.runWithDeadline(milliseconds, operation, complete); }
    catch (error) { complete(error); }
  });
}

async function runProbe(options, dependencies = {}) {
  const emit = dependencies.emit || (() => {});
  const now = dependencies.now || Date.now;
  const magis = dependencies.magis || require('../webos/fidelity/api/lib/magis');
  const started = now();
  const remaining = () => Math.max(1, options.timeoutMs - (now() - started));
  let phase = 'sesion';
  const report = { ok: false, etapas: [], exitCode: 0 };
  function record(value) {
    const safe = Object.assign({ fase: phase, ms: Math.max(0, now() - started) }, value);
    report.etapas.push(safe);
    emit(safe);
  }
  try {
    await deadlineCall(magis, remaining(), finish => magis.ensureSession(finish));
    record({ ok: true, mensaje: 'Sesión aceptada por el portal.' });
    if (options.contentId) {
      phase = 'resolucion';
      if (now() - started >= options.timeoutMs) throw timeoutError();
      const stream = await deadlineCall(magis, remaining(), finish => magis.resolve(options.contentId, options.seriesId || '', {}, finish));
      if (!stream || !stream.url) throw new Error('missing source');
      // Deliberate field allowlist: do not spread portal responses into logs.
      const safeText = value => /^[A-Za-z0-9/+._-]{1,64}$/.test(String(value || '')) ? String(value) : undefined;
      record({ ok: true, mensaje: 'El portal resolvió el título.', mime: safeText(stream.mime), codec: safeText(stream.codec) });
      if (options.media) {
        phase = 'medio';
        if (now() - started >= options.timeoutMs) throw timeoutError();
        if (typeof dependencies.probeMedia !== 'function') throw new Error('media probe unavailable');
        const media = await dependencies.probeMedia(stream, Math.min(25000, remaining()));
        record({ ok: true, mensaje: 'Se recibió una muestra del medio; la decodificación del navegador no se comprueba aquí.',
          http: media.status, bytes: media.bytes, aceptaRangos: media.status === 206 });
      }
    }
    report.ok = true;
  } catch (error) {
    const safe = classifyError(error, phase);
    report.exitCode = safe.exitCode;
    record({ ok: false, codigo: safe.codigo, mensaje: safe.mensaje });
  }
  return report;
}

function probeMedia(stream, { handler, secret, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let source;
    try {
      source = new URL(stream.url);
      if (!['https:', 'http:'].includes(source.protocol)) throw new Error('invalid source');
    } catch (_) { reject(new Error('invalid source')); return; }
    const payload = Buffer.from(JSON.stringify({
      url: stream.url, headers: stream.headers || {}, hosts: [source.hostname.toLowerCase()],
      mime: stream.mime || '', exp: Date.now() + timeoutMs + 10000
    })).toString('base64url');
    const token = payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    let request;
    let settled = false;
    let timer;
    const server = http.createServer((req, res) => {
      req.query = Object.fromEntries(new URL(req.url, 'http://127.0.0.1').searchParams);
      res.status = status => { res.statusCode = status; return res; };
      res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      res.send = value => res.end(value);
      try { handler(req, res); } catch (_) { res.destroy(); }
    });
    function complete(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (request) request.destroy();
      server.close();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      if (error) reject(error);
      else resolve(result);
    }
    timer = setTimeout(() => complete(timeoutError()), timeoutMs);
    server.on('error', error => complete(error));
    server.listen(0, '127.0.0.1', () => {
      if (settled) return;
      request = http.get({ hostname: '127.0.0.1', port: server.address().port,
        path: '/api/media?token=' + encodeURIComponent(token), headers: { Range: 'bytes=0-' + (MAX_BYTES - 1) } }, response => {
        const status = response.statusCode || 0;
        if (status !== 200 && status !== 206) { response.resume(); complete(new Error('media response rejected')); return; }
        let bytes = 0;
        response.on('data', chunk => {
          bytes += Math.min(chunk.length, MAX_BYTES - bytes);
          if (bytes >= MAX_BYTES) complete(null, { status, bytes });
        });
        response.on('end', () => bytes ? complete(null, { status, bytes }) : complete(new Error('empty media')));
        response.on('error', error => complete(error));
      });
      request.on('error', error => complete(error));
    });
  });
}

async function main(args) {
  let options;
  try { options = parseArgs(args); }
  catch (error) { process.stderr.write(error.message + '\n' + USAGE + '\n'); return 2; }
  if (options.help) { process.stdout.write(USAGE + '\n'); return 0; }
  if (Number(process.versions.node.split('.')[0]) < 18) {
    process.stderr.write('La comprobación requiere Node.js 18 o posterior.\n'); return 2;
  }
  const dependencies = { emit: value => process.stdout.write(JSON.stringify(value) + '\n') };
  if (options.media) {
    // A fresh CLI process owns this ephemeral key; it never replaces the key
    // of a running server and is never persisted in a .env file.
    const secret = crypto.randomBytes(32).toString('hex');
    process.env.MEDIA_TOKEN_SECRET = secret;
    const handler = require('../webos/fidelity/api/media');
    dependencies.probeMedia = (stream, timeoutMs) => probeMedia(stream, { handler, secret, timeoutMs });
  }
  // Portal modules may log upstream error strings. The CLI owns stdout and
  // emits only the allowlisted structured results above.
  console.log = console.warn = console.error = () => {};
  const report = await runProbe(options, dependencies);
  return report.exitCode;
}

module.exports = { parseArgs, classifyError, deadlineCall, runProbe, probeMedia, MAX_BYTES };
if (require.main === module) {
  main(process.argv.slice(2)).then(code => process.exit(code), () => {
    process.stderr.write('No se pudo completar la comprobación.\n'); process.exit(5);
  });
}
