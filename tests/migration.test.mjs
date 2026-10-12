import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'avery-migration-'));
process.env.DATA_DIR = folder;
// Prior versions stored reviewed quantities without an automatic/manual mode.
const old = new Database(path.join(folder, 'quotes.db'));
old.exec(`CREATE TABLE quote_lines (
  id INTEGER PRIMARY KEY, quote_id INTEGER, pos INTEGER, line_ref TEXT,
  group_label TEXT, comp_sku TEXT, comp_desc TEXT, qty REAL, comp_unit_price REAL,
  our_sku TEXT, match_source TEXT, confidence TEXT, reason TEXT, na INTEGER DEFAULT 0,
  include INTEGER DEFAULT 1, confirmed INTEGER DEFAULT 0, suggested_sku TEXT, our_qty REAL,
  qty_basis TEXT DEFAULT '', customer_note TEXT DEFAULT ''
);
INSERT INTO quote_lines (id,our_sku,our_qty) VALUES (1,'REVIEWED-SKU',17), (2,NULL,NULL);`);
old.close();
const { db } = await import('../lib/db.js');
after(() => { db().close(); fs.rmSync(folder, { recursive: true, force: true }); });

test('upgrade preserves existing reviewed quantities as manual instead of silently recalculating', () => {
  const rows = db().prepare('SELECT * FROM quote_lines ORDER BY id').all();
  assert.equal(rows[0].our_qty, 17);
  assert.equal(rows[0].quantity_mode, 'manual');
  assert.equal(rows[0].review_accepted, 0);
  assert.equal(rows[1].quantity_mode, 'auto');
});
