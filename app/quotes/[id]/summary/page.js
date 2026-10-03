import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getQuote, computeQuote, fmt } from '@/lib/quotes';
import { brand } from '@/lib/settings';
import SummaryActions from './summary-actions';

export default async function SummaryPage({ params }) {
  const { id } = await params;
  const q = getQuote(Number(id));
  if (!q) notFound();
  const c = computeQuote(q);
  const b = brand();
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const text = [
    `${b.companyName} — savings comparison`,
    q.job_name ? `Job: ${q.job_name}` : null,
    q.quote_number ? `Compared to quote ${q.quote_number}${q.competitor ? ` (${q.competitor})` : ''}` : null,
    '',
    ...c.summaryRows.map(
      (r) =>
        `• ${r.comp_sku} ×${r.qty} at ${fmt(r.comp_unit_price)} → ${r.our.title} (${r.our.sku}) ×${r.ourQty} at ${fmt(r.ourUnit)} = save ${fmt(r.savings)}`
    ),
    '',
    `Their total: ${fmt(c.totals.theirs)}   Avery total: ${fmt(c.totals.ours)}   You save: ${fmt(c.totals.savings)} (${(c.totals.pct * 100).toFixed(0)}%)`,
  ]
    .filter((x) => x !== null)
    .join('\n');

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <Link className="btn" href={`/quotes/${q.id}`}>
          ← Back to review
        </Link>
        <SummaryActions text={text} />
        {c.counts.unconfirmed > 0 && <span className="small error">{c.counts.unconfirmed} line(s) not confirmed yet</span>}
      </div>

      <article className="summary">
        <header className="sum-head">
          <div>
            <img src="/api/logo" alt={b.companyName} className="sum-logo" />
            {b.tagline && <div className="sum-tag">{b.tagline}</div>}
          </div>
          <div className="sum-meta">
            <div className="sum-title">Savings comparison</div>
            <div>{today}</div>
            {q.customer && <div>Prepared for: {q.customer}</div>}
            {q.job_name && <div>Job: {q.job_name}</div>}
            {q.quote_number && <div>Compared to quote {q.quote_number}</div>}
          </div>
        </header>

        <section className="sum-hero">
          <div>
            <div className="sum-label">You save</div>
            <div className="sum-big">{fmt(c.totals.savings)}</div>
            <div className="sum-sub">{(c.totals.pct * 100).toFixed(0)}% less than the quote you received</div>
          </div>
          <div className="sum-split">
            <div>
              <span>Their price</span>
              <b>{fmt(c.totals.theirs)}</b>
            </div>
            <div>
              <span>{b.companyName} price</span>
              <b>{fmt(c.totals.ours)}</b>
            </div>
          </div>
        </section>

        {c.summaryRows.length === 0 ? (
          <p className="muted">No lines to compare yet. Go back and match items or add the competitor&apos;s prices.</p>
        ) : (
          <table className="sum-table">
            <thead>
              <tr>
                <th>Their item</th>
                <th className="num">Qty</th>
                <th className="num">Their price</th>
                <th>{b.companyName} item</th>
                <th className="num">Qty</th>
                <th className="num">Our price</th>
                <th className="num">You save</th>
              </tr>
            </thead>
            <tbody>
              {c.summaryRows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.comp_sku}</b>
                    <div className="sum-desc">{r.comp_desc}</div>
                  </td>
                  <td className="num">{r.qty}</td>
                  <td className="num">
                    {fmt(r.theirTotal)}
                    <div className="sum-desc">{fmt(r.comp_unit_price)} ea</div>
                  </td>
                  <td>
                    <b>{r.our.title}</b>
                    <div className="sum-desc">
                      {r.our.sku}
                      {r.our.variant ? ` · ${r.our.variant}` : ''}
                    </div>
                  </td>
                  <td className="num">{r.ourQty}</td>
                  <td className="num">
                    {fmt(r.ourTotal)}
                    <div className="sum-desc">{fmt(r.ourUnit)} ea</div>
                  </td>
                  <td className="num sum-save">{fmt(r.savings)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <b>Total</b>
                </td>
                <td className="num">
                  <b>{fmt(c.totals.theirs)}</b>
                </td>
                <td colSpan={2}></td>
                <td className="num">
                  <b>{fmt(c.totals.ours)}</b>
                </td>
                <td className="num sum-save">
                  <b>{fmt(c.totals.savings)}</b>
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        <footer className="sum-foot">
          <p>{b.disclaimer}</p>
          <p>
            {b.contactLine}
            {b.intakeEmail && (
              <>
                {b.contactLine ? ' · ' : ''}Send your next quote to <b>{b.intakeEmail}</b>
              </>
            )}
          </p>
        </footer>
      </article>

      <style>{`
        .summary { background:#fff; border:1px solid var(--line); border-radius:12px; padding:36px; max-width:1100px; margin:0 auto; }
        .sum-head { display:flex; justify-content:space-between; align-items:center; gap:24px; padding-bottom:16px; flex-wrap:wrap; position:relative; }
        .sum-head::after { content:''; position:absolute; left:0; right:0; bottom:0; height:4px; border-radius:2px; background:var(--gold-grad); }
        .sum-logo { height:72px; width:auto; display:block; }
        .sum-name { font-size:28px; font-weight:800; color:var(--brand); letter-spacing:.5px; }
        .sum-tag { color:var(--muted); margin-top:4px; }
        .sum-meta { text-align:right; font-size:14px; color:var(--muted); }
        .sum-title { font-size:20px; font-weight:700; color:var(--brand); }
        .sum-hero { display:flex; justify-content:space-between; align-items:center; gap:24px; flex-wrap:wrap; background:var(--brand); color:#fff; border-radius:12px; padding:22px 28px; margin:24px 0; border-left:8px solid var(--accent); }
        .sum-label { text-transform:uppercase; letter-spacing:1px; font-size:12px; opacity:.85; }
        .sum-big { font-size:44px; font-weight:800; color:var(--gold-light); line-height:1.1; }
        .sum-sub { opacity:.9; }
        .sum-split { display:flex; gap:28px; }
        .sum-split span { display:block; font-size:12px; opacity:.8; text-transform:uppercase; letter-spacing:.5px; }
        .sum-split b { font-size:22px; }
        .sum-table th { background:#f3f1ea; }
        .sum-desc { font-size:12px; color:var(--muted); }
        .sum-save { color:var(--good); font-weight:700; }
        .sum-table tfoot td { border-top:2px solid var(--accent); }
        .sum-foot { margin-top:24px; font-size:12px; color:var(--muted); border-top:1px solid var(--line); padding-top:12px; }
        @media print {
          .summary { border:none; padding:0; }
          .sum-hero { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          .sum-table th { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          @page { margin: 14mm; }
        }
      `}</style>
    </>
  );
}
