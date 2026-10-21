import { publicReason } from '@/lib/reasons';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getQuote, summaryDocument, fmt } from '@/lib/quotes';
import SummaryActions from './summary-actions';
import { MATCH_LABELS } from '@/lib/crossover';
import { briefConditions } from '@/lib/proposal';
import { sourceCharges, CHARGE_LABELS } from '@/lib/source-costs';
import { loadSpecSheets } from '@/lib/spec-sheets';
import { loadPurchaseCart } from '@/lib/purchase-cart';
import { requireQuoteAccess } from '@/lib/access';
import { memberState } from '@/lib/portal';
import { portalConfig } from '@/lib/shopify-portal';

function MemberPanel({ stored }) {
  if (!stored.shopify_customer_id) return null;
  const who = [stored.portal_customer_name, stored.portal_company, stored.portal_customer_email].filter(Boolean).join(' · ') || `Shopify customer ${stored.shopify_customer_id}`;
  return <section className="card no-print" style={{ marginBottom: 16 }} aria-label="Member quote">
    <p className="small" style={{ margin: 0 }}><b>Member quote</b> — uploaded by {who} at averyled.com/apps/quote{stored.portal_project ? ` · Project: ${stored.portal_project}` : ''}. The member sees and edits this quote in their own Quote Tool. Status for them: <b>{memberState(stored).label}</b>.</p>
  </section>;
}

const exclusion = (r) => r.state === 'na' ? (publicReason(r.reason) || 'No compatible Avery product selected') : r.state === 'invalid_source_price' ? 'Conflicting or invalid source price needs correction' : r.state.startsWith('invalid') ? 'Quantity or catalog price needs correction' : 'Excluded during review';
const date = (value) => value ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('en-US', { timeZone: value.length === 10 ? 'UTC' : 'America/New_York', year: 'numeric', month: 'long', day: 'numeric' }) : 'To be confirmed';
const estimateDisclaimer = 'This is an estimate. Contact our team for the final price before placing your order.';
const unitLabel = (item, n) => item?.category === 'tape' ? (n === 1 ? 'roll' : 'rolls') : item?.category === 'channel' ? (n === 1 ? 'section' : 'sections') : (n === 1 ? 'piece' : 'pieces');
const quantityLabel = (row, comparison) => row.our?.category === 'driver' && row.quantity_mode === 'auto' ? (comparison.installation?.basis==='tape_load' ? `${row.ourQty} driver(s) allocated; see selected-tape load calculation` : `${row.requirement_watts}W source capacity; see shared driver purchase schedule`) : `${row.ourQty} ${unitLabel(row.our,row.ourQty)} required`;
function costDetails(comparison, row) {
  if (comparison.priceBasis !== 'pack') return row.our?.category === 'driver' && row.quantity_mode === 'auto'
    ? ['Share of job driver estimate allocated by quoted watts', 'Per-piece estimate; see purchase quantities']
    : [`${row.ourQty} ${unitLabel(row.our,row.ourQty)} at ${fmt(row.ourUnit)} each`, 'Per-piece estimate'];
  const order = comparison.orders.find((o) => o.sku === row.our_sku);
  if (!order) return ['Whole-pack cost; see purchase quantities'];
  const unit = /case/i.test(order.packLabel) ? 'case' : /box/i.test(order.packLabel) ? 'box' : /bundle/i.test(order.packLabel) ? 'bundle' : 'pack';
  const plural = order.packs === 1 ? unit : unit === 'box' ? 'boxes' : `${unit}s`;
  const purchase = `${order.packs} ${plural} × ${fmt(order.packPrice)}`;
  const shared = comparison.summaryRows.filter((r) => r.our_sku === row.our_sku).length > 1;
  return shared ? [`Allocated share of ${purchase}`, row.our?.category === 'driver' && row.quantity_mode === 'auto' ? 'Allocated by quoted watts; see job capacity estimate' : `${row.ourQty} of ${order.requiredPieces} required pieces`]
    : [purchase, `${order.orderPieces} pieces supplied${order.extraPieces ? ` (${order.extraPieces} extra)` : ''}`];
}

export default async function SummaryPage({ params }) {
  const { id } = await params;
  const actor = await requireQuoteAccess(Number(id));
  const member = actor.type === 'member';
  const stored = getQuote(Number(id));
  if (!stored) notFound();
  if (stored.status === 'error') redirect(`/quotes/${stored.id}`);
  const { quote: q, comparison: c, branding: b, ready } = summaryDocument(stored);
  const excluded = c.rows.filter((r) => !r.inSummary);
  const pricedCount=c.counts.priced ?? c.summaryRows.filter((r)=>r.theirTotal != null).length;
  const hasComparison=pricedCount>0;
  const unpricedCount=c.summaryRows.length-pricedCount;
  const comparedOurs=c.totals.comparedOurs ?? c.totals.ours;
  const [documents,purchase]=await Promise.all([loadSpecSheets(c.orders.map((o)=>o.sku)),loadPurchaseCart({quote:q,comparison:c,ready})]);
  const cfg = portalConfig(), storeBuy = (mode) => `${cfg.storefront}${cfg.proxyPath}/q/${stored.id}/buy?mode=${mode}`;
  const buyUrl = purchase.url ? (member ? storeBuy('add') : purchase.url) : null;
  const pricingScope=hasComparison
    ? `Price comparison covers ${pricedCount} selected line(s) with source prices${unpricedCount ? `; ${unpricedCount} selected line(s) have no source price and are excluded from savings` : ''}. Avery product subtotal includes all selected products.`
    : 'Source prices were not provided for the selected products. Only Avery pricing is shown; no price comparison is available.';
  const title=hasComparison ? 'Product comparison' : 'Avery product proposal';
  const higher = c.totals.savings < 0;
  const percent = c.totals.pct == null ? null : `${Math.abs(c.totals.pct * 100).toFixed(1)}%`;
  const expired = !!q.valid_until && q.valid_until < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const charges=sourceCharges(q.source_charges);
  const highlights=c.summaryRows.map((r)=>({row:r,note:briefConditions(r)})).filter((r)=>r.note);
  const text = [
    `${b.companyName} — ${title.toLowerCase()} AQ-${stored.id}${ready ? '' : ' — DRAFT, NOT REVIEWED'}`,
    `Prepared for: ${q.customer || 'Not specified'}${q.job_name ? ` · Project: ${q.job_name}` : ''}`,
    `Source: ${q.competitor || 'Competitor'} quote ${q.quote_number || 'not specified'} (${q.quote_date || 'date not specified'})`,
    `Scope: ${c.counts.compared} of ${c.counts.total} product lines selected. ${excluded.length} excluded. All amounts USD; tax, freight, installation, controls and unlisted accessories are excluded.`,
    pricingScope,
    c.priceBasis === 'pack' ? 'Pricing: whole packs. Shared-SKU pack cost is allocated proportionally across compared lines.' : 'Pricing: per-piece estimate; assumes loose pieces can be supplied. Confirm with Avery before ordering.',
    ...c.summaryRows.map((r) => `${r.comp_sku} × ${r.qty}${r.theirTotal == null ? "; source price not provided" : ` = ${fmt(r.theirTotal)}`} → ${r.our.title} (${r.our.sku}), ${quantityLabel(r,c)}${r.qty_basis ? ` (${r.qty_basis})` : ''}; cost ${fmt(r.ourTotal)} (${costDetails(c, r).join('; ')}). ${r.savings == null ? 'Source price unavailable.' : `${r.savings < 0 ? 'Additional cost' : 'Savings'} ${fmt(Math.abs(r.savings))}.`}${r.match_kind ? ` ${MATCH_LABELS[r.match_kind]}.` : ''}${r.difference_notes ? ` Differences/conditions: ${r.difference_notes}` : ''}${r.customer_note ? ` Spec note: ${r.customer_note}` : ''}`),
    `Avery product subtotal (all selected products): ${fmt(c.totals.ours)}.`,
    hasComparison ? `Priced source lines: competitor subtotal ${fmt(c.totals.theirs)}; allocated Avery cost ${fmt(comparedOurs)}. ${higher ? 'Additional cost' : 'Estimated savings'}: ${fmt(Math.abs(c.totals.savings))}${percent ? ` (${percent})` : ''}.` : '',
    'Avery purchase quantities:',
    ...c.orders.map((o) => `${o.sku}: ${o.requiredPieces} pieces required; ${o.packs} × ${o.packLabel} of ${o.packQty} (${o.orderPieces} pieces, ${o.extraPieces} extra); ${fmt(o.total)}${c.priceBasis === 'pack' ? '' : ` per-piece estimate; ${fmt(o.packs*o.packPrice)} if buying full packs`}.${documents[o.sku]?.sheets.map((sheet)=>` Spec sheet: ${sheet.url}`).join('') || ' Spec sheet unavailable.'}`),
    buyUrl ? `Buy now — all recommended products: ${buyUrl}\nCurrent store product total: ${fmt(purchase.total)} for whole packs. Shopify confirms final prices, availability, shipping and taxes.` : '',
    estimateDisclaimer,
    ...excluded.map((r) => `Not compared: ${r.comp_sku} × ${r.qty} — ${exclusion(r)}${r.theirTotal != null ? `; source amount ${fmt(r.theirTotal)}` : ''}.`),
    `Reviewed: ${ready ? date(q.reviewed_at) : 'Pending'}. Valid until: ${date(q.valid_until)}${expired ? ' — EXPIRED, REQUEST UPDATED PRICING' : ''}.`,
    `Availability / lead time: ${q.lead_time || 'To be confirmed'}. Payment terms: ${q.payment_terms || 'To be confirmed'}.`,
    `Reviewed by: ${q.reviewer_name || 'Earlier reviewer not recorded'}.`,
    ...charges.map((c)=>`Excluded source charge: ${CHARGE_LABELS[c.kind]} ${fmt(c.amount)}${c.note ? ' — '+c.note : ''}.`),
    q.installation_note ? `Installation assumptions: ${q.installation_note}` : '',
    q.reconciliation_note ? `Source reconciliation: ${q.reconciliation_note}` : '',
    q.customer_notes || '', b.disclaimer,
    'Next step: ask Avery to confirm specifications, quantities, stock, freight, tax and final order pricing before placing the order.',
    b.contactLine || '', b.intakeEmail ? `Contact: ${b.intakeEmail}` : 'Contact your Avery representative.',
  ].filter(Boolean).join('\n\n');
  return (
    <>
      <div className="row no-print" style={{ marginBottom: 16 }}>
        {ready
          ? <Link className="btn" href={`/quotes/${stored.id}`}>← Back to review</Link>
          : <><Link className="btn" href={member ? '/m' : '/'}>← All quotes</Link><Link className="btn primary" href={`/quotes/${stored.id}`}>Review &amp; adjust →</Link></>}
        <SummaryActions text={text} ready={ready && !expired} />
        {ready && !expired && <><a className="btn" href={`/api/quotes/${stored.id}/bom`}>Download purchase CSV</a>{!member && <a className="btn" href={`/api/quotes/${stored.id}/bom?benchmark=1`}>Export reviewed benchmark expectations</a>}</>}
        {!ready && <span className="error small">Confirm the comparison before exporting.</span>}
        {expired && <span className="error small">Expired — request an updated comparison.</span>}
      </div>
      {!member && <MemberPanel stored={stored} />}
      <article className="summary">
        {!ready && <div className="sum-status">{member ? 'DRAFT · Check the matches, then confirm to order' : 'DRAFT · Not reviewed · Do not send to customer'}</div>}
        {expired && <div className="sum-status">EXPIRED · Request updated pricing</div>}
        <header className="sum-head">
          <div><img src={ready ? `/api/logo?quote=${stored.id}` : '/api/logo'} alt={b.companyName} className="sum-logo" />{b.tagline && <div className="sum-tag">{b.tagline}</div>}</div>
          <div className="sum-meta"><h1>{title}</h1><b>AQ-{stored.id}</b><div>Prepared for: {q.customer || 'Not specified'}</div>{q.job_name && <div>Project: {q.job_name}</div>}<div>Reviewed: {ready ? date(q.reviewed_at) : 'Pending'}</div><div>Valid until: {date(q.valid_until)}</div></div>
        </header>
        <p className="sum-source">Product crossovers from {q.competitor || 'competitor'} quote <b>{q.quote_number || 'number not specified'}</b> · Source date: {q.quote_date || 'not specified'}</p>
        <section className="sum-hero">
          <div><div className="sum-label">{hasComparison ? (higher ? 'Additional product cost' : 'Estimated product savings') : 'Avery product estimate'}</div><div className="sum-big">{fmt(hasComparison ? Math.abs(c.totals.savings) : c.totals.ours)}</div><div>{hasComparison ? (percent ? `${percent} ${higher ? 'higher' : 'lower'} on ${pricedCount} priced source line(s)` : 'Percentage unavailable: priced source subtotal is zero') : 'Source prices not provided'}</div></div>
          <div className="sum-split">{hasComparison && <><div><span>Competitor subtotal · priced lines</span><b>{fmt(c.totals.theirs)}</b></div><div><span>Avery cost · same priced lines</span><b>{fmt(comparedOurs)}</b></div></>}<div><span>{b.companyName} subtotal · all selected products</span><b>{fmt(c.totals.ours)}</b></div></div>
        </section>
        <section className="sum-scope"><b>{c.counts.compared} of {c.counts.total} product lines selected · All prices USD</b><p>{pricingScope}</p><p>This proposal covers the selected products below. {excluded.length} source line(s) are excluded and listed separately. Tax, freight, installation, controls, and unlisted accessories are excluded. Final order pricing and system suitability require confirmation.</p><p>{c.priceBasis === 'pack' ? 'Avery cost includes full cases, boxes or bundles, rounded up after combining repeated SKUs. Line costs allocate shared pack costs proportionally.' : 'Avery cost is a per-piece estimate. It assumes loose pieces can be supplied; case, box or bundle ordering may cost more. Confirm supply terms before ordering.'}</p></section>
        <section className="buy-all" aria-label="Buy recommended products">
          {purchase.url ? <>
            {member
              ? <span className="row no-print"><a className="btn primary buy-now" href={storeBuy('add')}>Add all to cart</a><a className="btn buy-now" href={storeBuy('buy')}>Buy now</a></span>
              : <a className="btn primary buy-now" href={purchase.url} target="_blank" rel="noopener noreferrer">Buy now</a>}
            <div><b>All {purchase.items.length} recommended product{purchase.items.length===1 ? '' : 's'} · {fmt(purchase.total)} store product total</b>
              <p>{member ? 'Add all to cart keeps anything already in your averyled.com cart; Buy now replaces it and goes to checkout. Your partner pricing is applied there. ' : 'Opens your Avery Shopify cart with the full cases, boxes or packs shown below. '} Uses current store prices, which may differ from this saved estimate. {c.priceBasis!=='pack' && 'This full-pack amount can differ from the per-piece estimate above. '}Final prices, availability, shipping and taxes are confirmed in Shopify.</p>
            </div>
          </> : <><button className="btn" type="button" disabled>Buy now</button><p>{purchase.message}</p></>}
        </section>
        <h2>Recommended Avery purchase</h2>
        <div className="tablewrap"><table className="sum-table overview-table"><thead><tr><th>SKU / product</th><th className="num">Required</th><th>{c.priceBasis==='pack' ? 'Purchase quantities' : 'Full-pack option'}</th><th className="num">{c.priceBasis==='pack' ? 'Purchase cost' : 'Piece estimate'}</th></tr></thead><tbody>{c.orders.map((o)=><tr key={o.sku}><td><b>{o.sku}</b><div className="sum-desc">{o.title}</div>{documents[o.sku]?.sheets.length ? documents[o.sku].sheets.map((sheet)=><div className="sum-desc" key={sheet.url}><a href={sheet.url} target="_blank" rel="noopener noreferrer" aria-label={`Spec sheet for ${o.sku}: ${sheet.label}`}>Spec sheet{documents[o.sku].sheets.length>1 ? ` · ${sheet.label}` : ''} ↗</a></div>) : <div className="sum-desc">Spec sheet unavailable{documents[o.sku]?.productUrl && <> · <a href={documents[o.sku].productUrl} target="_blank" rel="noopener noreferrer">Product details ↗</a></>}</div>}</td><td className="num">{o.requiredPieces} {unitLabel({category:o.category},o.requiredPieces)}</td><td>{o.packs} × {o.packLabel}<div className="sum-desc">{o.orderPieces} supplied; {o.extraPieces} extra</div>{c.priceBasis!=='pack' && <div className="sum-desc"><b>{fmt(o.packs*o.packPrice)} for full packs</b></div>}</td><td className="num">{fmt(o.total)}</td></tr>)}</tbody></table></div>
        {highlights.length>0 && <section className="key-conditions"><h2>Key differences and conditions</h2><ul>{highlights.map(({row,note})=><li key={row.id}><b>{row.comp_sku} → {row.our_sku}:</b> {note}</li>)}</ul></section>}
        {q.installation_note && <p className="sum-note"><b>Installation assumptions:</b> {q.installation_note}</p>}
        {excluded.length>0 && <p className="sum-note"><b>Excluded source products:</b> {excluded.map((r)=>r.comp_sku).join(', ')}. Budget these separately; see the appendix.</p>}
        <p className="sum-estimate"><b>Estimate:</b> Contact our team to confirm specifications, quantities, stock, freight, tax and final price before ordering. {b.contactLine || ''} {b.intakeEmail || ''}</p>
        <p className="sum-desc">Lead time: {q.lead_time || 'To be confirmed'} · Payment: {q.payment_terms || 'To be confirmed'} · Reviewer: {q.reviewer_name || 'Earlier reviewer not recorded'}</p>
        <section className="technical-appendix">
        <h2>Product crossovers</h2>
        {!c.summaryRows.length ? <p>No valid Avery products selected. Return to review.</p> : <div className="tablewrap"><table className="sum-table comparison-table">{hasComparison && <colgroup><col style={{ width: '24%' }} /><col style={{ width: '12%' }} /><col style={{ width: '36%' }} /><col style={{ width: '15%' }} /><col style={{ width: '13%' }} /></colgroup>}<thead><tr><th>Source item / quantity</th>{hasComparison && <th className="num">Source total</th>}<th>Avery substitute / pieces</th><th className="num">Cost</th>{hasComparison && <th className="num">Difference</th>}</tr></thead><tbody>
          {c.summaryRows.map((r) => <tr key={r.id}><td><b>{r.comp_sku}</b><div className="sum-desc">{r.comp_desc}</div>{r.group_label && <div className="sum-desc">{r.group_label}</div>}<div>{r.qty} source units{r.comp_unit_price == null ? " · source price not provided" : ` × ${fmt(r.comp_unit_price)}`}</div></td>{hasComparison && <td className="num">{r.theirTotal == null ? 'Not provided' : fmt(r.theirTotal)}</td>}<td><b>{r.our.title}</b><div className="sum-desc">{r.our.sku} · {r.our.variant}</div><div>{quantityLabel(r,c)}</div>{r.match_kind && <div className="sum-desc"><b>{MATCH_LABELS[r.match_kind]}</b></div>}{r.difference_notes && <p className="sum-note"><b>Differences / conditions:</b> {r.difference_notes}</p>}{r.qty_basis && <div className="sum-desc">{r.qty_basis}</div>}<div className="sum-desc">{[r.our.cct, r.our.output_class, r.our.watts ? `${r.our.watts}W` : null, r.our.ip_rating].filter(Boolean).join(' · ')}</div>{r.customer_note && <p className="sum-note"><b>Specification note:</b> {r.customer_note}</p>}</td><td className="num">{fmt(r.ourTotal)}{costDetails(c, r).map((detail, i) => <div key={i} className="sum-desc">{detail}</div>)}</td>{hasComparison && <td className={`num ${r.savings == null ? '' : r.savings < 0 ? 'error' : 'ok'}`}>{r.savings == null ? 'No source price' : <>{r.savings < 0 ? '+' : '−'}{fmt(Math.abs(r.savings))}<div className="sum-desc">{r.savings < 0 ? 'additional cost' : 'savings'}</div></>}</td>}</tr>)}
        </tbody><tfoot><tr><td><b>Avery subtotal · all selected products</b></td>{hasComparison && <td className="num"><b>{fmt(c.totals.theirs)}</b><div className="sum-desc">Priced source lines only</div></td>}<td></td><td className="num"><b>{fmt(c.totals.ours)}</b></td>{hasComparison && <td className="num"><b>{higher ? '+' : '−'}{fmt(Math.abs(c.totals.savings))}</b><div className="sum-desc">Priced lines only; Avery share {fmt(comparedOurs)}</div></td>}</tr></tfoot></table></div>}
        <h2>Avery purchase quantities — calculation detail</h2>
        <div className="tablewrap"><table className="sum-table"><thead><tr><th>Avery SKU</th><th className="num">Required pieces</th><th>{c.priceBasis==='pack' ? 'Full packs to order' : 'Full-pack option'}</th><th className="num">Pieces supplied / extra</th><th className="num">{c.priceBasis === 'pack' ? 'Purchase cost' : 'Piece estimate'}</th></tr></thead><tbody>{c.orders.map((o) => <tr key={o.sku}><td><b>{o.sku}</b><div className="sum-desc">{o.title}</div></td><td className="num">{o.requiredPieces}</td><td>{o.packs} × {o.packLabel} ({o.packQty} pieces per pack)<div className="sum-desc">{fmt(o.packPrice)} / pack</div>{c.priceBasis!=='pack' && <div className="sum-desc">{fmt(o.packs*o.packPrice)} full-pack total</div>}</td><td className="num">{o.orderPieces} / {o.extraPieces} extra</td><td className="num">{fmt(o.total)}</td></tr>)}</tbody></table></div>
        <p className="sum-estimate"><b>Estimate:</b> Contact our team for the final price before placing your order.</p>
        {excluded.length > 0 && <section><h2>Source items outside this comparison</h2><p className="sum-desc">Allow for these separately when budgeting the complete project.</p><div className="tablewrap"><table className="sum-table"><thead><tr><th>Source item</th><th className="num">Qty</th><th>Reason excluded</th><th className="num">Source amount</th></tr></thead><tbody>{excluded.map((r) => <tr key={r.id}><td><b>{r.comp_sku}</b><div className="sum-desc">{r.comp_desc}</div></td><td>{r.qty}</td><td>{exclusion(r)}</td><td className="num">{r.theirTotal == null ? 'Not provided' : fmt(r.theirTotal)}</td></tr>)}</tbody></table></div></section>}
        {c.installation?.groups?.length>0 && <section><h2>Installation calculations and assumptions</h2><p className="sum-desc">Driver basis: {c.installation.basis==='tape_load' ? 'Selected Avery tape load' : 'Quoted driver rated capacity'}. Headroom: {c.installation.headroom == null ? 'To be verified' : `${c.installation.headroom}%`}. Calculations do not establish circuit distribution or complete system suitability.</p>{c.installation.groups.map((g)=><div key={g.name} className="sum-note"><b>{g.name}: {g.status}.</b> Known tape load {g.knownLoadWatts.toFixed(2)}W; selected driver capacity {g.capacityWatts}W.{g.requiredWatts != null && ` Required with headroom: ${g.requiredWatts.toFixed(2)}W.`}{[...g.incomplete,...g.conditions,...g.blockers].map((n,i)=><div key={i}>{n}</div>)}</div>)}</section>}
        {charges.length>0 && <section><h2>Source charges outside product comparison</h2>{charges.map((c)=><p key={c.kind} className="sum-note"><b>{CHARGE_LABELS[c.kind]}:</b> {fmt(c.amount)} {c.note || ''}</p>)}<p className="sum-desc">Shown for source reconciliation. These amounts are excluded from both compared product subtotals; Avery freight and tax require confirmation.</p></section>}
        <section className="sum-terms"><div><h2>Availability and terms</h2><p><b>Lead time / availability:</b> {q.lead_time || 'To be confirmed'}</p><p><b>Payment terms:</b> {q.payment_terms || 'To be confirmed'}</p>{q.reconciliation_note && <p><b>Source reconciliation:</b> {q.reconciliation_note}</p>}{q.customer_notes && <p className="preserve">{q.customer_notes}</p>}</div><div><h2>Next step</h2><p>Ask Avery to confirm specifications, quantities, stock, freight, tax, and final order pricing before placing the order.</p><p>{b.contactLine || 'Contact your Avery representative.'}</p>{b.intakeEmail && <a href={`mailto:${b.intakeEmail}?subject=${encodeURIComponent(`Avery comparison AQ-${stored.id}`)}`}>{b.intakeEmail}</a>}</div></section>
        </section>
        <footer className="sum-foot"><p>{b.disclaimer}</p><p>Comparison AQ-{stored.id} · {ready ? 'Reviewed prices saved with this comparison' : 'Draft prices may change until reviewed'}</p></footer>
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
        .buy-all{display:flex;align-items:center;gap:18px;border:1px solid var(--accent);border-radius:10px;padding:16px;margin:20px 0;break-inside:avoid;}.buy-all p{font-size:12px;margin:4px 0;}.buy-now{white-space:nowrap;}@media(max-width:600px){.buy-all{align-items:flex-start;flex-direction:column;}}
        .technical-appendix{margin-top:30px;border-top:2px solid var(--accent);padding-top:10px;}.key-conditions{font-size:12px;}.key-conditions ul{padding-left:18px;}.key-conditions li{margin:5px 0;}.overview-table{font-size:12px;}
        .summary h2 {font-size:18px;margin-top:26px;}.sum-table {font-size:13px;min-width:720px;}.comparison-table{table-layout:fixed;}.sum-table th {background:#f3f1ea;}.sum-table td:not(.num),.sum-table th{overflow-wrap:anywhere;}.sum-desc {font-size:12px;color:var(--muted);white-space:normal;}.sum-note {font-size:12px;margin:8px 0 0;}.sum-table tfoot td {border-top:2px solid var(--accent);}
        .sum-estimate {font-size:13px;background:#f7f6f1;border-left:3px solid var(--accent);padding:10px 12px;margin:12px 0;break-inside:avoid;}.sum-terms {display:grid;grid-template-columns:1fr 1fr;gap:24px;font-size:13px;}.preserve {white-space:pre-wrap;}.sum-foot {margin-top:24px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px;}
        @media(max-width:700px){.summary{padding:18px;}.sum-meta{text-align:left;}.sum-terms{grid-template-columns:1fr;}.sum-big{font-size:34px;}.summary .tablewrap{max-width:100%;}.summary{min-width:0;}}
        @media print {.technical-appendix{break-before:page;margin-top:0;border-top:0;padding-top:0;}.key-conditions{font-size:11px;}.key-conditions li{margin:3px 0;}html,body{background:#fff!important;}.summary{border:none;padding:0;max-width:none;font-size:13px;}.sum-head{padding-bottom:8px;}.sum-logo{height:48px;}.sum-hero{padding:14px;margin:12px 0;}.sum-big{font-size:34px;}.sum-scope{font-size:11px;padding:10px;}.sum-scope p{margin:6px 0;}.summary h2{font-size:16px;margin-top:14px;}.sum-table{font-size:11px;}.sum-table th{font-size:10px;letter-spacing:0;}.sum-desc,.sum-note{font-size:10px;line-height:1.4;}.sum-table td,.sum-table th{padding:5px;}.sum-terms{font-size:12px;}.sum-foot{font-size:11px;margin-top:12px;padding-top:8px;}.sum-terms p{margin:6px 0;}.sum-foot p{display:inline;margin:0;}.sum-foot p+p:before{content:' ';}.summary .tablewrap{overflow:visible;}.summary table{min-width:0;width:100%;}.sum-estimate{font-size:12px;}.sum-hero,.sum-table th,.sum-status,.sum-estimate{-webkit-print-color-adjust:exact;print-color-adjust:exact;}tr{break-inside:avoid;}thead{display:table-header-group;}tfoot{display:table-row-group;}.sum-head,.sum-hero,.sum-terms{break-inside:avoid;}@page{margin:14mm;}}
      `}</style>
    </>
  );
}
