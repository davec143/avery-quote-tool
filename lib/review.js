import { db, getBlob, setBlob } from './db.js';
import { catalogBySku } from './catalog.js';
import { getQuote, computeQuote } from './quotes.js';
import { brand } from './settings.js';
import { addCompatRows } from './compat.js';
import { evaluateCrossovers } from './crossover.js';
import { chargesFromForm } from './source-costs.js';
import { specOptions } from './product-specs.js';
import { recordEvent } from './history.js';
import { confirmationIssues } from './readiness.js';

function numeric(raw, label, { optional = false, quantity = false } = {}) {
  const text = String(raw ?? '').trim().replace(/[$,]/g, '');
  if (optional && text === '') return null;
  const n = text === '' ? NaN : Number(text);
  if (!Number.isFinite(n) || (quantity ? n <= 0 : n < 0)) throw new Error(`${label} must be a ${quantity ? 'positive quantity' : 'valid non-negative price'}.`);
  return n;
}

/** Validate the entire form before writing; save and confirmation are atomic. */
export function saveReview(id, form, confirm = false, { overageAck = false } = {}) {
  const d = db();
  const q = getQuote(id);
  if (!q) throw new Error('Quote not found.');
  if (Number(form.get('revision')) !== q.revision) throw new Error('Someone changed this quote. Reload before saving so their changes are preserved.');
  const cat = catalogBySku();
  const currency = form.has('currency_confirmed') ? 1 : 0;
  const verified = form.has('quantities_verified') ? 1 : 0;
  const removed=q.lines.filter((l)=>form.has(`remove_${l.id}`));
  if (confirm && removed.length) throw new Error('Save source-line removals before confirming the corrected source.');
  let lines = q.lines.filter((l)=>!form.has(`remove_${l.id}`)).map((l) => {
    const qty = numeric(form.get(`qty_${l.id}`), `Line ${l.line_ref} competitor quantity`, { quantity: true });
    let oq = numeric(form.get(`oq_${l.id}`), `Line ${l.line_ref} Avery quantity`);
    const mode = form.has(`mode_${l.id}`) ? String(form.get(`mode_${l.id}`)) : oq !== (l.our_qty ?? l.qty) ? 'manual' : l.quantity_mode || 'auto';
    if (!['auto','manual'].includes(mode)) throw new Error('Invalid quantity mode.');
    if (mode === 'manual' && oq <= 0) throw new Error(`Line ${l.line_ref}: manual Avery quantity must be positive.`);
    const sku = String(form.get(`sku_${l.id}`) || 'NA');
    const our = sku === 'NA' ? null : cat[sku];
    if (sku !== 'NA' && !our) throw new Error(`Line ${l.line_ref}: the selected SKU is no longer in the catalog.`);
    if (our && !Number.isInteger(oq)) throw new Error(`Line ${l.line_ref}: Avery quantity must be a whole number of pieces.`);
    const price = numeric(form.get(`price_${l.id}`), `Line ${l.line_ref} competitor price`, { optional: true });
    const note = String(form.get(`note_${l.id}`) || '').trim();
    // Choosing a product for a line that had none includes it: the Include box can't be ticked until a product is saved.
    const include = our && (form.has(`inc_${l.id}`) || !l.our_sku) ? 1 : 0;
    const source={};
    for (const [field,key] of [['comp_sku','source_sku'],['comp_desc','source_desc'],['group_label','group'],['decision_note','decision']]) source[field]=form.has(`${key}_${l.id}`) ? String(form.get(`${key}_${l.id}`) || '').trim() : l[field] || '';
    if (!source.comp_sku || !source.comp_desc) throw new Error(`Line ${l.line_ref}: enter the source SKU and description.`);
    return { ...l, ...source, quantity_mode:mode, qty, our_qty:oq, comp_unit_price:price, our_sku:our?.sku || null, na:our ? 0 : 1, include,
      customer_note:note, review_accepted:form.has(`accept_${l.id}`) ? 1 : 0, overage_ack:form.has(`ack_${l.id}`) ? 1 : 0,
      reason:(our?.sku || null) !== l.our_sku ? 'Product selected during review.' : l.reason,
      match_source:(our?.sku || null) !== l.our_sku ? 'manual' : l.match_source };
  });
  const values = {};
  for (const key of ['customer', 'job_name', 'notes', 'customer_notes', 'lead_time', 'payment_terms', 'valid_until', 'reconciliation_note']) values[key] = String(form.get(key) || '').trim();
  for (const key of ['reviewer_name','installation_note']) values[key]=form.has(key) ? String(form.get(key) || '').trim() : q[key] || '';
  values.driver_basis=form.has('driver_basis') ? String(form.get('driver_basis')) : q.driver_basis || 'source';
  if (!['source','tape_load'].includes(values.driver_basis)) throw new Error('Choose a valid driver calculation basis.');
  const headroom=form.has('design_headroom') ? String(form.get('design_headroom') || '').trim() : q.design_headroom;
  values.design_headroom=headroom === '' || headroom == null ? null : Number(headroom);
  if (values.design_headroom != null && (!Number.isFinite(values.design_headroom) || values.design_headroom<0 || values.design_headroom>100)) throw new Error('Enter a reviewed headroom percentage from 0 to 100, or leave it unknown.');
  values.source_charges=chargesFromForm(form,q.source_charges);
  if (form.get('intent') === 'addline') {
    const sku=String(form.get('new_sku') || '').trim(), desc=String(form.get('new_desc') || '').trim();
    if (!sku || !desc) throw new Error('Enter a source SKU and description for the missing line.');
    const qty=numeric(form.get('new_qty'),'New source quantity',{quantity:true}),price=numeric(form.get('new_price'),'New source unit price',{optional:true});
    const pos=Math.max(-1,...q.lines.map((l)=>l.pos))+1;
    lines.push({id:-1,quote_id:id,pos,line_ref:String(form.get('new_ref') || `Added ${pos+1}`).trim(),group_label:String(form.get('new_group') || '').trim(),
      comp_sku:sku,comp_desc:desc,qty,comp_unit_price:price,our_sku:null,our_qty:qty,quantity_mode:'auto',fixed_multiplier:1,requirement_watts:null,
      na:1,include:0,confirmed:0,review_accepted:0,overage_ack:0,confidence:'low',match_source:'manual',reason:'Source line added during review; select an Avery product or re-match.',customer_note:'',decision_note:'Added from original source.'});
  }
  lines = evaluateCrossovers(lines,cat,specOptions(values));
  for (const l of lines) {
    const commercialChange = ['comp_sku','comp_desc','group_label','qty','our_qty','our_sku','include','comp_unit_price','customer_note','quantity_mode','difference_notes','decision_note'].some((k) => (l[k] ?? '') !== (q.lines.find((old) => old.id === l.id)?.[k] ?? ''));
    l.confirmed = confirm ? 1 : commercialChange ? 0 : l.confirmed;
    if (commercialChange && !confirm) l.review_accepted = 0;
  }
  if (values.valid_until && (!/^\d{4}-\d{2}-\d{2}$/.test(values.valid_until) || !Number.isFinite(Date.parse(values.valid_until)) || new Date(values.valid_until).toISOString().slice(0, 10) !== values.valid_until)) throw new Error('Enter a valid comparison expiry date.');
  const candidate = { ...q, ...values, lines, currency_confirmed: currency, quantities_verified: verified };
  const c = computeQuote(candidate, { live: true });
  if (confirm) {
    const issues=confirmationIssues(candidate,c,{overageAck});
    if(issues.length) throw new Error(issues[0].message);
  }
  const fields=['comp_sku','comp_desc','group_label','qty','our_qty','comp_unit_price','our_sku','na','include','customer_note','quantity_mode','difference_notes','review_accepted','decision_note','overage_ack'];
  const changes=lines.filter((l)=>l.id>0).map((l)=>({id:l.id,sku:l.comp_sku,fields:Object.fromEntries(fields.filter((k)=>(l[k] ?? '') !== (q.lines.find((old)=>old.id===l.id)?.[k] ?? '')).map((k)=>[k,{before:q.lines.find((old)=>old.id===l.id)?.[k] ?? null,after:l[k] ?? null}]))})).filter((l)=>Object.keys(l.fields).length);
  const quoteChanges=Object.fromEntries(Object.keys(values).filter((k)=>(values[k] ?? '') !== (q[k] ?? '')).map((k)=>[k,{before:q[k] ?? null,after:values[k]}]));
  const changed = removed.length || lines.some((l)=>l.id<0) || changes.length || Object.keys(quoteChanges).length || currency !== q.currency_confirmed || verified !== q.quantities_verified;
  const reviewedAt = new Date().toISOString();
  const snapshot = confirm ? JSON.stringify({ quote: { ...candidate, lines: undefined, raw_text: undefined, file_path: undefined, notes: undefined, outcome_note:undefined, summary_snapshot: undefined, reviewed_at: reviewedAt }, comparison: c, branding: brand() }) : changed ? null : q.summary_snapshot;
  let learned = 0;
  d.transaction(() => {
    const result = d.prepare(`UPDATE quotes SET customer=@customer, job_name=@job_name, notes=@notes, customer_notes=@customer_notes,
      lead_time=@lead_time, payment_terms=@payment_terms, valid_until=@valid_until, reconciliation_note=@reconciliation_note, currency_confirmed=@currency, quantities_verified=@verified,
      source_charges=@source_charges,reviewer_name=@reviewer_name,driver_basis=@driver_basis,design_headroom=@design_headroom,installation_note=@installation_note,
      status=@status, summary_snapshot=@snapshot, reviewed_at=@reviewedAt, revision=revision+1 WHERE id=@id AND revision=@revision`)
      .run({ ...values, currency, verified, status: confirm ? 'done' : changed ? 'review' : q.status, snapshot,
        reviewedAt: confirm ? reviewedAt : changed ? null : q.reviewed_at, id, revision: q.revision });
    if (!result.changes) throw new Error('This quote changed. Reload before saving.');
    for (const l of removed) d.prepare('DELETE FROM quote_lines WHERE id=? AND quote_id=?').run(l.id,id);
    for (const l of lines.filter((l)=>l.id<0)) l.id=Number(d.prepare('INSERT INTO quote_lines (quote_id,pos,line_ref,comp_sku,comp_desc,qty,comp_unit_price) VALUES (?,?,?,?,?,?,?)').run(id,l.pos,l.line_ref,l.comp_sku,l.comp_desc,l.qty,l.comp_unit_price).lastInsertRowid);
    const upd = d.prepare(`UPDATE quote_lines SET comp_sku=@comp_sku,comp_desc=@comp_desc,group_label=@group_label,decision_note=@decision_note,qty=@qty, our_qty=@our_qty, comp_unit_price=@comp_unit_price, our_sku=@our_sku,
      na=@na, include=@include, confirmed=@confirmed, match_source=@match_source, confidence=@confidence, reason=@reason, customer_note=@customer_note, qty_basis=@qty_basis, quantity_mode=@quantity_mode, requirement_watts=@requirement_watts,
      match_kind=@match_kind, difference_notes=@difference_notes, review_required=@review_required, review_accepted=@review_accepted, overage_ack=@overage_ack, dependency_ids=@dependency_ids WHERE id=@id`);
    for (const l of lines) upd.run(l);
    recordEvent(d,id,q.revision+1,confirm ? 'confirmed' : 'saved',values.reviewer_name,{changes,quoteChanges,added:lines.filter((l)=>!q.lines.some((old)=>old.id===l.id)).map((l)=>({id:l.id,sku:l.comp_sku,description:l.comp_desc,qty:l.qty,price:l.comp_unit_price})),removed:removed.map((l)=>({id:l.id,sku:l.comp_sku,description:l.comp_desc,qty:l.qty,price:l.comp_unit_price})),totals:c.totals});
    // Learning is explicit and only occurs after review. Preserve quantity conversion as well as SKU.
    if (confirm) {
      const mappings = lines.filter((l) => form.has(`learn_${l.id}`)).map((l) => ({
        competitor_sku: l.comp_sku, competitor_description: l.comp_desc, competitor_brand: q.competitor || '',
        avery_sku: l.our_sku || 'N/A', units_per_line_item: ['tape','driver','channel'].includes(cat[l.our_sku]?.category) ? 1 : l.our_qty / l.qty,
        notes: `Reviewed on comparison #${id}; quantities and dependencies must be recalculated.`,
      }));
      learned = addCompatRows(mappings, 'review');
      const logo = getBlob('logo');
      if (logo) setBlob(`quote_logo_${id}`, logo.mime, logo.data);
      else d.prepare('DELETE FROM blobs WHERE key = ?').run(`quote_logo_${id}`);
    }
  })();
  return learned;
}
