// Historical v0.9 baseline reproductions: these assert the old defects and are not regression tests for the corrected implementation.
// Audit evidence for commit 0156d77, October 12, 2026.
// A successful exit means the documented defects were reproduced, NOT that the app is safe.
// Uses a new disposable database and mocked AI; never opens existing app data or calls live services.
// Convert these scenarios into regression tests of corrected behavior when fixing each finding.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'avery-audit-repros-'));
process.env.DATA_DIR = data;
const {db,setSetting} = await import('../lib/db.js');
const {toItem,replaceCatalog} = await import('../lib/catalog.js');
const {runPipeline,rematch,getQuote} = await import('../lib/quotes.js');
const {saveReview} = await import('../lib/review.js');
const {extractQuote,extractWithRules} = await import('../lib/extract.js');
const {tapeRolls} = await import('../lib/requirements.js');
const {assessMatch} = await import('../lib/match-safety.js');
const tape=toItem({handle:'audit-tape',sku:'AUDIT-TAPE-CT1',title:'24V tape light 3000K 200 lm/ft',price:20,options:['Case (1 pcs)'],specs:'Roll length: 16.4 ft; IP65',source:'audit'});
const driver=toItem({handle:'audit-driver',sku:'AUDIT-DRIVER-CT1',title:'24V 100W non-dimmable driver',price:20,options:['Case (1 pcs)'],specs:'IP20 AC input 100–240V',source:'audit'});
replaceCatalog([tape,driver],'audit');
function quote(desc,qty=3) {
 const id=Number(db().prepare("INSERT INTO quotes (raw_text,customer,status) VALUES ('Source USD','Audit customer','review')").run().lastInsertRowid);
 db().prepare("INSERT INTO quote_lines (quote_id,pos,line_ref,comp_sku,comp_desc,qty,comp_unit_price) VALUES (?,0,'1','SOURCE-TAPE',?,?,100)").run(id,desc,qty);
 return id;
}
function form(id) {
 const q=getQuote(id),f=new FormData();
 for(const [k,v] of Object.entries({revision:q.revision,customer:q.customer,currency_confirmed:'on',quantities_verified:'on'})) f.set(k,String(v));
 for(const l of q.lines) {
  for(const [k,v] of Object.entries({qty:l.qty,oq:l.our_qty??l.qty,price:l.comp_unit_price??'',sku:l.our_sku||'NA',note:''})) f.set(`${k}_${l.id}`,String(v));
  if(l.include) f.set(`inc_${l.id}`,'on');
 }
 return f;
}
try {
 const cut=tapeRolls({qty:3,comp_desc:'24V tape light 3000K 200 lm/ft 10ft'},tape);
 assert.equal(cut.rolls,2);
 console.log('CUT_FEASIBILITY',JSON.stringify({returnedRolls:cut.rolls,continuous10ftCutsPossible:2,requiredCuts:3}));

 const id=quote('24V tape light 3000K 200 lm/ft 7ft',3);
 await rematch(id);
 assert.equal(getQuote(id).lines[0].our_qty,2);
 const f=form(id),lid=getQuote(id).lines[0].id;
 f.set(`qty_${lid}`,'6');
 saveReview(id,f);
 const edited=getQuote(id).lines[0];
 assert.equal(edited.our_qty,4);
 const recalculated=tapeRolls(edited,tape).rolls;
 assert.equal(recalculated,3);
 console.log('QUANTITY_EDIT',JSON.stringify({savedRolls:edited.our_qty,recalculatedRolls:recalculated,basis:edited.qty_basis}));
 const other=quote('24V tape light 3000K 200 lm/ft 7ft',3);
 await rematch(other);
 const g=form(other);g.set(`qty_${getQuote(other).lines[0].id}`,'4');
 assert.throws(()=>saveReview(other,g),/whole number/);
 console.log('QUANTITY_EDIT_FRACTIONAL','3 -> 4 source pieces rejects save instead of recomputing rolls');

 const missing=quote('24V tape light 3000K 200 lm/ft',2);
 await rematch(missing);
 assert.equal(getQuote(missing).lines[0].confidence,'low');
 saveReview(missing,form(missing),true);
 assert.equal(getQuote(missing).status,'done');
 console.log('MISSING_LENGTH_CONFIRMED',JSON.stringify({status:getQuote(missing).status,sourceLength:'missing',ourQty:getQuote(missing).lines[0].our_qty,customerNote:getQuote(missing).lines[0].customer_note}));

 const wet=assessMatch({comp_desc:'24V tape light 3000K 200 lm/ft 5ft IP68'},tape);
 assert.deepEqual(wet.blockers,[]); assert.deepEqual(wet.gaps,[]);
 console.log('IP68_TO_IP65',JSON.stringify(wet));

 const mismatch=Number(db().prepare("INSERT INTO quotes (raw_text,customer,status) VALUES ('Source USD','Audit customer','review')").run().lastInsertRowid);
 await runPipeline(mismatch,'1 SRC-24V-100W $100.00 1 $100.00\n24V 100W non-dimmable driver\n\nQuote Total: $200.00');
 const warning=getQuote(mismatch).error;
 assert.match(warning,/prints \$200/);
 saveReview(mismatch,form(mismatch),true);
 assert.equal(getQuote(mismatch).status,'done');
 console.log('UNRESOLVED_TOTAL_CONFIRMED',JSON.stringify({status:getQuote(mismatch).status,warning}));

 const source='1 SRC-24V-100W $10.00 5 $60.00\n24V 100W non-dimmable driver';
 const rules=extractWithRules(source);
 assert.equal(rules.lines[0].unit_price,null);
 setSetting('llm_provider','custom');setSetting('llm_model','audit-mock');setSetting('llm_base_url','https://mock.invalid');
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({lines:[{line:'1',sku:'SRC-24V-100W',description:'24V 100W non-dimmable driver',qty:5,unit_price:10}]})}}]}));
  const ai=await extractQuote(source);
  assert.equal(ai.extractor,'ai');assert.equal(ai.lines[0].unit_price,10);assert.equal(ai.warnings,undefined);
  console.log('AI_DROPS_PRICE_CONFLICT',JSON.stringify({rulePrice:rules.lines[0].unit_price,ruleWarning:rules.warnings[0],aiPrice:ai.lines[0].unit_price,aiWarnings:ai.warnings||[]}));
 } finally {globalThis.fetch=original;setSetting('llm_provider','none');}
 const metre=tapeRolls({qty:10,comp_desc:'24V tape light 3000K 200 lm/ft priced per metre'},tape);
 assert.match(metre.working,/10 ft = 32\.81 ft/);
 console.log('METRE_TEXT',metre.working);
} finally { db().close();fs.rmSync(data,{recursive:true,force:true}); }
