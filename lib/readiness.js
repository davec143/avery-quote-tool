import { evaluateCrossovers } from './crossover.js';
import { calculateComparison } from './comparison.js';
import { specOptions } from './product-specs.js';
import { reconcileTotal } from './extract.js';
import { chargeTotal } from './source-costs.js';

export const todayEastern = () => new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());

/** Shared by the saved-draft checklist and final server-side confirmation. */
export function confirmationIssues(q, c, quantities = new Map(q.lines.map((l)=>[l.id,l.our_qty]))) {
  const issues=[];
  const add=(message,target)=>issues.push({message,target});
  for(const l of q.lines.filter((l)=>l.include)) {
    const target=`line-${l.id}`;
    if(l.blockers.length) add(`Line ${l.line_ref}: ${l.blockers.join(' ')} Select a compatible product or exclude the line.`,target);
    if(l.gaps.length && !l.customer_note) add(`Line ${l.line_ref}: add a customer-facing specification note explaining the differences or details still to verify. ${l.gaps.join(' ')}`,target);
    if(l.quantity_problem && l.quantity_mode!=='manual') add(`Line ${l.line_ref}: choose manual quantity and document the requirement, or exclude the line.`,target);
    if(l.review_required && !l.review_accepted) add(`Line ${l.line_ref}: explicitly accept the option requiring review after verifying the installation or quantity plan.`,target);
    if(l.quantity_mode==='auto' && quantities.get(l.id)!==l.our_qty) add(`Line ${l.line_ref}: Save to recalculate and review the updated Avery purchase quantity before confirming.`,target);
  }
  if(!q.raw_text || q.status==='error') add('The source quote must be successfully read before confirmation.','source-review');
  if(q.valid_until && q.valid_until<todayEastern()) add('The validity date has passed. Enter a current validity date.','customer-review');
  if(!q.customer?.trim()) add('Enter the customer name before confirmation.','customer-details');
  if(q.lines.some((l)=>l.comp_unit_price!=null) && (!q.currency_confirmed || /(?:\b(?:EUR|GBP|CAD|AUD|JPY|CNY)\b|[€£]|C\$|A\$)/i.test(q.raw_text))) add('Verify USD source pricing. Currency conversion is not supported; upload a USD quote.','customer-review');
  if(!q.quantities_verified) add('Verify source quantities, roll lengths, unit prices, and Avery piece quantities before confirmation.','customer-review');
  if(reconcileTotal(q.raw_text,q.lines.map((l)=>({qty:l.qty,unit_price:l.comp_unit_price})),chargeTotal(q.source_charges)) && !q.reconciliation_note) add('Resolve the source total difference or explain the verified freight, tax, discount or scope difference in the source reconciliation note.','customer-review');
  for(const r of c.rows.filter((l)=>l.include && !['ok','no_price'].includes(l.state))) add(`Line ${r.line_ref}: An included line has invalid quantities, catalog pricing, or conflicting source prices. Fix it or exclude it.`,`line-${r.id}`);
  if(!c.summaryRows.length) add('Include at least one valid Avery product before confirmation.','source-review');
  for(const message of c.installation.blockers) add(message,'installation');
  if(!q.reviewer_name?.trim()) add('Enter the reviewer name before confirming this comparison.','customer-review');
  return issues;
}

export function reviewReadiness(q,catalog,priceBasis) {
  const candidate={...q,lines:evaluateCrossovers(q.lines,catalog,specOptions(q))};
  return confirmationIssues(candidate,calculateComparison(candidate,catalog,priceBasis),new Map(q.lines.map((l)=>[l.id,l.our_qty])));
}
