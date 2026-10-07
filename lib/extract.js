import { complete, parseJson, aiEnabled } from './llm.js';

/** Text out of a PDF, keeping each page's line breaks. */
export async function pdfToText(buffer) {
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines from text items by their y position, left to right.
    const rows = new Map();
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: it.transform[4], s: it.str });
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) =>
        items
          .sort((a, b) => a.x - b.x)
          .reduce((acc, it) => {
            const gap = acc.lastX == null ? 0 : Math.max(1, Math.round((it.x - acc.lastX) / 6));
            acc.text += (acc.text ? ' '.repeat(Math.min(gap, 12)) : '') + it.s;
            acc.lastX = it.x + it.s.length * 5;
            return acc;
          }, { text: '', lastX: null }).text
      );
    pages.push(lines.join('\n'));
  }
  return pages.join('\n\n--- page break ---\n\n');
}

/** Drop the long legal boilerplate so the AI only sees the useful part. */
export function trimBoilerplate(text) {
  return text
    .split('\n')
    .filter((l) => !/^\s{0,4}(Purchaser agrees|Lighting technology|degradation|products\.|design, configuration)/.test(l))
    .join('\n')
    .slice(0, 40000);
}

const EXTRACT_SYSTEM = `You read competitor quotes for LED lighting products and return their line items as JSON.
Return ONLY a JSON object, no commentary, with this shape:
{
  "quote_number": string|null,
  "job_name": string|null,
  "customer": string|null,          // the bill-to company
  "competitor": string|null,        // the company that issued the quote, e.g. "Elemental LED"
  "quote_date": string|null,
  "lines": [
    {
      "line": string,               // the line number as printed, e.g. "1", "2.3"
      "group": string|null,         // fixture type / section heading the line sits under, e.g. "Type: S1 ALT 6'"
      "sku": string,                // the competitor's part number exactly as printed
      "description": string,        // full product description, joined into one line
      "qty": number,
      "unit_price": number|null     // price per unit as printed; null if the quote shows no prices
    }
  ]
}
Rules:
- Include every product line. Do not include subtotal, total, group header or legal text rows.
- Never invent a price. If a line has no price on the quote, unit_price is null.
- If only an extended (final) price is shown, unit_price = final price / qty.
- Numbers are plain numbers without $ or commas.`;

export async function extractWithAI(text) {
  const reply = await complete({ system: EXTRACT_SYSTEM, user: `Quote text:\n\n${trimBoilerplate(text)}`, maxTokens: 8000 });
  const j = parseJson(reply);
  if (!Array.isArray(j.lines)) throw new Error('AI reply had no lines');
  j.lines = j.lines
    .filter((l) => l && l.sku)
    .map((l) => ({
      line: String(l.line ?? ''),
      group: l.group || null,
      sku: String(l.sku).trim(),
      description: String(l.description || '').trim(),
      qty: Number(l.qty),
      unit_price: l.unit_price == null || l.unit_price === '' ? null : Number(String(l.unit_price).replace(/[$,]/g, '')),
    }));
  if (j.lines.some((l) => !Number.isFinite(l.qty) || l.qty <= 0 || (l.unit_price != null && (!Number.isFinite(l.unit_price) || l.unit_price < 0)))) throw new Error('AI extracted an invalid quantity or price.');
  for (const key of ['quote_number', 'job_name', 'customer', 'competitor', 'quote_date']) j[key] = j[key] == null ? null : String(j[key]);
  return j;
}

const money = (s) => (s == null ? null : Number(String(s).replace(/[$,]/g, '')));

/**
 * Rules-based reader for the common "Line | Item | Price | Qty | Final Price" layout
 * (Elemental / Diode LED and similar). Used when no AI is configured, and as a cross-check.
 */
export function extractWithRules(text) {
  const lines = text.split('\n');
  const out = [];
  const warnings = [];
  let group = null;
  let cur = null;
  const header = {
    quote_number: (text.match(/Quote\s*#:?\s*([A-Z0-9-]+)/i) || [])[1] || null,
    job_name: ((text.match(/Job Name:\s*(.+?)(?:\s{2,}|$)/m) || [])[1] || '').trim() || null,
    customer: null,
    competitor: /Elemental|Diode/i.test(text) ? 'Elemental LED (Diode LED)' : null,
    quote_date: ((text.match(/Version Date:\s*([A-Za-z]{3} \d{1,2}, \d{4})/) || [])[1]) || null,
  };
  const bill = text.match(/BILL TO:[^\n]*\n\s*(.+?)(?:\s{2,}|$)/m);
  if (bill) header.customer = bill[1].trim();

  const itemRe = /^\s*(\d+(?:\.\d+)?)\s+([A-Z0-9][A-Z0-9.\-\/]{3,})\s+(?:\$([\d,]+\.\d{2})\s+)?(\d+(?:\.\d+)?)\s*(?:\$([\d,]+\.\d{2}))?\s*$/;
  const typeRe = /^\s*\d+\s+Type:\s*(.+?)\s{2,}.*Qty:/;
  for (const raw of lines) {
    const t = typeRe.exec(raw);
    if (t) {
      group = t[1].replace(/\s{2,}/g, ' ').trim();
      cur = null;
      continue;
    }
    const m = itemRe.exec(raw);
    if (m) {
      const [, line, sku, price, qty, final] = m;
      const q = Number(qty);
      if (!Number.isFinite(q) || q <= 0) throw new Error('Source quote contains an invalid quantity.');
      const unit = price ? money(price) : final ? money(final) / q : null;
      let linePrice = unit;
      if (price && final && Math.abs(unit * q - money(final)) > 0.02) {
        // Keep the line but leave the price blank so it cannot enter totals until a reviewer decides which figure is right.
        warnings.push(`Line ${line} (${sku}): unit price $${unit.toFixed(2)} × ${q} does not equal the extended price $${money(final).toFixed(2)}. The price was left blank; check the PDF and enter the correct unit price.`);
        linePrice = null;
      }
      cur = { line, group: line.includes('.') ? group : null, sku, description: '', qty: q, unit_price: linePrice };
      out.push(cur);
      continue;
    }
    if (cur) {
      const s = raw.trim();
      const stop = !s || /^\(Type:|Total:|^Line\s+Item|^QUOTE$|page break|^Purchaser|^Quote #|^Job Name|Qty:\s*\d+\s*$/i.test(s);
      if (stop) {
        cur = null;
        continue;
      }
      // Description continuation lines. Cut off anything far to the right (other columns).
      cur.description = (cur.description + ' ' + s.replace(/\s{6,}.*$/, '')).trim();
      if (cur.description.length > 400) cur = null;
    }
  }
  if (!out.length) {
    const generic = extractGeneric(text);
    if (generic.lines.length) return { ...header, ...generic.header, lines: generic.lines, warnings: generic.warnings, layout: 'generic' };
  }
  return { ...header, lines: out, warnings };
}

/**
 * Fallback for single-row tables: [line #] SKU  description  qty  unit price  amount.
 * Used only when the Elemental-style reader finds nothing. Every row must satisfy qty × unit ≈ amount.
 */
export function extractGeneric(text) {
  const rowRe = /^\s*(?:\d{1,3}\s+)?([A-Z0-9][A-Z0-9.\-\/]{3,})\s+(.+?)\s+(\d+(?:\.\d+)?)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})\s*$/;
  const lines = [], warnings = [];
  for (const raw of text.split('\n')) {
    const m = rowRe.exec(raw);
    if (!m || !/\d/.test(m[1])) continue;
    const [, sku, desc, qty, unitRaw, amtRaw] = m;
    const q = Number(qty), unit = money(unitRaw), amount = money(amtRaw);
    if (!(q > 0)) continue;
    const ok = Math.abs(unit * q - amount) <= 0.02;
    if (!ok) warnings.push(`Row ${lines.length + 1} (${sku}): $${unit.toFixed(2)} × ${q} does not equal $${amount.toFixed(2)}. The price was left blank; check the PDF.`);
    lines.push({ line: String(lines.length + 1), group: null, sku, description: desc.replace(/\s{2,}/g, ' ').trim(), qty: q, unit_price: ok ? unit : null });
  }
  const header = { quote_number: (text.match(/(?:Quote|Estimate|Proposal|Invoice)\s*(?:#|No\.?|Number)?:?\s*([A-Z0-9][A-Z0-9-]{3,})/i) || [])[1] || null };
  return { header, lines, warnings };
}

export async function extractQuote(text) {
  const rules = extractWithRules(text);
  if (aiEnabled()) {
    try {
      const ai = await extractWithAI(text);
      if (rules.lines.length && ai.lines.length < rules.lines.length) throw new Error(`AI returned ${ai.lines.length} lines; built-in reader found ${rules.lines.length}. Using the fuller extraction.`);
      if (ai.lines.length) return { ...ai, extractor: 'ai', rulesLineCount: rules.lines.length };
    } catch (e) {
      return { ...rules, extractor: 'rules', aiError: String(e.message || e) };
    }
  }
  return { ...rules, extractor: 'rules' };
}

/** The grand total a source quote prints ("Quote Total: $1,234.56"), or null. The last one on the document wins. */
export function printedTotal(text = '') {
  const all = [...text.matchAll(/(?<![A-Za-z])(?:Quote\s+|Grand\s+)?Total:?\s*\$\s*([\d,]+\.\d{2})/gi)];
  return all.length ? Number(all[all.length - 1][1].replace(/,/g, '')) : null;
}

/** Warn when extracted lines do not add up to the printed total (missed line, or freight/tax/discount on the source). */
export function reconcileTotal(text, lines) {
  const printed = printedTotal(text);
  if (printed == null) return null;
  const sum = Math.round(lines.reduce((n, l) => n + (Number.isFinite(l.unit_price) ? l.unit_price * l.qty : 0), 0) * 100) / 100;
  if (Math.abs(printed - sum) <= 0.02) return null;
  const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const explained = /freight|shipping|handling|sales\s+tax|\btax\b|discount/i.test(text) ? ' The quote mentions freight, tax or a discount, which probably explains the difference, but confirm it.' : '';
  return `The extracted lines total ${money(sum)} but the source quote prints ${money(printed)} (difference ${money(Math.abs(printed - sum))}). A line may be missing or misread, or the source may include freight, tax or a discount. Check every line against the PDF.${explained}`;
}
