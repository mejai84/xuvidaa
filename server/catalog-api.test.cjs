'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.MEDIA_TOKEN_SECRET = 'test-secret-only-not-for-production-01234567890';
const handler = require('../webos/fidelity/api/[method].js');
function call(method, body) {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', query: { method }, body: body || {},
      headers: { host: 'tv.example.test' }, socket: { remoteAddress: '127.0.0.19' } };
    const res = { code: 200, setHeader() { return this; },
      status(n) { this.code = n; return this; },
      json(value) { resolve({ code: this.code, body: value }); return this; },
      destroy() { reject(new Error('response destroyed')); } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
test('prewarm no longer depends on blocked Magis provider', async () => {
  const result = await call('prewarm');
  assert.equal(result.code, 200);
  assert.equal(result.body.returnValue, true);
});
test('liveCategories uses IPTV-org, not Magis', async () => {
  const old = handler.iptvOrg.getCategories;
  handler.iptvOrg.getCategories = async () => ({ categories: [{ id: 'all', name: 'Todos' }] });
  try {
    const result = await call('liveCategories');
    assert.equal(result.code, 200);
    assert.equal(result.body.categories[0].name, 'Todos');
  } finally { handler.iptvOrg.getCategories = old; }
});
test('liveChannels uses IPTV-org with paging', async () => {
  const old = handler.iptvOrg.getChannels;
  handler.iptvOrg.getChannels = async () => ({ channels: [{ id: 'Canal1.co', channelCode: 'Canal1.co' }], total: 1, hasMore: false, pageNum: 1 });
  try {
    const result = await call('liveChannels', { pageNum: 1, pageSize: 20 });
    assert.equal(result.code, 200);
    assert.equal(result.body.channels[0].channelCode, 'Canal1.co');
  } finally { handler.iptvOrg.getChannels = old; }
});
test('home movies uses private M3U source', async () => {
  const old = handler.m3uProvider.getMovies;
  handler.m3uProvider.getMovies = async () => ({ items: [{ id: 'mov-test', title: 'Película de prueba' }], total: 1 });
  try {
    const result = await call('home', { root: 'movies' });
    assert.equal(result.code, 200);
    assert.equal(result.body.items[0].id, 'mov-test');
  } finally { handler.m3uProvider.getMovies = old; }
});
test('catalog failure must not generate blocked portal100024 responses', async () => {
  const old = handler.iptvOrg.getChannels;
  handler.iptvOrg.getChannels = async () => { throw new Error('network offline'); };
  try {
    const result = await call('liveChannels', { pageNum: 1 });
    assert.equal(result.code, 200);
    assert.equal(result.body.channels.length, 0);
  } finally { handler.iptvOrg.getChannels = old; }
});
