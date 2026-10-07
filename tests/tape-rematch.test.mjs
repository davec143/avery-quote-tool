import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avery-tape-'));
const { db } = await import('../lib/db.js');
const { toItem, replaceCatalog } = await import('../lib/catalog.js');
const { rematch, getQuote, computeQuote } = await import('../lib/quotes.js');
const { addCompatRows } = await import('../lib/compat.js');

function setup(specs) {
  const tape = toItem({ handle: 'cob', sku: 'AV-TAPE-24V-3000K-200L-CT10', title: 'COB Tape Light 24V 3000K 200 lm/ft', price: 200,
    options: ['Case (10 pcs)'], specs, source: 'test' });
  replaceCatalog([tape], 'test');
  const id = Number(db().prepare("INSERT INTO quotes (raw_text, customer, status) VALUES ('x','C','review')").run().lastInsertRowid);
  db().prepare(`INSERT INTO quote_lines (quote_id,pos,line_ref,comp_sku,comp_desc,qty,comp_unit_price)
    VALUES (?,0,'1','TAPE-ANY-3000K-86I','Tape light 24V 3000K 200 lm/ft 86.44in White 36in Wire',4,80)`).run(id);
  return id;
}

test('tape quantity comes from length and roll size, even when a saved mapping has a multiplier', async () => {
  const id = setup('Roll length: 16.4 ft. IP20.');
  addCompatRows([{ competitor_sku: 'TAPE-ANY-*', avery_sku: 'AV-TAPE-24V-3000K-200L-CT10', units_per_line_item: 4 }]);
  await rematch(id, { all: true });
  const line = getQuote(id).lines[0];
  assert.equal(line.our_qty, 2);            // 4 × 86.44 in = 28.8 ft → 2 rolls, not 4 × 4
  assert.match(line.reason, /Length check/);
  const c = computeQuote(getQuote(id), { live: true });
  assert.equal(c.orders[0].packs, 1);       // 2 rolls → one case of 10
  assert.equal(c.totals.ours, 200);
});

test('unreadable roll length keeps the line but flags it low confidence for manual entry', async () => {
  const id = setup('IP20 only');
  await rematch(id, { all: true });
  const line = getQuote(id).lines[0];
  assert.equal(line.confidence, 'low');
  assert.match(line.reason, /Quantity not converted from length/);
});
