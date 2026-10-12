import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const folder = fs.mkdtempSync(path.join(os.tmpdir(),'avery-crossovers-'));
process.env.DATA_DIR = folder;
const { db, setSetting } = await import('../lib/db.js');
const { toItem, replaceCatalog, catalogBySku } = await import('../lib/catalog.js');
const { matchLines } = await import('../lib/match.js');
const { getQuote, rematch, runPipeline, createQuoteFromSource } = await import('../lib/quotes.js');
const { saveReview } = await import('../lib/review.js');
const { evaluateCrossovers } = await import('../lib/crossover.js');
const { calculateComparison } = await import('../lib/comparison.js');
const { complete } = await import('../lib/llm.js');
const { extractQuote } = await import('../lib/extract.js');
const { sourceMime, validateUploads } = await import('../lib/uploads.js');
const { productSpecs } = await import('../lib/product-specs.js');
after(()=>{db().close();fs.rmSync(folder,{recursive:true,force:true});});
const make=(sku,title,price,options,specs='')=>toItem({handle:sku,sku,title,price,options,specs,source:'test'});
const catalog=[
  make('T200','24V tape light 3000K 200 lm/ft',100,['Case (10 pcs)'],'10mm IP20 Roll length: 16.4 ft'),
  make('T300','24V tape light 3000K 300 lm/ft',120,['Case (10 pcs)'],'10mm IP20 Roll length: 16.4 ft'),
  make('T500','24V tape light 3000K 500 lm/ft',150,['Case (10 pcs)'],'10mm IP20 Roll length: 16.4 ft'),
  make('D60','24V 60W non-dimmable driver',60,['Case (10 pcs)'],'IP20 AC input 100–240V'),
  make('D100','24V 100W non-dimmable driver',100,['Case (10 pcs)'],'IP20 AC input 100–240V'),
  make('CHAN','Surface U-channel aluminum',50,['Bundle (10 sections)'],'Section length 1m; fits 10mm tape'),
  make('CORNER','Corner aluminum channel',55,['Bundle (10 sections)'],'Section length 1m; fits 10mm tape'),
  make('BLOCK','10mm terminal block',20,['Box (100 pcs)'],'2 pin tape connector'),
];
const cat=Object.fromEntries(catalog.map((c)=>[c.sku,c]));
const line=(id,desc,qty=1,sku='T200')=>({id,line_ref:String(id),comp_sku:`SRC-${id}`,comp_desc:desc,qty,our_sku:sku,our_qty:qty,comp_unit_price:50,include:1,na:0,quantity_mode:'auto',fixed_multiplier:1});
async function proposed(lines) {
  replaceCatalog(catalog,'test');const {results}=await matchLines(lines);
  return evaluateCrossovers(lines.map((l)=>({...l,our_sku:results[l.id].sku,include:!!results[l.id].sku})),cat);
}
function insert(lines, raw='Quote in USD') {
  replaceCatalog(catalog,'test');
  const id=Number(db().prepare("INSERT INTO quotes (raw_text,customer,status) VALUES (?,'Customer','review')").run(raw).lastInsertRowid);
  const stmt=db().prepare('INSERT INTO quote_lines (quote_id,pos,line_ref,comp_sku,comp_desc,qty,comp_unit_price) VALUES (?,?,?,?,?,?,?)');
  lines.forEach((l,i)=>stmt.run(id,i,l.line_ref,l.comp_sku,l.comp_desc,l.qty,l.comp_unit_price));return id;
}
function form(id) {
  const q=getQuote(id),f=new FormData();
  for(const [k,v] of Object.entries({revision:q.revision,customer:q.customer,reviewer_name:'Test reviewer', currency_confirmed:'on',quantities_verified:'on'})) f.set(k,String(v));
  for(const l of q.lines) {
    for(const [k,v] of Object.entries({qty:l.qty,oq:l.our_qty??l.qty,price:l.comp_unit_price??'',sku:l.our_sku||'NA',mode:l.quantity_mode||'auto',note:'Verified requirement and circuit/fit plan.',accept:'on'})) f.set(`${k}_${l.id}`,String(v));
    if(l.include) f.set(`inc_${l.id}`,'on');
  } return f;
}

test('ten eight-foot channels use 25 one-metre sections and three bundles, with joints disclosed',async()=>{
  const rows=await proposed([line(1,'Surface U-channel aluminum 8ft',10)]);
  assert.equal(rows[0].our_sku,'CHAN');assert.equal(rows[0].our_qty,25);
  const c=calculateComparison({lines:rows},cat,'pack');
  assert.equal(c.orders[0].packs,3);assert.equal(c.orders[0].orderPieces,30);assert.equal(c.totals.ours,150);
  assert.match(rows[0].difference_notes,/one-metre.*joined sections/);assert.equal(rows[0].match_kind,'alternative');
});
test('channel profiles stay authoritative and unknown profiles require review',async()=>{
  assert.equal((await proposed([line(1,'Corner aluminum channel 12ft',2)]))[0].our_sku,'CORNER');
  const unknown=(await proposed([line(1,'Aluminum channel 4ft',2)]))[0];assert.equal(unknown.match_kind,'review');assert.match(unknown.difference_notes,/profile/);
});
test('previously imported channels use retained bundle metadata without requiring a catalog reload',async()=>{
  replaceCatalog(catalog,'test');db().prepare("UPDATE catalog_items SET category='other',pack_qty=1,unit_price=pack_price WHERE sku='CHAN'").run();
  const source=line(1,'Surface U-channel aluminum 8ft',10),{results}=await matchLines([source]);
  assert.equal(results[1].sku,'CHAN');
  const current=catalogBySku(),rows=evaluateCrossovers([{...source,our_sku:'CHAN'}],current);
  const c=calculateComparison({lines:rows},current,'pack');assert.equal(c.orders[0].packs,3);assert.equal(c.totals.ours,150);
});
test('driver examples use total rated capacity and honest whole-case costs',async()=>{
  for(const [qty,watts,sku,count] of [[10,30,'D60',5],[8,120,'D100',10],[3,200,'D100',6],[2,300,'D100',6]]) {
    const rows=await proposed([line(1,`24V ${watts}W non-dimmable driver`,qty)]);
    assert.equal(rows[0].our_sku,sku);assert.equal(rows[0].our_qty,count);assert.equal(rows[0].match_kind,'review');
    const c=calculateComparison({lines:rows},cat,'pack');assert.equal(c.orders[0].requiredPieces,count);assert.equal(c.orders[0].packs,1);
    assert.match(rows[0].difference_notes,/reviewed wiring plan/);
  }
});
test('driver capacity pools across rows without dropping a zero-allocation source line',async()=>{
  const rows=await proposed([line(1,'24V 30W non-dimmable driver'),line(2,'24V 30W non-dimmable driver')]);
  assert.equal(rows.reduce((n,l)=>n+l.our_qty,0),1);
  const c=calculateComparison({lines:rows},cat,'pack');assert.equal(c.counts.compared,2);assert.equal(c.totals.theirs,100);assert.equal(c.totals.ours,60);
  assert.equal(c.rows[0].ourTotal,30);assert.equal(c.rows[1].ourTotal,30);
});
test('driver pooling keeps explicit source circuits apart',()=>{
  const rows=evaluateCrossovers([line(1,'24V 30W driver',1,'D60'),{...line(2,'24V 30W driver',1,'D60'),group_label:'Separate circuit'}],cat);
  assert.equal(rows.reduce((n,l)=>n+l.our_qty,0),2);
});
test('tape widths 8/10/12 remain eligible; 6/5 are excluded',async()=>{
  for(const width of [8,10,12,6,5]) {
    const r=(await proposed([line(1,`24V tape light 3000K 200 lm/ft ${width}mm 5ft`)]))[0];
    assert.equal(!!r.our_sku,width>=8);
    if(width>=8 && width!==10) assert.match(r.difference_notes,new RegExp(`10mm.*${width}mm.*Confirm fit`));
  }
});
test('output alternatives cover 100→200, 300→300 and 600→500; 700+ is excluded',async()=>{
  for(const [output,sku] of [[100,'T200'],[200,'T200'],[300,'T300'],[600,'T500'],[700,null],[800,null]]) {
    const r=(await proposed([line(1,`24V tape light 3000K ${output} lm/ft 10mm 5ft`)]))[0];assert.equal(r.our_sku,sku);
    if(output===100) assert.match(r.difference_notes,/100 lm\/ft higher/);
    if(output===600) assert.match(r.difference_notes,/100 lm\/ft lower/);
  }
});
test('output is normalized to the same length basis',async()=>{
  const r=(await proposed([line(1,'24V tape light 3000K 656.168 lm/m 10mm 5ft')]))[0];
  assert.equal(r.our_sku,'T200');assert.doesNotMatch(r.difference_notes,/Output:/);
});
test('AI cannot replace the 100-to-200 crossover with a legacy 100-lumen catalog SKU',async()=>{
  const legacy=make('T100','24V tape light 3000K 100 lm/ft',90,['Case (10 pcs)'],'10mm IP20 Roll length: 16.4 ft');
  replaceCatalog([...catalog,legacy],'test');setSetting('llm_provider','custom');setSetting('llm_model','mock');setSetting('llm_base_url','https://mock.invalid');
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({matches:[{id:1,sku:'T100',confidence:'high',reason:'Exact output.'}]})}}]}));
    const source=line(1,'24V tape light 3000K 100 lm/ft 8mm 10ft',5),{results}=await matchLines([source]);
    assert.equal(results[1].sku,'T200');assert.match(results[1].reason,/100 lm\/ft higher/);
  } finally {globalThis.fetch=original;setSetting('llm_provider','none');}
});
test('imported terminal-block PCB width takes priority over housing size and pin distance',async()=>{
  const block=make('ACTUAL-BLOCK','Terminal Block: Strip to Wire',87.89,['10 Packs - 12 pcs per pack (120 pcs)'],
    'Size; 13.3×11.5×6.4mm; Pin Quantity; 2; Pin Distance; 4.5 mm; IP20; PCB Width; 10mm; PCB Thickness; 0.25 ~0.35 mm');
  assert.equal(productSpecs(block).width_mm,10);
  assert.equal(productSpecs({...block,specification_values:{width_mm:null}}).width_mm,null);
  replaceCatalog([catalog[0],block],'test');
  const sources=[line(1,'24V tape light 3000K 100 lm/ft 8mm 10ft'),line(2,'8mm 2 pin terminal block strip to wire',10)];
  const {results}=await matchLines(sources);
  assert.equal(results[2].sku,'ACTUAL-BLOCK');assert.match(results[2].reason,/Conditional on using the Avery 10mm tape.*not compatible with the original 8mm/);
  const isolated=await matchLines([sources[1]]);assert.equal(isolated.results[2].sku,null);
});
test('8mm terminal blocks cross to 10mm only with corresponding included Avery tape',async()=>{
  const tape=line(1,'24V tape light 3000K 200 lm/ft 8mm 5ft');const block=line(2,'8mm terminal block 2 pin',3,'BLOCK');
  const rows=await proposed([tape,block]);assert.equal(rows[1].our_sku,'BLOCK');assert.match(rows[1].difference_notes,/Conditional.*not compatible with the original 8mm/);
  assert.deepEqual(JSON.parse(rows[1].dependency_ids),[1]);
  assert.equal((await proposed([block]))[0].our_sku,null);
  const excluded=evaluateCrossovers([{...rows[0],include:0},rows[1]],cat);assert.ok(excluded[1].blockers.length);
});
test('partial rematching retains confirmed tape context for dependent terminal blocks',async()=>{
  const id=insert([line(1,'24V tape light 3000K 200 lm/ft 8mm 5ft'),line(2,'8mm terminal block 2 pin',3,'BLOCK')]);
  await rematch(id);
  const tape=getQuote(id).lines[0];db().prepare('UPDATE quote_lines SET confirmed=1 WHERE id=?').run(tape.id);
  await rematch(id);
  const q=getQuote(id);assert.equal(q.lines[0].confirmed,1);assert.equal(q.lines[1].our_sku,'BLOCK');
  assert.deepEqual(JSON.parse(q.lines[1].dependency_ids),[tape.id]);
});
test('confirmation rechecks terminal-block dependencies after excluding tape',async()=>{
  const id=insert([line(1,'24V tape light 3000K 200 lm/ft 8mm 5ft'),line(2,'8mm terminal block 2 pin',3,'BLOCK')]);await rematch(id);
  const q=getQuote(id),f=form(id);f.delete(`inc_${q.lines[0].id}`);
  assert.throws(()=>saveReview(id,f,true),/Connector width mismatch/);
});
test('automatic quantity changes must be saved before confirming the displayed purchase',async()=>{
  const id=insert([line(1,'24V tape light 3000K 200 lm/ft 10mm 10ft',3)]);await rematch(id);
  const f=form(id);f.set(`qty_${getQuote(id).lines[0].id}`,'5');
  assert.throws(()=>saveReview(id,f,true),/Save to recalculate/);
  saveReview(id,f);saveReview(id,form(id),true);assert.equal(getQuote(id).lines[0].our_qty,5);
});
test('exact checked tape specs and unknown brightness produce different classifications',async()=>{
  assert.equal((await proposed([line(1,'24V tape light 3000K 200 lm/ft 10mm 16.4ft')]))[0].match_kind,'exact');
  assert.equal((await proposed([line(1,'24V tape light 3000K 10mm 16.4ft')]))[0].match_kind,'review');
});
test('review changes recompute rolls rather than scaling a rounded ratio',async()=>{
  const id=insert([line(1,'24V tape light 3000K 200 lm/ft 10mm 7ft',3)]);await rematch(id);
  const lid=getQuote(id).lines[0].id;assert.equal(getQuote(id).lines[0].our_qty,2);
  const f=form(id);f.set(`qty_${lid}`,'6');saveReview(id,f);assert.equal(getQuote(id).lines[0].our_qty,3);
  const g=form(id);g.set(`qty_${lid}`,'4');saveReview(id,g);assert.equal(getQuote(id).lines[0].our_qty,2);
});
test('continuous tape cuts cannot be allocated on footage alone; metre explanations keep metres',()=>{
  const rows=evaluateCrossovers([line(1,'24V tape light 3000K 200 lm/ft 10mm 10ft',3),line(2,'24V tape light 3000K 200 lm/ft 10mm priced per metre',10)],cat);
  assert.equal(rows[0].our_qty,3);assert.match(rows[1].qty_basis,/10 m = 32.81 ft/);
});
test('unknown lengths require documented manual quantity and per-line acceptance',async()=>{
  const id=insert([line(1,'24V tape light 3000K 200 lm/ft 10mm',2)]);await rematch(id);
  assert.throws(()=>saveReview(id,form(id),true),/manual quantity/);
  const l=getQuote(id).lines[0],f=form(id);f.set(`mode_${l.id}`,'manual');f.set(`oq_${l.id}`,'3');f.delete(`accept_${l.id}`);
  assert.throws(()=>saveReview(id,f,true),/explicitly accept/);f.set(`accept_${l.id}`,'on');saveReview(id,f,true);assert.equal(getQuote(id).status,'done');
});
test('source-total differences must be corrected or explicitly explained',async()=>{
  const id=insert([]);await runPipeline(id,'1 SRC-DRIVER $100.00 1 $100.00\n24V 100W non-dimmable driver\n\nQuote Total: $200.00');
  assert.throws(()=>saveReview(id,form(id),true),/source total difference/);
  const f=form(id);f.set('reconciliation_note','Verified $100 freight excluded from product comparison.');saveReview(id,f,true);
  assert.match(JSON.parse(getQuote(id).summary_snapshot).quote.reconciliation_note,/freight/);
});
test('AI cannot silently restore a price contradicted by printed arithmetic',async()=>{
  setSetting('llm_provider','custom');setSetting('llm_model','mock');setSetting('llm_base_url','https://mock.invalid');
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({lines:[{line:'1',sku:'SRC-DRIVER',description:'24V 100W driver',qty:5,unit_price:10}]})}}]}));
    const ex=await extractQuote('1 SRC-DRIVER $10.00 5 $60.00\n24V 100W driver');assert.equal(ex.lines[0].unit_price,null);assert.match(ex.warnings.join(' '),/extended price/);
  } finally {globalThis.fetch=original;setSetting('llm_provider','none');}
});
test('upload validation rejects disguised files and enforces aggregate capacity',()=>{
  assert.equal(sourceMime('x.png',Buffer.from([137,80,78,71,13,10,26,10])),'image/png');
  assert.equal(sourceMime('x.jpeg',Buffer.from([255,216,255,224])),'image/jpeg');
  assert.throws(()=>sourceMime('x.png',Buffer.from('%PDF-1.7')),/content/);
  assert.throws(()=>validateUploads([{name:'a.pdf',size:10*1024*1024},{name:'b.png',size:10*1024*1024}]),/18 MB/);
});
test('all provider adapters send image content in their native formats',async()=>{
  const original=globalThis.fetch;const image={mime:'image/png',data:'test-base64'};
  try {
    for(const provider of ['anthropic','gemini','openai','openrouter','custom']) {
      let payload;globalThis.fetch=async(_url,opts)=>{payload=JSON.parse(opts.body);return new Response(JSON.stringify(provider==='anthropic'?{content:[{text:'OK'}]}:provider==='gemini'?{candidates:[{content:{parts:[{text:'OK'}]}}]}:{choices:[{message:{content:'OK'}}]}));};
      assert.equal(await complete({system:'s',user:'u',images:[image]},{provider,model:'mock',apiKey:'mock',baseUrl:''}),'OK');
      const content=provider==='gemini'?payload.contents[0].parts:payload.messages[provider==='anthropic'?0:1].content;
      assert.equal(Array.isArray(content),true);assert.match(JSON.stringify(content),/test-base64/);
    }
  } finally {globalThis.fetch=original;}
});
test('image intake retains its original type and reads transcribed lines with a mocked vision provider',async()=>{
  replaceCatalog(catalog,'test');setSetting('llm_provider','custom');setSetting('llm_model','vision-mock');setSetting('llm_base_url','https://mock.invalid');
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async(_url,opts)=>{
      const body=JSON.parse(opts.body);const imageCall=Array.isArray(body.messages[1].content);
      const reply=imageCall ? {customer:'Image customer',source_text:'1 SRC-DRIVER $50.00 10 $500.00\n24V 30W non-dimmable driver\n\nQuote Total: $500.00',lines:[{line:'1',sku:'SRC-DRIVER',description:'24V 30W non-dimmable driver',qty:10,unit_price:50}]} : {matches:[]};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(reply)}}]}));
    };
    const id=await createQuoteFromSource('quote.png',Buffer.from([137,80,78,71,13,10,26,10]));const q=getQuote(id);
    assert.equal(q.source_type,'image/png');assert.equal(q.extractor,'vision');assert.equal(q.customer,'Image customer');assert.equal(q.lines[0].our_qty,5);assert.equal(q.status,'review');
  } finally {globalThis.fetch=original;setSetting('llm_provider','none');}
});
