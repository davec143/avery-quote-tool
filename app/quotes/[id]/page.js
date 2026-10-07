import { requireAuth } from '@/lib/auth';
import Link from 'next/link';
import fs from 'node:fs';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getQuote, computeQuote, rematch, runPipeline, fmt } from '@/lib/quotes';
import { listCatalog, catalogBySku } from '@/lib/catalog';
import { saveReview } from '@/lib/review';
import SubmitButton from '../../submit-button';

const CAT_LABEL = { tape: 'Tape light', driver: 'Power supplies', connector: 'Connectors', other: 'Other' };
const SRC_LABEL = { compat: 'Compatibility list', ai: 'AI suggestion', rules: 'Built-in rules', manual: 'Set by hand' };

async function save(formData) {
  'use server';
  await requireAuth();
  const id = Number(formData.get('quote_id'));
  const intent = String(formData.get('intent') || 'save');
  const d = db();
  const current = getQuote(id);
  if (!current) notFound();
  if (Number(formData.get('revision')) !== current.revision) redirect(`/quotes/${id}?error=This quote changed. Reload before retrying.`);
  if (intent === 'delete') {
    const q = d.prepare('SELECT file_path FROM quotes WHERE id = ?').get(id);
    d.transaction(() => {
      d.prepare('DELETE FROM quotes WHERE id = ?').run(id);
      d.prepare('DELETE FROM blobs WHERE key = ?').run(`quote_logo_${id}`);
    })();
    if (q?.file_path) fs.rm(q.file_path, () => {});
    revalidatePath('/');
    redirect('/');
  }
  if (intent === 'rerun') {
    const q = d.prepare('SELECT raw_text FROM quotes WHERE id = ?').get(id);
    try { await runPipeline(id, q.raw_text || ''); }
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

export default async function QuotePage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const q = getQuote(Number(id));
  if (!q) notFound();
  const c = computeQuote(q, { live: true });
  const catalog = listCatalog();
  const groups = Object.entries(
    catalog.reduce((acc, it) => ((acc[it.category] ||= []).push(it), acc), {})
  );

  return (
    <form action={save}>
      <input type="hidden" name="quote_id" value={q.id} />
      <input type="hidden" name="revision" value={q.revision} />
      <div className="spread">
        <div>
          <p className="muted small" style={{ margin: 0 }}>
            <Link href="/">Quotes</Link> / #{q.id}
          </p>
          <h1>{q.quote_number || q.filename}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {q.competitor || 'Competitor'} · {q.quote_date || 'no date'} · read by {q.extractor === 'ai' ? 'AI' : 'built-in reader'}, matched by{' '}
            {q.matcher === 'ai' ? 'AI' : 'built-in rules'} ·{' '}
            {q.file_path && (
              <a href={`/api/quotes/${q.id}/pdf`} target="_blank">
                original PDF
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
      {q.status !== 'error' && q.error && <p className="banner">{q.error}</p>}
      {sp?.saved && <p className="ok">Saved.{sp?.learned ? ` Added ${sp.learned} match(es) to the compatibility list.` : ''}</p>}

      <div className="stats">
        <div className="stat big">
          <span className="muted small">Savings in summary</span>
          <b>{fmt(c.totals.savings)}</b>
          <span className="small muted">{c.totals.pct == null ? 'No percentage available' : `${(c.totals.pct * 100).toFixed(1)}% difference on compared lines`}</span>
        </div>
        <div className="stat">
          <span className="muted small">Their total (compared lines)</span>
          <b>{fmt(c.totals.theirs)}</b>
        </div>
        <div className="stat">
          <span className="muted small">Our total</span>
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
          {c.counts.noPrice} matched line{c.counts.noPrice > 1 ? 's have' : ' has'} no competitor price on the quote. Type their price in to include
          {c.counts.noPrice > 1 ? ' them' : ' it'} in the summary.
        </p>
      )}

      <div className="grid2" style={{ marginBottom: 16 }}>
        <label>
          Customer (shown on summary)
          <input name="customer" defaultValue={q.customer || ''} />
        </label>
        <label>
          Job name
          <input name="job_name" defaultValue={q.job_name || ''} />
        </label>
      </div>

      <p className="small muted">After changing a product or quantity, click Save to refresh costs and inclusion controls. Confirm only after checking the updated comparison.</p>
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
              <th title="Save this match to the compatibility list">Remember</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.id} className={r.state === 'na' ? 'na' : r.inSummary ? '' : 'excluded'}>
                <td className="small">
                  {r.line_ref}
                  {r.group_label && <div className="muted">{r.group_label}</div>}
                </td>
                <td>
                  <b className="small">{r.comp_sku}</b>
                  <div className="line-desc">{r.comp_desc}</div>
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
                  <select aria-label={`Avery product for line ${r.line_ref}`} name={`sku_${r.id}`} defaultValue={r.our_sku || 'NA'}>
                    <option value="NA">N/A — we don&apos;t carry this</option>
                    {groups.map(([cat, items]) => (
                      <optgroup key={cat} label={CAT_LABEL[cat] || cat}>
                        {items.map((it) => (
                          <option key={it.sku} value={it.sku}>
                            {it.title} — {it.variant} ({fmt(it.unit_price)} ea)
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {r.our && <div className="small muted">{r.our.sku}</div>}
                </td>
                <td className="num">
                  <input aria-label={`Avery pieces for line ${r.line_ref}`} name={`oq_${r.id}`} type="number" min="1" step="1" required defaultValue={r.ourQty} style={{ width: 64 }} inputMode="decimal" />
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
                  {r.state.startsWith('invalid') ? <span className="error small">Invalid quantity or price</span> : r.state === 'na' ? <span className="pill na">N/A</span> : r.state === 'no_price' ? <span className="muted small">needs their price</span> : (
                    <span className={r.savings < 0 ? 'error' : 'ok'}>{fmt(r.savings)}</span>
                  )}
                </td>
                <td>
                  <span className={`pill ${r.confirmed ? 'high' : r.confidence || 'na'}`}>{r.confirmed ? 'confirmed' : r.confidence || '—'}</span>{' '}
                  <span className="pill src">{SRC_LABEL[r.match_source] || r.match_source}</span>
                  <div className="reason">{r.reason}</div>
                  <label className="small">Customer-facing spec note
                    <textarea name={`note_${r.id}`} defaultValue={r.customer_note || ''} placeholder="Explain differences and what still needs verification" />
                  </label>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" aria-label={`Include line ${r.line_ref} in comparison`} name={`inc_${r.id}`} defaultChecked={!!r.include} disabled={r.state === 'na'} />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" aria-label={`Remember reviewed match for line ${r.line_ref}`} name={`learn_${r.id}`} defaultChecked={false} disabled={r.match_source === 'compat'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Savings compare the same selected lines, including higher-cost substitutes. Avery quantities are pieces; whole-pack mode combines repeated SKUs and rounds up to full packs. Review units and roll lengths against the source PDF. N/A lines, lines with no competitor price and unticked lines stay out of the summary. Tick
        “Remember” to add a match to the compatibility list so it’s used automatically next time.
      </p>

      <section className="card" style={{ marginTop: 20 }}>
        <h3>Customer information and review</h3>
        <p className="small muted">This is a product comparison. Enter the terms you can substantiate; blank terms are shown as “To be confirmed.”</p>
        <div className="grid2">
          <label>Lead time / availability<input name="lead_time" defaultValue={q.lead_time || ''} placeholder="Confirm stock and delivery with Avery" /></label>
          <label>Payment terms<input name="payment_terms" defaultValue={q.payment_terms || ''} /></label>
          <label>Comparison valid until<input type="date" name="valid_until" defaultValue={q.valid_until || ''} /></label>
          <label>Customer-facing project notes<textarea name="customer_notes" defaultValue={q.customer_notes || ''} /></label>
        </div>
        <label className="row"><input type="checkbox" name="currency_confirmed" defaultChecked={!!q.currency_confirmed} /> I verified that the competitor prices are in USD.</label>
        <label className="row"><input type="checkbox" name="quantities_verified" defaultChecked={!!q.quantities_verified} /> I verified every source line, unit price, roll length / unit of measure, and Avery piece quantity against the PDF and product specifications.</label>
        <p className="small muted">“Save” keeps a draft. “Confirm” validates and freezes the reviewed prices and customer document. Remembered mappings are saved only during confirmation.</p>
      </section>

      <label style={{ marginTop: 16 }}>
        Internal notes
        <textarea name="notes" defaultValue={q.notes || ''} />
      </label>

      <div className="row no-print" style={{ marginTop: 8 }}>
        <SubmitButton label="Save" className="" name="intent" value="save" />
        <SubmitButton label="Confirm & make summary" name="intent" value="confirm" pending="Saving…" />
        <SubmitButton label="Re-match unconfirmed lines" className="" name="intent" value="rematch" pending="Matching…" />
        <SubmitButton label="Re-read the PDF from scratch" confirmMessage="Re-read this PDF and replace every saved match, price edit, and customer specification note?" className="" name="intent" value="rerun" pending="Reading…" />
        <SubmitButton label="Delete quote" confirmMessage="Delete this quote and its uploaded PDF? This cannot be undone." className="danger" name="intent" value="delete" />
      </div>
    </form>
  );
}
