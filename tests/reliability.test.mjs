import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'avery-tests-'));
process.env.DATA_DIR = folder;
const { calculateComparison } = await import('../lib/comparison.js');
const { db, setSetting } = await import('../lib/db.js');
const { toItem, replaceCatalog, catalogBySku, syncFromShopify } = await import('../lib/catalog.js');
const { getQuote, computeQuote, rematch, runPipeline } = await import('../lib/quotes.js');
const { saveReview } = await import('../lib/review.js');
const { ruleMatch, matchLines, aiMatch } = await import('../lib/match.js');
const { assessMatch } = await import('../lib/match-safety.js');
const { addCompatRows, lookupCompat, listCompat } = await import('../lib/compat.js');
const { extractWithRules, extractWithAI, extractQuote } = await import('../lib/extract.js');
const { sessionToken, validSession, safeNext } = await import('../lib/session.js');
const item = toItem({ handle: 'driver', sku: 'AV-24V-100W-CT10', title: '24V 100W non-dimmable driver', price: 100,
  options: ['Case (10 pcs)'], specs: 'Input AC 100–240V; IP20', source: 'test' });
const line = (id = 1, qty = 5, price = 10) => ({ id, line_ref: String(id), comp_sku: 'COMP-24V-96W', comp_desc: '24V 96W non-dimmable driver', qty,
  comp_unit_price: price, our_sku: item.sku, our_qty: qty, include: 1, confirmed: 0, na: 0 });
const catalog = { [item.sku]: item };
function quote() {
  replaceCatalog([item], 'test');
  const id = Number(db().prepare("INSERT INTO quotes (raw_text, customer, status) VALUES ('source quote', 'Test customer', 'review')").run().lastInsertRowid);
  const l = line();
  const lid = Number(db().prepare(`INSERT INTO quote_lines (quote_id,pos,line_ref,comp_sku,comp_desc,qty,comp_unit_price,our_sku,our_qty,include)
    VALUES (?,0,?,?,?,?,?,?,?,1)`).run(id, l.line_ref, l.comp_sku, l.comp_desc, l.qty, l.comp_unit_price, l.our_sku, l.our_qty).lastInsertRowid);
  return { id, lid };
}
function form(id) {
  const q = getQuote(id), f = new FormData();
  for (const [k,v] of Object.entries({ revision: q.revision, customer: q.customer, job_name: q.job_name || '', currency_confirmed: 'on', quantities_verified: 'on' })) f.set(k,String(v));
  for (const l of q.lines) for (const [k,v] of Object.entries({ qty:l.qty, price:l.comp_unit_price ?? '', oq:l.our_qty ?? l.qty, sku:l.our_sku || 'NA', inc:'on', note:'Confirm 100–240V input and installation; non-dimmable supply for a non-dimmed circuit.' })) f.set(`${k}_${l.id}`,String(v));
  return f;
}
after(() => { db().close(); fs.rmSync(folder, { recursive: true, force: true }); });

test('whole-pack totals include more-expensive matches rather than hiding them', () => {
  const c = calculateComparison({ lines:[line()] }, catalog, 'pack');
  assert.equal(c.summaryRows.length,1); assert.equal(c.totals.ours,100); assert.equal(c.totals.savings,-50);
  assert.equal(c.orders[0].packs,1); assert.equal(c.orders[0].extraPieces,5);
});
test('same SKU across source lines shares packs, and line allocation reconciles exactly', () => {
  const c=calculateComparison({ lines:[line(1,3),line(2,4)] },catalog,'pack');
  assert.equal(c.totals.ours,100); assert.equal(c.orders[0].requiredPieces,7);
  assert.equal(c.summaryRows.reduce((n,r)=>n+r.ourTotal,0),100);
});
test('per-piece mode is a different explicitly labelled estimate', () => {
  const c=calculateComparison({lines:[line()]},catalog,'per_piece'); assert.equal(c.totals.ours,50); assert.equal(c.priceBasis,'per_piece');
});
test('fractional, zero and non-finite quantities, and missing prices cannot enter totals', () => {
  for (const qty of [0,-1,Infinity,NaN,0.5]) assert.equal(calculateComparison({lines:[line(1,qty)]},catalog,'pack').summaryRows.length,0);
  for (const price of [null,NaN,Infinity,-1]) assert.equal(calculateComparison({lines:[line(1,5,price)]},catalog).summaryRows.length,0);
  assert.equal(calculateComparison({lines:[line(1,5,0)]},catalog).totals.pct,null);
});
test('unknown case quantities are not guessed as individual pieces', () => {
  const unknown=toItem({...item,handle:'unknown',options:['Case'],sku:'NO-PACK-COUNT',price:100});
  assert.equal(unknown.pack_qty,0); assert.equal(calculateComparison({lines:[{...line(),our_sku:unknown.sku}]},{[unknown.sku]:unknown}).rows[0].state,'invalid_price');
});
test('nested connector packs count the actual total pieces', () => {
  const nested=toItem({handle:'c',title:'Connector',sku:'C',options:['10 Packs - 12 pcs per pack (120 pcs)'],price:60});
  assert.equal(nested.pack_qty,120);assert.equal(nested.unit_price,0.5);
});
test('all automatic sources reject voltage mismatch and undersized driver mappings', async () => {
  replaceCatalog([item],'test');
  addCompatRows([{competitor_sku:'COMP-12V-96W',avery_sku:item.sku}]);
  const {results}=await matchLines([{...line(),comp_sku:'COMP-12V-96W',comp_desc:'12V 96W driver'}]);
  assert.equal(results[1].sku,null);assert.match(results[1].reason,/Voltage mismatch/);
  assert.ok(assessMatch({comp_sku:'DI-ODX-12V96W-J',comp_desc:'OMNIDRIVE X driver'},item).blockers.some((s)=>s.includes('Voltage mismatch')));
  assert.equal(ruleMatch({...line(),comp_desc:'24V 200W driver'},[item]).sku,null);
});
test('wet strip and incompatible connector matches are blocked', () => {
  assert.ok(assessMatch({comp_desc:'24V 3000K wet-rated IP65 strip'}, {...item,category:'tape',title:'24V 3000K strip',ip_rating:'IP20',cct:'3000K'}).blockers.length);
  assert.ok(assessMatch({comp_desc:'12mm connector'}, {...item,category:'connector',title:'10mm connector'}).blockers.length);
});
test('rematching preserves an honest higher-cost line in the draft', async () => {
  const {id}=quote();await rematch(id); const q=getQuote(id);assert.equal(q.lines[0].include,1);assert.equal(q.status,'review');
});
test('invalid form values fail atomically, preserving all original data', () => {
  const {id,lid}=quote(), f=form(id);f.set(`qty_${lid}`,'-4');f.set('customer','SHOULD NOT SAVE');
  assert.throws(()=>saveReview(id,f,false),/positive quantity/);assert.equal(getQuote(id).customer,'Test customer');assert.equal(getQuote(id).lines[0].qty,5);
});
test('confirmation requires USD verification, quantity review, and specification notes', () => {
  const {id,lid}=quote(), f=form(id);f.delete('currency_confirmed');assert.throws(()=>saveReview(id,f,true),/USD/);
  f.set('currency_confirmed','on');f.delete('quantities_verified');assert.throws(()=>saveReview(id,f,true),/roll lengths/);
  f.set('quantities_verified','on');db().prepare("UPDATE quote_lines SET comp_desc='96W non-dimmable driver', comp_sku='COMP-96W' WHERE id=?").run(lid);f.set(`note_${lid}`,'');assert.throws(()=>saveReview(id,f,true),/specification note/);
});
test('reviewed document freezes pricing, customer information and branding across catalog changes', () => {
  const {id}=quote(),f=form(id);setSetting('price_basis','pack');setSetting('company_name','Avery LED');saveReview(id,f,true);
  assert.equal(getQuote(id).status,'done');assert.equal(computeQuote(getQuote(id)).totals.ours,100);
  replaceCatalog([{...item,pack_price:300,unit_price:30}],'changed');setSetting('price_basis','per_piece');setSetting('company_name','Changed');
  assert.equal(computeQuote(getQuote(id)).totals.ours,100);assert.equal(computeQuote(getQuote(id),{live:true}).totals.ours,150);
  assert.equal(JSON.parse(getQuote(id).summary_snapshot).branding.companyName,'Avery LED');
  setSetting('price_basis','pack');setSetting('company_name','Avery LED');
});
test('changing reviewed quantities invalidates the summary and prevents stale writes', () => {
  const {id,lid}=quote(),f=form(id);saveReview(id,f,true);assert.throws(()=>saveReview(id,f,false),/Someone changed/);
  const edit=form(id);edit.set(`qty_${lid}`,'6');saveReview(id,edit,false);
  const q=getQuote(id);assert.equal(q.summary_snapshot,null);assert.equal(q.status,'review');assert.equal(q.lines[0].confirmed,0);assert.equal(q.lines[0].our_qty,6);
});
test('confirmed remembered matches preserve quantity conversion', () => {
  const {id,lid}=quote(),f=form(id);f.set(`oq_${lid}`,'10');f.set(`learn_${lid}`,'on');saveReview(id,f,true);
  assert.equal(lookupCompat('COMP-24V-96W',listCompat()).units_per_line_item,2);
});
test('empty and duplicate catalog replacements leave the previous catalog intact', () => {
  replaceCatalog([item],'test');assert.throws(()=>replaceCatalog([],'test'),/preserved/);assert.throws(()=>replaceCatalog([item,item],'test'),/Duplicate/);
  assert.equal(catalogBySku()[item.sku].pack_price,100);
});
test('a source line with contradictory unit and extended prices is kept but left unpriced', () => {
  const r=extractWithRules('1 COMP-24V-96W $10.00 5 $60.00\n24V 96W driver');assert.equal(r.lines[0].unit_price,null);assert.match(r.warnings[0],/does not equal/);
  assert.equal(extractWithRules('1 COMP-24V-96W $10.00 5 $50.00\n24V 96W driver').lines[0].qty,5);
});
test('an unreadable quote does not erase previously reviewed lines', async () => {
  const {id}=quote();await assert.rejects(runPipeline(id,'Not a readable quote'),/No product lines/);assert.equal(getQuote(id).lines.length,1);
});
test('session tokens are signed, unique, expire, and cannot redirect to other origins', async () => {
  const now=Date.now(), token=await sessionToken('test-password',now);
  assert.equal(await validSession(token,'test-password',now),true);assert.equal(await validSession(token,'wrong',now),false);
  assert.equal(await validSession(token,'test-password',now+8*86400000),false);assert.notEqual(token,await sessionToken('test-password',now));
  for (const value of ['//evil.test','/\\evil.test','https://evil.test','/\nfoo']) assert.equal(safeNext(value),'/');
  assert.equal(safeNext('/quotes/1'),'/quotes/1');
});
test('AI unknown SKUs, malformed quantities and partial extraction are handled conservatively', async () => {
  const original=globalThis.fetch;setSetting('llm_provider','custom');setSetting('llm_model','test');setSetting('llm_base_url','https://mock.invalid');
  const reply=(payload)=>async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(payload)}}]}),{status:200});
  try {
    globalThis.fetch=reply({matches:[{id:1,sku:'MADE-UP',confidence:'high'}]});assert.equal((await aiMatch([line()],[item]))[1].sku,null);
    globalThis.fetch=reply({lines:[{sku:'COMP',qty:-1,unit_price:10}]});await assert.rejects(extractWithAI('source'),/invalid quantity/);
    globalThis.fetch=reply({lines:[{sku:'COMP',qty:1,unit_price:10}]});
    const extracted=await extractQuote('1 COMP-ONE $10.00 1 $10.00\n24V driver\n2 COMP-TWO $10.00 1 $10.00\n24V driver');
    assert.equal(extracted.lines.length,2);assert.equal(extracted.extractor,'rules');assert.match(extracted.aiError,/fuller extraction/);
  } finally {globalThis.fetch=original;setSetting('llm_provider','none');}
});
test('partial Shopify variant sync fails without replacing the catalog', async () => {
  replaceCatalog([item],'test');setSetting('shopify_domain','test.myshopify.com');setSetting('shopify_token','mock');
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({data:{products:{nodes:[{handle:'too-many',variants:{pageInfo:{hasNextPage:true}}}],pageInfo:{hasNextPage:false}}}}));
  try { await assert.rejects(syncFromShopify(),/more than 100 variants/);assert.equal(catalogBySku()[item.sku].pack_price,100); }
  finally { globalThis.fetch=original; }
});

test('tiny line allocations remain non-negative and reconcile in cents', () => {
  const cheap={...item,pack_qty:1,pack_price:0.005};
  const c=calculateComparison({lines:[1,2,3,4].map((id)=>line(id,1))},{[item.sku]:cheap},'pack');
  assert.equal(c.totals.ours,0.02);assert.ok(c.summaryRows.every((r)=>r.ourTotal>=0));
  assert.equal(Math.round(c.summaryRows.reduce((n,r)=>n+r.ourTotal,0)*100),2);
});
test('a no-op Save preserves a reviewed comparison', () => {
  const {id}=quote(); saveReview(id,form(id),true);
  const old=getQuote(id).summary_snapshot;saveReview(id,form(id),false);
  assert.equal(getQuote(id).status,'done');assert.equal(getQuote(id).summary_snapshot,old);
});
test('known non-USD quotes cannot be confirmed as USD', () => {
  const {id}=quote();db().prepare("UPDATE quotes SET raw_text='Currency EUR' WHERE id=?").run(id);
  assert.throws(()=>saveReview(id,form(id),true),/Currency conversion/);
});
