import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getQuote, summaryDocument, fmt } from '@/lib/quotes';
import SummaryActions from './summary-actions';

const exclusion = (r) => r.state === 'na' ? 'No compatible Avery product selected' : r.state === 'no_price' ? 'Competitor price missing' : r.state.startsWith('invalid') ? 'Quantity or catalog price needs correction' : 'Excluded during review';
const date = (value) => value ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('en-US', { timeZone: value.length === 10 ? 'UTC' : 'America/New_York', year: 'numeric', month: 'long', day: 'numeric' }) : 'To be confirmed';
const estimateDisclaimer = 'This is an estimate. Contact our team for the final price before placing your order.';
const unitLabel = (item, n) => (item?.category === 'tape' ? (n === 1 ? 'roll' : 'rolls') : (n === 1 ? 'piece' : 'pieces'));
function costDetails(comparison, row) {
  if (comparison.priceBasis !== 'pack') return [`${row.ourQty} pieces at ${fmt(row.ourUnit)} each`, 'Per-piece estimate'];
  const order = comparison.orders.find((o) => o.sku === row.our_sku);
  if (!order) return ['Whole-pack cost; see purchase quantities'];
  const unit = /case/i.test(order.packLabel) ? 'case' : /box/i.test(order.packLabel) ? 'box' : 'pack';
  const plural = order.packs === 1 ? unit : unit === 'box' ? 'boxes' : `${unit}s`;
  const purchase = `${order.packs} ${plural} × ${fmt(order.packPrice)}`;
  const shared = comparison.summaryRows.filter((r) => r.our_sku === row.our_sku).length > 1;
  return shared ? [`Allocated share of ${purchase}`, `${row.ourQty} of ${order.requiredPieces} required pieces`]
    : [purchase, `${order.orderPieces} pieces supplied${order.extraPieces ? ` (${order.extraPieces} extra)` : ''}`];
}

export default async function SummaryPage({ params }) {
  const { id } = await params;
  const stored = getQuote(Number(id));
  if (!stored) notFound();
  const { quote: q, comparison: c, branding: b, ready } = summaryDocument(stored);
  const excluded = c.rows.filter((r) => !r.inSummary);
  const higher = c.totals.savings < 0;
  const percent = c.totals.pct == null ? null : `${Math.abs(c.totals.pct * 100).toFixed(1)}%`;
  const expired = !!q.valid_until && q.valid_until < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const text = [
    `${b.companyName} — product comparison AQ-${stored.id}${ready ? '' : ' — DRAFT, NOT REVIEWED'}`,
    `Prepared for: ${q.customer || 'Not specified'}${q.job_name ? ` · Project: ${q.job_name}` : ''}`,
    `Source: ${q.competitor || 'Competitor'} quote ${q.quote_number || 'not specified'} (${q.quote_date || 'date not specified'})`,
    `Scope: ${c.counts.compared} of ${c.counts.total} product lines compared. ${excluded.length} excluded. All amounts USD; tax, freight, installation, controls and unlisted accessories are excluded.`,
    c.priceBasis === 'pack' ? 'Pricing: whole packs. Shared-SKU pack cost is allocated proportionally across compared lines.' : 'Pricing: per-piece estimate; assumes loose pieces can be supplied. Confirm with Avery before ordering.',
    ...c.summaryRows.map((r) => `${r.comp_sku} × ${r.qty} = ${fmt(r.theirTotal)} → ${r.our.title} (${r.our.sku}), ${r.ourQty} ${unitLabel(r.our, r.ourQty)} required${r.qty_basis ? ` (${r.qty_basis})` : ''}; cost ${fmt(r.ourTotal)} (${costDetails(c, r).join('; ')}). ${r.savings < 0 ? 'Additional cost' : 'Savings'} ${fmt(Math.abs(r.savings))}.${r.customer_note ? ` Spec note: ${r.customer_note}` : ''}`),
    `Compared competitor subtotal: ${fmt(c.totals.theirs)}. Avery product subtotal: ${fmt(c.totals.ours)}. ${higher ? 'Additional cost' : 'Estimated savings'}: ${fmt(Math.abs(c.totals.savings))}${percent ? ` (${percent})` : ''}.`,
    'Avery purchase quantities:',
    ...c.orders.map((o) => `${o.sku}: ${o.requiredPieces} pieces required; ${o.packs} × ${o.packLabel} of ${o.packQty} (${o.orderPieces} pieces, ${o.extraPieces} extra); ${fmt(o.total)}${c.priceBasis === 'pack' ? '' : ' per-piece estimate'}.`),
    estimateDisclaimer,
    ...excluded.map((r) => `Not compared: ${r.comp_sku} × ${r.qty} — ${exclusion(r)}${r.theirTotal != null ? `; source amount ${fmt(r.theirTotal)}` : ''}.`),
    `Reviewed: ${ready ? date(q.reviewed_at) : 'Pending'}. Valid until: ${date(q.valid_until)}${expired ? ' — EXPIRED, REQUEST UPDATED PRICING' : ''}.`,
    `Availability / lead time: ${q.lead_time || 'To be confirmed'}. Payment terms: ${q.payment_terms || 'To be confirmed'}.`,
    q.customer_notes || '', b.disclaimer,
    'Next step: ask Avery to confirm specifications, quantities, stock, freight, tax and final order pricing before placing the order.',
    b.contactLine || '', b.intakeEmail ? `Contact: ${b.intakeEmail}` : 'Contact your Avery representative.',
  ].filter(Boolean).join('\n\n');
  return (
    <>
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <Link className="btn" href={`/quotes/${stored.id}`}>← Back to review</Link>
        <SummaryActions text={text} ready={ready && !expired} />
        {!ready && <span className="error small">Confirm the comparison before exporting.</span>}
        {expired && <span className="error small">Expired — request an updated comparison.</span>}
      </div>
      <article className="summary">
        {!ready && <div className="sum-status">DRAFT · Not reviewed · Do not send to customer</div>}
        {expired && <div className="sum-status">EXPIRED · Request updated pricing</div>}
        <header className="sum-head">
          <div><img src={ready ? `/api/logo?quote=${stored.id}` : '/api/logo'} alt={b.companyName} className="sum-logo" />{b.tagline && <div className="sum-tag">{b.tagline}</div>}</div>
          <div className="sum-meta"><h1>Product comparison</h1><b>AQ-{stored.id}</b><div>Prepared for: {q.customer || 'Not specified'}</div>{q.job_name && <div>Project: {q.job_name}</div>}<div>Reviewed: {ready ? date(q.reviewed_at) : 'Pending'}</div><div>Valid until: {date(q.valid_until)}</div></div>
        </header>
        <p className="sum-source">Compared with {q.competitor || 'competitor'} quote <b>{q.quote_number || 'number not specified'}</b> · Source date: {q.quote_date || 'not specified'}</p>
        <section className="sum-hero">
          <div><div className="sum-label">{higher ? 'Additional product cost' : 'Estimated product savings'}</div><div className="sum-big">{fmt(Math.abs(c.totals.savings))}</div><div>{percent ? `${percent} ${higher ? 'higher' : 'lower'} on the compared lines` : 'Percentage unavailable: compared source subtotal is zero'}</div></div>
          <div className="sum-split"><div><span>Competitor subtotal</span><b>{fmt(c.totals.theirs)}</b></div><div><span>{b.companyName} subtotal</span><b>{fmt(c.totals.ours)}</b></div></div>
        </section>
        <section className="sum-scope"><b>{c.counts.compared} of {c.counts.total} product lines compared · All prices USD</b><p>This comparison covers the selected products below. {excluded.length} source line(s) are excluded and listed separately. Tax, freight, installation, controls, and unlisted accessories are excluded from both compared subtotals. This is a product comparison; final order pricing and system suitability require confirmation.</p><p>{c.priceBasis === 'pack' ? 'Avery cost includes full cases or boxes, rounded up after combining repeated SKUs. Line costs allocate shared pack costs proportionally.' : 'Avery cost is a per-piece estimate. It assumes loose pieces can be supplied; case and box ordering may cost more. Confirm supply terms before ordering.'}</p></section>
        <h2>Compared products</h2>
        {!c.summaryRows.length ? <p>No valid priced products selected. Return to review.</p> : <div className="tablewrap"><table className="sum-table comparison-table"><colgroup><col style={{ width: '24%' }} /><col style={{ width: '12%' }} /><col style={{ width: '36%' }} /><col style={{ width: '15%' }} /><col style={{ width: '13%' }} /></colgroup><thead><tr><th>Source item / quantity</th><th className="num">Source total</th><th>Avery substitute / pieces</th><th className="num">Cost</th><th className="num">Difference</th></tr></thead><tbody>
          {c.summaryRows.map((r) => <tr key={r.id}><td><b>{r.comp_sku}</b><div className="sum-desc">{r.comp_desc}</div>{r.group_label && <div className="sum-desc">{r.group_label}</div>}<div>{r.qty} source units × {fmt(r.comp_unit_price)}</div></td><td className="num">{fmt(r.theirTotal)}</td><td><b>{r.our.title}</b><div className="sum-desc">{r.our.sku} · {r.our.variant}</div><div>{r.ourQty} {unitLabel(r.our, r.ourQty)} required</div>{r.qty_basis && <div className="sum-desc">{r.qty_basis}</div>}<div className="sum-desc">{[r.our.cct, r.our.output_class, r.our.watts ? `${r.our.watts}W` : null, r.our.ip_rating].filter(Boolean).join(' · ')}</div>{r.customer_note && <p className="sum-note"><b>Specification note:</b> {r.customer_note}</p>}</td><td className="num">{fmt(r.ourTotal)}{costDetails(c, r).map((detail, i) => <div key={i} className="sum-desc">{detail}</div>)}</td><td className={`num ${r.savings < 0 ? 'error' : 'ok'}`}>{r.savings < 0 ? '+' : '−'}{fmt(Math.abs(r.savings))}<div className="sum-desc">{r.savings < 0 ? 'additional cost' : 'savings'}</div></td></tr>)}
        </tbody><tfoot><tr><td><b>Compared product subtotals</b></td><td className="num"><b>{fmt(c.totals.theirs)}</b></td><td></td><td className="num"><b>{fmt(c.totals.ours)}</b></td><td className="num"><b>{higher ? '+' : '−'}{fmt(Math.abs(c.totals.savings))}</b></td></tr></tfoot></table></div>}
        <h2>Avery purchase quantities</h2>
        <div className="tablewrap"><table className="sum-table"><thead><tr><th>Avery SKU</th><th className="num">Required pieces</th><th>Full packs to order</th><th className="num">Pieces supplied / extra</th><th className="num">{c.priceBasis === 'pack' ? 'Purchase cost' : 'Piece estimate'}</th></tr></thead><tbody>{c.orders.map((o) => <tr key={o.sku}><td><b>{o.sku}</b><div className="sum-desc">{o.title}</div></td><td className="num">{o.requiredPieces}</td><td>{o.packs} × {o.packLabel} ({o.packQty} pieces per pack)<div className="sum-desc">{fmt(o.packPrice)} / pack</div></td><td className="num">{o.orderPieces} / {o.extraPieces} extra</td><td className="num">{fmt(o.total)}</td></tr>)}</tbody></table></div>
        <p className="sum-estimate"><b>Estimate:</b> Contact our team for the final price before placing your order.</p>
        {excluded.length > 0 && <section><h2>Source items outside this comparison</h2><p className="sum-desc">Allow for these separately when budgeting the complete project.</p><table className="sum-table"><thead><tr><th>Source item</th><th>Qty</th><th>Reason excluded</th><th className="num">Source amount</th></tr></thead><tbody>{excluded.map((r) => <tr key={r.id}><td><b>{r.comp_sku}</b><div className="sum-desc">{r.comp_desc}</div></td><td>{r.qty}</td><td>{exclusion(r)}</td><td className="num">{fmt(r.theirTotal)}</td></tr>)}</tbody></table></section>}
        <section className="sum-terms"><div><h2>Availability and terms</h2><p><b>Lead time / availability:</b> {q.lead_time || 'To be confirmed'}</p><p><b>Payment terms:</b> {q.payment_terms || 'To be confirmed'}</p>{q.customer_notes && <p className="preserve">{q.customer_notes}</p>}</div><div><h2>Next step</h2><p>Ask Avery to confirm specifications, quantities, stock, freight, tax, and final order pricing before placing the order.</p><p>{b.contactLine || 'Contact your Avery representative.'}</p>{b.intakeEmail && <a href={`mailto:${b.intakeEmail}?subject=${encodeURIComponent(`Avery comparison AQ-${stored.id}`)}`}>{b.intakeEmail}</a>}</div></section>
        <footer className="sum-foot"><p>{b.disclaimer}</p><p>Comparison AQ-{stored.id} · Prepared from the supplied competitor quote · {ready ? 'Reviewed prices saved with this comparison' : 'Draft prices may change until reviewed'}</p></footer>
      </article>
      <style>{`
        .summary { background:#fff; border:1px solid var(--line); border-radius:12px; padding:36px; max-width:1100px; margin:0 auto; }
        .sum-status { border:2px solid #a45d12; background:#fff5dc; color:#70410b; padding:12px; margin-bottom:20px; font-weight:700; }
        .sum-head { display:flex; justify-content:space-between; align-items:center; gap:24px; padding-bottom:20px; border-bottom:4px solid var(--accent); flex-wrap:wrap; }
        .sum-logo { height:64px; width:auto; max-width:260px; object-fit:contain; }
        .sum-tag,.sum-meta,.sum-source { font-size:13px; color:var(--muted); }.sum-meta {text-align:right;}.sum-meta h1 {font-size:23px;margin:0 0 6px;color:var(--brand);}
        .sum-hero {display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap;background:var(--brand);color:#fff;border-radius:12px;padding:24px;margin:24px 0;border-left:8px solid var(--accent);}
        .sum-label {font-size:13px;text-transform:uppercase;letter-spacing:1px;}.sum-big {font-size:42px;font-weight:800;color:var(--gold-light);}.sum-split {display:flex;gap:24px;}.sum-split span {display:block;font-size:12px;}.sum-split b {font-size:22px;}
        .sum-scope {font-size:13px;background:#f7f6f1;padding:16px;border:1px solid var(--line);border-radius:8px;}.sum-scope p:last-child {margin-bottom:0;}
        .summary h2 {font-size:18px;margin-top:26px;}.sum-table {font-size:13px;}.comparison-table{table-layout:fixed;}.sum-table th {background:#f3f1ea;}.sum-table td:not(.num),.sum-table th{overflow-wrap:anywhere;}.sum-desc {font-size:12px;color:var(--muted);white-space:normal;}.sum-note {font-size:12px;margin:8px 0 0;}.sum-table tfoot td {border-top:2px solid var(--accent);}
        .sum-estimate {font-size:13px;background:#f7f6f1;border-left:3px solid var(--accent);padding:10px 12px;margin:12px 0;break-inside:avoid;}.sum-terms {display:grid;grid-template-columns:1fr 1fr;gap:24px;font-size:13px;}.preserve {white-space:pre-wrap;}.sum-foot {margin-top:24px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px;}
        @media(max-width:700px){.summary{padding:18px;}.sum-meta{text-align:left;}.sum-terms{grid-template-columns:1fr;}.sum-big{font-size:34px;}}
        @media print {html,body{background:#fff!important;}.summary{border:none;padding:0;max-width:none;font-size:13px;}.sum-head{padding-bottom:12px;}.sum-logo{height:48px;}.sum-hero{padding:16px;margin:16px 0;}.sum-big{font-size:34px;}.sum-scope{font-size:12px;padding:12px;}.summary h2{font-size:16px;margin-top:18px;}.sum-table{font-size:12px;}.sum-table th{font-size:10px;letter-spacing:0;}.sum-desc,.sum-note{font-size:11px;}.sum-table td,.sum-table th{padding:6px;}.sum-terms{font-size:12px;}.sum-foot{font-size:11px;}.summary .tablewrap{overflow:visible;}.summary table{min-width:0;width:100%;}.sum-estimate{font-size:12px;}.sum-hero,.sum-table th,.sum-status,.sum-estimate{-webkit-print-color-adjust:exact;print-color-adjust:exact;}tr{break-inside:avoid;}thead{display:table-header-group;}tfoot{display:table-row-group;}.sum-head,.sum-hero,.sum-terms{break-inside:avoid;}@page{margin:14mm;}}
      `}</style>
    </>
  );
}
