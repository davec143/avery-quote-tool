// Isolated demonstration data; this script refuses to add to an existing quote database.
import { db, setSetting } from '../lib/db.js';
import { replaceCatalog, toItem } from '../lib/catalog.js';
import { getQuote } from '../lib/quotes.js';
import { saveReview } from '../lib/review.js';
if (!process.env.DATA_DIR) throw new Error('Set DATA_DIR to a disposable demo directory first.');
if (db().prepare('SELECT COUNT(*) AS n FROM quotes').get().n) throw new Error('Demo seeding requires an empty database.');
const catalog = [
  toItem({ handle:'strip', sku:'DEMO-24V-200L-3000K-CT10', title:'24V SMD tape light 3000K', options:['Case (10 pcs)','200L'], price:176, specs:'IP20 · 24V DC · 16.4 ft roll', source:'demo' }),
  toItem({ handle:'supply', sku:'DEMO-24V-100W-CT10', title:'24V 100W non-dimmable power supply', options:['Case (10 pcs)'], price:180, specs:'IP20 · AC input 100–240V', source:'demo' }),
];
replaceCatalog(catalog,'demo');setSetting('price_basis','pack');setSetting('company_name','Avery LED');setSetting('contact_line','DEMONSTRATION — sample products and pricing');
for (let i=0;i<2;i++) {
  const id=Number(db().prepare(`INSERT INTO quotes (quote_number,job_name,customer,competitor,quote_date,raw_text,status,extractor,matcher)
    VALUES (?, 'Kitchen cabinet lighting — demonstration', 'Demonstration customer', 'Sample competitor', '2026-10-03', 'Sample quote in USD', 'review', 'rules', 'rules')`).run(`DEMO-${i+1}`).lastInsertRowid);
  const insert=db().prepare(`INSERT INTO quote_lines (quote_id,pos,line_ref,comp_sku,comp_desc,qty,comp_unit_price,our_sku,our_qty,include,confidence,customer_note,na)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?)`);
  insert.run(id,0,'1','DEMO-COMP-24V-3000K','24V 3000K 200 lm/ft tape, 16.4 ft roll',12,42,catalog[0].sku,12,1,'low','Sample assumption: same roll length and CCT. Verify brightness, cut increments and dry-location installation.',0);
  insert.run(id,1,'2','DEMO-COMP-24V-96W','24V 96W non-dimmable driver',2,65,catalog[1].sku,2,1,'low','Avery capacity is 100W rather than 96W. Verify AC input, connected load, wiring and installation requirements.',0);
  insert.run(id,2,'3','DEMO-CONTROL','Wall control / dimmer',1,55,null,1,0,'high','',1);
  if (i===0) {
    const q=getQuote(id), f=new FormData();
    for (const [k,v] of Object.entries({ revision:q.revision,customer:q.customer,job_name:q.job_name,currency_confirmed:'on',quantities_verified:'on',lead_time:'Sample only — request current stock and delivery date',payment_terms:'Sample only — confirm with Avery',valid_until:'2026-10-17',customer_notes:'DEMONSTRATION ONLY. Products, quantities, prices and terms shown here are illustrative.' })) f.set(k,String(v));
    for (const l of q.lines) {
      f.set(`qty_${l.id}`,String(l.qty));f.set(`price_${l.id}`,String(l.comp_unit_price));f.set(`oq_${l.id}`,String(l.our_qty));f.set(`sku_${l.id}`,l.our_sku||'NA');f.set(`note_${l.id}`,l.customer_note);if(l.include)f.set(`inc_${l.id}`,'on');
    }
    saveReview(id,f,true);
  }
}
console.log('Demo created: reviewed comparison /quotes/1/summary and draft /quotes/2.');
