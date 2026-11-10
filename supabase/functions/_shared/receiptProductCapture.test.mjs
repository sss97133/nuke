import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseProductPage, productEligible, supplierCandidates, supplierKey, productLinks, allowedProductUrl} from './receiptProductCapture.mjs';
const page = p => `<script type="application/ld+json">${JSON.stringify(p)}</script>`;
const product = {'@type':'Product',sku:'ABC-1',name:'Fuel pump',brand:{name:'Example'},image:'https://cdn.oerparts.com/assets/abc.jpg',offers:{price:'59.99',priceCurrency:'USD'}};
const url='https://www.oerparts.com/product/abc-1.html';
test('exact primary SKU binds dated supplier quote and image without asserting installation',()=>{
 const p=parseProductPage(page(product),url,'*abc-1');assert.equal(p.product_name,'Fuel pump');assert.equal(p.price,59.99);assert.match(p.match_basis,/installation_not_asserted/);
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
