import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'avery-workbench-'));
process.env.DATA_DIR=path.join(folder,'data');
const {db,UPLOAD_DIR}=await import('../lib/db.js');
const {toItem,replaceCatalog,catalogBySku}=await import('../lib/catalog.js');
const {getQuote,rematch,summaryDocument}=await import('../lib/quotes.js');
const {saveReview}=await import('../lib/review.js');
const {quoteHistory,saveOutcome}=await import('../lib/history.js');
const {saveProductSpecs}=await import('../lib/catalog-spec-review.js');
const {productSpecs,SPEC_FIELDS}=await import('../lib/product-specs.js');
const {evaluateCrossovers}=await import('../lib/crossover.js');
const {installationPlan}=await import('../lib/installation.js');
const {alternativeOptions}=await import('../lib/alternatives.js');
const {purchaseCsv,reviewedExpectation}=await import('../lib/exports.js');
const {evaluateBenchmark}=await import('../lib/benchmark.js');
const {backupData,restoreData}=await import('../lib/backup.js');
const {briefConditions}=await import('../lib/proposal.js');
const make=(sku,title,price,options,specs)=>toItem({handle:sku,sku,title,price,options,specs,source:'test'});
const catalog=[make('T200','24V 3000K tape light 200 lm/ft',100,['Case (10 pcs)'],'10mm IP20 Roll length 16.4ft; 3W/ft'),make('T500','24V 3000K tape light 500 lm/ft',150,['Case (10 pcs)'],'10mm IP20 Roll length 16.4ft; 9W/ft'),make('D60','24V 60W non-dimmable driver',60,['Case (10 pcs)'],'IP20'),make('CHAN','Surface U-channel aluminum',50,['Bundle (10 sections)'],'Section length 1m')];
const row=(id,desc,qty=1,sku='T200',group='')=>({id,pos:id-1,line_ref:String(id),comp_sku:`SRC-${id}`,comp_desc:desc,qty,comp_unit_price:30,our_sku:sku,our_qty:qty,include:1,na:0,quantity_mode:'auto',group_label:group,fixed_multiplier:1});
function quote(lines=[row(1,'24V 30W non-dimmable driver',10,'D60')],raw='Original source USD') {
  replaceCatalog(catalog,'test');
  const id=Number(db().prepare("INSERT INTO quotes (customer,raw_text,status) VALUES ('Customer',?,'review')").run(raw).lastInsertRowid);
  const insert=db().prepare('INSERT INTO quote_lines (quote_id,pos,line_ref,comp_sku,comp_desc,qty,comp_unit_price,our_sku,our_qty,group_label) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for(const l of lines) insert.run(id,l.pos,l.line_ref,l.comp_sku,l.comp_desc,l.qty,l.comp_unit_price,l.our_sku,l.our_qty,l.group_label);
  return id;
}
function form(id) {
  const q=getQuote(id),f=new FormData();
  for(const [k,v] of Object.entries({revision:q.revision,customer:q.customer,currency_confirmed:'on',quantities_verified:'on',reviewer_name:'Review tester',driver_basis:q.driver_basis,design_headroom:q.design_headroom ?? '',installation_note:q.installation_note || '',source_charges:q.source_charges})) f.set(k,String(v));
  for(const l of q.lines) {
    for(const [k,v] of Object.entries({qty:l.qty,oq:l.our_qty??l.qty,price:l.comp_unit_price??'',sku:l.our_sku||'NA',mode:l.quantity_mode,source_sku:l.comp_sku,source_desc:l.comp_desc,group:l.group_label||'',note:l.customer_note||'Verified installation and circuit plan.',decision:l.decision_note||'',accept:'on'})) f.set(`${k}_${l.id}`,String(v));
    if(l.include) f.set(`inc_${l.id}`,'on');
  }return f;
}
function specForm(item,over={}) {
  const f=new FormData(),s=productSpecs(item);
  for(const key of Object.keys(SPEC_FIELDS)) f.set(key,String(s[key] ?? ''));
  f.set('length_ft','16.4');f.set('profile',s.profile || '');f.set('cct',s.cct || '');f.set('ip_rating',s.ip_rating || '');f.set('dimmable',s.dimmable===1?'yes':s.dimmable===0?'no':'');
  f.set('verified_by','Product tester');f.set('reference','Synthetic datasheet');f.set('specs_verified','on');
  for(const [key,value] of Object.entries(over)) f.set(key,String(value));return f;
}
after(()=>{db().close();fs.rmSync(folder,{recursive:true,force:true});});

test('source corrections, insertion and removal retain original text and record before/after evidence',async()=>{
  const id=quote();await rematch(id);const l=getQuote(id).lines[0],edit=form(id);edit.set(`source_desc_${l.id}`,'24V 60W non-dimmable driver');edit.set(`decision_${l.id}`,'Corrected a misread driver rating.');saveReview(id,edit);
  assert.equal(getQuote(id).lines[0].our_qty,10);assert.equal(getQuote(id).raw_text,'Original source USD');
  const add=form(id);for(const [k,v] of Object.entries({intent:'addline',new_sku:'MISSED-1',new_desc:'24V 3000K tape light 200 lm/ft 10mm 10ft',new_qty:'3',new_price:'25',new_ref:'2'})) add.set(k,v);saveReview(id,add);
  assert.equal(getQuote(id).lines.length,2);assert.equal(quoteHistory(id)[0].details.added[0].sku,'MISSED-1');
  const remove=form(id);remove.set(`remove_${l.id}`,'on');saveReview(id,remove);assert.equal(getQuote(id).lines.length,1);assert.equal(quoteHistory(id)[0].details.removed[0].description,'24V 60W non-dimmable driver');
});
test('invalid missing-line intake and stale forms cannot partially save source corrections',async()=>{
  const id=quote();await rematch(id);const f=form(id);f.set('intent','addline');f.set('new_sku','NEW-1');f.set('new_desc','Tape');f.set('new_qty','0');f.set('customer','Must not save');
  assert.throws(()=>saveReview(id,f),/positive quantity/);assert.equal(getQuote(id).customer,'Customer');
  const stale=form(id);saveReview(id,form(id));assert.throws(()=>saveReview(id,stale),/Someone changed/);
});
test('freight, tax and positive discount deductions reconcile the source without changing product savings',async()=>{
  const id=quote(undefined,'USD\nQuote Total: $315.00');await rematch(id);const f=form(id);
  for(const [k,v] of Object.entries({charge_freight:'20',charge_tax:'5',charge_discount:'10',charge_other:''})) f.set(k,v);
  saveReview(id,f,true);const doc=summaryDocument(getQuote(id));assert.equal(doc.comparison.totals.theirs,300);assert.equal(doc.comparison.totals.ours,60);assert.equal(JSON.parse(doc.quote.source_charges).reduce((n,c)=>n+c.amount,0),15);
});
test('confirmation requires a named reviewer and outcomes preserve the frozen customer document',async()=>{
  const id=quote();await rematch(id);const f=form(id);f.set('reviewer_name','');assert.throws(()=>saveReview(id,f,true),/reviewer name/);
  saveReview(id,form(id),true);const q=getQuote(id),outcome=new FormData();outcome.set('revision',String(q.revision));outcome.set('outcome','declined');outcome.set('actor','Reviewer');
  assert.throws(()=>saveOutcome(id,outcome),/reason/);outcome.set('outcome_note','Customer needs a different mounting profile.');saveOutcome(id,outcome);
  assert.equal(getQuote(id).summary_snapshot,q.summary_snapshot);assert.equal(quoteHistory(id)[0].event_type,'outcome');assert.throws(()=>saveOutcome(id,outcome),/changed/);
});
test('verified fields override inference, unknown fields stay unknown, and changed catalog metadata invalidates verification',()=>{
  replaceCatalog(catalog,'test');let item=catalogBySku().T200;
  saveProductSpecs('T200',specForm(item,{voltage_v:'12',watts_ft:'',width_mm:'12'}));item=catalogBySku().T200;
  assert.equal(productSpecs(item).voltage_v,12);assert.equal(productSpecs(item).watts_ft,null);assert.equal(productSpecs(item).width_mm,12);
  const row24=evaluateCrossovers([row(1,'24V 3000K tape light 200 lm/ft 10mm 10ft')],catalogBySku())[0];assert.match(row24.blockers.join(' '),/Voltage mismatch/);
  replaceCatalog(catalog.map((i)=>i.sku==='T200'?{...i,pack_price:999}:i),'new price');assert.equal(productSpecs(catalogBySku().T200).voltage_v,12);
  replaceCatalog(catalog.map((i)=>i.sku==='T200'?{...i,specs:i.specs+' Updated construction.'}:i),'new specs');item=catalogBySku().T200;
  assert.equal(item.specification_stale,true);assert.equal(productSpecs(item).voltage_v,24);assert.equal(item.specification_values,undefined);
});
test('specification verification protects against invalid pack counts and stale edits',()=>{
  replaceCatalog(catalog,'test');const f=specForm(catalogBySku().T500,{pack_qty:'1.5'});assert.throws(()=>saveProductSpecs('T500',f),/whole number/);
  f.set('pack_qty','10');f.set('spec_revision','');saveProductSpecs('T500',f);assert.throws(()=>saveProductSpecs('T500',f),/Another reviewer/);
});
test('selected tape load recalculates driver quantity with reviewed headroom and changes when tape power changes',()=>{
  const current=Object.fromEntries(catalog.map((i)=>[i.sku,i]));
  const lines=[row(1,'24V 3000K tape light 200 lm/ft 10mm 10ft',3,'T200','Circuit A'),row(2,'24V 30W non-dimmable driver',10,'D60','Circuit A')];
  let planned=evaluateCrossovers(lines,current,{driverBasis:'tape_load',headroom:25});assert.equal(planned[1].our_qty,2);assert.match(planned[1].difference_notes,/selected replacement tape load with reviewed headroom/);assert.doesNotMatch(planned[1].difference_notes,/using total rated job capacity/);
  assert.equal(installationPlan({lines:planned,design_headroom:25},current).groups[0].requiredWatts,112.5);
  planned=evaluateCrossovers([{...lines[0],our_sku:'T500'},lines[1]],current,{driverBasis:'tape_load',headroom:25});assert.equal(planned[1].our_qty,6);
  assert.match(evaluateCrossovers(lines,current,{driverBasis:'tape_load'})[1].quantity_problem,/headroom/);
  assert.match(evaluateCrossovers(lines.map((l)=>({...l,group_label:''})),current,{driverBasis:'tape_load',headroom:25})[1].quantity_problem,/explicit circuit/);
});
test('grouped installation checks block inadequate capacity, voltage conflicts and too-narrow channels',()=>{
  const current=Object.fromEntries(catalog.map((i)=>[i.sku,i]));
  const lines=[row(1,'24V 3000K tape light 500 lm/ft 10mm 10ft',3,'T500','A'),row(2,'24V 30W driver',1,'D60','A')];
  assert.match(installationPlan({lines,design_headroom:25},current).blockers.join(' '),/below/);
  const wrongVoltage={...current,D60:{...current.D60,specification_values:{voltage_v:12}}};assert.match(installationPlan({lines},wrongVoltage).blockers.join(' '),/voltages differ/);
  const narrow={...current,CHAN:{...current.CHAN,specification_values:{channel_inner_mm:8}}};assert.match(installationPlan({lines:[lines[0],row(3,'Surface U-channel 8ft',1,'CHAN','A')]},narrow).blockers.join(' '),/usable width/);
  assert.equal(installationPlan({lines:lines.map((l)=>({...l,group_label:''}))},current).blockers.length,0);
});
test('maximum tape run specification requires an explicit feed and segmentation review',()=>{
  const current=Object.fromEntries(catalog.map((i)=>[i.sku,i]));current.T200={...current.T200,specification_values:{max_run_ft:5}};
  const planned=evaluateCrossovers([row(1,'24V 3000K tape light 200 lm/ft 10mm 10ft')],current)[0];assert.equal(planned.review_required,1);assert.match(planned.difference_notes,/maximum continuous run/);
});
test('lowest-cost alternative accounts for shared packs across the current quote',()=>{
  const a=make('CASE','24V 3000K tape light 200 lm/ft',50,['Case (10 pcs)'],'10mm IP20 Roll length 16.4ft');
  const b=make('EACH','24V 3000K tape light 200 lm/ft',8,['Each'],'10mm IP20 Roll length 16.4ft');
  const current={CASE:a,EACH:b};const lines=[row(1,'24V 3000K tape light 200 lm/ft 10mm 10ft',3,'CASE'),row(2,'24V 3000K tape light 200 lm/ft 10mm 16.4ft',1,'CASE')];
  const options=alternativeOptions({lines},lines[0],current);const cheap=options.find((o)=>o.label==='Lowest purchase cost');assert.equal(cheap.sku,'CASE');assert.equal(cheap.jobTotal,50);
});
test('purchase CSV uses frozen prices and protects spreadsheet formula cells; expectations retain excluded source rows',async()=>{
  const id=quote();await rematch(id);saveReview(id,form(id),true);const doc=summaryDocument(getQuote(id));
  replaceCatalog(catalog.map((i)=>({...i,pack_price:999})),'changed');assert.match(purchaseCsv(summaryDocument(getQuote(id))),/"60"/);
  const unsafe={...doc,comparison:{...doc.comparison,orders:doc.comparison.orders.map((o)=>({...o,title:'=HYPERLINK("bad")'}))}};assert.match(purchaseCsv(unsafe),/'=HYPERLINK/);
  const e=reviewedExpectation(doc);assert.equal(e.reviewed_by,'Review tester');assert.equal(e.expected.lines[0].qty,10);assert.throws(()=>purchaseCsv({...doc,ready:false}),/Confirm/);
});
test('benchmark detects missing lines, field errors and total errors independently',()=>{
  const actual={rows:[{line_ref:'1',comp_sku:'S1',qty:2,comp_unit_price:5,our_sku:null,ourQty:2,include:0}],totals:{theirs:0,ours:0,savings:0,pct:null}};
  const expected={lines:[{line_ref:'1',sku:'S1',qty:2,unit_price:5,avery_sku:null,our_qty:null,include:false}],totals:actual.totals};assert.equal(evaluateBenchmark(actual,expected).passed,true);
  const bad=evaluateBenchmark(actual,{lines:[{sku:'S1',qty:3,unit_price:5},{sku:'MISSING',qty:1,unit_price:null}],totals:{ours:99}});assert.ok(bad.issues.some((i)=>i.type==='missing_line'));assert.ok(bad.issues.some((i)=>i.type==='field_mismatch'));assert.ok(bad.issues.some((i)=>i.type==='total_mismatch'));
});
test('benchmark CLI runs against a synthetic corpus and refuses a reused evaluation database',()=>{
  const manifest=path.resolve('tests/fixtures/benchmark/manifest.json'),report=path.join(folder,'benchmark.json'),env={...process.env,DATA_DIR:path.join(folder,'benchmark-data'),BENCHMARK_PROVIDER:''};
  const r=spawnSync(process.execPath,['scripts/run-benchmark.mjs',manifest,report],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(fs.readFileSync(report,'utf8')).passed,1);
  const reused=spawnSync(process.execPath,['scripts/run-benchmark.mjs',manifest,report],{env,encoding:'utf8'});assert.notEqual(reused.status,0);assert.match(reused.stderr,/already contains quotes/);
});
test('backup and restore verify database and uploads, rebase paths and refuse overwrite or tampering',async()=>{
  const id=quote();const source=path.join(UPLOAD_DIR,'synthetic-source.png');fs.writeFileSync(source,Buffer.from([137,80,78,71,13,10,26,10]));db().prepare('UPDATE quotes SET file_path=? WHERE id=?').run(source,id);
  const backup=path.join(folder,'backup'),restored=path.join(folder,'restored');await backupData(process.env.DATA_DIR,backup);await restoreData(backup,restored);
  const d=new Database(path.join(restored,'quotes.db'),{readonly:true});const original=d.prepare('SELECT file_path FROM quotes WHERE id=?').get(id).file_path;d.close();assert.equal(original,path.join(restored,'uploads','synthetic-source.png'));assert.deepEqual(fs.readFileSync(original),fs.readFileSync(source));
  await assert.rejects(restoreData(backup,restored),/already exists/);fs.appendFileSync(path.join(backup,'uploads','synthetic-source.png'),'tampered');await assert.rejects(restoreData(backup,path.join(folder,'bad-restore')),/integrity/);
});
test('concise customer conditions preserve width/output and conditional connector differences',()=>{
  const current=Object.fromEntries(catalog.map((i)=>[i.sku,i]));const line=evaluateCrossovers([row(1,'24V 3000K tape light 100 lm/ft 8mm 10ft')],current)[0];
  const note=briefConditions({...line,our:current.T200});assert.match(note,/10mm.*8mm/);assert.match(note,/200 versus 100 lm\/ft/);assert.match(note,/compatible drivers/);
});


test('saved circuit configuration changes quantities and confirmation rejects insufficient manual capacity',async()=>{
  db().prepare('DELETE FROM product_specs').run();
  const id=quote([row(1,'24V 3000K tape light 200 lm/ft 10mm 10ft',3,'T200','A'),row(2,'24V 30W non-dimmable driver',10,'D60','A')]);await rematch(id);
  const f=form(id);f.set('driver_basis','tape_load');f.set('design_headroom','25');saveReview(id,f);
  assert.equal(getQuote(id).lines[1].our_qty,2);saveReview(id,form(id),true);
  const unsafe=form(id),driver=getQuote(id).lines[1];unsafe.set(`mode_${driver.id}`,'manual');unsafe.set(`oq_${driver.id}`,'1');
  assert.throws(()=>saveReview(id,unsafe,true),/below.*112.5W/);
  assert.equal(getQuote(id).status,'done');assert.equal(getQuote(id).lines[1].our_qty,2);
});
test('benchmark replays explicit circuit groups and reviewed tape-load sizing',()=>{
  const fixture=JSON.parse(fs.readFileSync('tests/fixtures/benchmark/manifest.json','utf8'));
  fixture.cases[0].file=path.resolve('tests/fixtures/benchmark/source.txt');
  fixture.cases[0].configuration={driver_basis:'tape_load',design_headroom:25,groups:[{sku:'SRC-D30',group:'A'},{sku:'SRC-T100',group:'A'}]};
  fixture.cases[0].expected.lines.find((l)=>l.sku==='SRC-D30').our_qty=2;
  const manifest=path.join(folder,'load-manifest.json'),report=path.join(folder,'load-report.json');fs.writeFileSync(manifest,JSON.stringify(fixture));
  const r=spawnSync(process.execPath,['scripts/run-benchmark.mjs',manifest,report],{env:{...process.env,DATA_DIR:path.join(folder,'load-benchmark-data'),BENCHMARK_PROVIDER:''},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr+fs.readFileSync(report,'utf8'));assert.equal(JSON.parse(fs.readFileSync(report,'utf8')).passed,1);
});

test('product verification rejects a form opened before a metadata reload',()=>{
  replaceCatalog(catalog,'test');const before=catalogBySku().T200,form=specForm(before);form.set('catalog_revision',before.catalog_revision);
  replaceCatalog(catalog.map((i)=>i.sku==='T200' ? {...i,specs:i.specs+' New dimensions.'} : i),'changed');
  assert.throws(()=>saveProductSpecs('T200',form),/metadata changed/);
});
