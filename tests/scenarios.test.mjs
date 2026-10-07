// Stress scenarios built from realistic competitor-quote PDFs (tests/fixtures, made by make-fixtures.py).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'avery-scn-'));
process.env.DATA_DIR = folder;
const { db } = await import('../lib/db.js');
const { replaceCatalog, toItem } = await import('../lib/catalog.js');
const { createQuoteFromPdf, getQuote, computeQuote } = await import('../lib/quotes.js');
const { saveReview } = await import('../lib/review.js');
after(() => { db().close(); fs.rmSync(folder, { recursive: true, force: true }); });

const mk = (handle, sku, title, opt, price, specs) => toItem({ handle, sku, title, options: opt, price, specs, source: 'scenario' });
const catalog = [
  mk('t27', 'AV-T-2700-200', '24V COB tape light 2700K', ['Case (10 pcs)', '200L'], 220, 'IP20 24V DC Roll length: 16.4 ft'),
  mk('t30', 'AV-T-3000-100', '24V SMD tape light 3000K', ['Case (10 pcs)', '100L'], 150, 'IP20 24V DC Roll length: 16.4 ft'),
  mk('t30b', 'AV-T-3000-200', '24V SMD tape light 3000K', ['Case (10 pcs)', '200L'], 176, 'IP20 24V DC Roll length: 16.4 ft'),
  mk('t30c', 'AV-T-3000-500', '24V SMD tape light 3000K', ['Case (10 pcs)', '500L'], 290, 'IP20 24V DC Roll length: 16.4 ft'),
  mk('rgbw', 'AV-T-RGBW', '24V RGBW tape light', ['Case (10 pcs)', '300L'], 310, 'IP20 24V DC Roll length: 16.4 ft'),
  mk('d60', 'AV-D-60', '24V 60W non-dimmable power supply', ['Case (10 pcs)'], 120, 'IP20 AC input 100–240V'),
  mk('d100', 'AV-D-100', '24V 100W non-dimmable power supply', ['Case (10 pcs)'], 180, 'IP20 AC input 100–240V'),
  mk('cw', 'AV-C-WIRE', 'Tape to wire connector 10mm', ['Box (100 pcs)'], 45, 'IP20 10mm 2 pin'),
];
const fx = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const byRef = (q) => Object.fromEntries(q.lines.map((l) => [l.comp_sku, l]));
async function load(name) {
  replaceCatalog(catalog, 'scenario');
  const id = await createQuoteFromPdf(name, fx(name));
  return { id, q: getQuote(id) };
}
function formFor(id, over = {}) {
  const q = getQuote(id), f = new FormData();
  for (const [k, v] of Object.entries({ revision: q.revision, customer: 'Maple Electric', job_name: 'Stress job', currency_confirmed: 'on', quantities_verified: 'on', ...over })) f.set(k, String(v));
  for (const l of q.lines) {
    f.set(`qty_${l.id}`, String(l.qty)); f.set(`price_${l.id}`, l.comp_unit_price ?? ''); f.set(`oq_${l.id}`, String(l.our_qty ?? l.qty));
    f.set(`sku_${l.id}`, l.our_sku || 'NA'); f.set(`note_${l.id}`, 'Verified against datasheets for this job.');
    if (l.include) f.set(`inc_${l.id}`, 'on');
  }
  return f;
}

test('mixed quote: boundaries, metric/feet, per-foot, wet, 12V, RGBW, undersized driver, no price', async () => {
  const { id, q } = await load('stress-mixed-tape-drivers.pdf');
  assert.equal(q.lines.length, 12); assert.equal(q.error, null);
  const L = byRef(q);
  assert.equal(L['DI-TAPE-A'].our_qty, 1);   // 196.8 in = exactly one 16.4 ft roll
  assert.equal(L['DI-TAPE-B'].our_qty, 1);   // 0.1 in over is measurement noise, not another roll
  assert.equal(L['DI-TAPE-C'].our_qty, 2);   // 2 × 5 m with a 16.4 ft roll: no phantom third roll
  assert.equal(L['DI-TAPE-D'].our_qty, 7);   // 100 ft priced per foot -> 7 rolls
  for (const sku of ['DI-WET-E', 'DI-12V-F', 'DI-PSU-120']) { assert.equal(L[sku].our_sku, null); assert.equal(L[sku].include, 0); }
  assert.match(L['DI-WET-E'].reason, /Wet/); assert.match(L['DI-12V-F'].reason, /Voltage/); assert.match(L['DI-PSU-120'].reason, /sufficiently rated/);
  assert.equal(L['DI-RGBW-G'].our_sku, 'AV-T-RGBW');
  assert.equal(L['DI-PSU-60'].our_sku, 'AV-D-60'); assert.equal(L['DI-PSU-100'].our_sku, 'AV-D-100');
  const c = computeQuote(getQuote(id), { live: true });
  assert.equal(c.counts.noPrice, 1);          // unpriced line cannot enter totals
  const tape = c.orders.find((o) => o.sku === 'AV-T-3000-200');
  assert.equal(tape.requiredPieces, 11); assert.equal(tape.packs, 2); assert.equal(tape.total, 352); // same SKU across lines shares cases
  assert.equal(c.totals.theirs, 567);
  assert.equal(c.totals.ours, 352 + 310 + 120 + 180 + 45);
  assert.ok(c.totals.savings < 0);            // Avery is dearer here and the tool must say so, not hide it
});

test('confidence is meaningful: clean matches are medium, real unknowns are low', async () => {
  const { q } = await load('stress-mixed-tape-drivers.pdf');
  const L = byRef(q);
  assert.equal(L['DI-PSU-100'].confidence, 'medium'); assert.equal(L['DI-TAPE-A'].confidence, 'medium');
  assert.match(L['DI-PSU-100'].reason, /Standard checks before sending/);
  assert.equal(L['DI-WET-E'].confidence, 'low');
});

test('another vendor layout is read by the generic reader, with explicit brightness respected', async () => {
  const { q } = await load('stress-other-vendor-layout.pdf');
  assert.equal(q.lines.length, 2);
  const L = byRef(q);
  assert.equal(L['ACM-STRIP-3K'].our_sku, 'AV-T-3000-200'); // "200 lm/ft" stated, so not the 100 lm/ft tape
  assert.equal(L['ACM-STRIP-3K'].our_qty, 3);                // 3 × "16.4ft roll"
  assert.equal(computeQuote(q, { live: true }).totals.theirs, 280);
});

test('a unit/extended price conflict keeps the line, blanks the price and warns', async () => {
  const { id, q } = await load('stress-price-conflict.pdf');
  assert.equal(q.status, 'review'); assert.equal(q.lines[0].comp_unit_price, null);
  assert.match(q.error, /does not equal the extended price/);
  assert.throws(() => saveReview(id, formFor(id), true), /missing or invalid pricing|valid priced product/);
});

test('freight/discount/tax lines explain a total mismatch; CAD cannot be confirmed as USD', async () => {
  const { id, q } = await load('stress-cad-freight-discount.pdf');
  assert.match(q.error, /prints \$195\.00/); assert.match(q.error, /freight, tax or a discount/);
  assert.throws(() => saveReview(id, formFor(id), true), /USD/);
});

test('60-line multipage quote reads every line and rounds packs once', async () => {
  const { id, q } = await load('stress-60-lines-multipage.pdf');
  assert.equal(q.lines.length, 60); assert.equal(q.error, null);
  const c = computeQuote(q, { live: true });
  assert.equal(c.orders[0].requiredPieces, 60); assert.equal(c.orders[0].packs, 6); assert.equal(c.totals.ours, 1080);
  // line-level allocations must reconcile exactly to the purchase schedule
  assert.equal(Math.round(c.rows.reduce((n, r) => n + r.ourTotal, 0) * 100), 108000);
});

test('manual override cannot push an unsafe product through confirmation', async () => {
  const { id, q } = await load('stress-mixed-tape-drivers.pdf');
  const wet = byRef(q)['DI-WET-E'];
  const f = formFor(id);
  f.set(`sku_${wet.id}`, 'AV-T-3000-200'); f.set(`inc_${wet.id}`, 'on');
  assert.throws(() => saveReview(id, f, true), /Wet\/outdoor/);
  const volt = byRef(q)['DI-12V-F'];
  const g = formFor(id); g.set(`sku_${volt.id}`, 'AV-T-3000-200'); g.set(`inc_${volt.id}`, 'on');
  assert.throws(() => saveReview(id, g, true), /Voltage mismatch/);
});

test('full flow: review, confirm, freeze; later catalog edits and stale tabs cannot change it', async () => {
  const { id } = await load('stress-basic-elemental.pdf');
  const before = getQuote(id).revision;
  saveReview(id, formFor(id, { valid_until: '2099-01-01' }), true);
  const done = getQuote(id);
  assert.equal(done.status, 'done'); assert.ok(done.summary_snapshot);
  const frozen = computeQuote(done).totals;
  assert.equal(frozen.theirs, 893.92); assert.equal(frozen.ours, 356); assert.equal(frozen.savings, 537.92);
  replaceCatalog(catalog.map((c) => ({ ...c, pack_price: c.pack_price * 3, unit_price: c.unit_price * 3 })), 'scenario'); // price change after approval
  assert.deepEqual(computeQuote(getQuote(id)).totals, frozen);
  const stale = formFor(id); stale.set('revision', String(before));
  assert.throws(() => saveReview(id, stale), /Someone changed|Reload/);
});

test('tape length working is stored for the customer summary and cleared by any manual change', async () => {
  const { id, q } = await load('stress-basic-elemental.pdf');
  const tape = q.lines.find((l) => l.comp_sku.includes('86.44'));
  assert.match(tape.qty_basis, /4 × 86\.44in = 28\.81 ft.*2 rolls/);
  assert.equal(q.lines.find((l) => l.comp_sku === 'DI-PSU-24V96W-ND').qty_basis, '');
  const f = formFor(id); f.set(`oq_${tape.id}`, '3');                     // reviewer overrides the roll count
  saveReview(id, f);
  assert.equal(getQuote(id).lines.find((l) => l.id === tape.id).qty_basis, '');
});
