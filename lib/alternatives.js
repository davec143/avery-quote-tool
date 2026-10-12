import { evaluateCrossovers } from './crossover.js';
import { calculateComparison } from './comparison.js';
import { kindFromText, brightness, sourceText, sourceWatts } from './specs.js';
import { productSpecs, specOptions } from './product-specs.js';

/** Price each alternative within the current quote, including shared packs and dependencies. */
export function alternativeOptions(q,line,catalog,priceBasis='pack') {
  const kind=kindFromText(line.comp_desc,line.comp_sku), srcLm=brightness(sourceText(line)).value;
  const candidates=[];
  for (const item of Object.values(catalog).filter((i)=>i.category===kind)) {
    const lines=evaluateCrossovers(q.lines.map((l)=>l.id===line.id ? {...l,our_sku:item.sku,include:1,na:0,quantity_mode:'auto'} : l),catalog,specOptions(q));
    const assessed=lines.find((l)=>l.id===line.id);
    if (assessed.blockers.length || assessed.quantity_problem || lines.some((l)=>l.include && l.blockers.length)) continue;
    const c=calculateComparison({...q,lines},catalog,priceBasis),row=c.rows.find((r)=>r.id===line.id);
    if (!row.inSummary || c.installation.blockers.length) continue;
    const s=productSpecs(item);
    const distance=assessed.gaps.length*1000 + (s.lumens_ft && srcLm ? Math.abs(s.lumens_ft-srcLm) : 0) + (kind==='driver' ? Math.abs(item.watts-(sourceWatts(line)<=60 ? 60 : 100)) : 0) + (assessed.match_kind==='exact' ? 0 : 1);
    candidates.push({sku:item.sku,title:item.title,quantity:row.ourQty,match_kind:assessed.match_kind,notes:assessed.difference_notes,jobTotal:c.totals.ours,jobSavings:c.totals.savings,output:s.lumens_ft,distance});
  }
  const sort=(field)=>[...candidates].sort((a,b)=>a[field]-b[field] || a.distance-b.distance || a.sku.localeCompare(b.sku))[0];
  const choices=[{label:'Closest specifications',candidate:sort('distance')},{label:priceBasis==='pack' ? 'Lowest purchase cost' : 'Lowest piece estimate',candidate:sort('jobTotal')}];
  if(kind==='tape' && srcLm) choices.push({label:'Higher output',candidate:candidates.filter((c)=>c.output>srcLm).sort((a,b)=>a.output-b.output || a.jobTotal-b.jobTotal)[0]});
  return choices.filter((c)=>c.candidate).map(({label,candidate})=>({label,...candidate}));
}
