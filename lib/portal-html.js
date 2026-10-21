// HTML for the member portal. Responses are sent as application/liquid so Shopify renders them inside the
// Avery theme (header, footer and its Tailwind styles). Every dynamic value goes through esc(), which also
// neutralises braces so customer or catalog text can never be evaluated as Liquid.
import { fmt } from './comparison.js';

export const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
const money = (n) => esc(fmt(n));

const shell = (inner) => `<section class="py-12 md:py-16 bg-gray-50" style="min-height:60vh">
<div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">${inner}</div></section>
`;
const eyebrow = '<span class="inline-block px-3 py-1 rounded-full text-xs font-bold tracking-wide bg-yellow-100 text-yellow-700 mb-4">MEMBERS ONLY</span>';
const card = (inner, extra = '') => `<div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6 ${extra}">${inner}</div>`;
const button = 'inline-block px-6 py-3 rounded-lg font-bold text-sm text-white bg-yellow-500 hover:bg-yellow-600 shadow-md transition-all';

export function gatePage(state, prefix) {
  const login = `/account/login?return_url=${encodeURIComponent(prefix)}`;
  const body = state === 'guest'
    ? `<h1 class="text-3xl font-bold text-gray-900 mb-3">Sign in to use the Quote Tool</h1><p class="text-gray-600 mb-6">The Quote Tool is available to approved Avery LED partners. Sign in to compare a competitor quote.</p><a class="${button}" href="${esc(login)}">Sign In</a><p class="text-xs text-gray-400 mt-4">Don't have an account? <a class="text-yellow-600 font-medium" href="/account/register">Create one</a></p>`
    : state === 'pending'
      ? '<h1 class="text-3xl font-bold text-gray-900 mb-3">Be an approved partner to get access</h1><p class="text-gray-600 mb-6">Your account is pending partner approval. Contact us to get set up.</p><a class="' + button + '" href="/pages/contact-us">Contact Us</a>'
      : '<h1 class="text-3xl font-bold text-gray-900 mb-3">We couldn\'t verify your account</h1><p class="text-gray-600 mb-6">Please refresh this page in a moment. If this continues, contact our team.</p><a class="' + button + '" href="/pages/contact-us">Contact Us</a>';
  return shell(`<div class="max-w-xl mx-auto text-center">${card(`${eyebrow}${body}`, 'border-2 border-dashed border-yellow-300')}</div>`);
}


/** Signed-in, approved member: continue straight into the Quote Tool as themselves. */
export function launchPage(enterUrl) {
  return shell(`<div class="max-w-xl mx-auto text-center">${card(`${eyebrow}<h1 class="text-3xl font-bold text-gray-900 mb-3">Opening the Quote Tool…</h1><p class="text-gray-600 mb-6">You're signed in with your Avery LED account.</p><a class="${button}" href="${esc(enterUrl)}" data-aq-enter>Open the Quote Tool</a>`)}</div>
<script>(function(){var a=document.querySelector('[data-aq-enter]');if(a)window.location.replace(a.href);})();</script>`);
}

export function notFoundPage(prefix, message = 'This proposal is not available to order.') {
  return shell(`<div class="max-w-xl mx-auto text-center">${card(`${eyebrow}<h1 class="text-2xl font-bold text-gray-900 mb-3">${esc(message)}</h1><p class="text-gray-600 mb-6">Confirm the comparison in the Quote Tool first, or check that it hasn't expired.</p><a class="${button}" href="${esc(prefix)}">Open the Quote Tool</a>`)}</div>`);
}

/**
 * Runs on averyled.com so the cart call is same-origin and the member's partner pricing applies.
 * add: adds every recommended product to the current cart, then opens it. buy: replaces the cart, then checkout.
 */
export function buyPage({ prefix, id, mode, itemCount, total }) {
  const buy = mode === 'buy';
  // Replacing the cart is destructive, so checkout waits for a click; adding to the cart starts right away.
  return shell(`<div class="max-w-xl mx-auto text-center">${card(`${eyebrow}<h1 class="text-2xl font-bold text-gray-900 mb-3">${buy ? 'Buy now' : 'Adding to your cart…'}</h1>
<p class="text-gray-600 mb-2">AQ-${Number(id)} · ${Number(itemCount)} recommended product${itemCount === 1 ? '' : 's'} in full cases, boxes or packs · ${money(total)} at list prices. Your partner pricing is applied in the cart.</p>
${buy ? `<p class="text-gray-600 mb-4">This replaces anything already in your cart with these products, then takes you to checkout.</p><button type="button" class="${button}" data-aq-go>Replace cart and check out</button>` : ''}
<p class="text-sm mt-4" data-aq-status role="status">${buy ? '' : 'Checking current availability…'}</p>
<p class="mt-6"><a class="text-yellow-700 font-semibold hover:underline" href="${esc(prefix)}">Back to the Quote Tool</a></p>`)}</div>
<script>
(function(){
  var status=document.querySelector('[data-aq-status]'),go=document.querySelector('[data-aq-go]');
  function fail(t){status.className='text-sm mt-4 text-red-600';status.textContent=t;if(go)go.disabled=false;}
  function post(u,b){return fetch(u,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},credentials:'same-origin',body:JSON.stringify(b||{})});}
  async function run(){
    try{
      if(go)go.disabled=true;
      status.className='text-sm mt-4';status.textContent='Checking current availability…';
      var check=await fetch('${esc(`${prefix}/q/${Number(id)}/cart`)}',{headers:{'Accept':'application/json'},credentials:'same-origin',cache:'no-store'});
      var data=await check.json();
      if(!check.ok||!data.ok)return fail(data&&data.message?data.message:'This proposal cannot be ordered online right now. Contact our team.');
      ${buy ? "var cleared=await post('/cart/clear.js');if(!cleared.ok)return fail('Your cart could not be updated. Please try again.');" : ''}
      var added=await post('/cart/add.js',{items:data.items});
      if(!added.ok){var err=null;try{err=await added.json();}catch(e){}return fail((err&&(err.description||err.message))||'These products could not be added to your cart. Contact our team.');}
      window.location.href='${buy ? '/checkout' : '/cart'}';
    }catch(e){fail('Something went wrong. Please try again or contact our team.');}
  }
  ${buy ? "go.addEventListener('click',run);" : 'run();'}
})();
</script>`);
}
