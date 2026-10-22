import Link from 'next/link';
import {db} from '@/lib/db';
import { requireAdmin } from '@/lib/access';
const labels={open:'Open',reviewing:'Customer reviewing',accepted:'Customer accepted',declined:'Customer declined'};
export default async function InsightsPage() {
  await requireAdmin();
  const d=db(),outcomes=d.prepare('SELECT outcome,COUNT(*) AS count FROM quotes GROUP BY outcome').all();
  const events=d.prepare("SELECT e.*,q.customer FROM quote_events e JOIN quotes q ON q.id=e.quote_id WHERE e.event_type IN ('saved','confirmed') ORDER BY e.id DESC LIMIT 1000").all();
  const corrections=events.flatMap((e)=>JSON.parse(e.details_json).changes || []).filter((c)=>Object.keys(c.fields || {}).some((k)=>['our_sku','comp_sku','comp_desc','qty','comp_unit_price'].includes(k)));
  const counts=new Map();for(const c of corrections) counts.set(c.sku,(counts.get(c.sku)||0)+1);
  const declined=d.prepare("SELECT id,customer,outcome_note FROM quotes WHERE outcome='declined' ORDER BY id DESC LIMIT 20").all();
  return <><h1>Team learning</h1><p className="muted">Customer outcomes and reviewer corrections recorded since this feature was added. Correction counts reflect activity, including repeated edits.</p>
    <div className="stats">{outcomes.map((o)=><div className="stat" key={o.outcome}><span>{labels[o.outcome] || o.outcome}</span><b>{o.count}</b></div>)}</div>
    <section className="card"><h3>Source SKUs with repeated corrections</h3><p className="small muted">Review these source formats, product data and suggested mappings before changing matching rules.</p>{[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([sku,count])=><p key={sku}><b>{sku}</b> · {count} recorded corrections</p>)}{!counts.size && <p>No corrections recorded yet.</p>}</section>
    <section className="card" style={{marginTop:16}}><h3>Customer decline feedback</h3>{declined.map((q)=><p key={q.id}><Link href={`/quotes/${q.id}`}>AQ-{q.id} · {q.customer}</Link> — {q.outcome_note}</p>)}{!declined.length && <p>No declined outcomes recorded.</p>}</section>
  </>;
}
