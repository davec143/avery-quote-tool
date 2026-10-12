'use client';
import { useState } from 'react';
const money=(n)=>n.toLocaleString('en-US',{style:'currency',currency:'USD'});
export default function ProductChoice({ id,line,selected,groups,options }) {
  const [sku,setSku]=useState(selected || 'NA');
  function choose(option,e) {
    setSku(option.sku);
    const note=e.currentTarget.form?.elements.namedItem(`decision_${id}`);
    if(note) note.value=`Selected ${option.label.toLowerCase()}: ${option.sku}.`;
  }
  return <>
    <select aria-label={`Avery product for line ${line}`} name={`sku_${id}`} value={sku} onChange={(e)=>{
      setSku(e.target.value);
      const note=e.currentTarget.form?.elements.namedItem(`decision_${id}`);
      if(note && /^Selected (closest specifications|lowest purchase cost|lowest piece estimate|higher output): /i.test(note.value)) note.value='';
    }}>
      <option value="NA">N/A — no product selected</option>
      {groups.map(([category,items])=><optgroup key={category} label={category}>{items.map((i)=><option key={i.sku} value={i.sku}>{i.title} — {i.variant} ({i.unit_price == null ? 'unknown pack count' : money(i.unit_price)} ea)</option>)}</optgroup>)}
    </select>
    {options.length>0 && <details className="candidate-options"><summary>Compare suggested options</summary>
      <p className="small muted">These recalculate the current quote with this selection, including shared packs. Save to review the new quantities and conditions.</p>
      {options.map((o)=><div className="candidate" key={o.label}><b>{o.label}</b><div>{o.sku} · {o.quantity} required</div><div>{o.match_kind==='exact' ? 'Exact on checked specs' : o.match_kind==='alternative' ? 'Alternative with disclosed differences' : 'Option requiring review'}</div><div>Avery total · all selected products: {money(o.jobTotal)}</div>{o.jobSavings != null ? <div>{o.jobSavings<0 ? 'Additional cost' : 'Savings'} · priced source lines only: {money(Math.abs(o.jobSavings))}</div> : <div>Source prices unavailable; Avery pricing only</div>}{o.notes && <p className="small">{o.notes}</p>}<button type="button" onClick={(e)=>choose(o,e)}>{sku===o.sku ? 'Selected' : 'Use this option'}</button></div>)}
    </details>}
  </>;
}
