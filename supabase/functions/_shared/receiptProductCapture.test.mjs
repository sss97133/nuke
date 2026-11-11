import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseProductPage, productEligible, supplierCandidates, supplierKey, productLinks, receiptLineCode, allowedProductUrl} from './receiptProductCapture.mjs';
const page = p => `<script type="application/ld+json">${JSON.stringify(p)}</script>`;
const product = {'@type':'Product',sku:'ABC-1',name:'Fuel pump',brand:{name:'Example'},image:'https://cdn.oerparts.com/assets/abc.jpg',offers:{price:'59.99',priceCurrency:'USD'}};
const url='https://www.oerparts.com/product/abc-1.html';
test('exact primary SKU binds dated supplier quote and image without asserting installation',()=>{
 const p=parseProductPage(page(product),url,'*abc-1');assert.equal(p.product_name,'Fuel pump');assert.equal(p.price,59.99);assert.match(p.match_basis,/installation_not_asserted/);
});
test('primary manufacturer part number may differ from the retailer UPC',()=>{
 const p=parseProductPage(page({...product,sku:'733704728108',mpn:'72810'}),url,'72810');
 assert.equal(p.status,'exact_sku_page'); assert.equal(p.printed_sku,'72810');
 assert.equal(parseProductPage(page([{...product,sku:'UPC',mpn:'OTHER'},{...product,mpn:'72810'}]),url,'72810').status,'sku_not_verified');
});
test('receipt line code disambiguates duplicate part numbers across supplier brands',()=>{
 const root='https://www.oreillyauto.com/search?q=55173';
 const html=['mry0','wal0','mtm0'].map(code=>`<a href="/detail/c/brand/item/${code}/55173?q=55173">part</a>`).join('')+'<a href="/detail/c/brand/item/mtm0/55173?tracking=duplicate">same</a>';
 assert.equal(productLinks(html,root,'55173').length,3);
 assert.deepEqual(productLinks(html,root,'55173',receiptLineCode('HOSE CLAMPS (MTM)')),['https://www.oreillyauto.com/detail/c/brand/item/mtm0/55173?q=55173']);
 assert.deepEqual(productLinks(html,root,'55173','ORC'),[]);
 assert.equal(receiptLineCode('BATTERY (SSB, 2Y warranty)'), 'SSB');
 assert.equal(receiptLineCode('ENGINE MOUNT (PT2) LT'),'PT2');
 assert.equal(receiptLineCode('SEMI-MET PAD (ST)'),'ST');
 assert.equal(receiptLineCode('Fluid without a printed code'),null);
});
test('matching recommendation cannot replace a mismatching primary product',()=>{
 assert.equal(parseProductPage(page([ {...product,sku:'OTHER'},product ]),url,'ABC-1').status,'sku_not_verified');
 const html='<div itemscope itemtype="https://schema.org/Product"><meta itemprop="name" content="Wrong"><div itemscope itemtype="https://schema.org/Product"><meta itemprop="sku" content="ABC-1">';
 assert.equal(parseProductPage(html,url,'ABC-1').status,'sku_not_verified');
});
test('missing SKU, placeholder image and missing product image remain unresolved',()=>{
 assert.equal(parseProductPage(page({...product,sku:undefined}),url,'ABC-1').status,'sku_not_verified');
 for(const image of [undefined,'https://cdn.oerparts.com/logo.png','https://cdn.oerparts.com/placeholder.jpg']) assert.notEqual(parseProductPage(page({...product,image}),url,'ABC-1').status,'exact_sku_page');
});
test('unknown price currency is preserved as unknown',()=>{
 const p=parseProductPage(page({...product,offers:{price:'59.99'}}),url,'ABC-1');assert.equal(p.currency,null);
});
test('shipping/core/labor are not product queries, returned parts stay referenceable',()=>{
 for(const l of [{part_number:null,description:'Labor'},{part_number:'SHIP',description:'Shipping'},{part_number:'CORE',description:'Core charge'}])assert.equal(productEligible(l),false);
 assert.equal(productEligible({part_number:'*ABC-1',description:'Return part'}),true);
 assert.equal(supplierKey('O’Reilly Auto Parts (Store 1532)'),'oreilly');
 assert.equal(supplierCandidates('Unknown private person','ABC-1').length,0);
});
test('candidate requests never include receipt description or identity',()=>{
 assert.deepEqual(supplierCandidates('Classic Industries','ABC-1').map(c=>c.url),['https://www.classicindustries.com/product/abc-1.html','https://www.oerparts.com/product/abc-1.html']);
});
test('search links require exact SKU path segment and allowlisted supplier',()=>{
 const root='https://www.oreillyauto.com/search?q=ABC-1';
 const html='<a href="/detail/c/brand/item/abc-10">wrong</a><a href="/detail/c/brand/item/abc-1">yes</a><a href="https://evil.test/detail/c/abc-1">no</a><a href="/detail/c/%zz/abc-1">malformed</a>';
 assert.deepEqual(productLinks(html,root,'ABC-1'),['https://www.oreillyauto.com/detail/c/brand/item/abc-1']);
 for(const u of ['https://www.oerparts.com.evil.test/p','http://www.oerparts.com/p','https://user@www.oerparts.com/p','https://127.0.0.1/p'])assert.equal(allowedProductUrl(u),false);
});
