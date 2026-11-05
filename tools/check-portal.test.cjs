'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseArgs, classifyError, deadlineCall, runProbe, probeMedia, MAX_BYTES } = require('./check-portal.cjs');

const options = values => Object.assign(parseArgs([]), values);
const fakeMagis = overrides => Object.assign({
  runWithDeadline: (_ms, operation, callback) => operation(callback),
  ensureSession: callback => callback(null, { userToken: 'secret-session' }),
  resolve: (_id, _series, _options, callback) => callback(null, {
    url: 'https://cdn.invalid/movie.ts?token=secret-url', mime: 'video/mp2t', codec: 'H265', headers: { 'Content-Auth': 'secret-auth' }
  })
}, overrides);

test('argumentos: sin ID comprueba sesión; media exige título y tiempo acotado', () => {
  assert.deepEqual(parseArgs([]), { contentId: '', seriesId: '', media: false, timeoutMs: 60000, help: false });
  assert.equal(parseArgs(['--content-id', 'ABC123', '--media', '--timeout-ms', '4000']).media, true);
  for (const args of [['--media'], ['--series-id', 'ABC'], ['--timeout-ms', 'Infinity'], ['--timeout-ms', '120001'], ['--content-id', 'a/b'], ['--unknown']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('errores nunca devuelven mensaje, URL, token ni códigos arbitrarios', () => {
  assert.deepEqual(classifyError({ portalCode: 'portal100024', message: 'https://private/?token=secret' }, 'sesion'), {
    codigo: 'portal100024', mensaje: 'El portal rechazó la región o la IP de este servidor.', exitCode: 3
  });
  const output = JSON.stringify(classifyError({ code: 'PRIVATE_TOKEN', message: 'secret' }, 'resolucion'));
  assert.equal(output.includes('secret'), false);
  assert.equal(output.includes('PRIVATE_TOKEN'), false);
  assert.equal(classifyError({ code: 'PORTAL_TIMEOUT' }, 'sesion').exitCode, 4);
  assert.equal(classifyError(new Error('secret'), 'medio').exitCode, 6);
});

test('rechazo regional detiene resolución y deja salida segura', async () => {
  let called = false;
  const output = [];
  const report = await runProbe(options({ contentId: 'ABC', media: true }), {
    magis: fakeMagis({ ensureSession: callback => callback({ portalCode: 'portal100024', message: 'secret' }), resolve: () => { called = true; } }),
    emit: value => output.push(value)
  });
  assert.equal(called, false);
  assert.equal(report.exitCode, 3);
  assert.equal(output.length, 1);
  assert.equal(JSON.stringify(output).includes('secret'), false);
});

test('sesión y resolución exponen solo metadatos permitidos', async () => {
  const output = [];
  const report = await runProbe(options({ contentId: 'ABC' }), { magis: fakeMagis(), emit: value => output.push(value) });
  assert.equal(report.ok, true);
  assert.deepEqual(output.map(value => value.fase), ['sesion', 'resolucion']);
  assert.equal(output[1].codec, 'H265');
  assert.equal(JSON.stringify(report).includes('secret'), false);
  assert.equal(JSON.stringify(report).includes('cdn.invalid'), false);
});

test('las etapas comparten el presupuesto total y no vuelven a conceder un minuto', async () => {
  let clock = 0;
  const budgets = [];
  const magis = fakeMagis({
    runWithDeadline: (budget, operation, callback) => { budgets.push(budget); operation(callback); },
    ensureSession: callback => { clock = 900; callback(null, {}); }
  });
  const report = await runProbe(options({ contentId: 'ABC', timeoutMs: 1000 }), { magis, now: () => clock });
  assert.equal(report.ok, true);
  assert.deepEqual(budgets, [1000, 100]);
});

test('un cliente que no llama callback termina por timeout y callbacks tardíos se ignoran', async () => {
  let callback;
  const promise = deadlineCall({ runWithDeadline: (_ms, _operation, done) => { callback = done; } }, 10, () => {});
  await assert.rejects(promise, { code: 'PROBE_TIMEOUT' });
  callback(null, { token: 'late-secret' });
});

test('medio usa handler real inyectado, rango de 64 KiB y token firmado efímero', async () => {
  const secret = crypto.randomBytes(32).toString('hex');
  const result = await probeMedia({ url: 'https://cdn.invalid/movie.ts', headers: { 'Content-Auth': 'secret' } }, {
    secret, timeoutMs: 2000,
    handler: (req, res) => {
      assert.equal(req.headers.range, 'bytes=0-65535');
      const [payload, signature] = req.query.token.split('.');
      assert.equal(signature, crypto.createHmac('sha256', secret).update(payload).digest('base64url'));
      const entry = JSON.parse(Buffer.from(payload, 'base64url'));
      assert.deepEqual(entry.hosts, ['cdn.invalid']);
      res.writeHead(206, { 'Content-Type': 'video/mp2t', 'Content-Range': 'bytes 0-65535/999999' });
      res.end(Buffer.alloc(MAX_BYTES));
    }
  });
  assert.deepEqual(result, { status: 206, bytes: MAX_BYTES });
});

test('si el CDN ignora Range se corta la descarga a los 64 KiB', async () => {
  const result = await probeMedia({ url: 'https://cdn.invalid/movie.ts' }, {
    secret: 'ephemeral-test-secret', timeoutMs: 2000,
    handler: (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.end(Buffer.alloc(MAX_BYTES * 16));
    }
  });
  assert.deepEqual(result, { status: 200, bytes: MAX_BYTES });
});

test('respuesta HTTP rechazada no imprime el cuerpo del CDN', async () => {
  await assert.rejects(probeMedia({ url: 'https://cdn.invalid/movie.ts' }, {
    secret: 'ephemeral-test-secret', timeoutMs: 2000,
    handler: (_req, res) => { res.statusCode = 403; res.end('PRIVATE_TOKEN'); }
  }), error => error.message === 'media response rejected');
});
