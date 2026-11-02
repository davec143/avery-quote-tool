import test from 'node:test';
import assert from 'node:assert/strict';
const { parseSourceLength, parseRollLength, tapeRolls } = await import('../lib/requirements.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≉ ${b}`);

test('source length ignores wire leads, brightness, wattage and tape width', () => {
  const d = 'STREAMLITE 200 Wet Location 2700K, 24V, 86.44in, White 36in Wire (20AWG), IP65, 15.8 Watt(s) 200 lm/ft 10mm';
  const r = parseSourceLength(d);
  near(r.feet, 86.44 / 12);
});
test('ambiguous or missing source lengths are refused, not guessed', () => {
  assert.ok(parseSourceLength('Tape 24V 3000K 5ft or 10ft options').problem);
  assert.ok(parseSourceLength('Tape 24V 3000K 200 lm/ft').problem);
});
test('metres, feet and per-foot sources convert to feet', () => {
  near(parseSourceLength('Tape 5m reel').feet, 16.4042);
  near(parseSourceLength('Tape 12 ft').feet, 12);
  assert.equal(parseSourceLength('Tape priced per foot').perFoot, true);
});
test('roll length is read from catalog text; conflicting lengths are refused', () => {
  near(parseRollLength({ variant: 'Case (10 pcs)', title: 'COB Tape', specs: 'Roll length: 16.4 ft (5 m). Width 10mm' }), 16.4);
  assert.equal(parseRollLength({ title: 'COB Tape', specs: 'Roll length 16.4 ft; reel length 32.8 ft' }), null);
  assert.equal(parseRollLength({ title: 'COB Tape', specs: 'IP20, 10mm' }), null);
});
test('tape rolls round up per line, with visible working', () => {
  const item = { sku: 'T1', title: 'COB Tape', specs: 'Roll length: 16.4 ft' };
  const r = tapeRolls({ qty: 4, comp_desc: 'Tape 24V 86.44in White 36in Wire' }, item);
  assert.equal(r.ok, true); assert.equal(r.rolls, 2); assert.match(r.working, /4 × 86\.44in/);
  assert.equal(tapeRolls({ qty: 1, comp_desc: 'Tape 24V 77.5in' }, item).rolls, 1);
  assert.equal(tapeRolls({ qty: 1, comp_desc: 'Tape 24V 196in' }, item).rolls, 1);
  assert.equal(tapeRolls({ qty: 2, comp_desc: 'Tape 24V 5m' }, item).rolls, 2); // 2 × 5 m = 16.404 ft each: metric rounding must not add a roll
  assert.equal(tapeRolls({ qty: 1, comp_desc: 'Tape 24V 200in' }, item).rolls, 2);
});
test('missing roll length or source length falls back to manual entry', () => {
  assert.equal(tapeRolls({ qty: 1, comp_desc: 'Tape 24V 5ft' }, { sku: 'T', title: 'Tape', specs: '' }).ok, false);
  assert.equal(tapeRolls({ qty: 1, comp_desc: 'Tape 24V' }, { sku: 'T', title: 'Tape', specs: 'Roll length: 16.4 ft' }).ok, false);
});

const { printedTotal, reconcileTotal } = await import('../lib/extract.js');
test('extracted lines are reconciled against the printed quote total', () => {
  const text = 'Subtotal: $100.00\nQuote Total: $1,234.56';
  assert.equal(printedTotal(text), 1234.56);
  assert.equal(printedTotal('no totals here'), null);
  const lines = [{ qty: 2, unit_price: 500 }, { qty: 1, unit_price: 234.56 }];
  assert.equal(reconcileTotal(text, lines), null);
  assert.match(reconcileTotal(text, lines.slice(0, 1)), /\$1,000\.00 but the source quote prints \$1,234\.56/);
  assert.equal(reconcileTotal('no totals', lines), null);
});


test('length parsing separates source sections, stated totals and output per length',async()=>{
  const {sourceLength,channelSections}=await import('../lib/requirements.js');
  assert.equal(parseSourceLength('8ft tape, 200 lumens per foot, 3 watts per foot').feet,8);
  near(parseSourceLength('5m (16.4ft) tape, maximum run 32ft, cut increment 2in').feet,16.4042);
  const line={qty:10,comp_desc:'8ft recessed aluminum channel; total footage: 80ft'};
  assert.equal(sourceLength(line).feet,8);assert.equal(sourceLength(line).totalFt,80);
  assert.equal(channelSections(line,{sku:'C',specs:'Section length 1m'}).pieces,25);
  assert.match(sourceLength({...line,qty:8}).problem,/does not agree/);
  assert.match(sourceLength({...line,comp_desc:'Total 80ft; total 90ft'}).problem,/conflicting/);
  const total=sourceLength({qty:10,comp_desc:'Total length: 1,200ft'});assert.equal(total.totalFt,1200);assert.equal(total.totalOnly,true);
  assert.equal(tapeRolls({qty:10,comp_desc:'Total length: 80ft'},{sku:'T',specs:'Roll length 16.4ft'}).rolls,5);
  assert.equal(tapeRolls({qty:10,comp_desc:'Total length: 80ft'},{sku:'T',specs:'Roll length 16.4ft'}).review,true);
  assert.equal(parseRollLength({specs:'Reel length 1,000ft'}),1000);
});

// Field report: "quote tool misread on 100 foot spools".
test('spools and reels are packaged footage, not one continuous run', async () => {
  const { parseSourceLength, tapeRolls, parseRollLength } = await import('../lib/requirements.js');
  const avery = { sku: 'AV', category: 'tape', variant: '16.4 ft roll', title: 'Tape', specs: '', specification_values: { length_ft: 16.4, max_run_ft: 32.8 } };
  for (const text of ['VALENT MINI 500 10mm LED Tape Light, 24V, 3500K, 100 ft. Spool', 'Tape 24V 100ft spool', "Tape 24V 100' spool", 'Tape 24V, 100 Foot Spool',
    'Tape 24V - 100FT SPOOL', 'Tape 24V, 100-ft spool', 'Tape 24V, 100 ft/spool', 'Tape 24V, 100 ft per spool', 'Tape 24V, Spool length: 100ft',
    'Tape 24V 100 ft. Spool, 16.4ft max run', 'Tape 24V, 100ft. spool, cut every 2in', 'Tape 24V 4.4W/ft 100 ft. Spool 36in lead']) {
    const p = parseSourceLength(text, { quantity: 2 });
    assert.equal(p.feet, 100, text); assert.equal(p.package, true, text);
    const r = tapeRolls({ comp_desc: text, comp_sku: 'X', qty: 2 }, avery);
    assert.equal(r.rolls, 13, text); assert.equal(r.review, false, text); assert.match(r.working, /200 ft/);
  }
  assert.equal(parseSourceLength('Tape 24V, 30.5m (100ft) reel').package, true);
  assert.equal(tapeRolls({ comp_desc: 'Tape 16.4 ft. Spool', comp_sku: 'X', qty: 4 }, avery).rolls, 4);
  // A run longer than a roll is still a run (needs a join plan).
  assert.equal(tapeRolls({ comp_desc: 'Tape 24V, 200in run', comp_sku: 'X', qty: 3 }, avery).review, true);
  // Avery spool listings are read as roll lengths.
  assert.equal(parseRollLength({ variant: '100 ft spool', title: 'Tape', specs: '' }), 100);
  // Unknown Avery roll length: say how much footage is needed instead of guessing.
  const unknown = tapeRolls({ comp_desc: 'Tape 100 ft spool', comp_sku: 'X', qty: 2 }, { sku: 'AV2', variant: 'Case (10 pcs)', title: 'COB tape' });
  assert.equal(unknown.ok, false); assert.match(unknown.problem, /needs 200 ft in total/);
  // "100 FT" × 100 is probably 100 ft by the foot: ask instead of ordering 607 rolls.
  assert.match(tapeRolls({ comp_desc: 'LED Tape 24V 100 FT', comp_sku: 'X', qty: 100 }, avery).problem, /may already be the footage/);
});

test('a line whose quantity cannot be calculated is not priced on the draft', async () => {
  const { calculateComparison } = await import('../lib/comparison.js');
  const tape = { sku: 'AV2', category: 'tape', title: 'COB tape', variant: 'Case (10 pcs)', pack_qty: 10, pack_price: 319 };
  const q = { lines: [{ id: 1, line_ref: '1', qty: 2, comp_unit_price: 50, our_sku: 'AV2', our_qty: 2, include: 1, quantity_mode: 'auto', quantity_problem: 'the roll length of AV2 is not in the catalog specs.' }] };
  const c = calculateComparison(q, { AV2: tape }, 'pack');
  assert.equal(c.rows[0].state, 'needs_qty'); assert.equal(c.summaryRows.length, 0);
  const manual = calculateComparison({ lines: [{ ...q.lines[0], quantity_mode: 'manual', our_qty: 13 }] }, { AV2: tape }, 'pack');
  assert.equal(manual.rows[0].state, 'ok'); assert.equal(manual.summaryRows[0].ourQty, 13);
});

test('a standard Avery roll length from Settings fills in when a tape SKU has none', async () => {
  const { tapeRolls, parseRollLength } = await import('../lib/requirements.js');
  const cob = { sku: 'AV-COB', category: 'tape', variant: 'Case (10 pcs) / 500L', title: 'COB Tape Light', specs: '' };
  assert.equal(parseRollLength(cob), null);
  assert.equal(parseRollLength({ ...cob, standard_roll_ft: 16.4 }), 16.4);
  assert.equal(tapeRolls({ comp_desc: 'Tape 24V 100 ft. Spool', comp_sku: 'X', qty: 2 }, { ...cob, standard_roll_ft: 16.4 }).rolls, 13);
  // A verified per-SKU length still wins.
  assert.equal(parseRollLength({ ...cob, standard_roll_ft: 16.4, specification_values: { length_ft: 32.8 } }), 32.8);
});

// Field feedback: "pull total feet and then give our closest option, but go over, not under total footage on a job".
test('tape is sized on total job footage, rounded up once, never under', async () => {
  const { planQuantities, packTapeJob } = await import('../lib/requirements.js');
  const catalog = { AV: { sku: 'AV', category: 'tape', title: 'Tape', variant: '', specs: '', specification_values: { length_ft: 16.4 } } };
  const line = (id, desc, qty) => ({ id, comp_sku: 'S' + id, comp_desc: desc, qty, our_sku: 'AV', include: 1, quantity_mode: 'auto' });
  // Two 100 ft spools + one 50 ft reel of the same tape = 250 ft → 16 rolls (262.4 ft), not 7 + 7 + 4 = 18.
  let out = planQuantities([line(1, 'Tape 24V 100 ft. Spool', 1), line(2, 'Tape 24V 100 ft. Spool', 1), line(3, 'Tape 24V 50 ft reel', 1)], catalog);
  assert.equal(out.reduce((n, l) => n + l.our_qty, 0), 16);
  assert.ok(16 * 16.4 >= 250);
  assert.match(out[0].qty_basis, /250 ft across 3 lines/);
  // Three 5 ft cuts fit on one roll; each line used to round up to its own roll.
  out = planQuantities([line(1, 'Tape 24V 5ft run', 1), line(2, 'Tape 24V 5ft run', 1), line(3, 'Tape 24V 5ft run', 1)], catalog);
  assert.equal(out.reduce((n, l) => n + l.our_qty, 0), 1);
  // Continuous cuts never span rolls: two 10 ft runs need 2 rolls even though 20 ft < 32.8 ft.
  out = planQuantities([line(1, 'Tape 24V 10ft run', 2)], catalog);
  assert.equal(out[0].our_qty, 2);
  // Spool footage fills the space left on rolls opened for cuts: 2 × 10 ft cuts leave 12.8 ft; 10 ft of spool fits there.
  out = planQuantities([line(1, 'Tape 24V 10ft run', 2), line(2, 'Tape 24V priced per foot', 10)], catalog);
  assert.equal(out.reduce((n, l) => n + l.our_qty, 0), 2);
  // Excluded lines don't join the job total.
  out = planQuantities([line(1, 'Tape 24V 100 ft. Spool', 1), { ...line(2, 'Tape 24V 100 ft. Spool', 1), include: 0 }], catalog);
  assert.equal(out[0].our_qty, 7); assert.equal(out[1].our_qty, 7);
  // Never under: random jobs always supply at least the job footage.
  for (let i = 0; i < 300; i++) {
    const entries = Array.from({ length: 1 + (i % 6) }, (_, k) => { const feet = 1 + ((i * 7 + k * 13) % 97) / 3, qty = 1 + ((i + k) % 4), cut = feet <= 16.4 && (i + k) % 2 === 0; return { qty, r: { cut, pieceFeet: feet, totalFt: feet * qty } }; });
    const { rolls, totalFt } = packTapeJob(16.4, entries);
    assert.ok(rolls * 16.4 * 1.005 + 1e-6 >= totalFt, `job ${i}`);
    assert.ok(rolls <= entries.reduce((n, e) => n + (e.r.cut ? e.qty : Math.ceil(e.r.totalFt / (16.4 * 1.005))), 0), `job ${i} not worse than per-line`);
  }
});

test('pooled tape cost follows footage, including lines allocated zero rolls', async () => {
  const { calculateComparison } = await import('../lib/comparison.js');
  const { planQuantities } = await import('../lib/requirements.js');
  const item = { sku: 'AV', category: 'tape', title: 'Tape', variant: '', specs: '', pack_qty: 1, pack_price: 40, specification_values: { length_ft: 16.4 } };
  const lines = planQuantities([1, 2, 3].map((id) => ({ id, line_ref: String(id), comp_sku: 'S' + id, comp_desc: 'Tape 24V 5ft run', qty: 1, comp_unit_price: 20, our_sku: 'AV', include: 1, quantity_mode: 'auto' })), { AV: item });
  const c = calculateComparison({ lines }, { AV: item }, 'pack');
  assert.equal(c.summaryRows.length, 3); assert.equal(c.orders[0].packs, 1);
  assert.deepEqual(c.summaryRows.map((r) => r.ourTotal), [13.34, 13.33, 13.33]);
});
