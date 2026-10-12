/** Compare human-reviewed expectations against extraction and deterministic matching. */
export function evaluateBenchmark(actual,expected) {
  if(!expected || !Array.isArray(expected.lines) || !expected.lines.length) throw new Error('Each benchmark case needs human-reviewed expected lines.');
  const remaining=[...actual.rows],issues=[];let matched=0,correct=0;
  for(const e of expected.lines) {
    if (!e.sku || !Number.isFinite(e.qty) || e.qty<=0 || !Object.hasOwn(e,'unit_price') || (e.unit_price!==null && (!Number.isFinite(e.unit_price) || e.unit_price<0))) throw new Error('Expected lines need SKU, a positive quantity and a non-negative unit price (or null).');
    const matches=remaining.map((l,i)=>({l,i})).filter(({l})=>l.comp_sku===e.sku && (e.line_ref==null || String(l.line_ref)===String(e.line_ref)));
    if(matches.length !== 1) {issues.push({type:matches.length ? 'ambiguous_line' : 'missing_line',sku:e.sku,line_ref:e.line_ref});continue;}
    const {l,i}=matches[0];remaining.splice(i,1);matched++;let lineCorrect=true;
    for(const [field,key] of [['qty','qty'],['unit_price','comp_unit_price'],['avery_sku','our_sku'],['our_qty','ourQty'],['include','include']]) {
      if(!Object.hasOwn(e,field)) continue;
      const wanted=e[field],got=field==='include' ? !!l[key] : field==='our_qty' && !l.our_sku ? null : l[key] ?? null;
      const ok=typeof wanted==='number' ? typeof got==='number' && Math.abs(wanted-got)<(field==='unit_price' ? 0.005 : 0.000001) : wanted===got;
      if(!ok){lineCorrect=false;issues.push({type:'field_mismatch',sku:e.sku,field,expected:wanted,actual:got});}
    }
    if(lineCorrect) correct++;
  }
  for(const l of remaining) issues.push({type:'unexpected_line',sku:l.comp_sku,line_ref:l.line_ref});
  for(const [field,wanted] of Object.entries(expected.totals || {})) {
    if(wanted===null && ['pct','theirs','comparedOurs','savings'].includes(field)) {if(actual.totals[field]!==null) issues.push({type:'total_mismatch',field,expected:null,actual:actual.totals[field]});continue;}
    if(typeof wanted!=='number' || !Number.isFinite(wanted)) throw new Error('Expected totals must be finite numbers.');
    if(Math.abs((actual.totals[field] ?? NaN)-wanted)>=0.01 || !Number.isFinite(actual.totals[field])) issues.push({type:'total_mismatch',field,expected:wanted,actual:actual.totals[field]});
  }
  return {passed:!issues.length,expectedLines:expected.lines.length,actualLines:actual.rows.length,matchedLines:matched,correctLines:correct,coverage:matched/expected.lines.length,lineAccuracy:correct/expected.lines.length,issues};
}
