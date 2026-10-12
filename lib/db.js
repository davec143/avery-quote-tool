import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

let _db;

export function db() {
  if (_db) return _db;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  _db = new Database(path.join(DATA_DIR, 'quotes.db'));
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  return _db;
}

function migrate(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS blobs (
      key TEXT PRIMARY KEY,
      mime TEXT,
      data BLOB
    );
    CREATE TABLE IF NOT EXISTS catalog_items (
      sku TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      variant TEXT,
      category TEXT,
      pack_label TEXT,
      pack_qty INTEGER DEFAULT 1,
      pack_price REAL,
      unit_price REAL,
      cct TEXT,
      output_class TEXT,
      watts REAL,
      dimmable INTEGER,
      ip_rating TEXT,
      specs TEXT,
      inventory INTEGER,
      source TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS compat_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competitor_brand TEXT,
      competitor_sku TEXT NOT NULL,
      competitor_description TEXT,
      avery_sku TEXT NOT NULL,
      notes TEXT,
      added_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now')),
      filename TEXT,
      file_path TEXT,
      quote_number TEXT,
      job_name TEXT,
      customer TEXT,
      competitor TEXT,
      quote_date TEXT,
      status TEXT DEFAULT 'review',
      extractor TEXT,
      matcher TEXT,
      raw_text TEXT,
      notes TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS quote_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      pos INTEGER,
      line_ref TEXT,
      group_label TEXT,
      comp_sku TEXT,
      comp_desc TEXT,
      qty REAL,
      comp_unit_price REAL,
      our_sku TEXT,
      match_source TEXT,
      confidence TEXT,
      reason TEXT,
      na INTEGER DEFAULT 0,
      include INTEGER DEFAULT 1,
      confirmed INTEGER DEFAULT 0,
      suggested_sku TEXT,
      our_qty REAL
    );
    CREATE TABLE IF NOT EXISTS product_specs (
      sku TEXT PRIMARY KEY, values_json TEXT NOT NULL, reference TEXT NOT NULL,
      verified_by TEXT NOT NULL, verified_at TEXT NOT NULL, source_fingerprint TEXT
    );
    CREATE TABLE IF NOT EXISTS quote_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      revision INTEGER, event_type TEXT NOT NULL, actor TEXT NOT NULL,
      details_json TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS quote_events_quote ON quote_events(quote_id,id);
  `);
  const cols = d.prepare('PRAGMA table_info(quote_lines)').all().map((c) => c.name);
  if (!d.prepare('PRAGMA table_info(product_specs)').all().some((c)=>c.name==='source_fingerprint')) d.exec('ALTER TABLE product_specs ADD COLUMN source_fingerprint TEXT');
  if (!cols.includes('our_qty')) d.exec('ALTER TABLE quote_lines ADD COLUMN our_qty REAL');
  if (!cols.includes('qty_basis')) d.exec("ALTER TABLE quote_lines ADD COLUMN qty_basis TEXT DEFAULT ''");
  if (!cols.includes('customer_note')) d.exec("ALTER TABLE quote_lines ADD COLUMN customer_note TEXT DEFAULT ''");
  for (const [name, type] of Object.entries({
    quantity_mode: "TEXT DEFAULT 'auto'", fixed_multiplier: 'REAL DEFAULT 1', requirement_watts: 'REAL',
    match_kind: "TEXT DEFAULT 'review'", difference_notes: "TEXT DEFAULT ''", review_required: 'INTEGER DEFAULT 1',
    review_accepted: 'INTEGER DEFAULT 0', dependency_ids: "TEXT DEFAULT '[]'",
    decision_note: "TEXT DEFAULT ''",
  })) if (!cols.includes(name)) d.exec(`ALTER TABLE quote_lines ADD COLUMN ${name} ${type}`);
  if (!cols.includes('quantity_mode')) d.exec("UPDATE quote_lines SET quantity_mode = 'manual' WHERE our_qty IS NOT NULL AND our_sku IS NOT NULL");
  const quoteCols = d.prepare('PRAGMA table_info(quotes)').all().map((c) => c.name);
  for (const [name, type] of Object.entries({
    revision: 'INTEGER DEFAULT 0', summary_snapshot: 'TEXT', reviewed_at: 'TEXT',
    customer_notes: "TEXT DEFAULT ''", lead_time: "TEXT DEFAULT ''", payment_terms: "TEXT DEFAULT ''",
    valid_until: "TEXT DEFAULT ''", currency_confirmed: 'INTEGER DEFAULT 0', quantities_verified: 'INTEGER DEFAULT 0',
    source_type: "TEXT DEFAULT 'application/pdf'", reconciliation_note: "TEXT DEFAULT ''",
    source_charges: "TEXT DEFAULT '[]'", reviewer_name: "TEXT DEFAULT ''",
    driver_basis: "TEXT DEFAULT 'source'", design_headroom: 'REAL', installation_note: "TEXT DEFAULT ''",
    outcome: "TEXT DEFAULT 'open'", outcome_note: "TEXT DEFAULT ''",
  })) if (!quoteCols.includes(name)) d.exec(`ALTER TABLE quotes ADD COLUMN ${name} ${type}`);
  const compatCols = d.prepare('PRAGMA table_info(compat_rows)').all().map((c) => c.name);
  if (!compatCols.includes('units_per_line_item')) d.exec('ALTER TABLE compat_rows ADD COLUMN units_per_line_item REAL DEFAULT 1');
}

export function getSetting(key, fallback = '') {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== null && row.value !== '' ? row.value : fallback;
}

export function setSetting(key, value) {
  db()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value ?? '');
}

export function getBlob(key) {
  return db().prepare('SELECT mime, data FROM blobs WHERE key = ?').get(key);
}

export function setBlob(key, mime, data) {
  db()
    .prepare('INSERT INTO blobs (key, mime, data) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data')
    .run(key, mime, data);
}

export function deleteBlob(key) {
  db().prepare('DELETE FROM blobs WHERE key = ?').run(key);
}
