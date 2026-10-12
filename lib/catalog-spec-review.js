import { db } from './db.js';
import { SPEC_FIELDS } from './product-specs.js';
import { catalogFingerprint } from './catalog-fingerprint.js';

export function saveProductSpecs(sku, form) {
  const d=db();
  const item=d.prepare('SELECT * FROM catalog_items WHERE sku=?').get(sku);
  if (!item) throw new Error('Product is no longer in the catalog.');
  if (form.has('catalog_revision') && String(form.get('catalog_revision')) !== catalogFingerprint(item)) throw new Error('Imported product metadata changed. Reload and verify the current specifications before saving.');
  const existing=d.prepare('SELECT verified_at FROM product_specs WHERE sku=?').get(sku);
  if (form.has('spec_revision') && String(form.get('spec_revision') || '') !== (existing?.verified_at || '')) throw new Error('Another reviewer changed these specifications. Reload before saving.');
  const reviewer=String(form.get('verified_by') || '').trim(), reference=String(form.get('reference') || '').trim();
  if (!reviewer || !reference || !form.has('specs_verified')) throw new Error('Enter your name, the product reference, and verify the specifications.');
  const values={};
  for (const field of Object.keys(SPEC_FIELDS)) {
    const raw=String(form.get(field) || '').trim();
    const value=raw ? Number(raw) : null;
    if (value != null && (!Number.isFinite(value) || value <= 0 || (['pack_qty','connector_pins'].includes(field) && !Number.isInteger(value)))) throw new Error(`${SPEC_FIELDS[field]} must be a positive ${['pack_qty','connector_pins'].includes(field) ? 'whole number' : 'number'}, or blank if unknown.`);
    values[field]=value;
  }
  const profile=String(form.get('profile') || '');
  if (profile && !['surface','corner','recessed'].includes(profile)) throw new Error('Choose a valid channel profile.');
  values.profile=profile || null;
  for (const field of ['cct','ip_rating']) {
    const value=String(form.get(field) || '').trim().toUpperCase();
    if (value && !(field === 'cct' ? /^(\d{4}K|RGBW)$/ : /^IP\d{2}$/).test(value)) throw new Error(`Enter a valid ${field === 'cct' ? 'colour temperature, such as 3000K or RGBW' : 'IP rating, such as IP20'}.`);
    values[field]=value || null;
  }
  const dim=String(form.get('dimmable') || '');
  if (!['','yes','no'].includes(dim)) throw new Error('Choose a valid dimming specification.');
  values.dimmable=dim === 'yes' ? 1 : dim === 'no' ? 0 : null;
  const previous=Date.parse(existing?.verified_at || '');
  const verifiedAt=new Date(Math.max(Date.now(),Number.isFinite(previous) ? previous+1 : 0)).toISOString();
  d.prepare(`INSERT INTO product_specs (sku,values_json,reference,verified_by,verified_at,source_fingerprint) VALUES (?,?,?,?,?,?)
    ON CONFLICT(sku) DO UPDATE SET values_json=excluded.values_json,reference=excluded.reference,verified_by=excluded.verified_by,verified_at=excluded.verified_at,source_fingerprint=excluded.source_fingerprint`)
    .run(sku,JSON.stringify(values),reference,reviewer,verifiedAt,catalogFingerprint(item));
}
