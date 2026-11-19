'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, createHmac } = require('node:crypto');

const PUBLIC_ID = /^(movie|series|episode)-[0-9a-f]{32}$/;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/;
const idFor = (type, parent, id) => type + '-' + createHash('sha256')
  .update(JSON.stringify([type, parent, id])).digest('hex').slice(0, 32);

// Only identifiers learned from an authorized catalog can become locators.
// Artwork, titles, credentials, control headers and playback URLs never enter this table.
class XuperLocators {
  constructor(cacheDir, sessionKey, config, streamHosts, secrets, limit = 50000) {
    this.enabled = !!cacheDir && typeof sessionKey === 'string' && sessionKey.length >= 32;
    if (!this.enabled) return;
    this.file = path.join(cacheDir, 'xuper-' + config.id + '-locators.sqlite');
    this.scope = createHmac('sha256', sessionKey)
      .update(JSON.stringify([config.id, config.baseUrl, config.authorization || '', [...streamHosts].sort()])).digest('hex');
    this.secrets = secrets;
    this.limit = limit;
  }

  withDatabase(write, operation) {
    if (!this.enabled || (!write && !fs.existsSync(this.file))) return null;
    let db;
    try {
      const { DatabaseSync } = require('node:sqlite');
      if (write) {
        fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
        fs.closeSync(fs.openSync(this.file, 'a', 0o600));
      }
      db = new DatabaseSync(this.file, { readOnly: !write });
      db.exec('PRAGMA busy_timeout=250');
      if (write) {
        db.exec('CREATE TABLE IF NOT EXISTS locators (scope TEXT, id TEXT, source TEXT NOT NULL, parent TEXT NOT NULL, season INTEGER NOT NULL, touched INTEGER NOT NULL, PRIMARY KEY(scope, id)); CREATE INDEX IF NOT EXISTS locators_age ON locators(touched)');
      }
      return operation(db);
    } catch {
      // An unavailable cache must never deny current-session catalog or playback.
      return null;
    } finally { if (db) db.close(); }
  }

  valid(id, source, parent) {
    if (!PUBLIC_ID.test(id) || !SOURCE_ID.test(source) || this.secrets.some(s => source.includes(s) || parent.includes(s))) return false;
    const type = id.slice(0, id.indexOf('-'));
    if (type === 'episode' ? !SOURCE_ID.test(parent) : parent !== '') return false;
    return id === idFor(type, parent, source);
  }

  remember(entries) {
    if (!this.enabled || !entries.length) return;
    this.withDatabase(true, db => {
      db.exec('BEGIN IMMEDIATE');
      const put = db.prepare('INSERT INTO locators(scope,id,source,parent,season,touched) VALUES(?,?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET touched=excluded.touched, season=excluded.season WHERE locators.touched < excluded.touched - 3600000 OR locators.season != excluded.season');
      const now = Date.now();
      for (const record of entries) {
        if (!record || !this.valid(record.item.id, record.source, record.parent)) continue;
        put.run(this.scope, record.item.id, record.source, record.parent, record.item.season || 0, now);
      }
      db.prepare('DELETE FROM locators WHERE rowid IN (SELECT rowid FROM locators ORDER BY touched DESC, rowid DESC LIMIT -1 OFFSET ?)').run(this.limit);
      db.exec('COMMIT');
    });
  }

  get(id) {
    if (!PUBLIC_ID.test(id)) return null;
    return this.withDatabase(false, db => {
      const row = db.prepare('SELECT source, parent, season FROM locators WHERE scope=? AND id=?').get(this.scope, id);
      if (!row || !this.valid(id, row.source, row.parent)) return null;
      return { source: row.source, parent: row.parent, item: { id, type: id.split('-')[0], season: row.season || 1 } };
    });
  }
}

module.exports = { XuperLocators, idFor };
