import { enrichReceiptProducts, allowedStockImage } from './receiptProducts.ts';
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const receipt = '60000000-0000-0000-0000-000000000001';
const queue = '80000000-0000-0000-0000-000000000001';
const request = { receipt_id: receipt, derivation_queue_id: queue, worker: 'fixture' };
function fixture(count = 3, vendor = 'Classic Industries') {
 const calls: any[] = [], cards = new Map();
 const lines = Array.from({ length: count }, (_, i) => ({ id: `line-${i}`, part_number: `SKU-${i}`, description: 'Owner private description 123 home address' }));
 const state = { generation: 0, prior: null as any };
 const admin: any = { from: (table: string) => {
   const data = () => table === 'derivation_queue' ? { id: queue, evidence_id: receipt, user_id: 'owner', product_result: state.prior, product_generation: state.generation }
     : table === 'receipts' ? { id: receipt, user_id: 'owner', vendor_name: vendor } : lines;
   const q: any = { select: () => q, eq: () => q, single: async () => ({ data: data(), error: null }), order: async () => ({ data: data(), error: null }) };return q;
 }, rpc: async (name: string, args: any) => {
   calls.push({ name, args });
   if (name === 'receipt_item_product_card') return { data: cards.get(args.p_item) ?? null };
   const id = `catalog-${args.p_number}`; cards.set(lines.find(line => line.part_number===args.p_number)?.id, {
     catalog_part_id: id, image_status: args.p_capture.image_status, image_url: args.p_capture.image_url,
     page_url: args.p_capture.page_url, quote_price: args.p_capture.price }); return { data: id };
 }};
 const captures: string[] = [];
 const effects = { capturePage: async (_a: any, url: string) => {
   captures.push(url); const sku = /sku-\d+/i.exec(url)?.[0].toUpperCase();
   return { html: `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', sku, name: 'Supplier product', image: 'https://cdn.oerparts.com/product.jpg', offers: { price: '49.95', priceCurrency: 'USD' } })}</script>`,
     source: { listing_url: url, id: 'snapshot', html_sha256: 'a'.repeat(64) } };
 }, retainImage: async () => ({ image_url: 'https://fixture.supabase.co/stock.jpg', image_sha256: 'b'.repeat(64), image_storage_path: 'stock.jpg' }) };
 return { admin, effects, calls, captures, cards, state, lines };
}
Deno.test('receipt worker bounds new captures, continues from shared catalog, and never sends private receipt text', async () => {
 const f = fixture();const first = await enrichReceiptProducts(f.admin, request, f.effects);
 assert(!first.product_complete && first.product_result.items['line-2'].status === 'queued', 'partial work must remain incomplete');
 assert(f.captures.length === 2 && f.captures.every(url => !url.includes('Owner') && !url.includes('address')), 'only public SKU URLs go out');
 assert(f.calls.filter(x => x.name === 'record_receipt_catalog_product').every(x => !JSON.stringify(x.args).includes('private')), 'public catalog excludes receipt context');
 f.state.prior = first.product_result;
 const second = await enrichReceiptProducts(f.admin, request, f.effects);
 assert(second.product_complete && f.captures.length === 3, 'next invocation uses acknowledged products and finishes remaining item');
});
Deno.test('blocked supplier is attempted once per host and each line retains a retry reason', async () => {
 const f = fixture(2);f.effects.capturePage = async (_a, url) => { f.captures.push(url);throw new Error('supplier_budget_deferred'); };
 const result = await enrichReceiptProducts(f.admin, request, f.effects);
 assert(!result.product_complete && f.captures.length === 2, 'one attempt per two candidate hosts, not four');
 assert(Object.values(result.product_result.items).every((x: any) => x.retry_at && x.status !== 'matched'), 'failures retain reasons and retry dates');
});
Deno.test('unknown supplier remains explicitly unresolved without any external transfer', async () => {
 const f = fixture(1, 'Private person');const result = await enrichReceiptProducts(f.admin, request, f.effects);
 assert(!result.product_complete && result.product_result.items['line-0'].status === 'supplier_not_integrated' && !f.captures.length, 'no guessed supplier');
});
Deno.test('same SKU is reusable across receipts and stock hosts must be known CDNs', async () => {
 const f = fixture(1);f.cards.set('line-0', { catalog_part_id: 'shared' });
 const result = await enrichReceiptProducts(f.admin, request, f.effects);
 assert(result.product_complete && !f.captures.length, 'reuse already retained product');
 assert(allowedStockImage('https://cdn.oerparts.com/p.jpg') && !allowedStockImage('https://cdn.oerparts.com.evil.test/p.jpg') && !allowedStockImage('https://localhost/p.jpg'), 'image host qualification');
 assert(allowedStockImage('https://images-prod.oreillyauto.com/parts/p.jpg') && !allowedStockImage('https://images-prod.oreillyauto.com.evil.test/p.jpg'), 'official production CDN only');
});
Deno.test('OReilly worker binds the receipt line code and primary MPN before admission', async () => {
 const f = fixture(1, "O'Reilly Auto Parts");
 f.lines[0] = { id: 'line-0', part_number: '72810', description: '1QT-P/SFLUID (ORC) private receipt context' };
 f.effects.capturePage = async (_a, url) => {
   f.captures.push(url);
   return { html: url.includes('/search?') ? '<a href="/detail/c/brand/fluid/orc0/72810?q=72810"><h3 class="js-product-name" data-item="72810" data-line="ORC">Fluid</h3></a><a href="/detail/c/other/item/abc0/72810?q=72810"><h3 class="js-product-name" data-item="72810" data-line="ABC">Wrong brand</h3></a>'
     : '<h1 class="js-product-name" data-item="72810" data-line="ORC">Power Steering Fluid</h1><script type="application/ld+json">{"@type":"Product","sku":"733704728108","mpn":"72810","name":"Power Steering Fluid","image":"https://images-prod.oreillyauto.com/parts/fluid.jpg"}</script>',
     source: { listing_url: url, id: 'snapshot', html_sha256: 'a'.repeat(64) } };
 };
 const result = await enrichReceiptProducts(f.admin, request, f.effects);
 assert(result.product_complete && f.captures.length===2 && f.captures[1].includes('/orc0/'), 'exact product line resolved');
 const saved=f.calls.find(x=>x.name==='record_receipt_catalog_product');
 assert(saved.args.p_capture.printed_sku==='72810' && !JSON.stringify(saved).includes('private'), 'primary MPN and public facts admitted');
});
Deno.test('OReilly receipt without a product line stays explicit and does not scrape', async () => {
 const f = fixture(1, "O'Reilly Auto Parts");
 const result = await enrichReceiptProducts(f.admin, request, f.effects);
 assert(!result.product_complete && result.product_result.items['line-0'].status==='receipt_line_code_missing' && !f.captures.length,'do not guess a brand');
});
Deno.test('a parser revision revisits a prior refusal instead of retaining its day-long delay', async () => {
 const f=fixture(1);
 const oldFingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['Classic Industries',f.lines[0].part_number,f.lines[0].description])))),x=>x.toString(16).padStart(2,'0')).join('');
 f.state.prior={items:{'line-0':{fingerprint:oldFingerprint,status:'sku_not_verified',retry_at:new Date(Date.now()+86400000).toISOString()}}};
 const result=await enrichReceiptProducts(f.admin,request,f.effects);
 assert(result.product_complete&&f.captures.length===1,'old-parser refusal retried through retained capture path');
});

Deno.test('an exact product without a stock image retains its source quote and completes normally', async () => {
 const f=fixture(1);let imageCalls=0;
 f.effects.capturePage=async (_a,url)=>({html:'<script type="application/ld+json">{"@type":"Product","sku":"SKU-0","name":"Qualified product","offers":{"price":"49.95","priceCurrency":"USD"}}</script>',
   source:{listing_url:url,id:'snapshot',html_sha256:'a'.repeat(64)}});
 f.effects.retainImage=async()=>{imageCalls++;throw new Error('unexpected_image_request');};
 const result=await enrichReceiptProducts(f.admin,request,f.effects);
 const capture=f.calls.find(x=>x.name==='record_receipt_catalog_product').args.p_capture;
 assert(result.product_complete&&imageCalls===0,'no missing-image request or endless retry');
 assert(capture.price===49.95&&capture.currency==='USD'&&capture.snapshot_id==='snapshot'&&capture.printed_sku==='SKU-0','source quote retained');
 assert(capture.image_status==='not_provided'&&capture.image_url===null&&capture.image_sha256===null&&capture.image_storage_path===null&&capture.image_source_url===null,'no stock-image proof invented');
});

Deno.test('failed or unqualified stock capture withholds every image proof field but admits the qualified product', async () => {
 for(const reason of ['stock_image_unavailable','stock_image_readback_mismatch','stock_image_host_unapproved']) {
   const f=fixture(1);f.effects.retainImage=async()=>{throw new Error(reason);};
   const result=await enrichReceiptProducts(f.admin,request,f.effects);
   const capture=f.calls.find(x=>x.name==='record_receipt_catalog_product').args.p_capture;
   assert(result.product_complete===(reason==='stock_image_host_unapproved'),'transient media failure preserves an existing retry; unqualified host is not retried');
   assert(result.product_result.items['line-0'].catalog_part_id==='catalog-SKU-0','retained product acknowledgement survives media failure');
   assert(capture.image_status===(reason==='stock_image_host_unapproved'?'unqualified':'unavailable'),'explicit media status');
   assert(['image_url','image_source_url','image_sha256','image_storage_path'].every(key=>capture[key]===null),'partial stock proof is never sent');
 }
});

Deno.test('a retained quote preserves the existing image backoff and later completes with qualified stock media', async () => {
 const f=fixture(1);let imageCalls=0;
 const retain=f.effects.retainImage;
 f.effects.retainImage=async()=>{imageCalls++;if(imageCalls===1)throw new Error('stock_image_unavailable');return retain();};
 const first=await enrichReceiptProducts(f.admin,request,f.effects);
 assert(!first.product_complete&&first.retry_after_seconds===3600&&first.product_result.items['line-0'].status==='stock_image_unavailable','existing one-hour retry keeps work pending');
 assert(f.cards.get('line-0').quote_price===49.95&&first.product_result.items['line-0'].price_retained===true,'catalog quote is already readable');
 f.state.prior=first.product_result;
 const waiting=await enrichReceiptProducts(f.admin,request,f.effects);
 assert(!waiting.product_complete&&imageCalls===1&&f.captures.length===1,'readable card does not erase pending media; no calls before retry clock');
 f.state.prior.items['line-0'].retry_at=new Date(Date.now()-1000).toISOString();
 const recovered=await enrichReceiptProducts(f.admin,request,f.effects);
 assert(recovered.product_complete&&Number(imageCalls)===2&&f.captures.length===2,'next eligible pass captures and acknowledges media');
 assert(f.calls.filter(x=>x.name==='record_receipt_catalog_product').length===2&&f.cards.get('line-0').image_status==='retained','same writer appends or acknowledges qualified image revision');
 const settled=await enrichReceiptProducts(f.admin,request,f.effects);
 assert(settled.product_complete&&Number(imageCalls)===2,'retained image does not trigger further calls');
});

Deno.test('image-free products still require exact primary SKU and matching OReilly line code', async () => {
 for(const [vendor,sku,lineCode] of [['Classic Industries','WRONG',null],["O'Reilly Auto Parts",'SKU-0','ABC']]) {
   const f=fixture(1,vendor!);f.lines[0].description='PART (ORC)';
   f.effects.capturePage=async(_a,url)=>({html:url.includes('/search?')?'<a href="/detail/c/brand/item/orc0/SKU-0"><h3 class="js-product-name" data-item="SKU-0" data-line="ORC">Part</h3></a>':
     `<h1 class="js-product-name" data-item="${sku}" data-line="${lineCode}">Part</h1><script type="application/ld+json">${JSON.stringify({'@type':'Product',sku,name:'Part',offers:{price:50,priceCurrency:'USD'}})}</script>`,
     source:{listing_url:url,id:'snapshot',html_sha256:'a'.repeat(64)}});
   const result=await enrichReceiptProducts(f.admin,request,f.effects);
   assert(!result.product_complete&&!f.calls.some(x=>x.name==='record_receipt_catalog_product'),'identity refusal still blocks admission');
 }
});

Deno.test('optional-image revision retries the prior image-only refusal', async () => {
 const f=fixture(1);
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['primary_identity_v2','Classic Industries',f.lines[0].part_number,f.lines[0].description])))),x=>x.toString(16).padStart(2,'0')).join('');
 f.state.prior={items:{'line-0':{fingerprint,status:'exact_sku_without_product_image',retry_at:new Date(Date.now()+86400000).toISOString()}}};
 const result=await enrichReceiptProducts(f.admin,request,f.effects);
 assert(result.product_complete&&f.captures.length===1,'existing source admission retried without waiting on obsolete image refusal');
 const capture=f.calls.find(x=>x.name==='record_receipt_catalog_product').args.p_capture;
 assert(capture.image_status==='retained'&&capture.image_sha256==='b'.repeat(64),'valid stock proof unchanged');
});

Deno.test('historical writer acknowledgement cannot complete while the current reader still has the image-free revision', async () => {
 const f=fixture(1);const rpc=f.admin.rpc;
 f.cards.set('line-0',{catalog_part_id:'current-image-free',image_status:'unavailable',quote_price:49.95});
 f.admin.rpc=async(name:string,args:any)=>name==='record_receipt_catalog_product'
   ? {data:'historical-with-image'} : rpc(name,args);
 const result=await enrichReceiptProducts(f.admin,request,f.effects);
 const item=result.product_result.items['line-0'];
 assert(!result.product_complete&&item.status==='catalog_readback_mismatch'&&result.retry_after_seconds===3600,'old writer ID never marks recovery complete');
 assert(item.catalog_part_id==='current-image-free'&&item.price_retained===true,'only the current readable quote is acknowledged');
});

Deno.test('source withdrawal or media mismatch at readback stays pending and never acknowledges stale testimony', async () => {
 for(const failure of ['withdrawn','wrong_image','wrong_status','wrong_page','reader_error']) {
   const f=fixture(1);const rpc=f.admin.rpc;let wrote=false;
   f.admin.rpc=async(name:string,args:any)=>{
     const result=await rpc(name,args);
     if(name==='record_receipt_catalog_product')wrote=true;
     if(name==='receipt_item_product_card'&&wrote) {
       if(failure==='withdrawn')return {data:null};
       if(failure==='reader_error')return {data:null,error:{message:'source read failed'}};
       return {data:{...result.data,...(failure==='wrong_image'?{image_url:'https://fixture.supabase.co/replacement.jpg'}:
         failure==='wrong_status'?{image_status:'unavailable'}:{page_url:'https://www.classicindustries.com/other.html'})}};
     }
     return result;
   };
   const result=await enrichReceiptProducts(f.admin,request,f.effects);
   const item=result.product_result.items['line-0'];
   assert(!result.product_complete&&item.status===(failure==='reader_error'?'catalog_reader_unavailable':'catalog_readback_mismatch'),'completion requires current source and image acknowledgement');
   if(failure==='withdrawn'||failure==='reader_error')assert(item.catalog_part_id===undefined&&item.price_retained===undefined,'withdrawn or unreadable quote is not claimed retained');
 }
});
