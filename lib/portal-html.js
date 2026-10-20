// HTML for the member portal. Responses are sent as application/liquid so Shopify renders them inside the
// Avery theme (header, footer and its Tailwind styles). Every dynamic value goes through esc(), which also
// neutralises braces so customer or catalog text can never be evaluated as Liquid.
import { fmt } from './comparison.js';
import { MATCH_LABELS } from './crossover.js';
import { briefConditions } from './proposal.js';

export const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
const money = (n) => esc(fmt(n));
const date = (value) => {
  if (!value) return 'To be confirmed';
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? esc(value) : esc(d.toLocaleDateString('en-US', { timeZone: value.length === 10 ? 'UTC' : 'America/New_York', year: 'numeric', month: 'short', day: 'numeric' }));
};
const unit = (category, n) => category === 'tape' ? (n === 1 ? 'roll' : 'rolls') : category === 'channel' ? (n === 1 ? 'section' : 'sections') : (n === 1 ? 'piece' : 'pieces');

const shell = (inner) => `<section class="py-12 md:py-16 bg-gray-50" style="min-height:60vh">
<div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">${inner}</div></section>
<style>.aq-table{width:100%;border-collapse:collapse;font-size:14px}.aq-table th{background:#f3f4f6;text-align:left;padding:10px;font-weight:600;color:#374151}.aq-table td{padding:10px;border-top:1px solid #e5e7eb;vertical-align:top}.aq-table .aq-num{text-align:right;white-space:nowrap}.aq-scroll{overflow-x:auto}@media print{header,footer,.aq-noprint{display:none!important}section{background:#fff!important;padding:0!important}}</style>`;
const eyebrow = '<span class="inline-block px-3 py-1 rounded-full text-xs font-bold tracking-wide bg-yellow-100 text-yellow-700 mb-4">MEMBERS ONLY</span>';
const card = (inner, extra = '') => `<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 ${extra}">${inner}</div>`;
const button = 'inline-block px-6 py-3 rounded-lg font-bold text-sm text-white bg-yellow-500 hover:bg-yellow-600 shadow-md transition-all';
const secondary = 'inline-block px-6 py-3 rounded-lg font-bold text-sm text-yellow-700 bg-white border-2 border-yellow-500 hover:bg-yellow-50 transition-all';

export function gatePage(state, prefix) {
  const login = `/account/login?return_url=${encodeURIComponent(prefix)}`;
  const body = state === 'guest'
    ? `<h1 class="text-3xl font-bold text-gray-900 mb-3">Sign in to use the Quote Tool</h1><p class="text-gray-600 mb-6">The Quote Tool is available to approved Avery LED partners. Sign in to compare a competitor quote.</p><a class="${button}" href="${esc(login)}">Sign In</a><p class="text-xs text-gray-400 mt-4">Don't have an account? <a class="text-yellow-600 font-medium" href="/account/register">Create one</a></p>`
    : state === 'pending'
      ? '<h1 class="text-3xl font-bold text-gray-900 mb-3">Be an approved partner to get access</h1><p class="text-gray-600 mb-6">Your account is pending partner approval. Contact us to get set up.</p><a class="' + button + '" href="/pages/contact-us">Contact Us</a>'
      : '<h1 class="text-3xl font-bold text-gray-900 mb-3">We couldn\'t verify your account</h1><p class="text-gray-600 mb-6">Please refresh this page in a moment. If this continues, contact our team.</p><a class="' + button + '" href="/pages/contact-us">Contact Us</a>';
  return shell(`<div class="max-w-xl mx-auto text-center">${card(`${eyebrow}${body}`, 'border-2 border-dashed border-yellow-300')}</div>`);
}

const FLASH = {
  submitted: ['ok', 'Thanks — your quote was received. Our team will review it and post your proposal here.'],
  files: ['error', 'Choose up to five PDF, JPEG or PNG files, each no larger than 10 MB (18 MB total).'],
  type: ['error', "That file isn't a readable PDF, JPEG or PNG. Choose the original file or a clear screenshot."],
  limit: ['error', 'You have reached the daily submission limit. Contact our team if you need more quotes today.'],
  expired: ['error', 'Your upload session expired. Please try again.'],
  access: ['error', 'We could not confirm partner access for this upload. Sign in again or contact our team.'],
  unavailable: ['error', 'The Quote Tool is temporarily unavailable. Please try again shortly.'],
};
const statusPill = (state) => {
  const color = { ready: 'bg-green-100 text-green-700', expired: 'bg-gray-100 text-gray-600', updating: 'bg-yellow-100 text-yellow-700', attention: 'bg-red-100 text-red-700', withdrawn: 'bg-gray-100 text-gray-600' }[state.key] || 'bg-yellow-100 text-yellow-700';
  return `<span class="inline-flex px-3 py-1 rounded-full text-xs font-bold ${color}">${esc(state.label)}</span>`;
};

export function dashboardPage({ prefix, member, quotes, uploadUrl, token, flash }) {
  const f = FLASH[flash];
  const notice = f ? `<div class="mb-6 p-4 rounded-lg ${f[0] === 'ok' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}" role="${f[0] === 'ok' ? 'status' : 'alert'}">${esc(f[1])}</div>` : '';
  const rows = quotes.map((q) => `<tr><td><b>AQ-${q.id}</b></td><td>${esc(q.portal_project || q.job_name || '—')}<div class="text-xs text-gray-500">${esc(q.filename || '')}</div></td><td>${date(q.created_at)}</td><td>${statusPill(q.state)}</td><td class="aq-num">${q.state.viewable ? `<a class="text-yellow-600 font-semibold hover:underline" href="${esc(`${prefix}/q/${q.id}`)}">View proposal →</a>` : ''}</td></tr>`).join('');
  const greeting = member.name ? `Welcome back, ${esc(member.name)}. ` : '';
  return shell(`${eyebrow}
<h1 class="text-4xl font-bold text-gray-900 mb-2">Quote Tool</h1>
<p class="text-gray-600 text-lg mb-8 max-w-3xl">${greeting}Upload a competitor's quote and our team will match it to Avery LED products, with savings, spec sheets and one-click ordering.</p>
${notice}
<div class="grid md:grid-cols-5 gap-6 mb-10">
${card(`<h2 class="text-xl font-bold text-gray-900 mb-4">Submit a quote</h2>
<form action="${esc(uploadUrl)}" method="post" enctype="multipart/form-data" data-aq-upload>
<input type="hidden" name="token" value="${esc(token)}">
<label class="block text-sm font-medium text-gray-700 mb-1" for="aq-files">Competitor quote (PDF, JPEG or PNG)</label>
<input id="aq-files" name="files" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple required class="block w-full text-sm mb-4 border border-gray-300 rounded-lg p-2 bg-white">
<label class="block text-sm font-medium text-gray-700 mb-1" for="aq-project">Project name (optional)</label>
<input id="aq-project" name="project" maxlength="200" class="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4" placeholder="e.g. Smith kitchen remodel">
<label class="block text-sm font-medium text-gray-700 mb-1" for="aq-note">Notes for our team (optional)</label>
<textarea id="aq-note" name="note" maxlength="2000" rows="3" class="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4" placeholder="Anything we should know: dimming, location, deadlines"></textarea>
<button type="submit" class="${button}" data-aq-submit>Submit for review</button>
<p class="text-xs text-gray-500 mt-3">Up to five files, 10 MB each. Reading and matching can take up to a minute; please keep this page open.</p>
</form>`, 'md:col-span-3')}
${card(`<h2 class="text-xl font-bold text-gray-900 mb-4">How it works</h2>
<ol class="space-y-3 text-sm text-gray-700 list-decimal pl-5">
<li>Upload the quote you received from another supplier.</li>
<li>Our team checks every line and selects matching Avery LED products, noting any differences.</li>
<li>Your proposal appears below with Avery pricing, savings where prices were provided, and spec sheets.</li>
<li>Add everything to your cart in one click, or go straight to checkout.</li></ol>`, 'md:col-span-2')}
</div>
<h2 class="text-2xl font-bold text-gray-900 mb-4">Your quotes</h2>
${quotes.length ? card(`<div class="aq-scroll"><table class="aq-table"><thead><tr><th>Quote</th><th>Project / file</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`, 'p-0 overflow-hidden') : card('<p class="text-gray-500">No quotes yet. Submit your first competitor quote above.</p>')}
<script>
(function(){var f=document.querySelector('[data-aq-upload]');if(!f)return;f.addEventListener('submit',function(){var b=f.querySelector('[data-aq-submit]');b.disabled=true;b.textContent='Reading and matching…';});})();
</script>`);
}

export function notFoundPage(prefix, message = 'This proposal is not available.') {
  return shell(`<div class="max-w-xl mx-auto text-center">${card(`${eyebrow}<h1 class="text-2xl font-bold text-gray-900 mb-3">${esc(message)}</h1><p class="text-gray-600 mb-6">It may still be in review, or it was updated. Check its status on your Quote Tool page.</p><a class="${button}" href="${esc(prefix)}">Back to Quote Tool</a>`)}</div>`);
}

/** Customer-facing proposal from the frozen, confirmed summary snapshot only. */
export function proposalPage({ prefix, id, document, specSheets, purchase, expired }) {
  const { quote: q, comparison: c, branding: b } = document;
  const priced = c.counts.priced ?? c.summaryRows.filter((r) => r.theirTotal != null).length;
  const hasComparison = priced > 0;
  const higher = c.totals.savings < 0;
  const percent = c.totals.pct == null ? null : `${Math.abs(c.totals.pct * 100).toFixed(1)}%`;
  const excluded = c.rows.filter((r) => !r.inSummary);
  const comparedOurs = c.totals.comparedOurs ?? c.totals.ours;
  const hero = hasComparison
    ? `<div class="text-sm uppercase tracking-wide text-gray-300">${higher ? 'Additional product cost' : 'Estimated product savings'}</div><div class="text-5xl font-extrabold text-yellow-400 my-2">${money(Math.abs(c.totals.savings))}</div><div class="text-gray-200">${percent ? `${esc(percent)} ${higher ? 'higher' : 'lower'} on ${priced} priced line(s)` : 'Percentage unavailable'}</div>`
    : `<div class="text-sm uppercase tracking-wide text-gray-300">Avery product estimate</div><div class="text-5xl font-extrabold text-yellow-400 my-2">${money(c.totals.ours)}</div><div class="text-gray-200">Source prices were not provided, so no savings are calculated.</div>`;
  const split = `${hasComparison ? `<div><div class="text-xs text-gray-300">Competitor · priced lines</div><div class="text-2xl font-bold">${money(c.totals.theirs)}</div></div><div><div class="text-xs text-gray-300">Avery · same lines</div><div class="text-2xl font-bold">${money(comparedOurs)}</div></div>` : ''}<div><div class="text-xs text-gray-300">Avery · all selected products</div><div class="text-2xl font-bold">${money(c.totals.ours)}</div></div>`;
  const buy = purchase.items?.length && !expired
    ? `<div class="flex flex-wrap gap-3 mb-3"><button type="button" class="${button}" data-aq-cart="add">Add all to cart</button><button type="button" class="${secondary}" data-aq-cart="buy">Buy now</button></div>
<p class="text-sm text-gray-700"><b>All ${purchase.items.length} recommended product${purchase.items.length === 1 ? '' : 's'}</b> in full cases, boxes or packs · ${money(purchase.total)} at current list prices.</p>
<p class="text-xs text-gray-500 mt-1">Your partner pricing is applied in the cart. <b>Add all to cart</b> keeps anything already in your cart; <b>Buy now</b> replaces your cart with this proposal and goes to checkout. Final prices, availability, shipping and taxes are confirmed at checkout.</p>
<p class="text-sm mt-2" data-aq-cart-message role="status"></p>`
    : `<p class="text-sm text-gray-700 mb-1"><b>Online ordering is unavailable for this proposal.</b></p><p class="text-sm text-gray-600">${esc(expired ? 'This proposal has expired. Submit the quote again or contact our team for updated pricing.' : purchase.message)}</p>`;
  const orders = c.orders.map((o) => {
    const docs = specSheets[o.sku];
    const sheets = docs?.sheets?.length
      ? docs.sheets.map((s) => `<div class="text-xs"><a class="text-yellow-600 hover:underline" href="${esc(s.url)}" target="_blank" rel="noopener">Spec sheet${docs.sheets.length > 1 ? ` · ${esc(s.label)}` : ''} ↗</a></div>`).join('')
      : `<div class="text-xs text-gray-500">Spec sheet unavailable${docs?.productUrl ? ` · <a class="text-yellow-600 hover:underline" href="${esc(docs.productUrl)}">Product details</a>` : ''}</div>`;
    return `<tr><td><b>${esc(o.title)}</b><div class="text-xs text-gray-500">${esc(o.sku)}</div>${sheets}</td><td class="aq-num">${o.requiredPieces} ${unit(o.category, o.requiredPieces)}</td><td>${o.packs} × ${esc(o.packLabel)}<div class="text-xs text-gray-500">${o.orderPieces} supplied${o.extraPieces ? `; ${o.extraPieces} extra` : ''}</div></td><td class="aq-num">${money(c.priceBasis === 'pack' ? o.total : o.packs * o.packPrice)}</td></tr>`;
  }).join('');
  const crossovers = c.summaryRows.map((r) => `<tr><td><b>${esc(r.comp_sku)}</b><div class="text-xs text-gray-500">${esc(r.comp_desc)}</div><div class="text-xs">${esc(r.qty)} source units${r.comp_unit_price == null ? ' · price not provided' : ` × ${money(r.comp_unit_price)}`}</div></td><td><b>${esc(r.our?.title)}</b><div class="text-xs text-gray-500">${esc(r.our?.sku)}</div>${r.match_kind ? `<div class="text-xs font-semibold mt-1">${esc(MATCH_LABELS[r.match_kind])}</div>` : ''}${r.difference_notes ? `<div class="text-xs text-gray-600 mt-1">${esc(r.difference_notes)}</div>` : ''}</td>${hasComparison ? `<td class="aq-num">${r.theirTotal == null ? 'Not provided' : money(r.theirTotal)}</td>` : ''}<td class="aq-num">${money(r.ourTotal)}</td>${hasComparison ? `<td class="aq-num ${r.savings == null ? '' : r.savings < 0 ? 'text-red-600' : 'text-green-700'}">${r.savings == null ? '—' : `${r.savings < 0 ? '+' : '−'}${money(Math.abs(r.savings))}`}</td>` : ''}</tr>`).join('');
  const highlights = c.summaryRows.map((r) => ({ r, note: briefConditions(r) })).filter((x) => x.note);
  const pricing = c.priceBasis === 'pack'
    ? 'Avery costs use full cases, boxes or bundles, rounded up after combining repeated products.'
    : 'Avery line costs are per-piece estimates; the purchase table shows full-pack amounts, which are what you order.';
  return shell(`<div class="aq-noprint mb-6 flex flex-wrap gap-3 justify-between items-center"><a class="text-sm text-yellow-700 font-semibold hover:underline" href="${esc(prefix)}">← All quotes</a><button type="button" class="${secondary}" onclick="window.print()">Print / save PDF</button></div>
${eyebrow}
<div class="flex flex-wrap justify-between gap-4 mb-6"><div><h1 class="text-4xl font-bold text-gray-900">${hasComparison ? 'Product comparison' : 'Avery product proposal'}</h1>
<p class="text-gray-600 mt-1">AQ-${id}${q.job_name ? ` · ${esc(q.job_name)}` : ''} · From ${esc(q.competitor || 'competitor')} quote ${esc(q.quote_number || '')}</p></div>
<div class="text-sm text-gray-600 md:text-right"><div>Prepared for: <b>${esc(q.customer || 'Not specified')}</b></div><div>Reviewed: ${date(q.reviewed_at)}</div><div class="${expired ? 'text-red-600 font-semibold' : ''}">Valid until: ${date(q.valid_until)}${expired ? ' — expired' : ''}</div></div></div>
<div class="rounded-xl p-6 mb-6 flex flex-wrap justify-between gap-6 items-center text-white" style="background:#2C2C2C;border-left:8px solid #EAB308"><div>${hero}</div><div class="flex flex-wrap gap-6">${split}</div></div>
${card(buy, 'mb-8 border-2 border-yellow-400 aq-noprint')}
<h2 class="text-2xl font-bold text-gray-900 mb-3">Recommended Avery purchase</h2>
${card(`<div class="aq-scroll"><table class="aq-table"><thead><tr><th>Product</th><th class="aq-num">Required</th><th>Order</th><th class="aq-num">Cost</th></tr></thead><tbody>${orders}</tbody></table></div>`, 'p-0 overflow-hidden mb-2')}
<p class="text-xs text-gray-500 mb-8">${esc(pricing)} All prices USD. Tax, freight, installation, controls and unlisted accessories are excluded.</p>
${highlights.length ? `<h2 class="text-2xl font-bold text-gray-900 mb-3">Key differences and conditions</h2>${card(`<ul class="space-y-2 text-sm text-gray-700 list-disc pl-5">${highlights.map(({ r, note }) => `<li><b>${esc(r.comp_sku)} → ${esc(r.our_sku)}:</b> ${esc(note)}</li>`).join('')}</ul>`, 'mb-8')}` : ''}
<h2 class="text-2xl font-bold text-gray-900 mb-3">Line-by-line crossover</h2>
${card(`<div class="aq-scroll"><table class="aq-table"><thead><tr><th>Quoted item</th><th>Avery product</th>${hasComparison ? '<th class="aq-num">Quoted</th>' : ''}<th class="aq-num">Avery</th>${hasComparison ? '<th class="aq-num">Difference</th>' : ''}</tr></thead><tbody>${crossovers}</tbody></table></div>`, 'p-0 overflow-hidden mb-8')}
${excluded.length ? `<h2 class="text-2xl font-bold text-gray-900 mb-3">Items not included</h2>${card(`<p class="text-sm text-gray-600 mb-3">Budget these separately; contact our team if you need help sourcing them.</p><ul class="text-sm list-disc pl-5">${excluded.map((r) => `<li><b>${esc(r.comp_sku)}</b> × ${esc(r.qty)} — ${esc(r.comp_desc)}</li>`).join('')}</ul>`, 'mb-8')}` : ''}
${card(`<div class="grid md:grid-cols-2 gap-6 text-sm text-gray-700"><div><h3 class="font-bold text-gray-900 mb-2">Availability and terms</h3><p>Lead time: ${esc(q.lead_time || 'To be confirmed')}</p><p>Payment terms: ${esc(q.payment_terms || 'To be confirmed')}</p>${q.customer_notes ? `<p class="mt-2" style="white-space:pre-wrap">${esc(q.customer_notes)}</p>` : ''}</div><div><h3 class="font-bold text-gray-900 mb-2">Questions?</h3><p>Contact our team to confirm specifications, quantities, stock, freight and tax before ordering.</p>${b.contactLine ? `<p class="mt-2">${esc(b.contactLine)}</p>` : ''}${b.intakeEmail ? `<p class="mt-2"><a class="text-yellow-600 hover:underline" href="mailto:${esc(b.intakeEmail)}">${esc(b.intakeEmail)}</a></p>` : ''}</div></div>`)}
<p class="text-xs text-gray-500 mt-6">${esc(b.disclaimer)}</p>
<script>
(function(){
  var msg=document.querySelector('[data-aq-cart-message]');
  var buttons=document.querySelectorAll('[data-aq-cart]');
  function post(url,body){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},credentials:'same-origin',body:JSON.stringify(body||{})});}
  function fail(text){buttons.forEach(function(b){b.disabled=false;});if(msg){msg.className='text-sm mt-2 text-red-600';msg.textContent=text;}}
  buttons.forEach(function(btn){btn.addEventListener('click',async function(){
    var mode=btn.getAttribute('data-aq-cart');buttons.forEach(function(b){b.disabled=true;});
    if(msg){msg.className='text-sm mt-2 text-gray-600';msg.textContent='Checking current availability…';}
    try{
      var check=await fetch('${esc(`${prefix}/q/${id}/cart`)}',{headers:{'Accept':'application/json'},credentials:'same-origin',cache:'no-store'});
      var data=await check.json();
      if(!check.ok||!data.ok){return fail(data&&data.message?data.message:'This proposal cannot be ordered online right now. Contact our team.');}
      if(mode==='buy'){var cleared=await post('/cart/clear.js');if(!cleared.ok)return fail('Your cart could not be updated. Please try again.');}
      var added=await post('/cart/add.js',{items:data.items});
      if(!added.ok){var err=null;try{err=await added.json();}catch(e){}return fail((err&&(err.description||err.message))||'These products could not be added to your cart. Contact our team.');}
      window.location.href=mode==='buy'?'/checkout':'/cart';
    }catch(e){fail('Something went wrong. Please try again or contact our team.');}
  });});
})();
</script>`);
}
