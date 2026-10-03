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
      qty: Number(l.qty) || 1,
      unit_price: l.unit_price == null || l.unit_price === '' ? null : Number(String(l.unit_price).replace(/[$,]/g, '')),
    }));
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
      const unit = price ? money(price) : final ? money(final) / q : null;
      cur = { line, group: line.includes('.') ? group : null, sku, description: '', qty: q, unit_price: unit };
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
  return { ...header, lines: out };
}

export async function extractQuote(text) {
  const rules = extractWithRules(text);
  if (aiEnabled()) {
    try {
      const ai = await extractWithAI(text);
      if (ai.lines.length) return { ...ai, extractor: 'ai', rulesLineCount: rules.lines.length };
    } catch (e) {
      return { ...rules, extractor: 'rules', aiError: String(e.message || e) };
    }
  }
  return { ...rules, extractor: 'rules' };
}
