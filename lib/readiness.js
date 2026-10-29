import { evaluateCrossovers } from './crossover.js';
import { calculateComparison } from './comparison.js';
import { specOptions } from './product-specs.js';

export const todayEastern = () => new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());

/**
 * Shared by the saved-draft checklist and final server-side confirmation.
 * Only problems that would produce a wrong or unusable proposal block confirmation. Reviewer acknowledgements
 * (spec notes, review acceptance, USD/quantity ticks, reviewer name, reconciliation notes) are optional:
 * flagged differences and conditions still print on the customer proposal.
 */
export function confirmationIssues(q, c, { overageAck = false } = {}) {
  const issues=[];
  const add=(message,target,extra={})=>issues.push({message,target,...extra});
  for(const l of q.lines.filter((l)=>l.include)) {
    if(l.blockers.length) add(`Line ${l.line_ref}: ${l.blockers.join(' ')} Select a compatible product or exclude the line.`,`line-${l.id}`,{kind:'blocker',lineId:l.id,detail:l.blockers.join(' ')});
    // No length or wattage could be read, so there is no quantity to order: enter one manually or exclude the line.
    if(l.quantity_problem && l.quantity_mode!=='manual') add(`Line ${l.line_ref}: choose manual quantity and enter the Avery quantity, or exclude the line.`,`line-${l.id}`,{kind:'quantity',lineId:l.id,detail:l.quantity_problem});
  }
  if(!q.raw_text || q.status==='error') add('The source quote must be successfully read before confirmation.','source-review',{kind:'source'});
  if(q.valid_until && q.valid_until<todayEastern()) add('The validity date has passed. Enter a current validity date.','customer-review',{kind:'expired'});
  // Savings would be wrong: the tool compares in USD only.
  if(q.lines.some((l)=>l.comp_unit_price!=null) && /(?:\b(?:EUR|GBP|CAD|AUD|JPY|CNY)\b|[€£]|C\$|A\$)/i.test(q.raw_text || '')) add('This quote is priced in another currency. Currency conversion is not supported; upload a USD quote.','customer-review',{kind:'currency'});
  for(const r of c.rows.filter((l)=>l.include && !['ok','no_price','needs_qty'].includes(l.state))) add(`Line ${r.line_ref}: An included line has invalid quantities, catalog pricing, or conflicting source prices. Fix it or exclude it.`,`line-${r.id}`,{kind:'invalid',lineId:r.id});
  if(!c.summaryRows.length && !issues.some((i)=>i.kind==='quantity')) add('Include at least one valid Avery product before confirmation.','source-review',{kind:'empty'});
  for(const message of c.installation.blockers) add(message,'installation',{kind:'installation'});
  // Members confirm they understand full-pack minimums; the proposal is never blocked for other reasons here.
  if(overageAck) for(const r of c.rows.filter((r)=>r.inSummary && r.overage && !r.overage_ack)) add(`Line ${r.line_ref}: Avery sells this in ${r.overage.packLabel}s of ${r.overage.packQty}, so the order is ${r.overage.ordered} for a need of ${r.overage.required}. Tick "I understand" on that item, or leave it out.`,`line-${r.id}`,{kind:'overage',lineId:r.id,detail:r.overage});
  return issues;
}

export function reviewReadiness(q,catalog,priceBasis,options) {
  const candidate={...q,lines:evaluateCrossovers(q.lines,catalog,specOptions(q))};
  return confirmationIssues(candidate,calculateComparison(candidate,catalog,priceBasis),options);
}
