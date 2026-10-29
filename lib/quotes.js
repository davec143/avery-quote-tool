import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR } from './db.js';
import { pdfToText, extractQuote, extractImage, extractWithRules, reconcileTotal } from './extract.js';
import { matchLines } from './match.js';
import { catalogBySku } from './catalog.js';
import { brand } from './settings.js';
import { calculateComparison } from './comparison.js';
import { evaluateCrossovers } from './crossover.js';
import { sourceMime } from './uploads.js';
import { recordEvent } from './history.js';
import { specOptions } from './product-specs.js';
export { round2, fmt } from './comparison.js';

export async function createQuoteFromPdf(filename, buffer) {
  return createQuoteFromSource(filename, buffer);
}

export async function createQuoteFromSource(filename, buffer, { owner = null } = {}) {
  const mime = sourceMime(filename, buffer);
  const d = db();
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  const { lastInsertRowid: id } = d.prepare('INSERT INTO quotes (filename, status, shopify_customer_id) VALUES (?, ?, ?)').run(filename, 'processing', owner == null ? null : String(owner));
  const filePath = path.join(UPLOAD_DIR, `${id}-${safe}`);
  try {
    fs.writeFileSync(filePath, buffer);
    d.prepare('UPDATE quotes SET file_path = ?, source_type = ? WHERE id = ?').run(filePath, mime, id);
    if (mime !== 'application/pdf') {
      const ex = await extractImage(buffer, mime);
      await runPipeline(id, ex.source_text, ex);
      return Number(id);
    }
    let text;
    try { text = await pdfToText(buffer); }
    catch { throw new Error("Couldn't open this PDF. It may be damaged or password-protected. Export the quote again, or upload a screenshot (JPEG or PNG)."); }
    if (text.replace(/\s|--- page break ---/g, '').length < 40) {
      throw new Error("Couldn't read any text from this PDF. It may be a scan or a photo — upload a text-based PDF export.");
    }
    d.prepare('UPDATE quotes SET raw_text = ? WHERE id = ?').run(text, id);
    await runPipeline(id, text);
  } catch (e) {
    d.prepare("UPDATE quotes SET status = 'error', error = ? WHERE id = ?").run(String(e.message || e), id);
  }
  return Number(id);
}

export async function runPipeline(id, text, preparedExtraction = null) {
  const d = db();
  const revision = d.prepare('SELECT revision FROM quotes WHERE id = ?').get(id)?.revision;
  const ex = preparedExtraction || await extractQuote(text);
  if (!ex.lines.length) throw new Error('No product lines could be read. Check the PDF layout; scanned PDFs require a text-based export.');
  if (d.prepare('SELECT revision FROM quotes WHERE id = ?').get(id)?.revision !== revision) throw new Error('This quote changed while reading. Reload before retrying.');
  d.transaction(() => {
    d.prepare(`UPDATE quotes SET raw_text = ?, quote_number = ?, job_name = ?, customer = ?, competitor = ?, quote_date = ?, extractor = ?, error = ? WHERE id = ?`)
    .run(text, ex.quote_number, ex.job_name, ex.customer, ex.competitor, ex.quote_date, ex.extractor, [ex.aiError ? `AI read failed, used built-in reader: ${ex.aiError}` : null, ...(ex.warnings || []), reconcileTotal(text, ex.lines)].filter(Boolean).join(' · ') || null, id);
  d.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(id);
  const ins = d.prepare(`INSERT INTO quote_lines (quote_id, pos, line_ref, group_label, comp_sku, comp_desc, qty, comp_unit_price, price_conflict)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ex.lines.forEach((l, i) => ins.run(id, i, l.line, l.group, l.sku, l.description, l.qty, l.unit_price, l.price_conflict ? 1 : 0));
  d.prepare("UPDATE quotes SET revision = revision + 1, status = 'review', summary_snapshot = NULL, reconciliation_note = '', source_charges='[]',currency_confirmed = 0, quantities_verified = 0 WHERE id = ?").run(id);
  recordEvent(d,id,revision+1,'source_read','Source reader',{extractor:ex.extractor,line_count:ex.lines.length,replaced_lines:d.prepare('SELECT COUNT(*) AS n FROM quote_events WHERE quote_id=?').get(id).n > 0});
  })();
  await rematch(id);
}

export async function reprocessQuote(id) {
  const q = getQuote(id);
  if (!q) throw new Error('Quote not found.');
  if (q.source_type?.startsWith('image/')) {
    const revision = q.revision;
    const ex = await extractImage(fs.readFileSync(q.file_path), q.source_type);
    if (getQuote(id)?.revision !== revision) throw new Error('This quote changed while reading. Reload before retrying.');
    return runPipeline(id, ex.source_text, ex);
  }
  return runPipeline(id, q.raw_text || '');
}

/** (Re)run matching on lines that Kryz hasn't confirmed yet. */
export async function rematch(id, { all = false } = {}) {
  const d = db();
  const lines = d.prepare(`SELECT * FROM quote_lines WHERE quote_id = ? ${all ? '' : 'AND confirmed = 0'} ORDER BY pos`).all(id);
  const revision = d.prepare('SELECT revision FROM quotes WHERE id = ?').get(id)?.revision;
  const quoteLines = d.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY pos').all(id);
  const { results, matcher, aiError } = await matchLines(lines, { quoteLines });
  if (d.prepare('SELECT revision FROM quotes WHERE id = ?').get(id)?.revision !== revision) throw new Error('This quote changed during matching. Reload before retrying.');
  const cat = catalogBySku();
  const proposed = d.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY pos').all(id).map((l) => {
    const r = results[l.id];
    return r ? { ...l, our_sku:r.sku, suggested_sku:r.sku, match_source:r.source, confidence:r.confidence,
      reason:r.reason, na:r.sku ? 0 : 1, include:r.sku ? 1 : 0, quantity_mode:'auto', fixed_multiplier:r.multiplier || 1, review_accepted:0, confirmed:0 } : l;
  });
  const planned = evaluateCrossovers(proposed,cat,specOptions(getQuote(id)));
  for (const l of planned) {
    const old = quoteLines.find((row) => row.id === l.id);
    if (old && (old.our_qty !== l.our_qty || old.difference_notes !== l.difference_notes || old.review_required !== l.review_required)) {
      l.confirmed = 0;
      l.review_accepted = 0;
    }
  }
  const upd = d.prepare(`UPDATE quote_lines SET our_sku=@our_sku, suggested_sku=@suggested_sku, match_source=@match_source,
    confidence=@confidence, reason=@reason, na=@na, include=@include, our_qty=@our_qty, qty_basis=@qty_basis,
    quantity_mode=@quantity_mode, fixed_multiplier=@fixed_multiplier, requirement_watts=@requirement_watts,
    match_kind=@match_kind, difference_notes=@difference_notes, review_required=@review_required,
    review_accepted=@review_accepted, dependency_ids=@dependency_ids, confirmed=@confirmed WHERE id=@id`);
  const prevErr = d.prepare('SELECT error FROM quotes WHERE id = ?').get(id)?.error;
  d.transaction(() => {
  for (const l of planned) upd.run({...l,our_qty:l.our_qty ?? l.qty});
  d.prepare("UPDATE quotes SET matcher = ?, status = 'review', summary_snapshot = NULL, revision = revision + 1, error = ? WHERE id = ?").run(
    matcher,
    [prevErr, aiError ? `AI match failed, used built-in rules: ${aiError}` : null].filter(Boolean).join(' · ') || null,
    id
  );
  recordEvent(d,id,revision+1,'rematched',getQuote(id).reviewer_name,{line_count:lines.length,matcher,changes:planned.filter((l)=>{const old=quoteLines.find((r)=>r.id===l.id);return old.our_sku!==l.our_sku || old.our_qty!==l.our_qty;}).map((l)=>({id:l.id,sku:l.comp_sku,before_sku:quoteLines.find((r)=>r.id===l.id).our_sku,after_sku:l.our_sku,quantity:l.our_qty}))});
  })();
}

export function getQuote(id) {
  const d = db();
  const q = d.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!q) return null;
  const lines = d.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY pos').all(id);
  // Older imports left conflicting prices blank before provenance was stored separately.
  if (lines.some((l)=>l.comp_unit_price == null && !l.price_conflict) && /does not equal|Source\/AI conflict/.test(q.error || '')) {
    const source=extractWithRules(q.raw_text || '').lines;
    for(const l of lines.filter((l)=>l.comp_unit_price == null)) {
      const matches=source.filter((r)=>r.sku===l.comp_sku && String(r.line)===String(l.line_ref));
      if(matches.length===1 && (matches[0].price_conflict || (q.error || '').includes(`Source/AI conflict on ${l.comp_sku}:`))) l.price_conflict=1;
    }
  }
  return { ...q, lines };
}

export function listQuotes() {
  return db()
    .prepare(`SELECT q.*, (SELECT COUNT(*) FROM quote_lines l WHERE l.quote_id = q.id) AS line_count
      FROM quotes q ORDER BY q.id DESC LIMIT 200`)
    .all();
}

/** Confirmed summaries use a frozen snapshot; the editor explicitly requests live pricing. */
export function computeQuote(q, { live = false } = {}) {
  if (!live && q.status === 'done' && q.summary_snapshot) return JSON.parse(q.summary_snapshot).comparison;
  const catalog = catalogBySku();
  // Re-plan quantities so a line whose quantity can't be calculated is flagged instead of reusing a stale number.
  return calculateComparison({ ...q, lines: evaluateCrossovers(q.lines, catalog, specOptions(q)) }, catalog, brand().priceBasis);
}

export function summaryDocument(q) {
  if (q.status === 'done' && q.summary_snapshot) return { ...JSON.parse(q.summary_snapshot), ready: true };
  return { quote: q, comparison: computeQuote(q, { live: true }), branding: brand(), ready: false };
}
