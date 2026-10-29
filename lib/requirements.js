import { sourceText, sourceWatts, driverPoolKey } from './specs.js';
import { productSpecs } from './product-specs.js';
/**
 * Requirement model for length-based products (LED tape).
 * Competitor tape lines are usually cut lengths ("86.44in"); Avery sells fixed-length rolls.
 * These helpers turn "N pieces of length L" into a whole number of Avery rolls, and refuse to
 * guess when a length cannot be read unambiguously.
 */
const FEET_PER = { in: 1 / 12, inch: 1 / 12, inches: 1 / 12, '"': 1 / 12, ft: 1, foot: 1, feet: 1, "'": 1, m: 3.28084, meter: 3.28084, meters: 3.28084, metre: 3.28084, metres: 3.28084, cm: 1 / 30.48 };
const LENGTH = /(?<![\d.,])(\d+(?:,\d{3})*(?:\.\d+)?)\s*-?\s*(inches|inch|in|"|feet|foot|ft|'|meters|meter|metres|metre|cm|m)(?![A-Za-z]|\/(?!\s*(?:spool|reel|roll)))/gi;
// "100 ft spool", "30 m reel", "Spool length: 100 ft": the length of a package of tape, not one continuous run.
const PACKAGE_AFTER = /^\.?\s*\)?\s*(?:\(\s*[\d.,]+\s*(?:ft|feet|foot|m|'|")\.?\s*\)\s*)?[-/]?\s*(?:per\s+|\/\s*)?(?:spool|reel|roll|coil)s?\b/i;
const PACKAGE_BEFORE = /(?:spool|reel|roll|coil)\s*(?:length|size)?\s*[:=,(-]?\s*$/i;
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
    if (skipLeads && (/(?:max(?:imum)?\.?\s*run(?:\s*length)?|cut(?:ting|table|s)?\s*(?:increments?|intervals?|every|at|points?)?(?:\s*of)?|width|height|depth)\s*[:=-]?\s*$/i.test(before) || /^\.?\s*(?:wide|high|tall|deep|max(?:imum)?\.?\s*(?:continuous\s+)?run|cut(?:ting)?\s*(?:increment|interval|point))\b/i.test(after))) continue;
    found.push({ feet: Number(m[1].replaceAll(',','')) * FEET_PER[m[2].toLowerCase()], raw: m[0].replace(/\s*-\s*/, ' '), total:/\btotal(?:\s+(?:length|footage))?\s*[:=-]?\s*$/i.test(before) || /^\s*(?:in\s+)?total\b/i.test(after),
      package: PACKAGE_AFTER.test(after) || PACKAGE_BEFORE.test(before) });
  }
  return found;
}

/** Length of ONE source piece, in feet. Returns { feet, raw } or { problem }. */
export function parseSourceLength(text = '', {quantity} = {}) {
  const found = lengthsIn(text, { skipLeads: true });
  const unique=(values)=>values.reduce((out,f)=>{if(!out.some((x)=>Math.abs(x.feet-f.feet)<=Math.max(x.feet,f.feet)*0.005)) out.push(f);return out;},[]);
  const totals=unique(found.filter((f)=>f.total));
  const distinct = unique(found.filter((f)=>!f.total));
  // "200 lumens per foot" and "3 watts per foot" describe output/load, not the quantity unit.
  const per=[...text.matchAll(/\bper\s+(foot|ft|meter|metre|m)\b/gi)].find((m)=>!/(?:lumens?|lm|watts?|w)\s*$/i.test(text.slice(0,m.index)));
  const perLength=per ? {feet:/^(foot|ft)$/i.test(per[1]) ? 1 : 3.28084,raw:/^(foot|ft)$/i.test(per[1]) ? 'per foot' : 'per metre',perFoot:true,unit:/^(foot|ft)$/i.test(per[1]) ? 'ft' : 'm'} : null;
  if(totals.length>1) return {problem:'conflicting total lengths are printed; verify the source footage.'};
  if(totals.length) {
    if(!(Number.isFinite(quantity) && quantity>0)) return {problem:'total footage is stated; verify the source quantity before calculating lengths.'};
    const totalFt=totals[0].feet, piece=perLength || (distinct.length===1 ? distinct[0] : null);
    if(distinct.length>1 && !perLength) return {problem:'several section lengths accompany the total footage; verify the run lengths.'};
    if(piece && Math.abs(piece.feet*quantity-totalFt)>Math.max(totalFt,piece.feet*quantity)*0.005) return {problem:`source quantity × length does not agree with the stated ${totals[0].raw} total; verify the source footage.`};
    return piece ? {...piece,totalFt} : {feet:totalFt/quantity,raw:`${totals[0].raw} total`,totalFt,totalOnly:true};
  }
  if(perLength) return perLength;
  if (!distinct.length) return { problem: 'no tape length found in the source description.' };
  if (distinct.length > 1) return { problem: `several lengths found (${distinct.map((d) => d.raw).join(', ')}); confirm which is the tape length.` };
  return { feet: distinct[0].feet, raw: distinct[0].raw, package: found.some((f) => f.package && Math.abs(f.feet - distinct[0].feet) <= distinct[0].feet * 0.005) };
}

export const sourceLength=(line)=>parseSourceLength(sourceText(line),{quantity:Number(line.qty)});

/** Roll/reel length of an Avery catalog item, in feet, from its variant, title and specs. */
export function parseRollLength(item) {
  if (Object.hasOwn(item.specification_values || {},'length_ft')) return item.specification_values.length_ft;
  const text = `${item.variant || ''} ${item.title || ''} ${item.specs || ''}`;
  const candidates = [];
  for (const m of text.matchAll(LENGTH)) {
    const near = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
    if (!/\b(?:roll|reel|spool|coil|section|length|long)\b/i.test(near)) continue;
    if (/\b(?:wire|lead|cable|cord)\b/i.test(near) && !/\b(?:roll|reel|spool|coil)\b/i.test(near)) continue;
    candidates.push(Number(m[1].replaceAll(',','')) * FEET_PER[m[2].toLowerCase()]);
  }
  if (!candidates.length) return item.standard_roll_ft || null;
  const min = Math.min(...candidates), max = Math.max(...candidates);
  // "16.4 ft (5 m)" is one length written twice; genuinely different lengths are ambiguous.
  return max / min <= 1.03 ? round(max, 3) : null;
}

/** Whole rolls needed for one tape line. */
export function tapeRolls(line, item) {
  const rollFt = parseRollLength(item);
  const piece = sourceLength(line);
  const qty = Number(line.qty);
  if (!rollFt) {
    const need = !piece.problem && Number.isFinite(qty) && qty > 0 ? ` Their quote needs ${fmtFt(piece.totalFt ?? piece.feet * qty)} in total.` : '';
    return { ok: false, problem: `the roll length of ${item.sku} is not in the catalog specs.${need} Enter the Avery roll count manually.`, sourceFt: need ? (piece.totalFt ?? piece.feet * qty) : null };
  }
  if (piece.problem) return { ok: false, problem: `${piece.problem} Enter the Avery roll count manually.` };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, problem: 'the source quantity is invalid.' };
  // "LED tape 100 FT" × 100 usually means 100 ft ordered by the foot, not 100 runs of 100 ft.
  if (!piece.perFoot && !piece.totalOnly && !piece.package && qty >= 10 && Math.abs(qty - piece.feet) < 1e-6) return { ok: false, problem: `the quantity (${qty}) equals the ${piece.raw} length, so it may already be the footage; verify the source footage. Enter the Avery roll count manually.` };
  const totalFt = piece.feet * qty;
  // A spool or reel is packaged footage: count the total length, not one continuous run per spool.
  if (piece.package) {
    const rolls = Math.max(1, Math.ceil(totalFt / (rollFt * 1.005) - 1e-9));
    return { ok: true, rolls, totalFt, rollFt, review: false,
      note: Math.abs(piece.feet - rollFt) / rollFt > 0.005 ? `Their quote is in ${piece.raw} spools; Avery supplies ${fmtFt(rollFt)} rolls covering the same ${fmtFt(totalFt)}.` : '',
      working: `Length check: ${qty} × ${piece.raw} spool = ${fmtFt(totalFt)}; Avery rolls are ${fmtFt(rollFt)}, so ${rolls} roll${rolls === 1 ? '' : 's'}.` };
  }
  // 0.5% tolerance: competitors quote 5 m (16.404 ft) where the Avery roll is listed as 16.4 ft.
  const overLength = !piece.perFoot && !piece.totalOnly && piece.feet > rollFt * 1.005;
  const cutsPerRoll = Math.floor(rollFt * 1.005 / piece.feet + 1e-9);
  const rolls = piece.perFoot || piece.totalOnly || overLength ? Math.max(1, Math.ceil(totalFt / (rollFt * 1.005) - 1e-9)) : Math.ceil(qty / cutsPerRoll);
  return {
    ok: true, rolls, totalFt, rollFt,
    review: overLength || !!piece.totalOnly,
    note: piece.totalOnly ? 'Only total footage is stated. This is a footage estimate; verify individual run lengths, cuts, joins and feeds before ordering.' : overLength ? 'A source run exceeds one Avery roll. This is a footage estimate requiring a reviewed join, feed and wiring plan; it does not supply an uninterrupted run.' : piece.perFoot ? `Avery supplies fixed ${fmtFt(rollFt)} rolls; the source is priced per ${piece.unit}.` : Math.abs(piece.feet - rollFt) / rollFt > 0.005 ? `Avery supplies ${fmtFt(rollFt)} rolls instead of the quoted ${piece.raw} cuts. Cut to length and allow for the remaining offcuts.` : '',
    working: `Length check: ${piece.totalOnly ? piece.raw : piece.perFoot ? `${qty} ${piece.unit}` : `${qty} × ${piece.raw}`} = ${fmtFt(totalFt)}; Avery rolls are ${fmtFt(rollFt)}, so ${rolls} roll${rolls === 1 ? '' : 's'}${!piece.perFoot && !piece.totalOnly && !overLength ? ` (${cutsPerRoll} continuous cut${cutsPerRoll === 1 ? '' : 's'} per roll)` : ''} (each source line rounded up on its own).`,
  };
}

export function channelSections(line, item) {
  const source = sourceLength(line);
  const knownLength=parseRollLength(item);
  if (!knownLength && Object.hasOwn(item.specification_values || {},'length_ft')) return {ok:false,problem:'Avery section length is explicitly unknown. Enter a reviewed manual section count.'};
  const sectionFt = knownLength || 3.28084; // Team-confirmed Avery format: one-metre sections.
  if (source.problem) return { ok: false, problem: `${source.problem} Enter the channel section count and explain the length assumption.` };
  const totalFt = source.feet * Number(line.qty);
  const pieces = Math.ceil(totalFt / sectionFt - 1e-9);
  return { ok: Number.isFinite(pieces) && pieces > 0, pieces,
    working: `Channel length: ${source.totalOnly ? source.raw : `${line.qty} × ${source.raw}`} = ${fmtFt(totalFt)}; ${pieces} Avery sections of ${fmtFt(sectionFt)} required before rounding to whole bundles.`,
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
      else { l.quantity_problem = r.problem; l.source_feet = r.sourceFt ?? null; }
    } else l.our_qty = Math.ceil(l.qty * (l.fixed_multiplier || 1));
  }
  for (const { item, lines: members } of groups.values()) {
    let totalWatts = members.reduce((sum, l) => sum + l.requirement_watts, 0);
    if (driverBasis === 'tape_load') {
      const group=members[0].group_label?.trim(), v=productSpecs(item).voltage_v;
      const tapes=out.filter((l)=>l.include && catalog[l.our_sku]?.category==='tape' && l.group_label?.trim() === group);
      const competing=[...groups.values()].filter((g)=>g.lines[0].group_label?.trim()===group && productSpecs(g.item).voltage_v === v);
      const loads=tapes.map((l)=>({l,s:productSpecs(catalog[l.our_sku]),length:sourceLength(l)}));
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
