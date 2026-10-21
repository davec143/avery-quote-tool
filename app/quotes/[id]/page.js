import { requireAuth } from '@/lib/auth';
import { requireQuoteAccess } from '@/lib/access';
import { MEMBER_DAILY_AI_RUNS } from '@/lib/portal';
import Link from 'next/link';
import fs from 'node:fs';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getQuote, computeQuote, rematch, reprocessQuote, fmt } from '@/lib/quotes';
import { listCatalog, catalogBySku } from '@/lib/catalog';
import { saveReview } from '@/lib/review';
import SubmitButton from '../../submit-button';
import QuantityInput from './quantity-input';
import { MATCH_LABELS } from '@/lib/crossover';
import { reconcileTotal, printedTotal } from '@/lib/extract';
import { sourceCharges, chargeTotal, CHARGE_LABELS } from '@/lib/source-costs';
import { alternativeOptions } from '@/lib/alternatives';
import { quoteHistory, saveOutcome } from '@/lib/history';
import { brand } from '@/lib/settings';
import SourceReview from './source-review';
import ProductChoice from './product-choice';
import { reviewReadiness } from '@/lib/readiness';
import { duplicateQuote } from '@/lib/quote-drafts';
import { publicReason } from '@/lib/reasons';
import { reserveMemberUsage, MEMBER_DAILY_LIMIT, MEMBER_MAX_LINES } from '@/lib/portal';

const memberName = (actor) => actor.member?.name || actor.member?.email || `Shopify customer ${actor.customerId}`;
const CAT_LABEL = { tape: 'Tape light', driver: 'Power supplies', channel: 'Aluminum channel', connector: 'Connectors', other: 'Other' };
const SRC_LABEL = { compat: 'Compatibility list', ai: 'AI suggestion', rules: 'Built-in rules', manual: 'Set by hand' };

async function save(formData) {
  'use server';
  const id = Number(formData.get('quote_id'));
  const actor = await requireQuoteAccess(id);
  const intent = String(formData.get('intent') || 'save');
  const d = db();
  const current = getQuote(id);
  if (!current) notFound();
  const home = actor.type === 'member' ? '/m' : '/';
  if (actor.type === 'member') {
    // Members edit their own quote only: no shared compatibility-list learning, and team notes stay as they are.
    for (const key of [...formData.keys()]) if (key.startsWith('learn_')) formData.delete(key);
    formData.set('notes', current.notes || '');
    for (const l of current.lines) formData.set(`decision_${l.id}`, l.decision_note || '');
    // Avery's commercial terms are set by the team; the reviewer is always the signed-in member.
    for (const key of ['lead_time', 'payment_terms', 'valid_until']) formData.set(key, current[key] || '');
    formData.set('reviewer_name', memberName(actor));
  }
  if (Number(formData.get('revision')) !== current.revision) redirect(`/quotes/${id}?error=This quote changed. Reload before retrying.`);
  if (intent === 'delete') {
    const q = d.prepare('SELECT file_path FROM quotes WHERE id = ?').get(id);
    d.transaction(() => {
      d.prepare('DELETE FROM quotes WHERE id = ?').run(id);
      d.prepare('DELETE FROM blobs WHERE key = ?').run(`quote_logo_${id}`);
    })();
    if (q?.file_path) fs.rm(q.file_path, () => {});
    revalidatePath(home);
    redirect(home);
  }
  if (actor.type === 'member' && intent === 'addline' && current.lines.length >= MEMBER_MAX_LINES) {
    redirect(`/quotes/${id}?error=${encodeURIComponent(`A quote can have up to ${MEMBER_MAX_LINES} lines. Contact our team for larger projects.`)}`);
  }
  if (actor.type === 'member' && ['rerun', 'rematch'].includes(intent) && !reserveMemberUsage(actor.customerId, 'ai', 1, MEMBER_DAILY_AI_RUNS)) {
    redirect(`/quotes/${id}?error=${encodeURIComponent('You have reached today\'s limit for re-reading and re-matching quotes. Try again tomorrow or contact our team.')}`);
  }
  if (intent === 'rerun') {
    try { await reprocessQuote(id); }
    catch (e) { redirect(`/quotes/${id}?error=${encodeURIComponent(e.message)}`); }
    revalidatePath(`/quotes/${id}`);
    redirect(`/quotes/${id}`);
  }
  if (intent === 'rematch') {
    try { await rematch(id); }
    catch (e) { redirect(`/quotes/${id}?error=${encodeURIComponent(e.message)}`); }
    revalidatePath(`/quotes/${id}`);
    redirect(`/quotes/${id}`);
  }

  let learned;
  try { learned = saveReview(id, formData, intent === 'confirm'); }
  catch (e) {
    // Preserve a valid draft when only the final confirmation checks fail.
    if (intent === 'confirm') { try { saveReview(id, formData, false); } catch {} }
    redirect(`/quotes/${id}?error=${encodeURIComponent(e.message)}`);
  }
  revalidatePath(`/quotes/${id}`);
  redirect(intent === 'confirm' ? `/quotes/${id}/summary` : `/quotes/${id}?saved=1${learned ? `&learned=${learned}` : ''}`);
}

async function createDraft(form) {
  'use server';
  const id=Number(form.get('quote_id'));let newId;
  const actor = await requireQuoteAccess(id);
  if (actor.type === 'member' && !reserveMemberUsage(actor.customerId, 'upload', 1, MEMBER_DAILY_LIMIT)) redirect(`/quotes/${id}?error=${encodeURIComponent(`You can add up to ${MEMBER_DAILY_LIMIT} quotes a day, including copies. Try again tomorrow.`)}`);
  try { newId=duplicateQuote(id,form.get('revision'),actor.type === 'member' ? memberName(actor) : 'Team'); } catch(e) { redirect(`/quotes/${id}?error=${encodeURIComponent(e.message)}`); }
  revalidatePath(actor.type === 'member' ? '/m' : '/');redirect(`/quotes/${newId}?copied=${id}`);
}

async function recordOutcome(form) {
  'use server';
  await requireAuth();
  const id=Number(form.get('quote_id'));
  try { saveOutcome(id,form); } catch(e) { redirect(`/quotes/${id}?error=${encodeURIComponent(e.message)}`); }
  revalidatePath(`/quotes/${id}`);redirect(`/quotes/${id}?saved=1`);
}

export default async function QuotePage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireQuoteAccess(Number(id));
  const member = actor.type === 'member';
  const q = getQuote(Number(id));
  if (!q) notFound();
  const c = computeQuote(q, { live: true });
  const catalog = listCatalog();
  const charges=sourceCharges(q.source_charges), catalogMap=Object.fromEntries(catalog.map((i)=>[i.sku,i]));
  const reconciliation = reconcileTotal(q.raw_text, q.lines.map((l) => ({qty:l.qty,unit_price:l.comp_unit_price})),chargeTotal(charges));
  const history=member ? [] : quoteHistory(q.id);
  const pricedCount=c.counts.priced ?? c.summaryRows.filter((r)=>r.theirTotal != null).length;
  const hasSourcePrices=q.lines.some((l)=>l.comp_unit_price != null);
  const missingSourcePrices=q.lines.some((l)=>l.comp_unit_price == null);
  const suggestions=Object.fromEntries(q.lines.map((l)=>[l.id,alternativeOptions(q,l,catalogMap,brand().priceBasis)]));
  const readiness=reviewReadiness(q,catalogMap,brand().priceBasis);
  const groups = Object.entries(
    catalog.reduce((acc, it) => ((acc[it.category] ||= []).push(it), acc), {})
  );

  return (
    <>
    <form action={save} key={q.revision}>
      <input type="hidden" name="quote_id" value={q.id} />
      <input type="hidden" name="revision" value={q.revision} />
      <div className="spread">
        <div>
          <p className="muted small" style={{ margin: 0 }}>
            <Link href={member ? '/m' : '/'}>{member ? 'My quotes' : 'Quotes'}</Link> / #{q.id}
          </p>
          <h1>{q.quote_number || q.filename}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {q.competitor || 'Competitor'} · {q.quote_date || 'no date'} · read by {q.extractor === 'vision' ? 'AI image reader' : q.extractor === 'ai' ? 'AI' : 'built-in reader'}, matched by{' '}
            {q.matcher === 'ai' ? 'AI' : 'built-in rules'} ·{' '}
            {q.file_path && (
              <a href={`/api/quotes/${q.id}/pdf`} target="_blank">
                original {q.source_type?.startsWith('image/') ? 'image' : 'PDF'}
              </a>
            )}
          </p>
        </div>
        <div className="row no-print">
          <Link className="btn" href={`/quotes/${q.id}/summary`}>
            View summary
          </Link>
          <SubmitButton label="Save" className="" name="intent" value="save" />
          <SubmitButton label="Confirm & make summary" name="intent" value="confirm" pending="Saving…" />
        </div>
      </div>

      {sp?.error && <p className="error card" role="alert">{sp.error}</p>}
      {q.status === 'error' && <p className="error card">{q.error}</p>}
      {q.status !== 'error' && q.error && !q.error.startsWith('The extracted lines total') && <p className="banner">{q.error}</p>}
      {reconciliation && <p className="banner">{reconciliation}</p>}
      {sp?.saved && <p className="ok">Saved.{sp?.learned ? ` Added ${sp.learned} match(es) to the compatibility list.` : ''}</p>}

      {sp?.copied && <p className="banner">New draft copied from <Link href={`/quotes/${Number(sp.copied)}`}>quote #{Number(sp.copied)}</Link>. Current catalog prices and calculated quantities apply. Approvals, expiry and customer outcome have been reset. Review retained terms and assumptions before confirming.</p>}
      <section className="card readiness no-print" aria-label="Confirmation checklist">
        <h3>{readiness.length ? `${readiness.length} item${readiness.length===1 ? '' : 's'} to resolve before confirmation` : 'Saved draft checks passed'}</h3>
        <p className="small muted">Checks use saved values and the current catalog. Save your edits to refresh this list. Final confirmation validates the submitted form again.</p>
        {readiness.length ? <ul>{readiness.map((issue,i)=><li key={i}><a href={`#${issue.target}`}>{issue.message}</a></li>)}</ul> : <p className="ok">Ready for a final review and confirmation.</p>}
        {q.summary_snapshot && <p className="small muted">Your confirmed customer summary remains frozen. Create a new draft below to prepare a revision while keeping that summary.</p>}
      </section>
      <div className="stats">
        <div className="stat big">
          <span className="muted small">{pricedCount ? 'Savings · priced source lines only' : 'Avery product estimate'}</span>
          <b>{fmt(pricedCount ? c.totals.savings : c.totals.ours)}</b>
          <span className="small muted">{!pricedCount ? 'Source prices not provided' : c.totals.pct == null ? 'No percentage available' : `${(c.totals.pct * 100).toFixed(1)}% difference on compared lines`}</span>
        </div>
        <div className="stat">
          <span className="muted small">Their total · priced lines only</span>
          <b>{fmt(c.totals.theirs)}</b>
        </div>
        <div className="stat">
          <span className="muted small">Avery total · all selected products</span>
          <b>{fmt(c.totals.ours)}</b>
        </div>
        <div className="stat">
          <span className="muted small">Lines</span>
          <b>{c.counts.total}</b>
          <span className="small muted">
            {c.counts.na} N/A · {c.counts.noPrice} no price · {c.counts.low} to check
          </span>
        </div>
      </div>

      {c.counts.noPrice > 0 && (
        <p className="banner">
          {c.counts.noPrice} matched line(s) have no source price. Selected products can be included with Avery pricing only; these lines are excluded from savings. Leave absent prices blank.
        </p>
      )}

      <div className="grid2" style={{ marginBottom: 16 }}>
        <label id="customer-details">
          Customer (shown on summary)
          <input name="customer" defaultValue={q.customer || ''} />
        </label>
        <label>
          Job name
          <input name="job_name" defaultValue={q.job_name || ''} />
        </label>
      </div>

      <p className="small muted">After changing a product or quantity, click Save to refresh costs and inclusion controls. Confirm only after checking the updated comparison.</p>
      <div id="source-review" /><SourceReview id={q.id} mime={q.source_type} hasFile={!!q.file_path} text={q.raw_text}>
      <div className="tablewrap">
        <table className="review">
          <thead>
            <tr>
              <th>Line</th>
              <th>Their item</th>
              <th className="num">Qty</th>
              <th className="num">Their price (each)</th>
              <th>Avery match</th>
              <th className="num">Avery pieces required</th>
              <th className="num">Avery reference price / piece</th>
              <th className="num">Savings</th>
              <th>Why</th>
              <th title="Include in summary">In summary</th>
              {!member && <th title="Save this match to the compatibility list">Remember</th>}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr id={`line-${r.id}`} key={r.id} className={r.state === 'na' ? 'na' : r.inSummary ? '' : 'excluded'}>
                <td className="small">
                  {r.line_ref}
                  {r.group_label && <div className="muted">{r.group_label}</div>}
                </td>
                <td>
                  <label>Source SKU<input aria-label={`Source SKU for line ${r.line_ref}`} name={`source_sku_${r.id}`} defaultValue={r.comp_sku} /></label>
                  <label>Source description<textarea aria-label={`Source description for line ${r.line_ref}`} name={`source_desc_${r.id}`} defaultValue={r.comp_desc} /></label>
                  <label>Circuit / installation group<input aria-label={`Circuit group for line ${r.line_ref}`} name={`group_${r.id}`} defaultValue={r.group_label || ''} placeholder="Same group for products installed together" /></label>
                  <button type="button" className="small" data-source-sku={r.comp_sku}>Find in source</button>
                  <label className="row small"><input type="checkbox" name={`remove_${r.id}`} /> Remove duplicate / non-product source row on Save</label>
                </td>
                <td className="num">
                  <input aria-label={`Source quantity for line ${r.line_ref}`} name={`qty_${r.id}`} type="number" min="0.0001" step="any" required defaultValue={r.qty} style={{ width: 64 }} inputMode="decimal" />
                </td>
                <td className="num">
                  <input
                    name={`price_${r.id}`}
                    aria-label={`Source unit price for line ${r.line_ref}`}
                    defaultValue={r.comp_unit_price ?? ''}
                    placeholder="not on quote"
                    style={{ width: 110 }}
                    inputMode="decimal"
                  />
                  {r.theirTotal != null && <div className="small muted">{fmt(r.theirTotal)} total</div>}
                </td>
                <td style={{ minWidth: 240 }}>
                  <ProductChoice id={r.id} line={r.line_ref} selected={r.our_sku} groups={groups.map(([cat,items])=>[CAT_LABEL[cat] || cat,items.map(({sku,title,variant,unit_price})=>({sku,title,variant,unit_price}))])} options={suggestions[r.id]} />
                  {r.our && <div className="small muted">{r.our.sku}</div>}
                </td>
                <td className="num">
                  <QuantityInput id={r.id} line={r.line_ref} quantity={r.ourQty} mode={r.quantity_mode || 'auto'} />
                  {r.qty_basis && <div className="reason">{r.qty_basis}</div>}
                </td>
                <td className="num">
                  {fmt(r.ourUnit)}
                  {r.our && (
                    <div className="small muted">
                      {fmt(r.our.pack_price)} / {r.our.pack_qty > 1 ? `${r.our.pack_label.toLowerCase()}` : 'each'}
                    </div>
                  )}
                </td>
                <td className="num">
                  {r.state.startsWith('invalid') ? <span className="error small">Invalid quantity or price</span> : r.state === 'na' ? <span className="pill na">N/A</span> : r.state === 'no_price' ? <span className="muted small">Avery pricing only</span> : (
                    <span className={r.savings < 0 ? 'error' : 'ok'}>{fmt(r.savings)}</span>
                  )}
                </td>
                <td>
                  <span className={`pill ${r.match_kind === 'exact' ? 'high' : r.match_kind === 'alternative' ? 'medium' : 'low'}`}>{MATCH_LABELS[r.match_kind] || 'Option requiring review'}</span>{' '}
                  <span className="pill src">{SRC_LABEL[r.match_source] || r.match_source}</span>
                  <div className="reason">{member ? publicReason(r.reason) : r.reason}</div>
                  {r.difference_notes && <p className="reason"><b>Customer disclosure:</b> {r.difference_notes}</p>}
                  <label className="small">Customer-facing spec note
                    <textarea name={`note_${r.id}`} defaultValue={r.customer_note || ''} placeholder="Explain differences and what still needs verification" />
                  </label>
                  {!member && <label className="small">Internal decision reason<input name={`decision_${r.id}`} defaultValue={r.decision_note || ''} placeholder="Why this option or correction?" /></label>}
                  {!!r.review_required && r.our && <label className="row small"><input type="checkbox" name={`accept_${r.id}`} defaultChecked={!!r.review_accepted} /> I reviewed this option&apos;s requirements and installation/quantity plan.</label>}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" aria-label={`Include line ${r.line_ref} in comparison`} name={`inc_${r.id}`} defaultChecked={!!r.include} disabled={r.state === 'na'} />
                </td>
                {!member && <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" aria-label={`Remember reviewed match for line ${r.line_ref}`} name={`learn_${r.id}`} defaultChecked={false} disabled={r.match_source === 'compat'} />
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </SourceReview>
      <section className="card" style={{marginTop:16}}>
        <h3>Add a missing source product</h3>
        <p className="small muted">Add a product visible on the original quote. Then select a product or re-match unconfirmed lines. Add freight, tax and discounts below as source charges.</p>
        <div className="grid2">
          <label>Source line reference<input name="new_ref" placeholder="Printed line or page reference" /></label>
          <label>Source SKU<input name="new_sku" /></label>
          <label>Source description<textarea name="new_desc" /></label>
          <label>Circuit / installation group<input name="new_group" /></label>
          <label>Source quantity<input name="new_qty" type="number" min="0.0001" step="any" defaultValue="1" /></label>
          <label>Source unit price<input name="new_price" inputMode="decimal" /></label>
        </div>
        <SubmitButton label="Add source line" name="intent" value="addline" pending="Adding…" />
      </section>
      <section className="card" style={{marginTop:16}}>
        <h3 id="installation">Installation requirements</h3>
        <p className="small muted">Give products installed together the same circuit group. Calculations use required tape length, not purchased offcuts. Verify connected loads, distribution, feeds and controls.</p>
        <div className="grid2">
          <label>Driver calculation basis<select name="driver_basis" defaultValue={q.driver_basis || 'source'}><option value="source">Quoted driver capacity</option><option value="tape_load">Selected Avery tape load with reviewed headroom</option></select></label>
          <label>Reviewed driver headroom (%)<input name="design_headroom" type="number" min="0" max="100" step="any" defaultValue={q.design_headroom ?? ''} placeholder="Unknown until reviewed" /></label>
        </div>
        {c.installation.groups.map((g)=><div className="installation-group" key={g.name}><b>{g.name}: {g.status}</b><div className="small">Known tape load: {g.knownLoadWatts.toFixed(2)}W{g.requiredWatts != null ? `; with headroom: ${g.requiredWatts.toFixed(2)}W` : ''}. Selected driver capacity: {g.capacityWatts}W.</div>{[...g.blockers,...g.incomplete,...g.conditions].map((note,i)=><p className={g.blockers.includes(note) ? 'error small' : 'small muted'} key={i}>{note}</p>)}</div>)}
        <label>Customer-facing installation assumptions<textarea name="installation_note" defaultValue={q.installation_note || ''} placeholder="Reviewed circuit distribution, feeds, controls and remaining conditions" /></label>
      </section>
      <p className="small muted">
        Savings compare the same selected lines, including higher-cost substitutes. Avery quantities are pieces; whole-pack mode combines repeated SKUs and rounds up to full packs. Review units and roll lengths against the source PDF. Selected products without source prices show Avery costs only. Savings use only priced source lines and their allocated Avery costs. N/A and unticked lines stay out of the summary.{!member && ' Tick “Remember” to add a match to the compatibility list so it’s used automatically next time.'}
      </p>

      <section className="card" style={{ marginTop: 20 }}>
        <h3 id="customer-review">Customer information and review</h3>
        <p className="small muted">This is a product comparison. Enter the terms you can substantiate; blank terms are shown as “To be confirmed.”</p>
        <div className="grid2">
          {member ? <>
            <p className="small"><b>Lead time / availability:</b> {q.lead_time || 'To be confirmed with Avery'}</p>
            <p className="small"><b>Payment terms:</b> {q.payment_terms || 'To be confirmed with Avery'}</p>
            <p className="small"><b>Comparison valid until:</b> {q.valid_until || 'To be confirmed with Avery'}</p>
          </> : <>
          <label>Lead time / availability<input name="lead_time" defaultValue={q.lead_time || ''} placeholder="Confirm stock and delivery with Avery" /></label>
          <label>Payment terms<input name="payment_terms" defaultValue={q.payment_terms || ''} /></label>
          <label>Comparison valid until<input type="date" name="valid_until" defaultValue={q.valid_until || ''} /></label>
          </>}
          <label>Customer-facing project notes<textarea name="customer_notes" defaultValue={q.customer_notes || ''} /></label>
        </div>
        {member ? <p className="small"><b>Reviewed by:</b> {memberName(actor)}</p> : <label>Reviewer name<input name="reviewer_name" defaultValue={q.reviewer_name || ''} placeholder="Required at confirmation" /></label>}
        <h3>Source charges and reconciliation</h3>
        <p className="small muted">Printed source total: {fmt(printedTotal(q.raw_text))}. {hasSourcePrices ? `Known source product amounts: ${fmt(q.lines.reduce((n,l)=>n+(l.comp_unit_price ?? 0)*l.qty,0))}.` : 'Source product prices not provided.'} Recorded adjustments: {fmt(chargeTotal(charges))}. These charges are excluded from product comparisons. {missingSourcePrices && 'Full source total reconciliation is unavailable because some source prices are missing; verify every source line and quantity.'}</p>
        <div className="grid2">{Object.entries(CHARGE_LABELS).map(([kind,label])=><label key={kind}>{label}{kind==='discount' ? ' (positive deduction)' : ''}<input name={`charge_${kind}`} type="number" min="0" step="0.01" defaultValue={Math.abs(charges.find((c)=>c.kind===kind)?.amount || 0) || ''} /></label>)}</div>
        <label>Other charge explanation<input name="charge_note" defaultValue={charges.find((c)=>c.kind==='other')?.note || ''} /></label>
        {hasSourcePrices && <label className="row"><input type="checkbox" name="currency_confirmed" defaultChecked={!!q.currency_confirmed} /> I verified that the supplied competitor prices are in USD.</label>}
        <label className="row"><input type="checkbox" name="quantities_verified" defaultChecked={!!q.quantities_verified} /> I verified every source line, unit price where provided, length / unit of measure, and Avery purchase quantity against the source and product specifications.</label>
        <label>Source total reconciliation note<textarea name="reconciliation_note" defaultValue={q.reconciliation_note || ''} placeholder="If totals differ, explain the verified freight, tax, discount or scope difference. Correct missing lines before confirming." /></label>
        <p className="small muted">“Save” keeps a draft. “Confirm” validates and freezes the reviewed prices and customer document.{!member && ' Remembered mappings are saved only during confirmation.'}</p>
      </section>

      {!member && <label style={{ marginTop: 16 }}>
        Internal notes
        <textarea name="notes" defaultValue={q.notes || ''} />
      </label>}

      <div className="row no-print" style={{ marginTop: 8 }}>
        <SubmitButton label="Save" className="" name="intent" value="save" />
        <SubmitButton label="Confirm & make summary" name="intent" value="confirm" pending="Saving…" />
        <SubmitButton label="Re-match unconfirmed lines" className="" name="intent" value="rematch" pending="Matching…" />
        <SubmitButton label="Re-read the source from scratch" confirmMessage="Re-read this source and replace every saved match, price edit, and customer specification note?" className="" name="intent" value="rerun" pending="Reading…" />
        <SubmitButton label="Delete quote" confirmMessage="Delete this quote and its uploaded source file? This cannot be undone." className="danger" name="intent" value="delete" />
      </div>
    </form>
    <section className="card no-print" style={{marginTop:20}}>
      <h3>Create a revision</h3>
      <p className="small muted">Copy saved source lines and selections into an independent draft using current catalog prices. The original quote and its confirmed summary stay intact. Save any edits you want to carry over first.</p>
      <form action={createDraft}>
        <input type="hidden" name="quote_id" value={q.id} /><input type="hidden" name="revision" value={q.revision} />
        <SubmitButton label="Create new draft from this quote" pending="Copying…" />
      </form>
    </section>
    {!member && <><section className="card no-print" style={{marginTop:20}}>
      <h3>Customer outcome</h3>
      <form action={recordOutcome} key={`outcome-${q.revision}`}>
        <input type="hidden" name="quote_id" value={q.id} /><input type="hidden" name="revision" value={q.revision} />
        <div className="grid2"><label>Status<select name="outcome" defaultValue={q.outcome || 'open'}><option value="open">Open</option><option value="reviewing">Customer reviewing</option><option value="accepted">Customer accepted</option><option value="declined">Customer declined</option></select></label><label>Recorded by<input name="actor" defaultValue={q.reviewer_name || ''} required /></label></div>
        <label>Feedback / reason<textarea name="outcome_note" defaultValue={q.outcome_note || ''} /></label>
        <SubmitButton label="Record customer outcome" />
        <p className="small muted">Records feedback internally. Reviewer names are self-reported under the shared team login.</p>
      </form>
    </section>
    <section className="card no-print" style={{marginTop:20}}><h3>Review history</h3>
      {!history.length && <p>No history recorded yet. Earlier activity was not logged.</p>}
      {history.map((e)=><details key={e.id}><summary>{e.created_at} UTC · {e.actor} · {e.event_type} · revision {e.revision}</summary><pre className="history-details">{JSON.stringify(e.details,null,2)}</pre></details>)}
    </section></>}
    </>
  );
}
