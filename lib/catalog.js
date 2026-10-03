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
export function toItem({ handle, title, sku, price, options, specs, body, inventory, source }) {
  const optText = options.filter(Boolean).join(' | ');
  const all = `${title} ${optText} ${specs} ${body}`;
  const packMatch = optText.match(/(\d+)\s*(?:pcs|pieces|pack)/i) || optText.match(/\((\d+)\s*pcs\)/i);
  let packQty = packMatch ? parseInt(packMatch[1], 10) : 1;
  // "10 Packs - 12 pcs per pack (120 pcs)" -> sold as 10 packs of 12
  const per = optText.match(/(\d+)\s*packs?\s*-\s*(\d+)\s*pcs per pack/i);
  if (per) packQty = parseInt(per[1], 10) * parseInt(per[2], 10);
  const packPrice = Number(price) || 0;
  const cct = (title.match(/(\d{4})K/) || all.match(/(\d{4})K/) || [])[1];
  const output = (optText.match(/(\d{3})L\b/) || [])[1];
  const watts = (title.match(/(\d+)\s*Watts?/i) || [])[1];
  const ip = (specs.match(/IP\s*Rating;?\s*(IP\d\d)/i) || specs.match(/Waterproof Rate;?\s*(IP\d\d)/i) || [])[1];
  const lower = title.toLowerCase();
  const dimmable = /non-dimmable/.test(lower) ? 0 : /dimmable/.test(lower) ? 1 : null;
  const isRgbw = /rgbw/i.test(title);
  return {
    sku: sku || `${handle}-${options.filter(Boolean).join('-')}`.replace(/[^A-Za-z0-9-]+/g, '-').toUpperCase(),
    title,
    variant: optText,
    category: categorize(title),
    pack_label: options[0] || '',
    pack_qty: packQty || 1,
    pack_price: packPrice,
    unit_price: packQty ? Math.round((packPrice / packQty) * 10000) / 10000 : packPrice,
    cct: isRgbw ? 'RGBW' : cct ? `${cct}K` : null,
    output_class: output ? `${output} lm/ft` : null,
    watts: watts ? Number(watts) : null,
    dimmable,
    ip_rating: ip || null,
    specs: stripHtml(specs).slice(0, 1200),
    inventory: inventory === '' || inventory == null ? null : Number(inventory),
    source,
  };
}

/** Parse a Shopify "products_export.csv" into catalog items. Skips $0, unpublished and sample/test items. */
export function parseShopifyCsv(text) {
  const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
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
    if (!price || price <= 0) continue; // internal "by unit" / sample rows have $0
    if (!p.published && p.status !== 'active') continue;
    if (/sample|test/i.test(p.title)) continue;
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
  const items = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const query = `query($cursor: String) {
      products(first: 50, after: $cursor, query: "status:active") {
        pageInfo { hasNextPage endCursor }
        nodes {
          handle title descriptionHtml status
          specs: metafield(namespace: "custom", key: "specifications") { value }
          variants(first: 100) { nodes { sku price inventoryQuantity selectedOptions { value } } }
        }
      }
    }`;
    const res = await fetch(`https://${domain}/admin/api/2025-07/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables: { cursor } }),
    });
    if (!res.ok) throw new Error(`Shopify returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    if (json.errors) throw new Error(`Shopify error: ${JSON.stringify(json.errors).slice(0, 300)}`);
    const conn = json.data.products;
    for (const p of conn.nodes) {
      if (/sample|test/i.test(p.title)) continue;
      for (const v of p.variants.nodes) {
        if (!Number(v.price)) continue;
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
    cursor = conn.pageInfo.endCursor;
  }
  return replaceCatalog(items, 'shopify');
}
