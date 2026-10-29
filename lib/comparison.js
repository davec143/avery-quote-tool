/** Pure comparison engine. Avery quantities always mean pieces, regardless of pricing mode. */
import { installationPlan } from './installation.js';
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const fmt = (n) => Number.isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }) : '—';
const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const nonnegative = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function calculateComparison(q, catalog, priceBasis = 'pack') {
  const rows = q.lines.map((l) => {
    const our = l.our_sku ? catalog[l.our_sku] : null;
    const ourQty = l.our_qty ?? l.qty;
    const hasTheirs = nonnegative(l.comp_unit_price);
    const quantityValid = positive(l.qty) && (!our || ((positive(ourQty) || (ourQty === 0 && our.category === 'driver' && l.quantity_mode === 'auto' && positive(l.requirement_watts))) && Number.isInteger(ourQty)));
    const packQty = our?.pack_qty;
    const packValid = positive(packQty) && Number.isInteger(packQty) && positive(our?.pack_price);
    const ourUnit = packValid ? our.pack_price / packQty : null;
    const theirTotal = hasTheirs && positive(l.qty) ? round2(l.comp_unit_price * l.qty) : null;
    const invalidSource = !hasTheirs && (l.comp_unit_price != null || !!l.price_conflict);
    const needsQty = !!our && !!l.quantity_problem && l.quantity_mode !== 'manual' && ['tape','channel','driver'].includes(our.category);
    const state = !quantityValid ? 'invalid_qty' : l.na || !our ? 'na' : needsQty ? 'needs_qty' : !packValid ? 'invalid_price' : invalidSource ? 'invalid_source_price' : !hasTheirs ? 'no_price' : 'ok';
    return { ...l, our, ourQty, ourUnit, packQty, theirTotal, ourTotal: null, savings: null,
      inSummary: ['ok','no_price'].includes(state) && !!l.include, state, orderPacks: null, orderPieces: null, extraPieces: null };
  });
  // Combine the same SKU before rounding to full packs; do not charge a case for each line.
  const grouped = new Map();
  for (const r of rows.filter((r) => r.inSummary)) {
    const group = grouped.get(r.our_sku) || [];
    group.push(r); grouped.set(r.our_sku, group);
  }
  const orders = [];
  for (const [sku, group] of grouped) {
    const item = group[0].our;
    const pieces = group.reduce((n, r) => n + r.ourQty, 0);
    const packs = Math.ceil(pieces / item.pack_qty);
    const orderPieces = packs * item.pack_qty;
    const total = round2(priceBasis === 'pack' ? packs * item.pack_price : pieces * item.pack_price / item.pack_qty);
    const cents = Math.round(total * 100);
    const weight = (r) => item.category === 'driver' && r.quantity_mode === 'auto' && positive(r.requirement_watts) ? r.requirement_watts / item.watts : r.ourQty;
    const weights = group.reduce((n,r) => n + weight(r),0);
    const shares = group.map((r) => ({ r, exact: cents * weight(r) / weights, cents: Math.floor(cents * weight(r) / weights) }));
    let remainder = cents - shares.reduce((n, share) => n + share.cents, 0);
    for (const share of [...shares].sort((a, b) => (b.exact - b.cents) - (a.exact - a.cents))) {
      if (remainder-- > 0) share.cents += 1;
    }
    for (const { r, cents: allocated } of shares) {
      r.ourTotal = allocated / 100;
      r.savings = r.theirTotal == null ? null : round2(r.theirTotal - r.ourTotal);
    }
    orders.push({ sku, category: item.category, title: item.title, variant: item.variant, packLabel: item.pack_label || 'pack', packQty: item.pack_qty,
      requiredPieces: pieces, packs, orderPieces, extraPieces: orderPieces - pieces, packPrice: item.pack_price, total });
  }
  // Rows whose full-pack order is bigger than the quoted need, so the reviewer can acknowledge the extra pieces.
  for (const r of rows.filter((r) => r.inSummary)) {
    const o = orders.find((x) => x.sku === r.our_sku);
    r.overage = o && o.extraPieces > 0 ? { packQty: o.packQty, packLabel: String(o.packLabel || 'pack').replace(/\s*\(.*\)\s*/, '').toLowerCase() || 'pack', required: o.requiredPieces, ordered: o.orderPieces, extra: o.extraPieces } : null;
  }
  // Excluded rows still show their fair standalone cost to the reviewer.
  for (const r of rows.filter((r) => !r.inSummary && ['ok','no_price'].includes(r.state))) {
    r.ourTotal = round2(priceBasis === 'pack' ? Math.ceil(r.ourQty / r.packQty) * r.our.pack_price : r.ourQty * r.ourUnit);
    r.savings = r.theirTotal == null ? null : round2(r.theirTotal - r.ourTotal);
  }
  const s = rows.filter((r) => r.inSummary);
  const priced = s.filter((r) => r.theirTotal != null);
  const theirs = priced.length ? round2(priced.reduce((n, r) => n + r.theirTotal, 0)) : null;
  const ours = round2(s.reduce((n, r) => n + r.ourTotal, 0));
  const comparedOurs = priced.length ? round2(priced.reduce((n,r) => n + r.ourTotal,0)) : null;
  const savings = priced.length ? round2(theirs - comparedOurs) : null;
  const totals = { theirs, ours, comparedOurs, savings, pct: theirs > 0 ? savings / theirs : null };
  if ((theirs != null && !Number.isFinite(theirs)) || !Number.isFinite(ours)) throw new Error('Comparison totals exceed the supported numeric range.');
  return { rows, summaryRows: s, orders, priceBasis, totals, installation:installationPlan(q,catalog), counts: {
    total: rows.length, compared: s.length, priced: priced.length, unpricedIncluded:s.length-priced.length, na: rows.filter((r) => r.state === 'na').length,
    noPrice: rows.filter((r) => r.state === 'no_price').length,
    invalid: rows.filter((r) => r.state.startsWith('invalid')).length,
    low: rows.filter((r) => r.state !== 'na' && r.confidence === 'low' && !r.confirmed).length,
    unconfirmed: rows.filter((r) => !r.confirmed).length,
    excluded: rows.filter((r) => !r.inSummary).length,
  } };
}
