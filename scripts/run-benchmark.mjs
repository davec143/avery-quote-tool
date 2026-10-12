// DATA_DIR must be a fresh evaluation directory. Never use the app's production data directory.
import fs from 'node:fs';
import path from 'node:path';
import { db,setSetting } from '../lib/db.js';
import { toItem,replaceCatalog,parseShopifyCsv } from '../lib/catalog.js';
import { createQuoteFromSource,runPipeline,getQuote } from '../lib/quotes.js';
import { evaluateBenchmark } from '../lib/benchmark.js';
const [manifestFile,reportFile]=process.argv.slice(2);
if(!manifestFile || !process.env.DATA_DIR || !reportFile) throw new Error('Usage: DATA_DIR=/tmp/fresh-evaluation node scripts/run-benchmark.mjs manifest.json report.json');
if(fs.existsSync(path.join(path.resolve(process.env.DATA_DIR),'quotes.db'))) throw new Error('Evaluation DATA_DIR already contains quotes or an existing app database. Use a fresh directory.');
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8')),root=path.dirname(path.resolve(manifestFile));
if(!Array.isArray(manifest.cases) || !manifest.cases.length) throw new Error('Benchmark manifest needs cases.');
const items=manifest.catalog_csv ? parseShopifyCsv(fs.readFileSync(path.resolve(root,manifest.catalog_csv),'utf8')) : (manifest.catalog || []).map((i)=>toItem({...i,source:'benchmark'}));
replaceCatalog(items,'benchmark');
if(manifest.specifications) {
  const {saveProductSpecs}=await import('../lib/catalog-spec-review.js');
  for(const specification of manifest.specifications) {
    const form=new FormData();
    for(const [key,value] of Object.entries(specification.values || {})) form.set(key,value == null ? '' : String(value));
    form.set('verified_by',specification.reviewed_by || '');form.set('reference',specification.reference || '');form.set('specs_verified','on');
    saveProductSpecs(specification.sku,form);
  }
}
if(process.env.BENCHMARK_PROVIDER) {setSetting('llm_provider',process.env.BENCHMARK_PROVIDER);setSetting('llm_model',process.env.BENCHMARK_MODEL || '');setSetting('llm_base_url',process.env.BENCHMARK_BASE_URL || '');}
const results=[];
for(const entry of manifest.cases) {
  const source=path.resolve(root,entry.file);let id;
  try {
    if(source.endsWith('.txt')) {id=Number(db().prepare("INSERT INTO quotes (filename) VALUES (?)").run(path.basename(source)).lastInsertRowid);await runPipeline(id,fs.readFileSync(source,'utf8'));}
    else id=await createQuoteFromSource(path.basename(source),fs.readFileSync(source));
    const q=getQuote(id);
    if(q.status==='error' || !q.lines.length) throw new Error(q.error || 'No lines extracted.');
    // Human decisions can exclude source scope; record those explicit expectations before quantity pooling.
    for(const e of entry.expected.lines) if(Object.hasOwn(e,'include')) db().prepare('UPDATE quote_lines SET include=? WHERE quote_id=? AND comp_sku=? AND (? IS NULL OR line_ref=?)').run(e.include ? 1 : 0,id,e.sku,e.line_ref ?? null,e.line_ref ?? null);
    const {evaluateCrossovers}=await import('../lib/crossover.js'),{catalogBySku}=await import('../lib/catalog.js'),{calculateComparison}=await import('../lib/comparison.js');
    const {specOptions}=await import('../lib/product-specs.js');
    const current=getQuote(id),configuration=entry.configuration || {};
    if(!['source','tape_load'].includes(configuration.driver_basis || 'source') || (configuration.design_headroom != null && (!Number.isFinite(configuration.design_headroom) || configuration.design_headroom<0 || configuration.design_headroom>100))) throw new Error('Invalid benchmark driver configuration.');
    const configured={...current,driver_basis:configuration.driver_basis || 'source',design_headroom:configuration.design_headroom ?? null};
    for(const group of configuration.groups || []) {
      const matching=configured.lines.filter((l)=>l.comp_sku===group.sku && (group.line_ref==null || String(l.line_ref)===String(group.line_ref)));
      if(matching.length!==1 || typeof group.group!=='string' || !group.group.trim()) throw new Error('Benchmark circuit group needs one unambiguous source line and a group name.');
      matching[0].group_label=group.group.trim();
    }
    const actual=calculateComparison({...configured,lines:evaluateCrossovers(configured.lines,catalogBySku(),specOptions(configured))},catalogBySku(),entry.price_basis || manifest.price_basis || 'pack');
    results.push({file:entry.file,extractor:q.extractor,matcher:q.matcher,...evaluateBenchmark(actual,entry.expected)});
  } catch(e){results.push({file:entry.file,passed:false,error:e.message});}
}
const report={evaluated_at:new Date().toISOString(),cases:results.length,passed:results.filter((r)=>r.passed).length,results};
fs.writeFileSync(reportFile,JSON.stringify(report,null,2),{mode:0o600});db().close();
console.log(`${report.passed}/${report.cases} benchmark cases passed. Report: ${path.resolve(reportFile)}`);
if(report.passed!==report.cases) process.exitCode=1;
