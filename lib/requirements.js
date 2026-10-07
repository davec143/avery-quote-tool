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
  if (/\bper\s+(?:foot|ft)\b/i.test(text)) return { feet: 1, raw: 'per foot', perFoot: true };
  if (/\bper\s+(?:meter|metre|m)\b/i.test(text)) return { feet: 3.28084, raw: 'per metre', perFoot: true };
  const found = lengthsIn(text, { skipLeads: true });
  const distinct = [...new Map(found.map((f) => [round(f.feet, 3), f])).values()];
  if (!distinct.length) return { problem: 'no tape length found in the source description.' };
  if (distinct.length > 1) return { problem: `several lengths found (${distinct.map((d) => d.raw).join(', ')}); confirm which is the tape length.` };
  return { feet: distinct[0].feet, raw: distinct[0].raw };
}

/** Roll/reel length of an Avery catalog item, in feet, from its variant, title and specs. */
export function parseRollLength(item) {
  const text = `${item.variant || ''} ${item.title || ''} ${item.specs || ''}`;
  const candidates = [];
  for (const m of text.matchAll(LENGTH)) {
    const near = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
    if (!/\b(?:roll|reel|length|long)\b/i.test(near)) continue;
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
  const rolls = Math.max(1, Math.ceil(totalFt / (rollFt * 1.005) - 1e-9));
  return {
    ok: true, rolls, totalFt, rollFt,
    working: `Length check: ${piece.perFoot ? `${qty} ft` : `${qty} × ${piece.raw}`} = ${fmtFt(totalFt)}; Avery rolls are ${fmtFt(rollFt)}, so ${rolls} roll${rolls === 1 ? '' : 's'} (each source line rounded up on its own).`,
  };
}
