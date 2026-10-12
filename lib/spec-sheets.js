// Customer documents come from the public Avery Shopify storefront, matched by exact variant SKU.
const STORE='https://averyled.com';
const decode=(s)=>s.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');

export function productSpecSheets(html,sku) {
  const start=html.indexOf('<!-- Spec Sheet Download -->');
  if(start<0) return [];
  const section=html.slice(start).split('<!-- Installation Guide Download -->')[0].split('<!-- ======= End Accordion')[0];
  const sheets=[];
  for(const match of section.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;try {url=new URL(decode(match[1]),STORE);}catch {continue;}
    if(url.protocol!=='https:' || !['averyled.com','cdn.shopify.com'].includes(url.hostname) || !/\.pdf$/i.test(url.pathname)) continue;
    if(sheets.some((s)=>s.url===url.href)) continue;
    const label=decode(match[2].replace(/<svg\b[\s\S]*?<\/svg>/gi,'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim() || 'Spec sheet';
    sheets.push({url:url.href,label});
  }
  // COB pages list separate 100/200/500L sheets. Match the variant's output rather than returning another output's sheet.
  const output=sku.match(/-(\d+)L(?:-|$)/i)?.[1];
  const outputSheets=sheets.filter((s)=>/[-_]\d+L(?:[-_.]|$)/i.test(new URL(s.url).pathname));
  return output && outputSheets.length ? sheets.filter((s)=>!outputSheets.includes(s) || new RegExp(`[-_]${output}L(?:[-_.]|$)`,'i').test(new URL(s.url).pathname)) : sheets;
}

export async function loadSpecSheets(skus,{fetcher=fetch}={}) {
  const result=Object.fromEntries([...new Set(skus)].map((sku)=>[sku,{sheets:[],productUrl:null}]));
  if(!skus.length) return result;
  const products=[];
  try {
    for(let page=1;page<=4;page++) {
      const response=await fetcher(`${STORE}/products.json?limit=250&page=${page}`,{next:{revalidate:3600},signal:AbortSignal.timeout(10000)});
      if(!response.ok) throw new Error('Storefront unavailable');
      const body=await response.json();if(!Array.isArray(body.products)) throw new Error('Invalid storefront product list');
      products.push(...body.products);if(body.products.length<250) break;
    }
  }catch {return result;}
  const groups=new Map();
  for(const sku of Object.keys(result)) {
    const matches=products.filter((p)=>Array.isArray(p?.variants) && p.variants.some((v)=>v?.sku===sku));
    if(matches.length!==1 || !/^[a-z0-9-]+$/.test(matches[0].handle)) continue;
    const productUrl=`${STORE}/products/${matches[0].handle}`;
    result[sku].productUrl=productUrl;
    const group=groups.get(productUrl)||[];group.push(sku);groups.set(productUrl,group);
  }
  // A page failure leaves its row visibly unavailable and does not prevent the quote summary from opening.
  await Promise.all([...groups].map(async([url,group])=>{
    try {
      const response=await fetcher(url,{next:{revalidate:3600},signal:AbortSignal.timeout(10000)});
      if(!response.ok) return;
      const html=await response.text();for(const sku of group) result[sku].sheets=productSpecSheets(html,sku);
    }catch { /* Availability is disclosed on the affected product row. */ }
  }));
  return result;
}
