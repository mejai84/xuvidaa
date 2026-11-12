'use strict';

// One active MKV remux lease per TVVIDAA instance. Does not launch FFmpeg.
const crypto = require('node:crypto');
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_IDLE_MS = 90 * 1000;

function createRemuxGate(options = {}) {
  const now = options.now || Date.now;
  let active = null;
  function cleanup() {
    if (active && (now() >= active.expires || now() - active.lastSeen >= MAX_IDLE_MS)) {
      const old = active;
      active = null;
      try { old.stop(); } catch (_) { /* cleanup is best effort */ }
    }
  }
  function acquire(stop) {
    if (typeof stop !== 'function') throw new TypeError('stop callback required');
    cleanup();
    if (active) return null;
    const id = crypto.randomBytes(20).toString('hex');
    const started = now();
    active = { id, stop, lastSeen: started, expires: started + MAX_DURATION_MS };
    return id;
  }
  function touch(id) {
    cleanup();
    if (!active || active.id !== id) return false;
    active.lastSeen = now();
    return true;
  }
  function release(id) {
    if (!active || active.id !== id) return false;
    const old = active;
    active = null;
    try { old.stop(); } catch (_) { /* cleanup is best effort */ }
    return true;
  }
  function busy() { cleanup(); return !!active; }
  return {acquire, touch, release, busy};
}
module.exports = {createRemuxGate, MAX_DURATION_MS, MAX_IDLE_MS};
