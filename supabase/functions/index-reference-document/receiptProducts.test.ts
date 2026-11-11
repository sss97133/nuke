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
   const id = `catalog-${args.p_number}`; cards.set(`line-${args.p_number.split('-')[1]}`, { catalog_part_id: id }); return { data: id };
 }};
 const captures: string[] = [];
 const effects = { capturePage: async (_a: any, url: string) => {
   captures.push(url); const sku = /sku-\d+/i.exec(url)?.[0].toUpperCase();
   return { html: `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', sku, name: 'Supplier product', image: 'https://cdn.oerparts.com/product.jpg' })}</script>`,
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
