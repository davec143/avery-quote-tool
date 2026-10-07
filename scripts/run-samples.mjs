// Usage: DATA_DIR=/tmp/x node scripts/run-samples.mjs <folder with PDFs> <products_export.csv>
import fs from 'node:fs';
import { parseShopifyCsv, replaceCatalog } from '../lib/catalog.js';
import { createQuoteFromPdf, getQuote, computeQuote, fmt } from '../lib/quotes.js';
const [dir, csv] = process.argv.slice(2);
if (!dir || !process.env.DATA_DIR) throw new Error('Usage: DATA_DIR=/tmp/avery-samples node scripts/run-samples.mjs <PDF folder> [products.csv]. Use an isolated DATA_DIR.');
let failures = 0;
if (csv) console.log('catalog items:', replaceCatalog(parseShopifyCsv(fs.readFileSync(csv, 'utf8')), 'csv'));
for (const f of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()) {
  const id = await createQuoteFromPdf(f, fs.readFileSync(`${dir}/${f}`));
  const q = getQuote(id);
  const c = computeQuote(q);
  const printed = ((q.raw_text || '').match(/Quote Total:\s*\$([\d,]+\.\d\d)/) || [])[1];
  if (q.status === 'error' || !q.lines.length) failures++;
  const lineSum = q.lines.reduce((a, l) => a + (l.comp_unit_price ?? 0) * l.qty, 0);
  console.log(`\n== ${q.quote_number} ${q.job_name || ''} [${q.extractor}/${q.matcher}] ${q.error || ''}`);
  console.log(`   lines ${c.counts.total} · N/A ${c.counts.na} · no price ${c.counts.noPrice} · low ${c.counts.low} · excluded ${c.counts.excluded}`);
  if (printed && Math.abs(Number(printed.replace(/,/g, '')) - lineSum) >= 0.02) failures++;
  if (printed) console.log(`   printed total $${printed} vs sum of lines ${fmt(lineSum)} ${Math.abs(Number(printed.replace(/,/g,'')) - lineSum) < 0.02 ? 'OK' : 'MISMATCH'}`);
  for (const r of c.rows) console.log(`   ${r.line_ref.padEnd(4)} ${r.comp_sku.slice(0,34).padEnd(34)} x${String(r.qty).padEnd(3)} ${fmt(r.comp_unit_price).padStart(9)} -> ${(r.our_sku||'N/A').padEnd(28)} ${fmt(r.ourUnit).padStart(8)} ${r.state.padEnd(8)} ${(r.confidence||'').padEnd(6)} ${fmt(r.savings).padStart(10)} | ${r.reason}`);
  console.log(`   SUMMARY: theirs ${fmt(c.totals.theirs)} ours ${fmt(c.totals.ours)} savings ${fmt(c.totals.savings)} (${(c.totals.pct*100).toFixed(0)}%)`);
}

if (failures) process.exitCode = 1;
