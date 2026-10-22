// Review screen for members: one card per product, plain-language checks, and only the choices a buyer
// actually makes (which Avery product, how many, include or not). Admins keep the detailed screen.
import Link from 'next/link';
import { fmt } from '@/lib/quotes';
import { publicReason } from '@/lib/reasons';
import { plainIssue, plainLineStatus, plainQuantityBasis, plainQuantityProblem, plainBlocker } from '@/lib/plain';
import SubmitButton from '../../submit-button';
import ProductChoice from './product-choice';
import MemberQuantity from './member-quantity';
import SourceReview from './source-review';
import AckAll from './ack-all';

const CAT_LABEL = { tape: 'Tape light', driver: 'Power supplies', channel: 'Aluminum channel', connector: 'Connectors', other: 'Other' };
const UNIT = { tape: 'rolls', channel: 'sections', driver: 'drivers', connector: 'pieces', other: 'pieces' };

export default function MemberReview({ q, c, sp, readiness, suggestions, groups, save, createDraft, reviewer }) {
  const issues = readiness.map((i) => plainIssue(i, q.lines));
  const included = c.rows.filter((r) => r.inSummary).length;
  const pricedCount = c.counts.priced ?? c.summaryRows.filter((r) => r.theirTotal != null).length;
  const groupList = groups.map(([cat, items]) => [CAT_LABEL[cat] || cat, items.map(({ sku, title, variant, unit_price }) => ({ sku, title, variant, unit_price }))]);
  const power = c.installation.groups.filter((g) => g.blockers.length || g.conditions.length);
  const unacked = c.rows.filter((r) => r.inSummary && r.overage && !r.overage_ack).length;

  return <>
    <form action={save} key={q.revision} className="member-review">
      <input type="hidden" name="quote_id" value={q.id} />
      <input type="hidden" name="revision" value={q.revision} />
      <div className="spread">
        <div>
          <p className="muted small" style={{ margin: 0 }}><Link href="/m">My quotes</Link> / AQ-{q.id}</p>
          <h1>{q.quote_number || q.filename}</h1>
          <p className="muted" style={{ margin: 0 }}>{q.competitor || 'Competitor quote'}{q.quote_date ? ` · ${q.quote_date}` : ''}{q.file_path && <> · <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noreferrer">open their original {q.source_type?.startsWith('image/') ? 'image' : 'PDF'}</a></>}</p>
        </div>
        <div className="row no-print">
          <Link className="btn" href={`/quotes/${q.id}/summary`}>View draft proposal</Link>
          <SubmitButton label="Save" className="" name="intent" value="save" />
          <SubmitButton label="Confirm & get proposal" name="intent" value="confirm" pending="Checking…" />
        </div>
      </div>

      {sp?.error && <p className="error card" role="alert">{sp.error}</p>}
      {q.status === 'error' && <p className="error card">{q.error}</p>}
      {sp?.saved && <p className="ok">Saved.</p>}
      {sp?.copied && <p className="banner">This is a fresh copy of quote AQ-{Number(sp.copied)} with today&apos;s prices. Check it and confirm again.</p>}

      <section className={`card checklist ${issues.length ? 'todo' : 'done'}`} aria-label="What to do next">
        {issues.length ? <>
          <h3>{issues.length === 1 ? '1 thing to sort out' : `${issues.length} things to sort out`} before you confirm</h3>
          <ol>{issues.map((i, n) => <li key={n}><a href={`#${i.target}`}><b>{i.title}</b></a>{i.detail && <div className="small">{i.detail}</div>}{i.action && <div className="small muted">{i.action}</div>}</li>)}</ol>
          {unacked > 0 && <p className="row"><AckAll count={unacked} /><span className="small muted">Ticks every &quot;I understand&quot; box for full-pack minimums.</span></p>}
          <p className="small muted">Saving refreshes this list.</p>
        </> : <>
          <h3>Everything checks out</h3>
          <p>{included} product{included === 1 ? '' : 's'} included. Click <b>Confirm &amp; get proposal</b> to lock in this comparison and order from it.</p>
          {q.summary_snapshot && <p className="small muted">Your confirmed proposal is kept as it is. Saving changes here creates a new draft; confirm again when you&apos;re done.</p>}
        </>}
      </section>

      <div className="stats">
        <div className="stat"><span className="muted small">Their total{pricedCount < included ? ' · priced lines' : ''}</span><b>{fmt(c.totals.theirs)}</b></div>
        <div className="stat"><span className="muted small">Avery total · all included products</span><b>{fmt(c.totals.ours)}</b></div>
        <div className="stat big"><span className="muted small">{pricedCount ? 'You save' : 'Savings'}</span><b>{pricedCount ? fmt(c.totals.savings) : '—'}</b><span className="small muted">{!pricedCount ? 'Their quote shows no prices' : c.totals.pct == null ? '' : `${(c.totals.pct * 100).toFixed(0)}% on the lines with prices`}</span></div>
      </div>

      <div className="grid2" style={{ marginBottom: 16 }}>
        <label>Customer name (shown on the proposal)<input name="customer" defaultValue={q.customer || ''} /></label>
        <label>Project name<input name="job_name" defaultValue={q.job_name || ''} /></label>
      </div>

      <SourceReview id={q.id} mime={q.source_type} hasFile={!!q.file_path} text={q.raw_text} compact>
      <h2 style={{ marginTop: 0 }}>Products on their quote</h2>
      <p className="small muted">For each item: check the Avery product we picked, change it if you like, and tick <b>Include</b> for everything you want on the proposal. Then <b>Save</b>.</p>
      {c.rows.map((r) => {
        const status = plainLineStatus(r);
        const unit = UNIT[r.our?.category] || 'pieces';
        const qtyProblem = r.quantity_problem && r.quantity_mode !== 'manual';
        return <article id={`line-${r.id}`} key={r.id} className={`item-card status-${status.key}`}>
          <header className="item-head">
            <div><span className="muted small">Line {r.line_ref}</span> <b>{r.comp_sku}</b></div>
            <span className={`pill st-${status.key}`}>{status.label}</span>
          </header>
          <div className="item-cols">
            <div className="item-theirs">
              <div className="muted small">Their product</div>
              <p className="item-desc">{r.comp_desc}</p>
              <div className="row">
                <label className="small">Qty on their quote<input aria-label={`Source quantity for line ${r.line_ref}`} name={`qty_${r.id}`} type="number" min="0.0001" step="any" required defaultValue={r.qty} style={{ width: 80 }} inputMode="decimal" /></label>
                <label className="small">Their price each<input name={`price_${r.id}`} aria-label={`Source unit price for line ${r.line_ref}`} defaultValue={r.comp_unit_price ?? ''} placeholder="not shown" style={{ width: 100 }} inputMode="decimal" /></label>
                {r.theirTotal != null && <span className="small muted">= {fmt(r.theirTotal)}</span>}
              </div>
              <details className="small"><summary>Edit what we read from their quote</summary>
                <label>Their SKU<input aria-label={`Source SKU for line ${r.line_ref}`} name={`source_sku_${r.id}`} defaultValue={r.comp_sku} /></label>
                <label>Their description<textarea aria-label={`Source description for line ${r.line_ref}`} name={`source_desc_${r.id}`} defaultValue={r.comp_desc} /></label>
                <label>Installed together with (circuit / room)<input aria-label={`Circuit group for line ${r.line_ref}`} name={`group_${r.id}`} defaultValue={r.group_label || ''} placeholder="e.g. Kitchen island" /></label>
                <button type="button" className="small" data-source-sku={r.comp_sku}>Show me on their quote</button>
                <label className="row small"><input type="checkbox" name={`remove_${r.id}`} /> This isn&apos;t a product — remove this line when I save</label>
              </details>
            </div>
            <div className="item-ours">
              <div className="muted small">Avery product</div>
              <ProductChoice id={r.id} line={r.line_ref} selected={r.our_sku} groups={groupList} options={suggestions[r.id]} />
              {r.our && <div className="small muted">{r.our.sku} · {fmt(r.ourUnit)} each{r.our.pack_qty > 1 ? ` · ${fmt(r.our.pack_price)} per ${r.our.pack_label.toLowerCase()}` : ''}</div>}
              {publicReason(r.reason) && <div className="small muted">{r.our ? 'Why this one: ' : ''}{publicReason(r.reason)}</div>}
              {r.blockers?.length > 0 && <p className="callout bad"><b>This product doesn&apos;t fit:</b> {r.blockers.map(plainBlocker).join(' ')} Pick another one or leave this item out.</p>}
              {r.our && !r.blockers?.length && r.difference_notes && <p className="callout note"><b>Good to know:</b> {r.difference_notes}</p>}
              {r.our && !r.blockers?.length && !r.difference_notes && status.key === 'near' && <p className="callout note"><b>Please check:</b> we couldn&apos;t verify every spec on this match. Compare it with their product before including it.</p>}
              {r.overage && <div className="callout note">
                <b>Full {r.overage.packLabel} minimum.</b> Avery sells this in {r.overage.packLabel}s of {r.overage.packQty}. This proposal needs {r.overage.required}, so the order is {r.overage.ordered} — {r.overage.extra} extra.
                <label className="row" style={{ marginTop: 6 }}><input type="checkbox" name={`ack_${r.id}`} defaultChecked={!!r.overage_ack} /> <b>I understand</b> I&apos;ll get more than their quote needs</label>
              </div>}
              {r.our && <div className="item-qty">
                {qtyProblem && <p className="callout bad"><b>Quantity needed.</b> {plainQuantityProblem(r.quantity_problem)}</p>}
                <MemberQuantity id={r.id} line={r.line_ref} quantity={r.ourQty} mode={r.quantity_mode || 'auto'} problem={qtyProblem ? r.quantity_problem : ''} basis={plainQuantityBasis(r)} unit={unit} />
              </div>}
              {!r.our && <><input type="hidden" name={`oq_${r.id}`} value={r.ourQty ?? r.qty} /><input type="hidden" name={`mode_${r.id}`} value={r.quantity_mode || 'auto'} /></>}
              <label className="small">Note for this item (optional, shown on the proposal)<textarea name={`note_${r.id}`} defaultValue={r.customer_note || ''} placeholder="e.g. Slightly brighter than the original" /></label>
              {!!r.review_required && r.our && <input type="hidden" name={`accept_${r.id}`} value="1" />}
            </div>
          </div>
          <footer className="item-foot">
            <label className="row"><input type="checkbox" aria-label={`Include line ${r.line_ref} in comparison`} name={`inc_${r.id}`} defaultChecked={!!r.include} disabled={r.state === 'na'} /> <b>Include</b> in my proposal</label>
            {r.state === 'ok' && r.savings != null && <span className={r.savings < 0 ? 'error' : 'ok'}>{r.savings < 0 ? `${fmt(-r.savings)} more than their price` : `saves ${fmt(r.savings)}`}</span>}
            {r.state === 'no_price' && <span className="small muted">Their quote shows no price for this line</span>}
          </footer>
        </article>;
      })}

      <details className="card" style={{ marginTop: 16 }}>
        <summary><b>Something on their quote is missing here?</b> Add it</summary>
        <p className="small muted">Add a product that is on their quote but isn&apos;t in the list above. After adding it, pick the Avery product for it.</p>
        <div className="grid2">
          <label>Their SKU<input name="new_sku" /></label>
          <label>Their description<textarea name="new_desc" /></label>
          <label>Quantity<input name="new_qty" type="number" min="0.0001" step="any" defaultValue="1" /></label>
          <label>Their price each (optional)<input name="new_price" inputMode="decimal" /></label>
        </div>
        <SubmitButton label="Add this product" name="intent" value="addline" pending="Adding…" />
      </details>
      </SourceReview>

      {power.length > 0 && <section className="card" style={{ marginTop: 16 }} id="installation">
        <h3>Power check</h3>
        <p className="small muted">We compare the tape wattage with the drivers you picked for each circuit or room.</p>
        {power.map((g) => <div className="installation-group" key={g.name}><b>{g.name}</b>{g.blockers.map((note, i) => <p className="error small" key={i}>{note}</p>)}{g.conditions.map((note, i) => <p className="small muted" key={i}>{note}</p>)}</div>)}
      </section>}

      <section className="card" style={{ marginTop: 16 }} id="customer-review">
        <label>Notes for the proposal (optional)<textarea name="customer_notes" defaultValue={q.customer_notes || ''} placeholder="Anything the customer should know" /></label>
        <p className="small muted">Reviewed by {reviewer}. Lead time, payment terms and validity are set by Avery{q.lead_time || q.payment_terms || q.valid_until ? `: ${[q.lead_time, q.payment_terms, q.valid_until && `valid until ${q.valid_until}`].filter(Boolean).join(' · ')}` : ''}.</p>
      </section>

      <div className="row no-print" style={{ marginTop: 16 }}>
        <SubmitButton label="Save" className="" name="intent" value="save" />
        <SubmitButton label="Confirm & get proposal" name="intent" value="confirm" pending="Checking…" />
        <Link className="btn" href={`/quotes/${q.id}/summary`}>View draft proposal</Link>
      </div>
    </form>
    <details className="no-print" style={{ marginTop: 20 }}>
      <summary className="small muted">Start a fresh copy of this quote with today&apos;s prices</summary>
      <form action={createDraft} className="row" style={{ marginTop: 8 }}>
        <input type="hidden" name="quote_id" value={q.id} /><input type="hidden" name="revision" value={q.revision} />
        <SubmitButton label="Make a copy" pending="Copying…" />
      </form>
    </details>
  </>;
}
