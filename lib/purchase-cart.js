import { toItem } from './catalog.js';
import { round2 } from './comparison.js';
const STORE='https://averyled.com';
const unavailable=(message)=>({url:null,total:null,items:[],message});

/** Exact SKU and pack matches only. Never send a partial recommended purchase. */
export function buildPurchaseCart(orders,products) {
  if(!orders?.length) return unavailable('No products are included in this proposal.');
  const items=[],seen=new Set();
  for(const order of orders) {
    const matches=products.flatMap(p=>(p.variants || []).filter(v=>v.sku===order.sku).map(v=>({p,v})));
    if(matches.length!==1) return unavailable(`Unable to identify one store variant for ${order.sku}. Contact Avery to complete the purchase.`);
    const {p,v}=matches[0];
    if(!Number.isSafeInteger(v.id) || v.id<=0 || seen.has(v.id)) return unavailable(`The store variant for ${order.sku} needs verification. Contact Avery to complete the purchase.`);
    if(v.available!==true || !Number.isFinite(Number(v.price)) || Number(v.price)<=0) return unavailable(`${order.sku} is not currently available to buy online. Contact Avery to complete the purchase.`);
    const options=[v.option1,v.option2,v.option3].filter(x=>x && x!=='Default Title');
    // Some channel packs put their count in the product title instead of variant options.
    if(!options.length) {const pack=p.title?.match(/\bpack of (\d+)\b/i);if(pack) options.push(`Pack (${pack[1]} pcs)`);}
    const storeItem=toItem({sku:v.sku,title:p.title,price:v.price,options});
    if(!Number.isSafeInteger(order.requiredPieces) || order.requiredPieces<=0 || !Number.isSafeInteger(order.packQty) || order.packQty<=0 || storeItem.pack_qty!==order.packQty || !Number.isSafeInteger(order.packs) || order.packs!==Math.ceil(order.requiredPieces/order.packQty) || order.orderPieces!==order.packs*order.packQty) return unavailable(`The purchase quantity or pack size for ${order.sku} needs verification. Review the quote against the current store product.`);
    seen.add(v.id);items.push({sku:order.sku,variantId:v.id,quantity:order.packs,packQty:order.packQty,total:round2(Number(v.price)*order.packs)});
  }
  const total=round2(items.reduce((n,i)=>n+i.total,0));
  const url=`${STORE}/cart/${items.map(i=>`${i.variantId}:${i.quantity}`).join(',')}?storefront=true&country=US`;
  if(!Number.isFinite(total) || url.length>7500) return unavailable('This purchase needs assistance from Avery. Contact the team with your proposal.');
  return {url,total,items,message:''};
}

export async function loadPurchaseCart(document,{fetcher=fetch,today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}={}) {
  if(!document.ready) return unavailable('Confirm this comparison before buying the recommended products.');
  if(document.quote.valid_until && document.quote.valid_until<today) return unavailable('This proposal has expired. Request updated pricing before buying.');
  if(!document.comparison.orders?.length) return unavailable('No products are included in this proposal.');
  let products;
  try { products=await storeProducts(fetcher); }
  catch(e) {return unavailable(e.incomplete ? 'The complete store catalog could not be checked. Contact Avery to complete the purchase.' : 'The store could not be checked right now. Refresh this page or contact Avery to complete the purchase.');}
  return buildPurchaseCart(document.comparison.orders,products);
}

// The live store catalog, shared for a minute so many members ordering at once make one set of requests to averyled.com.
let catalogCache=null;
async function fetchStoreProducts(fetcher) {
  const products=[];
  for(let page=1;page<=4;page++) {
    const response=await fetcher(`${STORE}/products.json?limit=250&page=${page}&country=US`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw new Error('Store unavailable');
    const body=await response.json();if(!Array.isArray(body.products)) throw new Error('Invalid store response');
    products.push(...body.products);
    if(body.products.length<250) return products;
  }
  throw Object.assign(new Error('Store catalog incomplete'),{incomplete:true});
}
function storeProducts(fetcher) {
  if(fetcher!==fetch) return fetchStoreProducts(fetcher);
  if(catalogCache && catalogCache.expires>Date.now()) return catalogCache.promise;
  const promise=fetchStoreProducts(fetcher);
  catalogCache={promise,expires:Date.now()+60000};
  promise.catch(()=>{if(catalogCache?.promise===promise) catalogCache=null;});
  return promise;
}
