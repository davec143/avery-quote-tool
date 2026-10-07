import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR } from './db.js';
import { pdfToText, extractQuote, reconcileTotal } from './extract.js';
import { matchLines } from './match.js';
import { catalogBySku } from './catalog.js';
import { brand } from './settings.js';
import { calculateComparison } from './comparison.js';
import { tapeRolls } from './requirements.js';
export { round2, fmt } from './comparison.js';

export async function createQuoteFromPdf(filename, buffer) {
  const d = db();
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  const { lastInsertRowid: id } = d.prepare('INSERT INTO quotes (filename, status) VALUES (?, ?)').run(filename, 'processing');
  const filePath = path.join(UPLOAD_DIR, `${id}-${safe}`);
  try {
    fs.writeFileSync(filePath, buffer);
    d.prepare('UPDATE quotes SET file_path = ? WHERE id = ?').run(filePath, id);
    const text = await pdfToText(buffer);
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

export async function runPipeline(id, text) {
  const d = db();
  const revision = d.prepare('SELECT revision FROM quotes WHERE id = ?').get(id)?.revision;
  const ex = await extractQuote(text);
  if (!ex.lines.length) throw new Error('No product lines could be read. Check the PDF layout; scanned PDFs require a text-based export.');
  if (d.prepare('SELECT revision FROM quotes WHERE id = ?').get(id)?.revision !== revision) throw new Error('This quote changed while reading. Reload before retrying.');
  d.transaction(() => {
    d.prepare(`UPDATE quotes SET raw_text = ?, quote_number = ?, job_name = ?, customer = ?, competitor = ?, quote_date = ?, extractor = ?, error = ? WHERE id = ?`)
    .run(text, ex.quote_number, ex.job_name, ex.customer, ex.competitor, ex.quote_date, ex.extractor, [ex.aiError ? `AI read failed, used built-in reader: ${ex.aiError}` : null, ...(ex.warnings || []), reconcileTotal(text, ex.lines)].filter(Boolean).join(' · ') || null, id);
  d.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(id);
  const ins = d.prepare(`INSERT INTO quote_lines (quote_id, pos, line_ref, group_label, comp_sku, comp_desc, qty, comp_unit_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  ex.lines.forEach((l, i) => ins.run(id, i, l.line, l.group, l.sku, l.description, l.qty, l.unit_price));
  d.prepare("UPDATE quotes SET revision = revision + 1, status = 'review', summary_snapshot = NULL WHERE id = ?").run(id);
  })();
  await rematch(id);
}

/** (Re)run matching on lines that Kryz hasn't confirmed yet. */
export async function rematch(id, { all = false } = {}) {
  const d = db();
  const lines = d.prepare(`SELECT * FROM quote_lines WHERE quote_id = ? ${all ? '' : 'AND confirmed = 0'} ORDER BY pos`).all(id);
  const revision = d.prepare('SELECT revision FROM quotes WHERE id = ?').get(id)?.revision;
  const { results, matcher, aiError } = await matchLines(lines);
  if (d.prepare('SELECT revision FROM quotes WHERE id = ?').get(id)?.revision !== revision) throw new Error('This quote changed during matching. Reload before retrying.');
  const upd = d.prepare(`UPDATE quote_lines SET our_sku = ?, suggested_sku = ?, match_source = ?, confidence = ?, reason = ?, na = ?, include = ?, our_qty = ?, qty_basis = ?, confirmed = 0 WHERE id = ?`);
  const cat = catalogBySku();
  d.transaction(() => {
    for (const l of lines) {
      const r = results[l.id];
      const na = r.sku ? 0 : 1;
      const our = r.sku ? cat[r.sku] : null;
      let ourQty = l.qty * (r.multiplier || 1);
      let reason = r.reason;
      let basis = '';
      let confidence = r.confidence;
      // Tape is sold in fixed-length rolls: derive the roll count from length, never from a reusable multiplier.
      if (our && our.category === 'tape') {
        const t = tapeRolls(l, our);
        if (t.ok) { ourQty = t.rolls; basis = t.working; reason = `${reason} ${t.working}`.trim(); }
        else { reason = `${reason} Quantity not converted from length: ${t.problem}`.trim(); confidence = 'low'; }
      }
      const include = our ? 1 : 0; // Include higher-cost matches too; savings must reflect the full compared scope.
      upd.run(r.sku, r.sku, r.source, confidence, reason, na, include, ourQty, basis, l.id);
    }
  })();
  const prevErr = d.prepare('SELECT error FROM quotes WHERE id = ?').get(id)?.error;
  d.prepare("UPDATE quotes SET matcher = ?, status = 'review', summary_snapshot = NULL, revision = revision + 1, error = ? WHERE id = ?").run(
    matcher,
    [prevErr, aiError ? `AI match failed, used built-in rules: ${aiError}` : null].filter(Boolean).join(' · ') || null,
    id
  );
}

export function getQuote(id) {
  const d = db();
  const q = d.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!q) return null;
  const lines = d.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY pos').all(id);
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
  return calculateComparison(q, catalogBySku(), brand().priceBasis);
}

export function summaryDocument(q) {
  if (q.status === 'done' && q.summary_snapshot) return { ...JSON.parse(q.summary_snapshot), ready: true };
  return { quote: q, comparison: computeQuote(q, { live: true }), branding: brand(), ready: false };
}
