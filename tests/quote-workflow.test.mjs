import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'avery-workflow-'));process.env.DATA_DIR=folder;
const {db,UPLOAD_DIR,setSetting}=await import('../lib/db.js');
const {replaceCatalog,toItem,catalogBySku}=await import('../lib/catalog.js');
const {getQuote,computeQuote,summaryDocument}=await import('../lib/quotes.js');
const {duplicateQuote}=await import('../lib/quote-drafts.js');
const {searchQuotes}=await import('../lib/quote-search.js');
const {reviewReadiness}=await import('../lib/readiness.js');
const {saveReview}=await import('../lib/review.js');
const {quoteHistory}=await import('../lib/history.js');
const driver=toItem({sku:'D60',title:'24V 60W non-dimmable driver',price:100,options:['Case (10 pcs)'],specs:'IP20',source:'test'});
replaceCatalog([driver],'test');setSetting('price_basis','pack');
after(()=>{db().close();fs.rmSync(folder,{recursive:true,force:true});});
function source() {
 const id=Number(db().prepare("INSERT INTO quotes (customer,job_name,quote_number,raw_text,status) VALUES ('Workflow Test','Kitchen','WF-TEST','Source USD','review')").run().lastInsertRowid);
 db().prepare("INSERT INTO quote_lines (quote_id,pos,line_ref,comp_sku,comp_desc,qty,comp_unit_price,our_sku,our_qty) VALUES (?,0,'1','SOURCE-D60','24V 60W non-dimmable driver',3,50,'D60',3)").run(id);return id;
}
function form(q) {
 const f=new FormData();for(const [k,v] of Object.entries({revision:q.revision,customer:q.customer,reviewer_name:q.reviewer_name||'',quantities_verified:q.quantities_verified?'on':'',currency_confirmed:q.currency_confirmed?'on':''})) if(v!=='') f.set(k,String(v));
 for(const l of q.lines)for(const [k,v] of Object.entries({qty:l.qty,oq:l.our_qty,price:l.comp_unit_price??'',sku:l.our_sku,mode:l.quantity_mode,inc:'on',note:l.customer_note||'',...(l.review_accepted?{accept:'on'}:{})}))f.set(`${k}_${l.id}`,String(v));return f;
}
test('checklist and confirmation report the same missing approval; valid form can confirm',()=>{
 const id=source();let q=getQuote(id);const issues=reviewReadiness(q,catalogBySku(),'pack');assert.equal(issues.length,3);assert.equal(issues[0].target,'customer-review');assert.throws(()=>saveReview(id,form(q),true),e=>e.message===issues[0].message);
 const f=form(q);f.set('currency_confirmed','on');f.set('quantities_verified','on');f.set('reviewer_name','Synthetic tester');saveReview(id,f,true);
 q=getQuote(id);assert.deepEqual(reviewReadiness(q,catalogBySku(),'pack'),[]);assert.equal(summaryDocument(q).ready,true);
});
test('changed source wattage requires recalculation before confirmation',()=>{
 const id=source();db().prepare("UPDATE quote_lines SET comp_desc='24V 30W non-dimmable driver',qty=10,our_qty=10 WHERE quote_id=?").run(id);
 const issues=reviewReadiness(getQuote(id),catalogBySku(),'pack');assert.ok(issues.some(i=>/Save to recalculate/.test(i.message)));assert.ok(issues.some(i=>i.target===`line-${getQuote(id).lines[0].id}`));
});
test('copy preserves the approved original, uses current pricing and resets every approval',()=>{
 const id=source(),q=getQuote(id),f=form(q);f.set('currency_confirmed','on');f.set('quantities_verified','on');f.set('reviewer_name','Synthetic tester');saveReview(id,f,true);
 const file=path.join(UPLOAD_DIR,`${id}-test.png`);fs.writeFileSync(file,'synthetic source bytes');db().prepare("UPDATE quotes SET file_path=?,valid_until='2030-01-01',outcome='accepted',outcome_note='Old decision' WHERE id=?").run(file,id);
 const original=getQuote(id);replaceCatalog([{...driver,pack_price:250}],'test');
 const newId=duplicateQuote(id,original.revision),copy=getQuote(newId);
 assert.deepEqual(getQuote(id),original);assert.equal(summaryDocument(original).comparison.totals.ours,100);assert.equal(computeQuote(copy).totals.ours,250);
 for(const k of ['currency_confirmed','quantities_verified','revision'])assert.equal(copy[k],0);
 assert.equal(copy.status,'review');assert.equal(copy.summary_snapshot,null);assert.equal(copy.reviewed_at,null);assert.equal(copy.valid_until,'');assert.equal(copy.reviewer_name,'');assert.equal(copy.outcome,'open');assert.equal(copy.outcome_note,'');
 assert.equal(copy.lines[0].confirmed,0);assert.equal(copy.lines[0].review_accepted,0);assert.notEqual(copy.lines[0].id,original.lines[0].id);
 assert.notEqual(copy.file_path,original.file_path);assert.equal(fs.readFileSync(copy.file_path,'utf8'),fs.readFileSync(original.file_path,'utf8'));
 assert.equal(quoteHistory(newId)[0].details.source_quote_id,id);
 fs.unlinkSync(copy.file_path);assert.ok(fs.existsSync(original.file_path));
 replaceCatalog([driver],'test');
});
test('stale copies and missing source files fail atomically',()=>{
 const id=source(),before=db().prepare('SELECT COUNT(*) AS n FROM quotes').get().n;
 assert.throws(()=>duplicateQuote(id,99),/changed/);db().prepare('UPDATE quotes SET file_path=? WHERE id=?').run(path.join(UPLOAD_DIR,'missing.png'),id);
 assert.throws(()=>duplicateQuote(id,0),/source file is missing/);assert.equal(db().prepare('SELECT COUNT(*) AS n FROM quotes').get().n,before);
});
test('copied connector dependencies refer to new tape lines and require fresh review',()=>{
 const tape=toItem({sku:'T200',title:'24V 3000K COB tape light 200 lm/ft',price:100,options:['Case (10 pcs)'],specs:'10mm IP20 Roll length 16.4ft',source:'test'});
 const connector=toItem({sku:'C10',title:'10mm 2-pin tape connector terminal block',price:10,options:['Case (10 pcs)'],specs:'10mm 2-pin',source:'test'});replaceCatalog([driver,tape,connector],'test');
 const id=source();db().prepare("DELETE FROM quote_lines WHERE quote_id=?").run(id);
 const ins=db().prepare('INSERT INTO quote_lines (quote_id,pos,line_ref,group_label,comp_sku,comp_desc,qty,our_sku,our_qty,review_accepted,confirmed) VALUES (?,?,?,?,?,?,?,?,?,1,1)');
 ins.run(id,0,'1','A','SRC-T','24V 3000K COB tape 8mm 200 lm/ft 16.4ft',1,'T200',1);ins.run(id,1,'2','A','SRC-C','8mm 2-pin connector terminal block',1,'C10',1);
 const copy=getQuote(duplicateQuote(id,0));assert.deepEqual(JSON.parse(copy.lines[1].dependency_ids),[copy.lines[0].id]);assert.equal(copy.lines[1].review_accepted,0);assert.match(copy.lines[1].difference_notes,/not compatible with the original/);replaceCatalog([driver],'test');
});
test('search reaches older quotes, filters outcomes and treats SQL metacharacters literally',()=>{
 const first=source();db().prepare("UPDATE quotes SET customer='Older special 100%_',outcome='accepted',status='done',summary_snapshot='{}',valid_until='2020-01-01' WHERE id=?").run(first);
 const insert=db().prepare("INSERT INTO quotes (customer,raw_text,status) VALUES ('Pagination Test','test','review')");db().transaction(()=>{for(let i=0;i<205;i++)insert.run();})();
 assert.equal(searchQuotes({query:'Pagination Test'}).total,205);assert.equal(searchQuotes({query:'Pagination Test',page:9}).quotes.length,5);assert.equal(searchQuotes({query:'Pagination Test',page:999}).page,9);
 assert.equal(searchQuotes({query:'100%_',status:'expired',outcome:'accepted'}).quotes[0].id,first);
 assert.ok(searchQuotes({query:'source-d60'}).quotes.some(q=>q.id===first));assert.ok(searchQuotes({query:'D60'}).total>0);
 assert.equal(searchQuotes({query:"' OR 1=1 --"}).total,0);assert.equal(searchQuotes({query:'Pagination Test',outcome:'declined'}).total,0);
});
test('failed uploads with no extracted text remain reviewable and explain the blocker',()=>{
 const id=Number(db().prepare("INSERT INTO quotes (filename,status,error) VALUES ('unreadable.pdf','error','Cannot read source')").run().lastInsertRowid);
 const issues=reviewReadiness(getQuote(id),catalogBySku(),'pack');assert.ok(issues.some(i=>/successfully read/.test(i.message)));
});
