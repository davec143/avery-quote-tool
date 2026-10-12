import { complete, parseJson, aiEnabled } from './llm.js';
import { listCatalog } from './catalog.js';
import { listCompat, lookupCompat } from './compat.js';
import { assessMatch } from './match-safety.js';
import { productSpecs } from './product-specs.js';

import { kindFromText, brightness, outputTarget, catalogBrightness, channelProfile, sourceWatts, voltage, itemText } from './specs.js';
export const lineKind = kindFromText;

const NOT_CARRIED = { channel_accessory: 'channel accessory', fixture: 'pre-built fixture', control: 'lighting control', unknown: 'unrecognised item' };

/**
 * Built-in rules matcher (no AI). Deliberately conservative: picks the obvious Avery equivalent
 * by type, colour temperature, brightness and wattage, and marks everything else N/A.
 */
export function ruleMatch(line, catalog, { prefer = 'case' } = {}) {
  const kind = lineKind(line.comp_desc, line.comp_sku);
  if (NOT_CARRIED[kind]) return { sku: null, confidence: 'high', reason: `Avery doesn't carry this (${NOT_CARRIED[kind]}).` };
  const desc = `${line.comp_desc} ${line.comp_sku}`;
  const preferPack = (items) => {
    const want = prefer === 'box' ? /box/i : /case/i;
    return items.find((i) => want.test(i.pack_label)) || items[0];
  };

  if (kind === 'tape') {
    const tapes = catalog.filter((c) => c.category === 'tape' && !assessMatch(line,c).blockers.length);
    if (!tapes.length) {
      const first = catalog.find((c) => c.category === 'tape');
      return { sku:null, confidence:'low', reason:first ? assessMatch(line,first).blockers.join(' ') : 'No tape products are loaded in the catalog.' };
    }
    if (/rgbw/i.test(desc)) {
      const m = preferPack(tapes.filter((c) => c.cct === 'RGBW'));
      return m ? { sku: m.sku, confidence: 'medium', reason: 'RGBW tape → Avery RGBW COB tape. Check controller/channel count.' } : { sku: null, confidence: 'medium', reason: 'No RGBW tape in catalog.' };
    }
    if (/\b(red|green|blue|amber)\b/i.test(desc) && !/\d{4}K/i.test(desc)) {
      return { sku: null, confidence: 'medium', reason: 'Single-colour (coloured) tape — Avery only stocks white and RGBW.' };
    }
    const k = (desc.match(/(\d{4})K/i) || desc.match(/-(\d{2})K-/) || desc.match(/-(\d{2})-0\d\d/) || [])[1];
    let cct = k ? (k.length === 2 ? `${k}00K` : `${k}K`) : null;
    const available = [...new Set(tapes.map((t) => t.cct).filter((c) => c && c !== 'RGBW'))];
    let note = '';
    if (cct && !available.includes(cct)) {
      const nearest = available.sort((a, b) => Math.abs(parseInt(a) - parseInt(cct)) - Math.abs(parseInt(b) - parseInt(cct)))[0];
      note += ` Their ${cct} not stocked; closest is ${nearest}.`;
      cct = nearest;
    }
    const output = brightness(desc);
    const lm = output.value;
    const cls = outputTarget(lm || 200);
    if (!cls) return { sku: null, confidence: 'high', reason: 'Source output is 700 lm/ft or above; outside the Avery crossover range.' };
    // Only COB comes in 2700K; otherwise prefer SMD.
    let pool = tapes.filter((t) => t.cct === cct && catalogBrightness(t) === cls);
    const smd = pool.filter((t) => /smd/i.test(t.title));
    if (smd.length) pool = smd;
    if (!pool.length) pool = tapes.filter((t) => t.cct === cct && catalogBrightness(t) >= 200 && catalogBrightness(t) <= 500).sort((a,b) => Math.abs(catalogBrightness(a) - cls) - Math.abs(catalogBrightness(b) - cls));
    const m = preferPack(pool);
    if (!m) return { sku: null, confidence: 'low', reason: `No Avery ${cct || ''} tape in the crossover range found.` };
    let conf = note ? 'low' : 'medium';
    if (!lm) { note += ' Brightness is not stated; proposed a 200 lm/ft alternative. Confirm with the datasheet.'; conf = 'low'; }
    if (/wet|ip6\d/i.test(desc) && !/ip6\d/i.test(m.ip_rating || '')) {
      note += ' Theirs is wet-rated (IP65); Avery tape is IP20 — not for outdoor/wet use.';
      conf = 'low';
    }
    return { sku: m.sku, confidence: conf, reason: `${cct || 'White'} tape, ~${lm || 100} lm/ft → Avery ${cls} lm/ft.${note}`.trim() };
  }

  if (kind === 'channel') {
    const profile = channelProfile(desc);
    const pool = catalog.filter((c) => c.category === 'channel' && (!profile || !productSpecs(c).profile || productSpecs(c).profile === profile));
    const m = pool.find((c) => profile && productSpecs(c).profile === profile) || pool[0];
    return m ? { sku: m.sku, confidence: profile ? 'medium' : 'low', reason: 'Channel crossover by profile and total required length; Avery sections are rounded to whole bundles. Confirm profile dimensions and joined sections.' } : { sku: null, confidence: 'low', reason: 'No matching channel profile is loaded in the catalog.' };
  }

  if (kind === 'driver') {
    const w = sourceWatts(line);
    const dimmable = /dimm/i.test(desc) && !/non[ -]?dimm/i.test(desc);
    const target = w && w <= 60 ? 60 : 100;
    const pool = catalog.filter((c) => c.category === 'driver' && c.watts === target && (!dimmable || c.dimmable === 1) && (!voltage(desc) || !productSpecs(c).voltage_v || voltage(desc) === productSpecs(c).voltage_v));
    const m = preferPack(pool);
    return m ? { sku: m.sku, confidence: w ? 'medium' : 'low', reason: `${w || 'Unknown'}W source drivers → Avery ${target}W option; count is based on total rated watts, with a reviewed circuit plan required for consolidation or splitting.` }
      : { sku: null, confidence: 'low', reason: `No Avery ${target}W driver meeting the dimming requirement is loaded.` };
  }

  if (kind === 'connector') {
    const toWire = /wire/i.test(desc);
    const m = catalog.find((c) => c.category === 'connector' && (!/terminal block/i.test(desc) || /terminal block/i.test(c.title)) && (toWire ? /wire/i.test(c.title) : /strip to strip|board to board/i.test(c.title))) || catalog.find((c) => c.category === 'connector' && /terminal block/i.test(c.title));
    if (!m) return { sku: null, confidence: 'medium', reason: 'No matching connector.' };
    let reason = `${toWire ? 'Tape-to-wire' : 'Tape-to-tape'} connector → Avery ${m.title}.`;
    if (/8mm|12mm/i.test(desc)) reason += ` Theirs is ${desc.match(/(8|12)mm/i)[0]}; Avery fits 10mm tape.`;
    return { sku: m.sku, confidence: 'low', reason };
  }
  return { sku: null, confidence: 'low', reason: 'Not sure what this is.' };
}

const MATCH_SYSTEM = `You are a lighting product specialist at Avery LED. For each competitor quote line, choose the closest
Avery LED substitute from the catalog provided, or say it is not carried.
Rules:
- Only use SKUs that appear in the catalog. Never invent a SKU.
- Same product type only: tape for tape, driver/power supply for driver, connector for connector.
- Tape: match colour temperature (CCT) first, then brightness (competitor series names like STREAMLITE 200 /
  VALENT MINI 300 roughly equal lumens per foot), then voltage. RGBW only matches RGBW. Coloured tape (red, blue…)
  only matches coloured tape.
- Drivers: voltage and dimming must match. Source drivers up to 60W use Avery 60W, above 60W use Avery 100W. Multiple drivers or consolidated circuits are potential system alternatives; quantities are computed deterministically from total watts.
- Tape widths >=8mm may cross to Avery 10mm with fit disclosure. Widths <=6mm are excluded. Output is normalized to lm/ft: propose 200, 300 or 500; 100 may use 200, 600 may use 500; >=700 is excluded.
- Channels: match profile, not section length. Avery one-metre sections are counted from total length and rounded into bundles.
- Terminal blocks can change width ONLY conditionally with corresponding selected Avery tape.
- Channel accessories, pre-built fixtures, controllers and anything Avery doesn't sell: sku = null (N/A).
- Prefer the "Case" pack unless told otherwise.
- units_per_line_item: use 1 unless a documented roll-length conversion is known. Driver and channel quantities are recomputed from requirements. Unknown lengths need review.
- confidence: "high" = same spec, "medium" = close substitute, "low" = spec gap the rep must check
  (e.g. wet-rated vs IP20, wattage short, different connector size). Put the gap in reason, plainly, in one sentence.
Return ONLY JSON: {"matches":[{"id": number, "sku": string|null, "units_per_line_item": number, "confidence": "high"|"medium"|"low", "reason": string}]}`;

function catalogForPrompt(catalog) {
  return catalog.map((c) => ({
    sku: c.sku,
    title: c.title,
    variant: c.variant,
    type: c.category,
    pack: `${c.pack_label} (${c.pack_qty} pcs)`,
    price_per_piece: c.unit_price,
    cct: c.cct,
    output: c.output_class,
    watts: c.watts,
    dimmable: c.dimmable === 1 ? 'yes' : c.dimmable === 0 ? 'no' : 'n/a',
    ip: c.ip_rating,
    product_specs: productSpecs(c),
    specs: c.specs?.slice(0, 400),
  }));
}

export async function aiMatch(lines, catalog) {
  if (!lines.length) return {};
  const reply = await complete({
    system: MATCH_SYSTEM,
    user:
      `AVERY CATALOG:\n${JSON.stringify(catalogForPrompt(catalog))}\n\n` +
      `COMPETITOR LINES:\n${JSON.stringify(lines.map((l) => ({ id: l.id, sku: l.comp_sku, description: l.comp_desc, qty: l.qty })))}`,
    maxTokens: 6000,
  });
  const j = parseJson(reply);
  const valid = new Set(catalog.map((c) => c.sku));
  const out = {};
  if (!Array.isArray(j.matches)) throw new Error('AI reply had no matches array.');
  const ids = new Set(lines.map((l) => l.id));
  for (const m of j.matches) {
    if (!m || !ids.has(m.id) || out[m.id]) continue;
    const sku = m.sku && valid.has(m.sku) ? m.sku : null;
    out[m.id] = {
      sku,
      multiplier: Number.isFinite(Number(m.units_per_line_item)) && Number(m.units_per_line_item) > 0 ? Number(m.units_per_line_item) : 1,
      confidence: ['high', 'medium', 'low'].includes(m.confidence) ? m.confidence : 'low',
      reason: (m.sku && !sku ? `AI suggested unknown SKU "${m.sku}" — set to N/A. ` : '') + (m.reason || ''),
    };
  }
  return out;
}

/**
 * Decide the Avery product for every line:
 *   1. Compatibility list (exact or wildcard)   → source "compat"
 *   2. AI substitute search (if an AI is set up) → source "ai"
 *   3. Built-in rules                            → source "rules"
 */
export async function matchLines(lines, { quoteLines = lines } = {}) {
  const catalog = listCatalog();
  const compat = listCompat();
  const bySku = new Set(catalog.map((c) => c.sku));
  const results = {};
  const pending = [];
  for (const l of lines) {
    const hit = lookupCompat(l.comp_sku, compat);
    if (hit && bySku.has(hit.avery_sku)) {
      results[l.id] = { sku: hit.avery_sku, multiplier: hit.units_per_line_item || 1, source: 'compat', confidence: 'high', reason: `From compatibility list${hit.notes ? ': ' + hit.notes : '.'}` };
    } else if (hit && /^n\/?a$/i.test(hit.avery_sku)) {
      results[l.id] = { sku: null, source: 'compat', confidence: 'high', reason: 'Compatibility list says not carried.' };
    } else {
      if (hit) l._compatMissing = hit.avery_sku;
      pending.push(l);
    }
  }
  let matcher = 'rules';
  let aiError = null;
  if (pending.length && aiEnabled()) {
    try {
      const ai = await aiMatch(pending, catalog);
      for (const l of pending) {
        if (ai[l.id]) results[l.id] = { ...ai[l.id], source: 'ai' };
      }
      if (Object.values(results).some((r) => r.source === 'ai')) matcher = 'ai';
    } catch (e) {
      aiError = String(e.message || e);
    }
  }
  for (const l of pending) {
    if (!results[l.id]) results[l.id] = { ...ruleMatch(l, catalog), source: 'rules' };
    // AI's N/A is only a suggestion. Check built-in candidates against the same
    // width, output, voltage, product-type and tape-dependency gates below.
    // Explicit human-maintained compatibility-list exclusions are preserved.
    if (results[l.id].source === 'ai' && !results[l.id].sku) {
      results[l.id] = { ...ruleMatch(l, catalog), source: 'rules' };
    }
    // Initial AI recommendations must follow the team's tape output tiers and
    // 60W/100W driver policy; manual reviewed choices remain available.
    const kind=lineKind(l.comp_desc,l.comp_sku);
    const policyInput=kind === 'tape' ? brightness(`${l.comp_desc} ${l.comp_sku}`).value : kind === 'driver' ? sourceWatts(l) : null;
    if (results[l.id].source === 'ai' && policyInput) {
      const suggested = ruleMatch(l, catalog);
      const selected = catalog.find((c) => c.sku === results[l.id].sku);
      const preferred = catalog.find((c) => c.sku === suggested.sku);
      if (selected && preferred && (kind === 'driver' ? selected.watts !== preferred.watts : catalogBrightness(selected) !== catalogBrightness(preferred))) {
        results[l.id] = { ...suggested, source: 'rules', reason: `Applied the Avery ${kind === 'driver' ? 'driver capacity' : 'output'} crossover policy. ${suggested.reason}` };
      }
    }
    if (l._compatMissing) results[l.id].reason = `List points to ${l._compatMissing}, which isn't in the catalog. ` + results[l.id].reason;
  }
  const ordered = [...lines].sort((a,b) => (lineKind(a.comp_desc,a.comp_sku) === 'connector') - (lineKind(b.comp_desc,b.comp_sku) === 'connector'));
  for (const l of ordered) {
    const result = results[l.id];
    const item = result.sku ? catalog.find((c) => c.sku === result.sku) : null;
    if (!item) continue;
    const context = quoteLines.map((row) => results[row.id]
      ? { ...row, our_sku: results[row.id].sku, include: !!results[row.id].sku }
      : row);
    const assessment = assessMatch(l, item, { lines: context, catalog: Object.fromEntries(catalog.map((c) => [c.sku,c])) });
    if (lineKind(l.comp_desc,l.comp_sku) !== item.category) assessment.blockers.push('Product types do not match.');
    if (assessment.blockers.length) { result.sku = null; result.confidence = 'low'; result.reason = assessment.blockers.join(' '); }
    else {
      if (assessment.gaps.length) result.confidence = 'low';
      result.reason += ' ' + [...assessment.differences, ...assessment.gaps].join(' ');
      if (assessment.checks.length) result.reason += ` Standard checks before sending: ${assessment.checks.join('; ')}.`;
    }
  }
  return { results, matcher, aiError };
}
