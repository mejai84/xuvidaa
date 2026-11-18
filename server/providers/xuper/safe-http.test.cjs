'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { isPublicAddress, validateUrl, resolveDestination, fetchText } = require('./safe-http.cjs');

test('catalog URL boundary rejects non-HTTPS, local/reserved addresses and credentials', () => {
  for (const value of ['http://catalog.example/a', 'file:///etc/passwd', 'https://user:pass@catalog.example/a',
    'https://127.0.0.1/a', 'https://169.254.169.254/latest', 'https://192.168.0.1/a', 'https://[::1]/a',
    'https://[::ffff:127.0.0.1]/a', 'https://service.internal/a', 'https://catalog.example:8443/a',
    'https://catalog.example/a#fragment']) assert.throws(() => validateUrl(value));
  assert.equal(validateUrl('https://catalog.example/a?token=private', ['catalog.example']).hostname, 'catalog.example');
  assert.throws(() => validateUrl('https://another.example/a', ['catalog.example']));
});

test('public IP checks cover IPv4, IPv6 and transition/reserved ranges', () => {
  for (const value of ['0.0.0.0', '10.2.3.4', '100.64.0.1', '127.1.2.3', '169.254.1.1', '172.31.0.1',
    '192.0.2.4', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.4', '224.0.0.1', '255.255.255.255',
    '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:808:808::1', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(value), false, value);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('all DNS answers must be public and socket lookup is pinned to the validated result', async () => {
  const url = validateUrl('https://catalog.example/a');
  await assert.rejects(resolveDestination(url, async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.2', family: 4 }]));
  let calls = 0;
  const lookup = await resolveDestination(url, async (host, options) => {
    ++calls; assert.equal(host, 'catalog.example'); assert.equal(options.all, true);
    return [{ address: '8.8.8.8', family: 4 }];
  });
  assert.deepEqual(await new Promise((resolve, reject) => lookup('catalog.example', { all: true }, (error, result) => error ? reject(error) : resolve(result))), [{ address: '8.8.8.8', family: 4 }]);
  await assert.rejects(new Promise((resolve, reject) => lookup('attacker.example', {}, (error) => error ? reject(error) : resolve())));
  assert.equal(calls, 1);
});

function remote(status, body, headers = {}) {
  return (url, options, callback) => {
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(typeof options.lookup, 'function');
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = status;
      response.headers = headers;
      response.resume = () => {};
      callback(response);
      response.emit('data', Buffer.from(body));
      response.emit('end');
    });
    return request;
  };
}

test('bounded HTTPS download rejects redirects, oversized and compressed responses', async () => {
  const options = { lookup: async () => [{ address: '8.8.8.8', family: 4 }], allowedHosts: ['catalog.example'] };
  assert.equal(await fetchText('https://catalog.example/a', { ...options, request: remote(200, 'catalog') }), 'catalog');
  await assert.rejects(fetchText('https://catalog.example/a', { ...options, request: remote(302, '', { location: 'https://other.example/secret' }) }));
  await assert.rejects(fetchText('https://catalog.example/a', { ...options, maxBytes: 3, request: remote(200, 'too long') }));
  await assert.rejects(fetchText('https://catalog.example/a', { ...options, request: remote(200, 'x', { 'content-length': 100000000 }) }));
  await assert.rejects(fetchText('https://catalog.example/a', { ...options, request: remote(200, 'x', { 'content-encoding': 'gzip' }) }));
});

test('legacy M3U download uses only the approved exact origin and pinned public DNS', async (t) => {
  const previousAck = process.env.VIDAA_HTTP_VOD_ACK;
  const previousHosts = process.env.VIDAA_HTTP_VOD_HOSTS;
  t.after(() => {
    if (previousAck === undefined) delete process.env.VIDAA_HTTP_VOD_ACK;
    else process.env.VIDAA_HTTP_VOD_ACK = previousAck;
    if (previousHosts === undefined) delete process.env.VIDAA_HTTP_VOD_HOSTS;
    else process.env.VIDAA_HTTP_VOD_HOSTS = previousHosts;
  });
  process.env.VIDAA_HTTP_VOD_ACK = 'yes';
  process.env.VIDAA_HTTP_VOD_HOSTS = 'catalog.example:8080,catalog.example:8081';
  const legacyVodOrigin = 'http://catalog.example:8080';
  const raw = legacyVodOrigin + '/list';
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }];
  assert.throws(() => validateUrl(raw));
  assert.throws(() => validateUrl('http://catalog.example:8081/list', undefined, legacyVodOrigin));
  assert.throws(() => validateUrl(raw + '#fragment', undefined, legacyVodOrigin));
  assert.equal(await fetchText(raw, { legacyVodOrigin, lookup, request: remote(200, 'catalog') }), 'catalog');
  await assert.rejects(fetchText(raw, { legacyVodOrigin, lookup, request: remote(302, '') }));
  await assert.rejects(fetchText(raw, {
    legacyVodOrigin, lookup: async () => [{ address: '10.0.0.2', family: 4 }],
    request: () => assert.fail('private DNS answers must not open a socket')
  }));
  process.env.VIDAA_HTTP_VOD_ACK = 'no';
  assert.throws(() => validateUrl(raw, undefined, legacyVodOrigin));
});
