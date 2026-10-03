import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR } from './db.js';
import { pdfToText, extractQuote } from './extract.js';
import { matchLines } from './match.js';
import { catalogBySku } from './catalog.js';
import { brand } from './settings.js';

export async function createQuoteFromPdf(filename, buffer) {
  const d = db();
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  const { lastInsertRowid: id } = d.prepare('INSERT INTO quotes (filename, status) VALUES (?, ?)').run(filename, 'processing');
  const filePath = path.join(UPLOAD_DIR, `${id}-${safe}`);
  fs.writeFileSync(filePath, buffer);
  d.prepare('UPDATE quotes SET file_path = ? WHERE id = ?').run(filePath, id);
  try {
    const text = await pdfToText(buffer);
    if (text.replace(/\s|--- page break ---/g, '').length < 40) {
      throw new Error("Couldn't read any text from this PDF. It may be a scan or a photo — type the lines in by hand for now.");
    }
    await runPipeline(id, text);
  } catch (e) {
    d.prepare("UPDATE quotes SET status = 'error', error = ? WHERE id = ?").run(String(e.message || e), id);
  }
  return Number(id);
}

export async function runPipeline(id, text) {
  const d = db();
  const ex = await extractQuote(text);
  d.prepare(`UPDATE quotes SET raw_text = ?, quote_number = ?, job_name = ?, customer = ?, competitor = ?, quote_date = ?, extractor = ?, error = ? WHERE id = ?`)
    .run(text, ex.quote_number, ex.job_name, ex.customer, ex.competitor, ex.quote_date, ex.extractor, ex.aiError ? `AI read failed, used built-in reader: ${ex.aiError}` : null, id);
  d.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(id);
  const ins = d.prepare(`INSERT INTO quote_lines (quote_id, pos, line_ref, group_label, comp_sku, comp_desc, qty, comp_unit_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  ex.lines.forEach((l, i) => ins.run(id, i, l.line, l.group, l.sku, l.description, l.qty, l.unit_price));
  await rematch(id);
}

/** (Re)run matching on lines that Kryz hasn't confirmed yet. */
export async function rematch(id, { all = false } = {}) {
  const d = db();
  const lines = d.prepare(`SELECT * FROM quote_lines WHERE quote_id = ? ${all ? '' : 'AND confirmed = 0'} ORDER BY pos`).all(id);
  const { results, matcher, aiError } = await matchLines(lines);
  const upd = d.prepare(`UPDATE quote_lines SET our_sku = ?, suggested_sku = ?, match_source = ?, confidence = ?, reason = ?, na = ?, include = ?, our_qty = ?, confirmed = 0 WHERE id = ?`);
  const cat = catalogBySku();
  d.transaction(() => {
    for (const l of lines) {
      const r = results[l.id];
      const na = r.sku ? 0 : 1;
      const our = r.sku ? cat[r.sku] : null;
      // Leave a line out of the summary by default if we'd be more expensive.
      const ourQty = l.qty * (r.multiplier || 1);
      const include = our && l.comp_unit_price != null ? (our.unit_price * ourQty <= l.comp_unit_price * l.qty ? 1 : 0) : 1;
      upd.run(r.sku, r.sku, r.source, r.confidence, r.reason, na, include, ourQty, l.id);
    }
  })();
  const prevErr = d.prepare('SELECT error FROM quotes WHERE id = ?').get(id)?.error;
  d.prepare("UPDATE quotes SET matcher = ?, status = 'review', error = ? WHERE id = ?").run(
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

/** All savings maths lives here, in code — the AI never does arithmetic. */
export function computeQuote(q) {
  const cat = catalogBySku();
  const basis = brand().priceBasis; // per_piece | pack
  const rows = q.lines.map((l) => {
    const our = l.our_sku ? cat[l.our_sku] : null;
    const ourUnit = our ? (basis === 'pack' ? our.pack_price : our.unit_price) : null;
    const hasTheirs = l.comp_unit_price != null && !Number.isNaN(l.comp_unit_price);
    const theirTotal = hasTheirs ? round2(l.comp_unit_price * l.qty) : null;
    const ourQty = l.our_qty ?? l.qty;
    const ourTotal = ourUnit != null ? round2(ourUnit * ourQty) : null;
    const savings = theirTotal != null && ourTotal != null ? round2(theirTotal - ourTotal) : null;
    const state = l.na || !our ? 'na' : !hasTheirs ? 'no_price' : 'ok';
    return { ...l, our, ourQty, ourUnit, theirTotal, ourTotal, savings, state, inSummary: state === 'ok' && !!l.include };
  });
  const s = rows.filter((r) => r.inSummary);
  const theirs = round2(s.reduce((a, r) => a + r.theirTotal, 0));
  const ours = round2(s.reduce((a, r) => a + r.ourTotal, 0));
  return {
    rows,
    summaryRows: s,
    totals: { theirs, ours, savings: round2(theirs - ours), pct: theirs ? (theirs - ours) / theirs : 0 },
    counts: {
      total: rows.length,
      na: rows.filter((r) => r.state === 'na').length,
      noPrice: rows.filter((r) => r.state === 'no_price').length,
      low: rows.filter((r) => r.state !== 'na' && r.confidence === 'low' && !r.confirmed).length,
      unconfirmed: rows.filter((r) => !r.confirmed).length,
      excluded: rows.filter((r) => r.state === 'ok' && !r.include).length,
    },
  };
}

export const round2 = (n) => Math.round(n * 100) / 100;
export const fmt = (n) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
