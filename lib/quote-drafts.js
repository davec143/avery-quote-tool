import fs from 'node:fs';
import path from 'node:path';
import { db,UPLOAD_DIR } from './db.js';
import { getQuote } from './quotes.js';
import { catalogBySku } from './catalog.js';
import { evaluateCrossovers } from './crossover.js';
import { specOptions } from './product-specs.js';
import { recordEvent } from './history.js';

/** A revision is independent: its own source file, current calculations, and no inherited approval. */
export function duplicateQuote(id,revision) {
  const d=db();let copiedPath;
  try {
    return d.transaction(()=>{
      const q=getQuote(id);
      if(!q) throw new Error('Quote not found.');
      if(q.revision!==Number(revision)) throw new Error('This quote changed. Reload before creating a new draft.');
      if(!q.raw_text || q.status==='error' || !q.lines.length) throw new Error('Read and correct the source before creating a new draft.');
      const fields=['filename','quote_number','job_name','customer','competitor','quote_date','extractor','matcher','raw_text','notes','error','customer_notes','lead_time','payment_terms','source_type','reconciliation_note','source_charges','driver_basis','design_headroom','installation_note'];
      const newId=Number(d.prepare(`INSERT INTO quotes (${fields.join(',')},status) VALUES (${fields.map(()=>'?').join(',')},'review')`).run(...fields.map((k)=>q[k])).lastInsertRowid);
      if(q.file_path) {
        if(!fs.existsSync(q.file_path)) throw new Error('The original source file is missing. Restore it before creating a new draft.');
        const root=fs.realpathSync(UPLOAD_DIR),source=fs.realpathSync(q.file_path);
        if(path.dirname(source)!==root) throw new Error('The source file is outside the upload folder. Restore it before copying this quote.');
        const destination=path.join(UPLOAD_DIR,`${newId}-${path.basename(source).replace(/^\d+-/,'')}`);
        fs.copyFileSync(source,destination,fs.constants.COPYFILE_EXCL);
        copiedPath=destination;
        d.prepare('UPDATE quotes SET file_path=? WHERE id=?').run(copiedPath,newId);
      }
      const lineFields=['pos','line_ref','group_label','comp_sku','comp_desc','qty','comp_unit_price','price_conflict','our_sku','suggested_sku','our_qty','match_source','confidence','reason','na','include','customer_note','decision_note','quantity_mode','fixed_multiplier'];
      const insert=d.prepare(`INSERT INTO quote_lines (quote_id,${lineFields.join(',')}) VALUES (?,${lineFields.map(()=>'?').join(',')})`);
      const lines=q.lines.map((l)=>({...l,id:Number(insert.run(newId,...lineFields.map((k)=>l[k]??null)).lastInsertRowid),quote_id:newId,confirmed:0,review_accepted:0}));
      const planned=evaluateCrossovers(lines,catalogBySku(),specOptions(q));
      const update=d.prepare('UPDATE quote_lines SET our_qty=@our_qty,qty_basis=@qty_basis,requirement_watts=@requirement_watts,match_kind=@match_kind,difference_notes=@difference_notes,review_required=@review_required,dependency_ids=@dependency_ids,confidence=@confidence WHERE id=@id');
      for(const l of planned) update.run({...l,our_qty:l.our_qty??l.qty});
      recordEvent(d,newId,0,'draft_created','Team',{source_quote_id:id,source_revision:q.revision,note:'Copied saved source and selections. Current catalog prices and automatic quantities apply. Approvals, expiry and customer outcome reset; verify retained terms and assumptions.'});
      return newId;
    })();
  } catch(e) {
    if(copiedPath) {try {fs.unlinkSync(copiedPath);} catch {}}
    throw e;
  }
}
