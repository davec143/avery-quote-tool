import { db, getBlob, setBlob } from './db.js';
import { catalogBySku } from './catalog.js';
import { getQuote, computeQuote } from './quotes.js';
import { brand } from './settings.js';
import { addCompatRows } from './compat.js';
import { assessMatch } from './match-safety.js';
import { lineKind } from './match.js';

function numeric(raw, label, { optional = false, quantity = false } = {}) {
  const text = String(raw ?? '').trim().replace(/[$,]/g, '');
  if (optional && text === '') return null;
  const n = text === '' ? NaN : Number(text);
  if (!Number.isFinite(n) || (quantity ? n <= 0 : n < 0)) throw new Error(`${label} must be a ${quantity ? 'positive quantity' : 'valid non-negative price'}.`);
  return n;
}

/** Validate the entire form before writing; save and confirmation are atomic. */
export function saveReview(id, form, confirm = false) {
  const d = db();
  const q = getQuote(id);
  if (!q) throw new Error('Quote not found.');
  if (Number(form.get('revision')) !== q.revision) throw new Error('Someone changed this quote. Reload before saving so their changes are preserved.');
  const cat = catalogBySku();
  const currency = form.has('currency_confirmed') ? 1 : 0;
  const verified = form.has('quantities_verified') ? 1 : 0;
  const lines = q.lines.map((l) => {
    const qty = numeric(form.get(`qty_${l.id}`), `Line ${l.line_ref} competitor quantity`, { quantity: true });
    let oq = numeric(form.get(`oq_${l.id}`), `Line ${l.line_ref} Avery quantity`, { quantity: true });
    const sku = String(form.get(`sku_${l.id}`) || 'NA');
    const our = sku === 'NA' ? null : cat[sku];
    if (sku !== 'NA' && !our) throw new Error(`Line ${l.line_ref}: the selected SKU is no longer in the catalog.`);
    if (qty !== l.qty && oq === (l.our_qty ?? l.qty) && l.qty > 0) oq = qty * ((l.our_qty ?? l.qty) / l.qty);
    if (our && !Number.isInteger(oq)) throw new Error(`Line ${l.line_ref}: Avery quantity must be a whole number of pieces.`);
    const price = numeric(form.get(`price_${l.id}`), `Line ${l.line_ref} competitor price`, { optional: true });
    const note = String(form.get(`note_${l.id}`) || '').trim();
    const assessment = our ? assessMatch(l, our) : { blockers: [], gaps: [] };
    if (our && lineKind(l.comp_desc, l.comp_sku) !== our.category) assessment.blockers.push('Product types do not match.');
    const include = our && form.has(`inc_${l.id}`) ? 1 : 0;
    if (confirm && include && assessment.blockers.length) throw new Error(`Line ${l.line_ref}: ${assessment.blockers.join(' ')} Select a compatible product or exclude the line.`);
    if (confirm && include && assessment.gaps.length && !note) throw new Error(`Line ${l.line_ref}: add a customer-facing specification note explaining the differences or details still to verify.`);
    const changed = qty !== l.qty || oq !== (l.our_qty ?? l.qty) || price !== l.comp_unit_price || (our?.sku || null) !== l.our_sku || include !== l.include || note !== (l.customer_note || '');
    // The length working only describes the quantity it produced; any manual change clears it.
    const basis = our && qty === l.qty && oq === (l.our_qty ?? l.qty) && our.sku === l.our_sku ? l.qty_basis || '' : '';
    return { ...l, qty_basis: basis, qty, our_qty: oq, comp_unit_price: price, our_sku: our?.sku || null, na: our ? 0 : 1, include,
      customer_note: note, confirmed: confirm ? 1 : changed ? 0 : l.confirmed,
      match_source: (our?.sku || null) !== l.our_sku ? 'manual' : l.match_source,
      reason: assessment.blockers.length || assessment.gaps.length ? [...assessment.blockers, ...assessment.gaps].join(' ') : l.reason,
      confidence: assessment.blockers.length || assessment.gaps.length ? 'low' : l.confidence };
  });
  const values = {};
  for (const key of ['customer', 'job_name', 'notes', 'customer_notes', 'lead_time', 'payment_terms', 'valid_until']) values[key] = String(form.get(key) || '').trim();
  if (values.valid_until && (!/^\d{4}-\d{2}-\d{2}$/.test(values.valid_until) || !Number.isFinite(Date.parse(values.valid_until)) || new Date(values.valid_until).toISOString().slice(0, 10) !== values.valid_until)) throw new Error('Enter a valid comparison expiry date.');
  const candidate = { ...q, ...values, lines, currency_confirmed: currency, quantities_verified: verified };
  const c = computeQuote(candidate, { live: true });
  if (confirm) {
    if (!q.raw_text || q.status === 'error') throw new Error('The source quote must be successfully read before confirmation.');
    if (candidate.valid_until && candidate.valid_until < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())) throw new Error('The validity date has passed. Enter a current validity date.');
    if (!candidate.customer) throw new Error('Enter the customer name before confirmation.');
    if (!currency || /(?:\b(?:EUR|GBP|CAD|AUD|JPY|CNY)\b|[€£]|C\$|A\$)/i.test(q.raw_text)) throw new Error('Verify USD source pricing. Currency conversion is not supported; upload a USD quote.');
    if (!verified) throw new Error('Verify source quantities, roll lengths, unit prices, and Avery piece quantities before confirmation.');
    if (!c.summaryRows.length) throw new Error('Include at least one valid priced product before confirmation.');
    if (lines.some((l) => l.include && c.rows.find((r) => r.id === l.id)?.state !== 'ok')) throw new Error('An included line has missing or invalid pricing. Fix it or exclude it.');
  }
  const changed = lines.some((l, i) => ['qty', 'our_qty', 'comp_unit_price', 'our_sku', 'na', 'include', 'customer_note'].some((key) => (l[key] ?? '') !== (q.lines[i][key] ?? ''))) ||
    Object.keys(values).some((k) => values[k] !== (q[k] || '')) || currency !== q.currency_confirmed || verified !== q.quantities_verified;
  const reviewedAt = new Date().toISOString();
  const snapshot = confirm ? JSON.stringify({ quote: { ...candidate, lines: undefined, raw_text: undefined, file_path: undefined, notes: undefined, summary_snapshot: undefined, reviewed_at: reviewedAt }, comparison: c, branding: brand() }) : changed ? null : q.summary_snapshot;
  let learned = 0;
  d.transaction(() => {
    const result = d.prepare(`UPDATE quotes SET customer=@customer, job_name=@job_name, notes=@notes, customer_notes=@customer_notes,
      lead_time=@lead_time, payment_terms=@payment_terms, valid_until=@valid_until, currency_confirmed=@currency, quantities_verified=@verified,
      status=@status, summary_snapshot=@snapshot, reviewed_at=@reviewedAt, revision=revision+1 WHERE id=@id AND revision=@revision`)
      .run({ ...values, currency, verified, status: confirm ? 'done' : changed ? 'review' : q.status, snapshot,
        reviewedAt: confirm ? reviewedAt : changed ? null : q.reviewed_at, id, revision: q.revision });
    if (!result.changes) throw new Error('This quote changed. Reload before saving.');
    const upd = d.prepare(`UPDATE quote_lines SET qty=@qty, our_qty=@our_qty, comp_unit_price=@comp_unit_price, our_sku=@our_sku,
      na=@na, include=@include, confirmed=@confirmed, match_source=@match_source, confidence=@confidence, reason=@reason, customer_note=@customer_note, qty_basis=@qty_basis WHERE id=@id`);
    for (const l of lines) upd.run(l);
    // Learning is explicit and only occurs after review. Preserve quantity conversion as well as SKU.
    if (confirm) {
      const mappings = lines.filter((l) => form.has(`learn_${l.id}`)).map((l) => ({
        competitor_sku: l.comp_sku, competitor_description: l.comp_desc, competitor_brand: q.competitor || '',
        avery_sku: l.our_sku || 'N/A', units_per_line_item: cat[l.our_sku]?.category === 'tape' ? 1 : l.our_qty / l.qty, // tape quantity is recalculated from length each time notes: `Reviewed on comparison #${id}`,
      }));
      learned = addCompatRows(mappings, 'review');
      const logo = getBlob('logo');
      if (logo) setBlob(`quote_logo_${id}`, logo.mime, logo.data);
      else d.prepare('DELETE FROM blobs WHERE key = ?').run(`quote_logo_${id}`);
    }
  })();
  return learned;
}
