import { round2 } from './comparison.js';
/** Spreadsheet-safe customer purchase schedule, using only a confirmed frozen snapshot. */
const cell=(v)=>{
  const raw=v == null ? '' : String(v),safe=typeof v==='string' && /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g,'""')}"`;
};
export function purchaseCsv(document) {
  if (!document.ready) throw new Error('Confirm the comparison before exporting purchase quantities.');
  const {quote:q,comparison:c}=document;
  const rows=[['Comparison','SKU','Product','Required pieces','Packs','Pack label','Pieces per pack','Pieces supplied','Extra pieces','Product cost USD','Full-pack cost USD','Pricing basis','Differences and conditions']];
  for(const order of c.orders) rows.push([`AQ-${q.id}`,order.sku,order.title,order.requiredPieces,order.packs,order.packLabel,order.packQty,order.orderPieces,order.extraPieces,order.total,round2(order.packs*order.packPrice),c.priceBasis==='pack' ? 'Whole-pack purchase' : 'Per-piece estimate',c.summaryRows.filter((l)=>l.our_sku===order.sku).map((l)=>[l.difference_notes,l.customer_note].filter(Boolean).join(' ')).join(' | ')]);
  return '\uFEFF'+rows.map((r)=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function reviewedExpectation(document) {
  if (!document.ready) throw new Error('Confirm the comparison before exporting benchmark expectations.');
  return {file:document.quote.filename,price_basis:document.comparison.priceBasis,reviewed_by:document.quote.reviewer_name || 'Earlier reviewer not recorded',configuration:{
    driver_basis:document.quote.driver_basis || 'source',design_headroom:document.quote.design_headroom ?? null,
    groups:document.comparison.rows.filter((l)=>l.group_label).map((l)=>({sku:l.comp_sku,line_ref:l.line_ref,group:l.group_label})),
  },expected:{
    lines:document.comparison.rows.map((l)=>({line_ref:l.line_ref,sku:l.comp_sku,qty:l.qty,unit_price:l.comp_unit_price,avery_sku:l.our_sku || null,our_qty:l.our_sku ? l.ourQty : null,include:!!l.include})),
    totals:document.comparison.totals,
  }};
}
