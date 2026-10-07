import Papa from 'papaparse';
import { db, getSetting } from './db.js';

const stripHtml = (s = '') =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function categorize(text) {
  const t = text.toLowerCase();
  if (/power supply|driver/.test(t)) return 'driver';
  if (/terminal block|connector/.test(t)) return 'connector';
  if (/tape light|strip/.test(t)) return 'tape';
  if (/sample|test/.test(t)) return 'other';
  return 'other';
}

/** Turn one Shopify product + variant into a catalog item. */
export function toItem({ handle, title, sku, price, options = [], specs = '', body = '', inventory, source }) {
  const optText = options.filter(Boolean).join(' | ');
  const all = `${title} ${optText} ${specs} ${body}`;
  const packMatch = optText.match(/(\d+)\s*(?:pcs|pieces|pack)/i) || optText.match(/\((\d+)\s*pcs\)/i);
  const suffix = (sku || '').match(/-(?:CT|BX)(\d+)$/i);
  let packQty = packMatch ? parseInt(packMatch[1], 10) : suffix ? Number(suffix[1]) : /case|box|packs?/i.test(optText) ? 0 : 1;
  // "10 Packs - 12 pcs per pack (120 pcs)" -> sold as 10 packs of 12
  const per = optText.match(/(\d+)\s*packs?\s*-\s*(\d+)\s*pcs per pack/i);
  if (per) packQty = parseInt(per[1], 10) * parseInt(per[2], 10);
  const packPrice = Number(price) || 0;
  const cct = (all.match(/(\d{4})\s*K/i) || [])[1];
  const output = (all.match(/(\d{2,4})\s*(?:L\b|lm\s*\/\s*ft)/i) || [])[1];
  const watts = (all.match(/(\d+(?:\.\d+)?)\s*(?:Watts?\b|W\b)/i) || [])[1];
  const ip = (all.match(/\b(IP\s*\d\d)\b/i) || [])[1]?.replace(/\s/g, '').toUpperCase();
  const lower = title.toLowerCase();
  const dimmable = /non-dimmable/.test(lower) ? 0 : /dimmable/.test(lower) ? 1 : null;
  const isRgbw = /rgbw/i.test(title);
  return {
    sku: sku || `${handle}-${options.filter(Boolean).join('-')}`.replace(/[^A-Za-z0-9-]+/g, '-').toUpperCase(),
    title,
    variant: optText,
    category: categorize(title),
    pack_label: options[0] || '',
    pack_qty: packQty,
    pack_price: packPrice,
    unit_price: packQty ? Math.round((packPrice / packQty) * 10000) / 10000 : packPrice,
    cct: isRgbw ? 'RGBW' : cct ? `${cct}K` : null,
    output_class: output ? `${output} lm/ft` : null,
    watts: watts ? Number(watts) : null,
    dimmable,
    ip_rating: ip || null,
    specs: stripHtml(`${specs} ${body}`).slice(0, 1200),
    inventory: inventory === '' || inventory == null ? null : Number(inventory),
    source,
  };
}

/** Parse a Shopify "products_export.csv" into catalog items. Skips $0, unpublished and sample/test items. */
export function parseShopifyCsv(text) {
  const { data, errors } = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (errors.length) throw new Error('The CSV has malformed rows. Export a fresh Shopify product CSV.');
  const products = {};
  const items = [];
  for (const row of data) {
    const handle = row['Handle'];
    if (!handle) continue;
    if (row['Title']) {
      products[handle] = {
        title: row['Title'],
        published: String(row['Published']).toLowerCase() === 'true',
        status: (row['Status'] || '').toLowerCase(),
        specs: row['Specifications (product.metafields.custom.specifications)'] || '',
        body: stripHtml(row['Body (HTML)'] || ''),
      };
    }
    const p = products[handle];
    if (!p) continue;
    const price = Number(row['Variant Price']);
    if (!row['Variant SKU'] && !row['Variant Price']) continue; // image-only rows
    if (!Number.isFinite(price) || price <= 0) continue; // internal "by unit" / sample rows have $0
    if (p.status ? p.status !== 'active' : !p.published) continue;
    if (/\b(?:sample|test)\b/i.test(p.title)) continue;
    items.push(
      toItem({
        handle,
        title: p.title,
        sku: row['Variant SKU'],
        price,
        options: [row['Option1 Value'], row['Option2 Value'], row['Option3 Value']]
          .filter((v) => v && v !== 'Default Title'),
        specs: p.specs,
        body: p.body,
        inventory: row['Variant Inventory Qty'],
        source: 'csv',
      })
    );
  }
  return items;
}

export function replaceCatalog(items, source) {
  if (!items.length) throw new Error('No priced products received. The existing catalog was preserved.');
  const seen = new Set();
  for (const item of items) {
    if (!item.sku || seen.has(item.sku)) throw new Error(`Duplicate or missing SKU: ${item.sku}. The existing catalog was preserved.`);
    if (!Number.isFinite(item.pack_price) || item.pack_price <= 0) throw new Error(`Invalid price for ${item.sku}.`);
    seen.add(item.sku);
  }
  const d = db();
  const ins = d.prepare(`INSERT OR REPLACE INTO catalog_items
    (sku, title, variant, category, pack_label, pack_qty, pack_price, unit_price, cct, output_class, watts, dimmable, ip_rating, specs, inventory, source, updated_at)
    VALUES (@sku, @title, @variant, @category, @pack_label, @pack_qty, @pack_price, @unit_price, @cct, @output_class, @watts, @dimmable, @ip_rating, @specs, @inventory, @source, datetime('now'))`);
  d.transaction(() => {
    d.prepare('DELETE FROM catalog_items').run();
    for (const it of items) ins.run({ ...it, source });
  })();
  return items.length;
}

export function listCatalog() {
  return db().prepare('SELECT * FROM catalog_items ORDER BY category, title, unit_price').all();
}

export function catalogBySku() {
  return Object.fromEntries(listCatalog().map((c) => [c.sku, c]));
}

/** Pull products straight from the Avery Shopify store (Admin API). */
export async function syncFromShopify() {
  const domain = getSetting('shopify_domain').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = getSetting('shopify_token');
  if (!domain || !token) throw new Error('Add the Shopify store domain and Admin API token in Settings first.');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(domain)) throw new Error('Use the store’s .myshopify.com domain.');
  const items = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const query = `query($cursor: String) {
      products(first: 50, after: $cursor, query: "status:active") {
        pageInfo { hasNextPage endCursor }
        nodes {
          handle title descriptionHtml status
          specs: metafield(namespace: "custom", key: "specifications") { value }
          variants(first: 100) { pageInfo { hasNextPage } nodes { sku price inventoryQuantity selectedOptions { value } } }
        }
      }
    }`;
    const res = await fetch(`https://${domain}/admin/api/2026-07/graphql.json`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables: { cursor } }),
    });
    if (!res.ok) throw new Error(`Shopify returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    if (json.errors) throw new Error(`Shopify error: ${JSON.stringify(json.errors).slice(0, 300)}`);
    const conn = json.data?.products;
    if (!conn?.nodes) throw new Error('Shopify returned no product connection. The catalog was preserved.');
    for (const p of conn.nodes) {
      if (p.variants.pageInfo.hasNextPage) throw new Error(`Product ${p.handle} has more than 100 variants. Use a complete CSV export; the catalog was preserved.`);
      if (/\b(?:sample|test)\b/i.test(p.title)) continue;
      for (const v of p.variants.nodes) {
        if (!Number.isFinite(Number(v.price)) || Number(v.price) <= 0) continue;
        items.push(
          toItem({
            handle: p.handle,
            title: p.title,
            sku: v.sku,
            price: v.price,
            options: v.selectedOptions.map((o) => o.value).filter((x) => x !== 'Default Title'),
            specs: p.specs?.value || '',
            body: stripHtml(p.descriptionHtml || ''),
            inventory: v.inventoryQuantity,
            source: 'shopify',
          })
        );
      }
    }
    if (!conn.pageInfo.hasNextPage) break;
    if (page === 19) throw new Error('Catalog exceeds the sync page limit. Use a complete CSV export; the existing catalog was preserved.');
    cursor = conn.pageInfo.endCursor;
  }
  return replaceCatalog(items, 'shopify');
}
