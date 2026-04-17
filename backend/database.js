import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'dealforge.db');

let db = null;
let saveTimeout = null;

class DatabaseWrapper {
  constructor(sqlDb) {
    this.db = sqlDb;
  }

  prepare(sql) {
    const dbRef = this.db;
    const self = this;
    return {
      run: (...params) => {
        const stmt = dbRef.prepare(sql);
        try {
          if (params.length) stmt.bind(params);
          stmt.step();
          stmt.free();
          self.scheduleSave();
          return { changes: dbRef.getRowsModified() };
        } catch (e) {
          try { stmt.free(); } catch (_) {}
          throw e;
        }
      },
      get: (...params) => {
        const stmt = dbRef.prepare(sql);
        try {
          if (params.length) stmt.bind(params);
          const result = stmt.step() ? stmt.getAsObject() : undefined;
          stmt.free();
          return result;
        } catch (e) {
          try { stmt.free(); } catch (_) {}
          throw e;
        }
      },
      all: (...params) => {
        const stmt = dbRef.prepare(sql);
        const results = [];
        try {
          if (params.length) stmt.bind(params);
          while (stmt.step()) results.push(stmt.getAsObject());
          stmt.free();
          return results;
        } catch (e) {
          try { stmt.free(); } catch (_) {}
          throw e;
        }
      }
    };
  }

  exec(sql) {
    this.db.exec(sql);
    this.scheduleSave();
  }

  run(sql, ...params) {
    return this.prepare(sql).run(...params);
  }

  get(sql, ...params) {
    return this.prepare(sql).get(...params);
  }

  all(sql, ...params) {
    return this.prepare(sql).all(...params);
  }

  scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => this.saveToDisk(), 100);
  }

  saveToDisk() {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = this.db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      console.error('DB save failed:', e.message);
    }
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      this.scheduleSave();
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

export async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();
  let sqlDb;

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buffer);
  } else {
    sqlDb = new SQL.Database();
  }

  sqlDb.exec('PRAGMA journal_mode=WAL');
  sqlDb.exec('PRAGMA foreign_keys=ON');

  db = new DatabaseWrapper(sqlDb);
  return db;
}

export function auditLog(db, eventType, entityType, entityId, actor, details) {
  db.run(
    `INSERT INTO audit_log (timestamp, event_type, entity_type, entity_id, actor, details_json)
     VALUES (datetime('now'), ?, ?, ?, ?, ?)`,
    eventType, entityType, entityId, actor || 'system', JSON.stringify(details || {})
  );
}
