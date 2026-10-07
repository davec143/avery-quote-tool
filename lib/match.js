import { complete, parseJson, aiEnabled } from './llm.js';
import { listCatalog } from './catalog.js';
import { listCompat, lookupCompat } from './compat.js';
import { assessMatch } from './match-safety.js';

/** What kind of product a competitor line is, from its description and part number. */
export function lineKind(desc = '', sku = '') {
  const t = `${desc} ${sku}`.toLowerCase();
  if (/channel|extrusion|profile|lens|diffuser|end cap|mounting clip/.test(t)) return 'channel';
  if (/fixture/.test(t)) return 'fixture';
  if (/casambi|controller|dmx|remote|wall control|dimmer switch|pwm/.test(t)) return 'control';
  if (/driver|power supply|transformer|omnidrive|-odx-|vlm\d+w/.test(t)) return 'driver';
  if (/connector|terminal block|splice|jumper/.test(t)) return 'connector';
  if (/tape|strip|streamlite|valent|blaze|celeste|ribbon|\b\d{4}k\b|rgbw?|-(12|24)v-(stmlt|vl|bl|cel)/.test(t)) return 'tape';
  return 'unknown';
}

const NOT_CARRIED = { channel: 'channel / profile', fixture: 'pre-built fixture', control: 'lighting control', unknown: 'unrecognised item' };

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
    const tapes = catalog.filter((c) => c.category === 'tape');
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
    // Brightness class: competitor series number ≈ lumens per foot (STREAMLITE 200, VALENT MINI 300…).
    const series = Number((desc.match(/(?:streamlite|valent mini|blaze|celeste)\s*(?:tape light\s*)?(\d{3,4})/i) || desc.match(/STMLT(\d)/i) || desc.match(/MN(\d)/i) || [])[1]);
    // An explicit brightness on the source beats the series-name guess.
    const stated = Number((desc.match(/(\d{2,4})\s*lm\s*\/\s*ft/i) || [])[1]);
    let lm = null;
    if (stated) lm = stated;
    else if (series) lm = series < 10 ? series * 100 : series;
    if (/VL8MN1|MINI 150/i.test(desc)) lm = 150;
    const cls = !lm ? 100 : lm <= 150 ? 100 : lm <= 350 ? 200 : 500;
    if (lm && lm > 600) note += ` Theirs is ~${lm} lm/ft; Avery tops out at 500.`;
    // Only COB comes in 2700K; otherwise prefer SMD.
    let pool = tapes.filter((t) => t.cct === cct && t.output_class === `${cls} lm/ft`);
    const smd = pool.filter((t) => /smd/i.test(t.title));
    if (smd.length) pool = smd;
    const m = preferPack(pool);
    if (!m) return { sku: null, confidence: 'low', reason: `No Avery ${cct || ''} ${cls} lm/ft tape found.` };
    let conf = note ? 'low' : 'medium';
    if (!lm) { note += ' Brightness is not stated; defaulted to the 100 lm/ft class. Confirm with the datasheet.'; conf = 'low'; }
    if (/wet|ip6\d/i.test(desc) && !/ip6\d/i.test(m.ip_rating || '')) {
      note += ' Theirs is wet-rated (IP65); Avery tape is IP20 — not for outdoor/wet use.';
      conf = 'low';
    }
    return { sku: m.sku, confidence: conf, reason: `${cct || 'White'} tape, ~${lm || 100} lm/ft → Avery ${cls} lm/ft.${note}`.trim() };
  }

  if (kind === 'driver') {
    const w = Number((desc.match(/(\d+)\s*W\b/i) || desc.match(/(\d+)W/i) || [])[1]);
    const dimmable = /dimm/i.test(desc) && !/non-dimm/i.test(desc);
    let pool = catalog.filter((c) => c.category === 'driver' && (dimmable ? c.dimmable === 1 : true));
    if (!pool.length) return { sku: null, confidence: 'low', reason: 'No driver meets the dimming requirement.' };
    const byFit = (a, b) => a.watts - b.watts || a.unit_price - b.unit_price;
    const fits = pool.filter((c) => c.watts >= (w || 0)).sort(byFit);
    const pick = fits[0] || [...pool].sort((a, b) => b.watts - a.watts || a.unit_price - b.unit_price)[0];
    if (!pick) return { sku: null, confidence: 'medium', reason: 'No drivers in catalog.' };
    const m = preferPack(pool.filter((c) => c.watts === pick.watts && c.dimmable === pick.dimmable));
    let reason = `${w || '?'}W ${dimmable ? 'dimmable ' : ''}driver → Avery ${m.watts}W${m.dimmable ? ' dimmable' : ''}.`;
    let conf = 'medium';
    let multiplier = 1;
    if (w && w > m.watts) {
      return { sku: null, confidence: 'low', reason: 'No sufficiently rated Avery driver. Multiple supplies require a separate system design.' };
    }
    if (/0-10v/i.test(desc)) reason += ' Confirm dimming type (theirs is 0-10V).';
    if (/220\s*[–-]\s*240\s*V/i.test(m.specs || '')) {
      reason += ' Avery spec lists 220–240V AC input — confirm for 120V jobs.';
      conf = 'low';
    }
    return { sku: m.sku, confidence: conf, reason, multiplier };
  }

  if (kind === 'connector') {
    const toWire = /wire/i.test(desc);
    const m = catalog.find((c) => c.category === 'connector' && (toWire ? /wire/i.test(c.title) : /strip to strip/i.test(c.title)));
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
- Drivers: voltage must match; Avery wattage should be >= theirs; dimmable needs dimmable.
- Channels, profiles, lenses, pre-built fixtures, controllers and anything Avery doesn't sell: sku = null (N/A).
- Prefer the "Case" pack unless told otherwise.
- units_per_line_item: use 1 unless a documented roll-length conversion is known. Never split one driver into multiple smaller supplies. Unknown lengths need review.
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
export async function matchLines(lines) {
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
      matcher = 'ai';
    } catch (e) {
      aiError = String(e.message || e);
    }
  }
  for (const l of pending) {
    if (!results[l.id]) results[l.id] = { ...ruleMatch(l, catalog), source: 'rules' };
    if (l._compatMissing) results[l.id].reason = `List points to ${l._compatMissing}, which isn't in the catalog. ` + results[l.id].reason;
  }
  for (const l of lines) {
    const result = results[l.id];
    const item = result.sku ? catalog.find((c) => c.sku === result.sku) : null;
    if (!item) continue;
    const kind = lineKind(l.comp_desc, l.comp_sku);
    const assessment = assessMatch(l, item);
    if (kind !== item.category) assessment.blockers.push('Product types do not match.');
    if (assessment.blockers.length) {
      result.sku = null;
      result.confidence = 'low';
      result.reason = assessment.blockers.join(' ');
    } else {
      if (assessment.gaps.length) {
        result.confidence = 'low';
        result.reason += ' ' + assessment.gaps.join(' ');
      }
      if (assessment.checks.length) result.reason += ` Standard checks before sending: ${assessment.checks.join('; ')}.`;
    }
  }
  return { results, matcher, aiError };
}
