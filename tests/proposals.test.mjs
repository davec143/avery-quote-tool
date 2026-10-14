import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'avery-proposals-'));process.env.DATA_DIR=folder;
const {calculateComparison}=await import('../lib/comparison.js');
const {extractWithRules,extractGeneric,reconcileTotal}=await import('../lib/extract.js');
const {db,setSetting}=await import('../lib/db.js');
const {toItem,replaceCatalog}=await import('../lib/catalog.js');
const {runPipeline,getQuote,summaryDocument}=await import('../lib/quotes.js');
const {saveReview}=await import('../lib/review.js');
const {purchaseCsv,reviewedExpectation}=await import('../lib/exports.js');
const {evaluateBenchmark}=await import('../lib/benchmark.js');
const {productSpecSheets,loadSpecSheets}=await import('../lib/spec-sheets.js');
const item=toItem({handle:'driver',sku:'AV-PSN-24V-60W-CT10',title:'24V 60W non-dimmable power supply',price:100,options:['Case (10 pcs)'],specs:'Input AC 100–240V; IP20',source:'test'});
const cat={[item.sku]:item};
const line=(id,qty,price)=>({id,line_ref:String(id),comp_sku:`SRC-${id}`,comp_desc:'24V 60W non-dimmable power supply',qty,comp_unit_price:price,our_sku:item.sku,our_qty:qty,quantity_mode:'manual',include:1,na:0});
after(()=>{db().close();fs.rmSync(folder,{recursive:true,force:true});});

test('unpriced selections retain Avery quantities and costs without fictitious source totals or savings',()=>{
 const c=calculateComparison({lines:[line(1,3,null)]},cat,'pack');
 assert.equal(c.summaryRows.length,1);assert.equal(c.orders[0].requiredPieces,3);assert.equal(c.orders[0].packs,1);
 assert.deepEqual(c.totals,{theirs:null,ours:100,comparedOurs:null,savings:null,pct:null});assert.equal(c.rows[0].savings,null);assert.equal(c.counts.unpricedIncluded,1);
 assert.equal(calculateComparison({lines:[{...line(1,3,null),include:0}]},cat).orders.length,0);
});
test('mixed priced/unpriced rows share one purchase and savings use only the priced allocated share',()=>{
 const c=calculateComparison({lines:[line(1,3,30),line(2,7,null)]},cat,'pack');
 assert.equal(c.orders.length,1);assert.equal(c.orders[0].requiredPieces,10);assert.equal(c.orders[0].packs,1);
 assert.deepEqual(c.totals,{theirs:90,ours:100,comparedOurs:30,savings:60,pct:60/90});
 assert.equal(c.rows[1].ourTotal,70);assert.equal(c.rows[1].savings,null);assert.equal(c.counts.priced,1);
});
test('genuine zero prices remain priced and invalid/conflicting prices are excluded',()=>{
 const c=calculateComparison({lines:[line(1,2,0)]},cat);assert.equal(c.counts.priced,1);assert.equal(c.totals.savings,-100);
 for(const price of [NaN,Infinity,-1]) assert.equal(calculateComparison({lines:[line(1,2,price)]},cat).summaryRows.length,0);
 assert.equal(calculateComparison({lines:[{...line(1,2,null),price_conflict:1}]},cat).rows[0].state,'invalid_source_price');
});
test('table extraction reads unpriced SKU/description/quantity rows and preserves mixed prices',()=>{
 const text='Quote # TEST-UNPRICED\nSKU  Description  Qty  Unit price  Amount\nSRC-D60  24V 60W non-dimmable driver  2\nSRC-D100  24V 100W non-dimmable driver  3  —  —\nSRC-D30  24V 30W non-dimmable driver  10  $20.00  $200.00';
 const r=extractGeneric(text);assert.equal(r.lines.length,3);assert.deepEqual(r.lines.map((l)=>[l.sku,l.qty,l.unit_price]),[['SRC-D60',2,null],['SRC-D100',3,null],['SRC-D30',10,20]]);
 assert.equal(extractGeneric('Qty  SKU  Description\n2  SRC-D60  24V 60W non-dimmable driver').lines[0].qty,2);
 assert.equal(extractGeneric('SRC-D60  24V driver 2').lines.length,0); // no quantity header: do not guess
 assert.equal(extractGeneric('Qty SKU Description\n2 SRC-D60 24V driver $20.00 $40.00').lines.length,0); // a priced layout is not an unpriced row
 assert.equal(extractWithRules('1 SRC-D60 2\n24V 60W non-dimmable driver').lines[0].unit_price,null);
 assert.equal(reconcileTotal('Quote Total: $200.00',r.lines),null);
});
function form(q) {
 const f=new FormData();for(const [k,v] of Object.entries({revision:q.revision,customer:'Synthetic test customer',reviewer_name:'Synthetic test reviewer',quantities_verified:'on'}))f.set(k,String(v));
 for(const l of q.lines)for(const [k,v] of Object.entries({qty:l.qty,oq:l.our_qty,price:l.comp_unit_price??'',sku:l.our_sku,mode:l.quantity_mode,inc:'on',accept:'on',note:'Synthetic test: verify voltage, input and installation plan.'}))f.set(`${k}_${l.id}`,String(v));return f;
}
test('unpriced source goes through extraction, matching, confirmation, frozen summary and purchase exports',async()=>{
 replaceCatalog([item],'test');setSetting('llm_provider','none');setSetting('price_basis','pack');
 const text='Quote # TEST-UNPRICED\nSKU  Description  Qty\nSRC-D60  24V 60W non-dimmable driver  2';
 const id=Number(db().prepare("INSERT INTO quotes (raw_text,status) VALUES (?,'review')").run(text).lastInsertRowid);
 await runPipeline(id,text);const q=getQuote(id);assert.equal(q.lines[0].comp_unit_price,null);assert.equal(q.lines[0].our_sku,item.sku);
 saveReview(id,form(q),true);const document=summaryDocument(getQuote(id));assert.equal(document.ready,true);assert.equal(document.comparison.orders[0].requiredPieces,2);
 assert.equal(document.comparison.totals.ours,100);assert.equal(document.comparison.totals.savings,null);assert.match(purchaseCsv(document),new RegExp(item.sku));
 const expected=reviewedExpectation(document).expected;assert.equal(expected.lines[0].unit_price,null);assert.equal(evaluateBenchmark(document.comparison,expected).passed,true);
 replaceCatalog([{...item,pack_price:500}],'changed');assert.equal(summaryDocument(getQuote(id)).comparison.totals.ours,100);
});
test('a conflicted price cannot be confirmed as an intentionally unpriced source',async()=>{
 replaceCatalog([item],'test');const text='1 SRC-D60 $20.00 2 $60.00\n24V 60W non-dimmable driver';
 const id=Number(db().prepare("INSERT INTO quotes (raw_text,status) VALUES (?,'review')").run(text).lastInsertRowid);await runPipeline(id,text);
 db().prepare('UPDATE quote_lines SET price_conflict=0 WHERE quote_id=?').run(id); // legacy import provenance must still be recovered
 const q=getQuote(id);assert.equal(q.lines[0].price_conflict,1);assert.throws(()=>saveReview(id,form(q),true),/conflicting source prices/);
 const f=form(q);f.set(`price_${q.lines[0].id}`,'30');f.set('currency_confirmed','on');saveReview(id,f,true);assert.equal(summaryDocument(getQuote(id)).comparison.totals.theirs,60);
});
const html=(body)=>`<a href="https://averyled.com/cdn/shop/files/install.pdf">Not a spec</a><!-- Spec Sheet Download -->${body}<!-- Installation Guide Download --><a href="https://averyled.com/cdn/shop/files/guide.pdf">Guide</a>`;
test('spec links retain the storefront PDF and select the correct output-specific sheet',()=>{
 const page=html('<a href="//averyled.com/cdn/shop/files/AV-COB-24V-200L_AveryLed.pdf?v=1&amp;download=1">200L</a><a href="//averyled.com/cdn/shop/files/AV-COB-24V-500L_AveryLed.pdf">500L</a>');
 const sheets=productSpecSheets(page,'AV-COB-24V-200L-3000K-CT10');assert.equal(sheets.length,1);assert.match(sheets[0].url,/200L_AveryLed.pdf\?v=1&download=1/);
 assert.equal(productSpecSheets(page,'AV-COB-24V-100L-3000K-CT10').length,0);
 assert.equal(productSpecSheets(html('<a href="javascript:alert(1)">Bad</a><a href="https://other.example/file.pdf">Bad</a>'),'SKU').length,0);
});
test('storefront SKU matching groups repeated products and gracefully discloses absent sheets',async()=>{
 const calls=[];const products=[{handle:'test-driver',variants:[{sku:'D60'},{sku:'D60-BOX'}]}];
 const fetcher=async(url)=>{calls.push(url);return url.includes('products.json') ? new Response(JSON.stringify({products})) : new Response(html('<a href="//averyled.com/cdn/shop/files/driver.pdf">Driver spec</a>'));};
 const docs=await loadSpecSheets(['D60','D60-BOX','UNKNOWN'],{fetcher});assert.equal(calls.length,2);assert.equal(docs.D60.sheets.length,1);assert.equal(docs['D60-BOX'].sheets.length,1);assert.deepEqual(docs.UNKNOWN,{sheets:[],productUrl:null});
 const failed=await loadSpecSheets(['D60'],{fetcher:async()=>{throw new Error('Offline');}});assert.equal(failed.D60.sheets.length,0);
});

test('purchase export distinguishes a loose-piece estimate from the full-pack amount',()=>{
 const comparison=calculateComparison({lines:[line(1,3,null)]},cat,'per_piece');
 const csv=purchaseCsv({ready:true,quote:{id:99},comparison});
 assert.match(csv,/"Product cost USD","Full-pack cost USD","Pricing basis"/);
 assert.match(csv,/"30","100","Per-piece estimate"/);
});
