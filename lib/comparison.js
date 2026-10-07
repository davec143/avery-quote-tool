/** Pure comparison engine. Avery quantities always mean pieces, regardless of pricing mode. */
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const fmt = (n) => Number.isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }) : '—';
const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const nonnegative = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function calculateComparison(q, catalog, priceBasis = 'pack') {
  const rows = q.lines.map((l) => {
    const our = l.our_sku ? catalog[l.our_sku] : null;
    const ourQty = l.our_qty ?? l.qty;
    const hasTheirs = nonnegative(l.comp_unit_price);
    const quantityValid = positive(l.qty) && (!our || (positive(ourQty) && Number.isInteger(ourQty)));
    const packQty = our?.pack_qty;
    const packValid = positive(packQty) && Number.isInteger(packQty) && positive(our?.pack_price);
    const ourUnit = packValid ? our.pack_price / packQty : null;
    const theirTotal = hasTheirs && positive(l.qty) ? round2(l.comp_unit_price * l.qty) : null;
    const state = !quantityValid ? 'invalid_qty' : l.na || !our ? 'na' : !packValid ? 'invalid_price' : !hasTheirs ? 'no_price' : 'ok';
    return { ...l, our, ourQty, ourUnit, packQty, theirTotal, ourTotal: null, savings: null,
      inSummary: state === 'ok' && !!l.include, state, orderPacks: null, orderPieces: null, extraPieces: null };
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
    const shares = group.map((r) => ({ r, exact: cents * r.ourQty / pieces, cents: Math.floor(cents * r.ourQty / pieces) }));
    let remainder = cents - shares.reduce((n, share) => n + share.cents, 0);
    for (const share of [...shares].sort((a, b) => (b.exact - b.cents) - (a.exact - a.cents))) {
      if (remainder-- > 0) share.cents += 1;
    }
    for (const { r, cents: allocated } of shares) {
      r.ourTotal = allocated / 100;
      r.savings = round2(r.theirTotal - r.ourTotal);
    }
    orders.push({ sku, title: item.title, variant: item.variant, packLabel: item.pack_label || 'pack', packQty: item.pack_qty,
      requiredPieces: pieces, packs, orderPieces, extraPieces: orderPieces - pieces, packPrice: item.pack_price, total });
  }
  // Excluded rows still show their fair standalone cost to the reviewer.
  for (const r of rows.filter((r) => !r.inSummary && r.state === 'ok')) {
    r.ourTotal = round2(priceBasis === 'pack' ? Math.ceil(r.ourQty / r.packQty) * r.our.pack_price : r.ourQty * r.ourUnit);
    r.savings = round2(r.theirTotal - r.ourTotal);
  }
  const s = rows.filter((r) => r.inSummary);
  const theirs = round2(s.reduce((n, r) => n + r.theirTotal, 0));
  const ours = round2(s.reduce((n, r) => n + r.ourTotal, 0));
  const totals = { theirs, ours, savings: round2(theirs - ours), pct: theirs > 0 ? (theirs - ours) / theirs : null };
  if (!Number.isFinite(theirs) || !Number.isFinite(ours)) throw new Error('Comparison totals exceed the supported numeric range.');
  return { rows, summaryRows: s, orders, priceBasis, totals, counts: {
    total: rows.length, compared: s.length, na: rows.filter((r) => r.state === 'na').length,
    noPrice: rows.filter((r) => r.state === 'no_price').length,
    invalid: rows.filter((r) => r.state.startsWith('invalid')).length,
    low: rows.filter((r) => r.state !== 'na' && r.confidence === 'low' && !r.confirmed).length,
    unconfirmed: rows.filter((r) => !r.confirmed).length,
    excluded: rows.filter((r) => !r.inSummary).length,
  } };
}
