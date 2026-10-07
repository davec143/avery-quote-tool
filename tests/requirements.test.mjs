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

const { passwordMatches, loginBlocked, recordLoginFailure, clearLoginFailures } = await import('../lib/login-guard.js');
test('password comparison and login throttle', () => {
  assert.equal(passwordMatches('correct horse', 'correct horse'), true);
  assert.equal(passwordMatches('correct horse ', 'correct horse'), false);
  assert.equal(passwordMatches('anything', ''), false);
  assert.equal(passwordMatches('anything', undefined), false);
  const t = 1_000_000;
  for (let i = 0; i < 8; i++) { assert.equal(loginBlocked('ip', t + i), false); recordLoginFailure('ip', t + i); }
  assert.equal(loginBlocked('ip', t + 100), true);
  assert.equal(loginBlocked('ip', t + 16 * 60 * 1000), false);
  recordLoginFailure('other', t); clearLoginFailures('other'); assert.equal(loginBlocked('other', t), false);
});
