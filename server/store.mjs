import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// Single-owner deployment. Database, credentials and encryption key stay in the owner's data directory.
export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dir, 'skoob.sqlite'));
    chmodSync(join(dir, 'skoob.sqlite'), 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection,id));');
    const keyFile = join(dir, 'secrets.key');
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.key = readFileSync(keyFile);
    if (this.key.length !== 32) throw new Error('Invalid local secrets.key; restore it with the database backup.');
  }
  get(collection, id, fallback = null) {
    const row = this.db.prepare('SELECT data FROM records WHERE collection=? AND id=?').get(collection, id);
    return row ? JSON.parse(row.data) : fallback;
  }
  set(collection, id, value) {
    this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data').run(collection, id, JSON.stringify(value));
    return value;
  }
  list(collection) { return this.db.prepare('SELECT data FROM records WHERE collection=? ORDER BY rowid').all(collection).map(r => JSON.parse(r.data)); }
  remove(collection, id) { this.db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(collection, id); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  secret(id, value) {
    if (value !== undefined) {
      if (!value) { this.remove('secrets', id); return ''; }
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      this.set('secrets', id, { iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
      return value;
    }
    const saved = this.get('secrets', id); if (!saved) return '';
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(saved.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(saved.data, 'base64')), decipher.final()]).toString('utf8');
  }
  close() { this.db.close(); }
}
