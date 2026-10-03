import Link from 'next/link';
import fs from 'node:fs';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { getQuote, computeQuote, rematch, runPipeline, fmt } from '@/lib/quotes';
import { listCatalog, catalogBySku } from '@/lib/catalog';
import { addCompatRows } from '@/lib/compat';
import SubmitButton from '../../submit-button';

const CAT_LABEL = { tape: 'Tape light', driver: 'Power supplies', connector: 'Connectors', other: 'Other' };
const SRC_LABEL = { compat: 'Compatibility list', ai: 'AI suggestion', rules: 'Built-in rules', manual: 'Set by hand' };

async function save(formData) {
  'use server';
  const id = Number(formData.get('quote_id'));
  const intent = String(formData.get('intent') || 'save');
  const d = db();
  if (intent === 'delete') {
    const q = d.prepare('SELECT file_path FROM quotes WHERE id = ?').get(id);
    d.prepare('DELETE FROM quotes WHERE id = ?').run(id);
    if (q?.file_path) fs.rm(q.file_path, () => {});
    revalidatePath('/');
    redirect('/');
  }
  if (intent === 'rerun') {
    const q = d.prepare('SELECT raw_text FROM quotes WHERE id = ?').get(id);
    await runPipeline(id, q.raw_text || '');
    revalidatePath(`/quotes/${id}`);
    redirect(`/quotes/${id}`);
  }
  if (intent === 'rematch') {
    await rematch(id);
    revalidatePath(`/quotes/${id}`);
    redirect(`/quotes/${id}`);
  }

  d.prepare('UPDATE quotes SET customer = ?, job_name = ?, notes = ? WHERE id = ?').run(
    String(formData.get('customer') || ''),
    String(formData.get('job_name') || ''),
    String(formData.get('notes') || ''),
    id
  );
  const cat = catalogBySku();
  const lines = d.prepare('SELECT * FROM quote_lines WHERE quote_id = ?').all(id);
  const learn = [];
  const upd = d.prepare(
    'UPDATE quote_lines SET comp_unit_price = ?, qty = ?, our_qty = ?, our_sku = ?, na = ?, include = ?, match_source = ?, confirmed = ? WHERE id = ?'
  );
  d.transaction(() => {
    for (const l of lines) {
      const priceRaw = String(formData.get(`price_${l.id}`) ?? '').replace(/[$,\s]/g, '');
      const price = priceRaw === '' ? null : Number(priceRaw);
      const qty = Number(formData.get(`qty_${l.id}`)) || l.qty;
      const sku = String(formData.get(`sku_${l.id}`) || '');
      const na = sku === '' || sku === 'NA' || !cat[sku] ? 1 : 0;
      const ourSku = na ? null : sku;
      const changed = (ourSku || null) !== (l.our_sku || null);
      let ourQty = Number(formData.get(`oq_${l.id}`)) || qty;
      if (Number(qty) !== Number(l.qty) && Number(formData.get(`oq_${l.id}`)) === Number(l.our_qty ?? l.qty)) {
        ourQty = qty * ((l.our_qty ?? l.qty) / l.qty); // keep the units-per-item ratio when qty changes
      }
      const include = formData.get(`inc_${l.id}`) ? 1 : 0;
      const confirmed = intent === 'confirm' ? 1 : l.confirmed || changed ? 1 : 0;
      upd.run(Number.isNaN(price) ? null : price, qty, ourQty, ourSku, na, include, changed ? 'manual' : l.match_source, confirmed, l.id);
      if (formData.get(`learn_${l.id}`)) {
        learn.push({ competitor_sku: l.comp_sku, competitor_description: l.comp_desc, avery_sku: ourSku || 'N/A', competitor_brand: '', notes: `Confirmed on quote #${id}` });
      }
    }
    if (intent === 'confirm') d.prepare("UPDATE quotes SET status = 'done' WHERE id = ?").run(id);
  })();
  if (learn.length) addCompatRows(learn, 'review');
  revalidatePath(`/quotes/${id}`);
  redirect(intent === 'confirm' ? `/quotes/${id}/summary` : `/quotes/${id}?saved=1${learn.length ? `&learned=${learn.length}` : ''}`);
}

export default async function QuotePage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const q = getQuote(Number(id));
  if (!q) notFound();
  const c = computeQuote(q);
  const catalog = listCatalog();
  const groups = Object.entries(
    catalog.reduce((acc, it) => ((acc[it.category] ||= []).push(it), acc), {})
  );

  return (
    <form action={save}>
      <input type="hidden" name="quote_id" value={q.id} />
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

      {q.status === 'error' && <p className="error card">{q.error}</p>}
      {q.status !== 'error' && q.error && <p className="banner">{q.error}</p>}
      {sp?.saved && <p className="ok">Saved.{sp?.learned ? ` Added ${sp.learned} match(es) to the compatibility list.` : ''}</p>}

      <div className="stats">
        <div className="stat big">
          <span className="muted small">Savings in summary</span>
          <b>{fmt(c.totals.savings)}</b>
          <span className="small muted">{(c.totals.pct * 100).toFixed(0)}% below their price</span>
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

      <div className="tablewrap">
        <table className="review">
          <thead>
            <tr>
              <th>Line</th>
              <th>Their item</th>
              <th className="num">Qty</th>
              <th className="num">Their price (each)</th>
              <th>Avery match</th>
              <th className="num">Our qty</th>
              <th className="num">Our price (each)</th>
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
                  <input name={`qty_${r.id}`} defaultValue={r.qty} style={{ width: 64 }} inputMode="decimal" />
                </td>
                <td className="num">
                  <input
                    name={`price_${r.id}`}
                    defaultValue={r.comp_unit_price ?? ''}
                    placeholder="not on quote"
                    style={{ width: 110 }}
                    inputMode="decimal"
                  />
                  {r.theirTotal != null && <div className="small muted">{fmt(r.theirTotal)} total</div>}
                </td>
                <td style={{ minWidth: 240 }}>
                  <select name={`sku_${r.id}`} defaultValue={r.our_sku || 'NA'}>
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
                  <input name={`oq_${r.id}`} defaultValue={r.ourQty} style={{ width: 64 }} inputMode="decimal" />
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
                  {r.state === 'na' ? <span className="pill na">N/A</span> : r.state === 'no_price' ? <span className="muted small">needs their price</span> : (
                    <span className={r.savings < 0 ? 'error' : 'ok'}>{fmt(r.savings)}</span>
                  )}
                </td>
                <td>
                  <span className={`pill ${r.confirmed ? 'high' : r.confidence || 'na'}`}>{r.confirmed ? 'confirmed' : r.confidence || '—'}</span>{' '}
                  <span className="pill src">{SRC_LABEL[r.match_source] || r.match_source}</span>
                  <div className="reason">{r.reason}</div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" name={`inc_${r.id}`} defaultChecked={!!r.include} disabled={r.state === 'na'} />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" name={`learn_${r.id}`} defaultChecked={r.match_source === 'manual'} disabled={r.match_source === 'compat'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Savings = their price × their qty − our price × our qty. N/A lines, lines with no competitor price and unticked lines stay out of the summary. Tick
        “Remember” to add a match to the compatibility list so it’s used automatically next time.
      </p>

      <label style={{ marginTop: 16 }}>
        Internal notes
        <textarea name="notes" defaultValue={q.notes || ''} />
      </label>

      <div className="row no-print" style={{ marginTop: 8 }}>
        <SubmitButton label="Save" className="" name="intent" value="save" />
        <SubmitButton label="Confirm & make summary" name="intent" value="confirm" pending="Saving…" />
        <SubmitButton label="Re-match unconfirmed lines" className="" name="intent" value="rematch" pending="Matching…" />
        <SubmitButton label="Re-read the PDF from scratch" className="" name="intent" value="rerun" pending="Reading…" />
        <SubmitButton label="Delete quote" className="danger" name="intent" value="delete" />
      </div>
    </form>
  );
}
