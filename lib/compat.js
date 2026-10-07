import Papa from 'papaparse';
import { db } from './db.js';

export const COMPAT_HEADERS = ['competitor_brand', 'competitor_sku', 'competitor_description', 'avery_sku', 'notes', 'units_per_line_item'];

export const normSku = (s = '') => s.toUpperCase().replace(/\s+/g, '').trim();

const pick = (row, names) => {
  for (const k of Object.keys(row)) {
    const nk = k.toLowerCase().replace(/[^a-z]/g, '');
    if (names.includes(nk)) return (row[k] || '').trim();
  }
  return '';
};

/** Accepts the template headers, plus common variants ("Competitor SKU", "Our SKU", "Avery SKU"…). */
export function parseCompatCsv(text) {
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = [];
  for (const r of data) {
    const competitor_sku = pick(r, ['competitorsku', 'theirsku', 'competitorpart', 'competitorpartnumber', 'partnumber']);
    const avery_sku = pick(r, ['averysku', 'oursku', 'hitlightssku', 'sku', 'substitutesku']);
    if (!competitor_sku || !avery_sku) continue;
    rows.push({
      competitor_brand: pick(r, ['competitorbrand', 'brand', 'competitor']),
      competitor_sku,
      competitor_description: pick(r, ['competitordescription', 'description', 'theirdescription']),
      avery_sku,
      notes: pick(r, ['notes', 'note', 'comments']),
      units_per_line_item: pick(r, ['unitsperlineitem', 'multiplier']) === '' ? 1 : Number(pick(r, ['unitsperlineitem', 'multiplier'])),
    });
  }
  return rows;
}

export function addCompatRows(rows, addedBy = 'upload', { replace = false } = {}) {
  const d = db();
  const ins = d.prepare(`INSERT INTO compat_rows (competitor_brand, competitor_sku, competitor_description, avery_sku, notes, added_by, units_per_line_item)
    VALUES (@competitor_brand, @competitor_sku, @competitor_description, @avery_sku, @notes, @added_by, @units_per_line_item)`);
  const del = d.prepare('DELETE FROM compat_rows WHERE competitor_sku = ?');
  d.transaction(() => {
    if (replace) d.prepare('DELETE FROM compat_rows').run();
    for (const r of rows) {
      if (!Number.isFinite(r.units_per_line_item ?? 1) || (r.units_per_line_item ?? 1) <= 0) throw new Error('Compatibility quantity multiplier must be positive.');
      del.run(r.competitor_sku); // newest mapping for a SKU wins
      ins.run({ competitor_brand: '', competitor_description: '', notes: '', units_per_line_item: 1, ...r, added_by: addedBy });
    }
  })();
  return rows.length;
}

export function listCompat() {
  return db().prepare('SELECT * FROM compat_rows ORDER BY created_at DESC, id DESC').all();
}

/** Find a mapping for a competitor SKU. Exact match first, then patterns using * as a wildcard. */
export function lookupCompat(compSku, rows = listCompat()) {
  const key = normSku(compSku);
  if (!key) return null;
  const exact = rows.find((r) => normSku(r.competitor_sku) === key);
  if (exact) return exact;
  const wild = rows
    .filter((r) => r.competitor_sku.includes('*'))
    .sort((a, b) => b.competitor_sku.length - a.competitor_sku.length) // most specific pattern first
    .find((r) => {
      const re = new RegExp('^' + normSku(r.competitor_sku).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      return re.test(key);
    });
  return wild || null;
}

export function compatTemplateCsv() {
  const sample = [
    COMPAT_HEADERS,
    ['Elemental LED (Diode LED)', 'DI-ODX-24V96W-J', 'OMNIDRIVE X 24V 96W dimmable driver', 'AV-PSD-24V-100W-CT10', 'Dimmable 100W covers up to 96W; verify dimming protocol', 1],
    ['Elemental LED (Diode LED)', 'DI-24V-VL8MN3-30K-*', 'VALENT MINI 300 3000K, any length (* = wildcard)', 'AV-LED-24V-200L-3000K-CT10', 'Example only: verify brightness and roll length for each quote', 1],
  ];
  return Papa.unparse(sample);
}
