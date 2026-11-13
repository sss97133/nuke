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
 const html=['mry0','wal0','mtm0'].map(code=>`<a href="/detail/c/brand/item/${code}/55173?q=55173"><h3 class="js-product-name" data-item="55173" data-line="${code.slice(0,-1).toUpperCase()}">part</h3></a>`).join('')+'<a href="/detail/c/brand/item/mtm0/55173?tracking=duplicate"><h3 class="js-product-name" data-item="55173" data-line="MTM">same</h3></a>';
 assert.equal(productLinks(html,root,'55173').length,3);
 assert.deepEqual(productLinks(html,root,'55173',receiptLineCode('HOSE CLAMPS (MTM)')),['https://www.oreillyauto.com/detail/c/brand/item/mtm0/55173?q=55173']);
 assert.deepEqual(productLinks(html,root,'55173','ORC'),[]);
 assert.equal(receiptLineCode('BATTERY (SSB, 2Y warranty)'), 'SSB');
 assert.equal(receiptLineCode('ENGINE MOUNT (PT2) LT'),'PT2');
 assert.equal(receiptLineCode('SEMI-MET PAD (ST)'),'ST');
 assert.equal(receiptLineCode('Fluid without a printed code'),null);
});
test('printed product-line code is independent of the URL brand abbreviation',()=>{
 const detail='https://www.oreillyauto.com/detail/c/precision/hose/opr0/13401332';
 const heading='<h1 class="js-product-name" data-line="PPS" data-item="13401332">Steering hose</h1>';
 const body=page({...product,sku:'UPC',mpn:'13401332'})+heading;
 assert.equal(parseProductPage(body,detail,'13401332').line_code,'PPS');
 assert.equal(parseProductPage(body.replace('data-item="13401332"','data-item="WRONG"'),detail,'13401332').status,'primary_line_code_not_verified');
 const card=`<a href="${detail}"><h3 class="js-product-name" data-line="PPS" data-item="13401332">Steering hose</h3></a>`;
 assert.deepEqual(productLinks(card,'https://www.oreillyauto.com/search?q=13401332','13401332','PPS'),[detail]);
 assert.deepEqual(productLinks(card,'https://www.oreillyauto.com/search?q=13401332','13401332','OPR'),[]);
});
test('matching recommendation cannot replace a mismatching primary product',()=>{
 assert.equal(parseProductPage(page([ {...product,sku:'OTHER'},product ]),url,'ABC-1').status,'sku_not_verified');
 const html='<div itemscope itemtype="https://schema.org/Product"><meta itemprop="name" content="Wrong"><div itemscope itemtype="https://schema.org/Product"><meta itemprop="sku" content="ABC-1">';
 assert.equal(parseProductPage(html,url,'ABC-1').status,'sku_not_verified');
});
test('primary microdata supplies an identifier only when JSON-LD has none',()=>{
 const micro='<div itemscope itemtype="https://schema.org/Product"><meta itemprop="sku" content="ABC-1"></div>';
 assert.equal(parseProductPage(page({...product,sku:undefined})+micro,url,'ABC-1').status,'exact_sku_page');
 assert.equal(parseProductPage(page({...product,sku:'OTHER'})+micro,url,'ABC-1').status,'sku_not_verified');
});
test('missing identity is refused while unavailable images do not discard an exact supplier quote',()=>{
 assert.equal(parseProductPage(page({...product,sku:undefined}),url,'ABC-1').status,'sku_not_verified');
 assert.equal(parseProductPage(page({...product,name:undefined}),url,'ABC-1').status,'exact_sku_without_product_name');
 for(const image of [undefined,'https://cdn.oerparts.com/logo.png','https://cdn.oerparts.com/placeholder.jpg','http://cdn.oerparts.com/photo.jpg']) {
   const p=parseProductPage(page({...product,image}),url,'ABC-1');
   assert.equal(p.status,'exact_sku_page');assert.equal(p.image_url,null);assert.equal(p.price,59.99);assert.equal(p.currency,'USD');
   assert.equal(p.image_status,image?'unqualified':'not_provided');
 }
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
test('search links without printed line proof require exact SKU path segment and allowlisted supplier',()=>{
 const root='https://www.oreillyauto.com/search?q=ABC-1';
 const html='<a href="/detail/c/brand/item/abc-10">wrong</a><a href="/detail/c/brand/item/abc-1">yes</a><a href="https://evil.test/detail/c/abc-1">no</a><a href="/detail/c/%zz/abc-1">malformed</a>';
 assert.deepEqual(productLinks(html,root,'ABC-1'),['https://www.oreillyauto.com/detail/c/brand/item/abc-1']);
 for(const u of ['https://www.oerparts.com.evil.test/p','http://www.oerparts.com/p','https://user@www.oerparts.com/p','https://127.0.0.1/p'])assert.equal(allowedProductUrl(u),false);
});
test('exact printed OReilly SKU and line can identify a detail URL with a punctuation-free slug',()=>{
 const root='https://www.oreillyauto.com/search?q=GAL50%2F50';
 const detail='https://www.oreillyauto.com/detail/c/brand/coolant/afz0/gal5050?q=GAL50%2F50';
 const card=(item='GAL50/50',line='AFZ',href=detail)=>`<a href="${href}"><h3 class="js-product-name" data-item="${item}" data-line="${line}">Premixed coolant</h3></a>`;
 assert.deepEqual(productLinks(card()+card('GAL50/50','AFZ',detail+'#reviews'),root,'GAL50/50','AFZ'),[detail]);
 assert.deepEqual(productLinks(card(),root,'GAL50/50'),[]);
 assert.deepEqual(productLinks(card('GAL5050'),root,'GAL50/50','AFZ'),[]);
 assert.deepEqual(productLinks(card('GAL50/50','OTHER'),root,'GAL50/50','AFZ'),[]);
 assert.deepEqual(productLinks(card(),root,'GAL5050','AFZ'),[]);
});
test('printed identity is bound to the same link, supplier and detail route',()=>{
 const root='https://www.oreillyauto.com/search?q=GAL50%2F50';
 const heading='<h3 class="js-product-name" data-item="GAL50/50" data-line="AFZ">Coolant</h3>';
 for(const href of ['https://evil.test/detail/c/brand/coolant/afz0/gal5050','https://user@www.oreillyauto.com/detail/c/brand/coolant/afz0/gal5050','/search?q=GAL50%2F50','/detail/c/%zz/gal5050']) {
  assert.deepEqual(productLinks(`<a href="${href}">${heading}</a>`,root,'GAL50/50','AFZ'),[]);
 }
 assert.deepEqual(productLinks(`<a href="/detail/c/brand/coolant/afz0/gal5050">unidentified link</a>${heading}`,root,'GAL50/50','AFZ'),[]);
 assert.deepEqual(productLinks(`<a href="/detail/c/brand/coolant/afz0/gal5050">${heading}</a>`,'https://www.oerparts.com/search','GAL50/50','AFZ'),[]);
});
test('detail identity remains exact after discovery and does not inherit the search card proof',()=>{
 const detail='https://www.oreillyauto.com/detail/c/brand/coolant/afz0/gal5050';
 const heading='<h1 class="js-product-name" data-item="GAL50/50" data-line="AFZ">Coolant</h1>';
 const exact=page({...product,sku:'GAL50/50'})+heading;
 assert.equal(parseProductPage(exact,detail,'GAL50/50').status,'exact_sku_page');
 assert.equal(parseProductPage(page({...product,sku:'GAL5050'})+heading,detail,'GAL50/50').status,'sku_not_verified');
 assert.equal(parseProductPage(page({...product,sku:'GAL50/50'})+heading.replace('data-item="GAL50/50"','data-item="GAL5050"'),detail,'GAL50/50').status,'primary_line_code_not_verified');
 assert.equal(parseProductPage(exact.replace('data-line="AFZ"','data-line="ALT"'),detail,'GAL50/50').line_code,'ALT');
 // The unchanged receipt worker compares this returned primary line to AFZ;
 // discovery does not override a different line on the actual product page.
});
