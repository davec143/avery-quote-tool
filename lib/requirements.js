import { sourceText, sourceWatts, driverPoolKey } from './specs.js';
import { productSpecs } from './product-specs.js';
/**
 * Requirement model for length-based products (LED tape).
 * Competitor tape lines are usually cut lengths ("86.44in"); Avery sells fixed-length rolls.
 * These helpers turn "N pieces of length L" into a whole number of Avery rolls, and refuse to
 * guess when a length cannot be read unambiguously.
 */
const FEET_PER = { in: 1 / 12, inch: 1 / 12, inches: 1 / 12, '"': 1 / 12, ft: 1, foot: 1, feet: 1, "'": 1, m: 3.28084, meter: 3.28084, meters: 3.28084, metre: 3.28084, metres: 3.28084, cm: 1 / 30.48 };
const LENGTH = /(\d+(?:\.\d+)?)\s*(inches|inch|in|"|feet|foot|ft|'|meters|meter|metres|metre|cm|m)(?![A-Za-z/])/gi;
// A length followed or preceded by these words is a wire lead / cable, not the tape itself.
const LEAD_AFTER = /^\s*(?:long\s+)?(?:wire|wires|lead|leads|leader|cable|cord|pigtail|jumper|power\s+cord)/i;
const LEAD_BEFORE = /(?:wire|lead|leads|cable|cord|pigtail)\s*(?:length)?\s*[:=-]?\s*$/i;

const round = (n, p = 4) => Math.round(n * 10 ** p) / 10 ** p;
const fmtFt = (n) => `${round(n, 2)} ft`;

function lengthsIn(text, { skipLeads }) {
  const found = [];
  for (const m of text.matchAll(LENGTH)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 24);
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    if (skipLeads && (LEAD_AFTER.test(after) || LEAD_BEFORE.test(before))) continue;
    found.push({ feet: Number(m[1]) * FEET_PER[m[2].toLowerCase()], raw: m[0] });
  }
  return found;
}

/** Length of ONE source piece, in feet. Returns { feet, raw } or { problem }. */
export function parseSourceLength(text = '') {
  if (/\bper\s+(?:foot|ft)\b/i.test(text)) return { feet: 1, raw: 'per foot', perFoot: true, unit: 'ft' };
  if (/\bper\s+(?:meter|metre|m)\b/i.test(text)) return { feet: 3.28084, raw: 'per metre', perFoot: true, unit: 'm' };
  const found = lengthsIn(text, { skipLeads: true });
  const distinct = [...new Map(found.map((f) => [round(f.feet, 3), f])).values()];
  if (!distinct.length) return { problem: 'no tape length found in the source description.' };
  if (distinct.length > 1) return { problem: `several lengths found (${distinct.map((d) => d.raw).join(', ')}); confirm which is the tape length.` };
  return { feet: distinct[0].feet, raw: distinct[0].raw };
}

/** Roll/reel length of an Avery catalog item, in feet, from its variant, title and specs. */
export function parseRollLength(item) {
  if (Object.hasOwn(item.specification_values || {},'length_ft')) return item.specification_values.length_ft;
  const text = `${item.variant || ''} ${item.title || ''} ${item.specs || ''}`;
  const candidates = [];
  for (const m of text.matchAll(LENGTH)) {
    const near = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
    if (!/\b(?:roll|reel|section|length|long)\b/i.test(near)) continue;
    if (/\b(?:wire|lead|cable|cord)\b/i.test(near) && !/\b(?:roll|reel)\b/i.test(near)) continue;
    candidates.push(Number(m[1]) * FEET_PER[m[2].toLowerCase()]);
  }
  if (!candidates.length) return null;
  const min = Math.min(...candidates), max = Math.max(...candidates);
  // "16.4 ft (5 m)" is one length written twice; genuinely different lengths are ambiguous.
  return max / min <= 1.03 ? round(max, 3) : null;
}

/** Whole rolls needed for one tape line. */
export function tapeRolls(line, item) {
  const rollFt = parseRollLength(item);
  if (!rollFt) return { ok: false, problem: `the roll length of ${item.sku} is not in the catalog specs. Enter the Avery roll count manually.` };
  const piece = parseSourceLength(`${line.comp_desc || ''} ${line.comp_sku || ''}`);
  if (piece.problem) return { ok: false, problem: `${piece.problem} Enter the Avery roll count manually.` };
  const qty = Number(line.qty);
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, problem: 'the source quantity is invalid.' };
  const totalFt = piece.feet * qty;
  // 0.5% tolerance: competitors quote 5 m (16.404 ft) where the Avery roll is listed as 16.4 ft.
  const overLength = !piece.perFoot && piece.feet > rollFt * 1.005;
  const cutsPerRoll = Math.floor(rollFt * 1.005 / piece.feet + 1e-9);
  const rolls = piece.perFoot || overLength ? Math.max(1, Math.ceil(totalFt / (rollFt * 1.005) - 1e-9)) : Math.ceil(qty / cutsPerRoll);
  return {
    ok: true, rolls, totalFt, rollFt,
    review: overLength,
    note: overLength ? 'A source run exceeds one Avery roll. This is a footage estimate requiring a reviewed join, feed and wiring plan; it does not supply an uninterrupted run.' : piece.perFoot ? `Avery supplies fixed ${fmtFt(rollFt)} rolls; the source is priced per ${piece.unit}.` : Math.abs(piece.feet - rollFt) / rollFt > 0.005 ? `Avery supplies ${fmtFt(rollFt)} rolls instead of the quoted ${piece.raw} cuts. Cut to length and allow for the remaining offcuts.` : '',
    working: `Length check: ${piece.perFoot ? `${qty} ${piece.unit}` : `${qty} × ${piece.raw}`} = ${fmtFt(totalFt)}; Avery rolls are ${fmtFt(rollFt)}, so ${rolls} roll${rolls === 1 ? '' : 's'}${!piece.perFoot && !overLength ? ` (${cutsPerRoll} continuous cut${cutsPerRoll === 1 ? '' : 's'} per roll)` : ''} (each source line rounded up on its own).`,
  };
}

export function channelSections(line, item) {
  const source = parseSourceLength(sourceText(line));
  const knownLength=parseRollLength(item);
  if (!knownLength && Object.hasOwn(item.specification_values || {},'length_ft')) return {ok:false,problem:'Avery section length is explicitly unknown. Enter a reviewed manual section count.'};
  const sectionFt = knownLength || 3.28084; // Team-confirmed Avery format: one-metre sections.
  if (source.problem) return { ok: false, problem: `${source.problem} Enter the channel section count and explain the length assumption.` };
  const totalFt = source.feet * Number(line.qty);
  const pieces = Math.ceil(totalFt / sectionFt - 1e-9);
  return { ok: Number.isFinite(pieces) && pieces > 0, pieces,
    working: `Channel length: ${line.qty} × ${source.raw} = ${fmtFt(totalFt)}; ${pieces} Avery sections of ${fmtFt(sectionFt)} required before rounding to whole bundles.`,
    note: `Avery channel uses ${fmtFt(sectionFt)} (${Math.abs(sectionFt - 3.28084) < 0.01 ? 'one-metre' : `${round(sectionFt / 3.28084, 2)} m`}) sections instead of the quoted ${source.raw}. Longer runs require joined sections; confirm profile, fit, joints and cutting waste.` };
}

/** Rebuild quantities whenever source requirements or selected products change. */
export function planQuantities(lines, catalog, {driverBasis='source',headroom=null} = {}) {
  const out = lines.map((line) => ({ ...line, requirement_watts: null, qty_basis: '', quantity_problem: '', quantity_note: '', quantity_review: false }));
  const groups = new Map();
  for (const l of out) {
    const item = catalog[l.our_sku];
    if (!item) continue;
    if (l.quantity_mode === 'manual') {
      l.qty_basis = `Manual quantity: ${l.our_qty} Avery pieces. ${l.customer_note || 'A reviewed quantity explanation is required.'}`;
      l.quantity_review = true;
      continue;
    }
    if (item.category === 'driver') {
      const watts = sourceWatts(l);
      if (!watts || !item.watts) { l.quantity_problem = 'Driver wattage is unknown. Enter a reviewed manual quantity.'; continue; }
      l.requirement_watts = watts * l.qty;
      if (l.include) {
        const key = driverPoolKey(l, item);
        if (!groups.has(key)) groups.set(key, { item, lines: [] });
        groups.get(key).lines.push(l);
      } else {
        l.our_qty = Math.ceil(l.requirement_watts / item.watts);
        l.qty_basis = `${l.qty} × ${watts}W = ${l.requirement_watts}W; ${l.our_qty} × ${item.watts}W Avery drivers (excluded from job pooling).`;
      }
    } else if (item.category === 'tape' || item.category === 'channel') {
      const r = item.category === 'tape' ? tapeRolls(l, item) : channelSections(l, item);
      if (r.ok) { l.our_qty = r.rolls ?? r.pieces; l.qty_basis = r.working; l.quantity_note = r.note || ''; l.quantity_review = !!r.review; }
      else l.quantity_problem = r.problem;
    } else l.our_qty = Math.ceil(l.qty * (l.fixed_multiplier || 1));
  }
  for (const { item, lines: members } of groups.values()) {
    let totalWatts = members.reduce((sum, l) => sum + l.requirement_watts, 0);
    if (driverBasis === 'tape_load') {
      const group=members[0].group_label?.trim(), v=productSpecs(item).voltage_v;
      const tapes=out.filter((l)=>l.include && catalog[l.our_sku]?.category==='tape' && l.group_label?.trim() === group);
      const competing=[...groups.values()].filter((g)=>g.lines[0].group_label?.trim()===group && productSpecs(g.item).voltage_v === v);
      const loads=tapes.map((l)=>({l,s:productSpecs(catalog[l.our_sku]),length:parseSourceLength(sourceText(l))}));
      if (!group || !v || headroom == null || !tapes.length || competing.length !== 1 || loads.some(({s,length})=>!s.watts_ft || s.voltage_v !== v || length.problem)) {
        for (const l of members) { l.quantity_problem='Tape-load sizing needs one driver option per explicit circuit group, known matching voltages, tape length/power and a reviewed headroom percentage. Correct the inputs or use a documented manual quantity.'; l.qty_basis='Tape-load sizing unresolved.'; }
        continue;
      }
      totalWatts=loads.reduce((n,{l,s,length})=>n+length.feet*l.qty*s.watts_ft,0)*(1+Number(headroom)/100);
    }
    const count = Math.ceil(totalWatts / item.watts - 1e-9);
    const weightTotal=members.reduce((n,l)=>n+l.requirement_watts,0);
    const shares = members.map((l) => ({ l, exact: count * l.requirement_watts / weightTotal, n: Math.floor(count * l.requirement_watts / weightTotal) }));
    let rest = count - shares.reduce((sum, s) => sum + s.n, 0);
    for (const s of [...shares].sort((a, b) => (b.exact - b.n) - (a.exact - a.n))) if (rest-- > 0) s.n++;
    for (const { l, n } of shares) {
      l.our_qty = n;
      l.quantity_review = driverBasis === 'tape_load' || count !== members.reduce((sum, row) => sum + row.qty, 0) || members.some((row) => sourceWatts(row) !== item.watts);
      l.qty_basis = `Job capacity estimate: ${round(totalWatts,2)}W ${driverBasis === 'tape_load' ? `selected tape load including ${headroom}% headroom` : 'quoted in this driver group'} → ${count} × ${item.watts}W = ${count * item.watts}W Avery capacity. ${n} driver(s) allocated to this line; shared purchase cost follows quoted watts.`;
      l.quantity_note = l.quantity_review ? `${driverBasis === 'tape_load' ? 'Calculated load and available capacity are comparison estimates, not a circuit design.' : 'Total rated wattage is a comparison basis, not a circuit design.'} Confirm connected loads, headroom, circuit distribution, AC input and dimming; consolidation or splitting requires a reviewed wiring plan.` : '';
    }
  }
  return out;
}
