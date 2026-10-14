import test from 'node:test';import assert from 'node:assert/strict';
import {buildPurchaseCart,loadPurchaseCart} from '../lib/purchase-cart.js';
const order=(sku='D60',over={})=>({sku,requiredPieces:5,packQty:10,packs:1,orderPieces:10,...over});
const product=(sku='D60',over={})=>({title:'Non-dimmable Power Supply',variants:[{sku,id:12345,available:true,price:'110.00',option1:'Case (10 pcs)',...over}]});
test('one cart contains all grouped products in sellable packs using current store prices',()=>{
 const result=buildPurchaseCart([order(),order('T200',{requiredPieces:25,packs:3,orderPieces:30})],[product(),product('T200',{id:67890,price:'150.00'})]);
 assert.equal(result.url,'https://averyled.com/cart/12345:1,67890:3?storefront=true');assert.equal(result.total,560);assert.equal(result.items[0].quantity,1);
});
test('missing, duplicate, unavailable and zero-price variants block the whole cart',()=>{
 for(const products of [[],[product(),product()],[product('D60',{available:false})],[product('D60',{price:'0.00'})],[product('D60',{id:'bad'})]]) assert.equal(buildPurchaseCart([order()],products).url,null);
 assert.equal(buildPurchaseCart([order(),order('MISSING')],[product()]).url,null);
});
test('pack changes and invalid purchase quantities cannot create a cart',()=>{
 for(const changes of [{packQty:5},{packs:5},{requiredPieces:0},{requiredPieces:2.5},{orderPieces:5}])assert.equal(buildPurchaseCart([order('D60',changes)],[product()]).url,null);
 assert.equal(buildPurchaseCart([order()],[product('D60',{option1:'Box (20 pcs)'})]).url,null);
});
test('nested connector packs and channel title packs use the actual sellable unit',()=>{
 assert.equal(buildPurchaseCart([order('C',{packQty:120,orderPieces:120})],[product('C',{option1:'10 Packs - 12 pcs per pack (120 pcs)'})]).items[0].quantity,1);
 const p={...product('CHAN',{option1:'Default Title'}),title:'Aluminum channel - Pack of 5'};
 assert.equal(buildPurchaseCart([order('CHAN',{packQty:5,requiredPieces:25,packs:5,orderPieces:25})],[p]).items[0].quantity,5);
});
test('draft and expired proposals never fetch or expose a buy link',async()=>{
 const fetcher=()=>{throw new Error('Must not fetch');};
 assert.match((await loadPurchaseCart({ready:false},{fetcher})).message,/Confirm/);
 assert.match((await loadPurchaseCart({ready:true,quote:{valid_until:'2020-01-01'}},{fetcher})).message,/expired/);
});
test('store outages and incomplete pagination fail closed without breaking the summary',async()=>{
 const doc={ready:true,quote:{},comparison:{orders:[order()]}};
 assert.equal((await loadPurchaseCart(doc,{fetcher:async()=>{throw new Error('offline');}})).url,null);
 assert.equal((await loadPurchaseCart(doc,{fetcher:async()=>new Response(JSON.stringify({products:Array(250).fill(product())}))})).url,null);
 const result=await loadPurchaseCart(doc,{fetcher:async(url,options)=>{assert.equal(options.cache,'no-store');return new Response(JSON.stringify({products:[product()]}));}});assert.equal(result.total,110);
});
