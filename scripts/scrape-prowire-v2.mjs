#!/usr/bin/env node
/**
 * ProWire scraper v2 — uses Firecrawl v1 API + real markdown parser.
 * Discovers categories via mapUrl, scrapes each, parses products,
 * writes to catalog_parts.
 */

import { createClient } from '@supabase/supabase-js';
import FirecrawlApp from '@mendable/firecrawl-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FC_KEY = process.env.FIRECRAWL_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !FC_KEY) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / FIRECRAWL_API_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const fc = new FirecrawlApp({ apiKey: FC_KEY });

// Get or create catalog_source row
async function getOrCreateCatalogSource() {
  const { data: existing } = await sb
    .from('catalog_sources')
    .select('id')
    .eq('name', 'ProWire USA')
    .single();
  if (existing) return existing.id;
  const { data: created } = await sb
    .from('catalog_sources')
    .insert({ name: 'ProWire USA', provider: 'ProWire', base_url: 'https://www.prowireusa.com' })
    .select()
    .single();
  return created.id;
}

// Parse markdown of a ProWire category page → array of products.
// Each product block has:
//   [![Image Alt](image url)](product page url)
//   As low as$X.XX / Unit   OR   $X.XX
//   [PRODUCT NAME](product page url)
//   Brand line (optional)
//   Item No.[SKU](product page url)
//   STOCK Feet In Stock  OR  In Stock / Out of Stock
function parseProducts(markdown, sourceUrl) {
  const products = [];
  if (!markdown) return products;

  // Split into blocks at "Item No.[" markers
  const blocks = markdown.split(/(?=Item No\.\[)/);
  for (const block of blocks) {
    if (!block.startsWith('Item No.[')) continue;

    // Extract SKU + product page URL from "Item No.[SKU](url)"
    const skuMatch = block.match(/^Item No\.\[([^\]]+)\]\(([^)]+)\)/);
    if (!skuMatch) continue;
    const sku = skuMatch[1].trim();
    const productUrl = skuMatch[2].trim();

    // Find product name — most recent `[NAME](url)` before "Item No." in original block
    // We'll search backwards in the original markdown around this point
    const idxInMd = markdown.indexOf(`Item No.[${sku}]`);
    if (idxInMd < 0) continue;
    // Look at preceding 600 chars
    const before = markdown.slice(Math.max(0, idxInMd - 600), idxInMd);
    // Find all [text](url) where url is the same product page
    const linkRe = new RegExp(`\\[([^\\]\\n][^\\]]*)\\]\\(${productUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
    let name = null;
    let m;
    while ((m = linkRe.exec(before)) !== null) {
      const candidate = m[1].trim();
      // Skip image alts (start with "!"... actually we stripped those already in markdown form)
      if (candidate.length > 3 && candidate.length < 200 && !candidate.startsWith('http')) {
        name = candidate;  // keep the last one — closest to "Item No."
      }
    }

    // Extract price from before-block — "$0.244" or "As low as$0.244"
    const priceMatch = before.match(/\$(\d+(?:\.\d{1,3})?)/);
    const price = priceMatch ? parseFloat(priceMatch[1]) : null;

    // Stock indicator from after the SKU line
    const after = markdown.slice(idxInMd, idxInMd + 200);
    const stockMatch = after.match(/(\d+)\s+\w+\s+In Stock/i);
    const stockQty = stockMatch ? parseInt(stockMatch[1], 10) : null;
    const inStock = !!stockMatch || /In Stock/i.test(after);

    // Image URL (last image before this block)
    let imageUrl = null;
    const imgRe = /!\[[^\]]*\]\(([^)]+\.(?:jpg|jpeg|png|webp))\)/gi;
    let imgM;
    let lastImg = null;
    while ((imgM = imgRe.exec(before)) !== null) lastImg = imgM[1];
    if (lastImg) imageUrl = lastImg.startsWith('http') ? lastImg : `https://www.prowireusa.com${lastImg}`;

    products.push({
      sku,
      name: name || sku,
      product_url: productUrl,
      price,
      stock_qty: stockQty,
      in_stock: inStock,
      image_url: imageUrl,
      source_category_url: sourceUrl,
    });
  }

  return products;
}

async function upsertProduct(catalogId, p) {
  const { data: existing } = await sb
    .from('catalog_parts')
    .select('id')
    .eq('part_number', p.sku)
    .eq('catalog_id', catalogId)
    .maybeSingle();

  const payload = {
    catalog_id: catalogId,
    part_number: p.sku,
    name: p.name,
    description: p.name,
    price_current: p.price,
    product_image_url: p.image_url,
    in_stock: p.in_stock,
    supplier_url: p.product_url,
    category: 'wiring',
    manufacturer: 'ProWire USA',
    application_data: {
      supplier: 'ProWire USA',
      source_category_url: p.source_category_url,
      stock_qty: p.stock_qty,
    },
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await sb.from('catalog_parts').update(payload).eq('id', existing.id);
    return error ? 'err' : 'updated';
  }
  const { error } = await sb.from('catalog_parts').insert(payload);
  return error ? 'err' : 'inserted';
}

async function main() {
  console.log('🚀 ProWire scraper v2');
  const catalogId = await getOrCreateCatalogSource();
  console.log(`catalog_source id: ${catalogId}`);

  // Discover category pages
  console.log('Discovering category pages via mapUrl...');
  const mapRes = await fc.v1.mapUrl('https://www.prowireusa.com', { limit: 500 });
  const allUrls = mapRes.links || [];
  const categoryUrls = allUrls.filter((u) => /\/c-\d+-/.test(u));
  console.log(`Found ${categoryUrls.length} category pages of ${allUrls.length} total URLs`);

  let totalProducts = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (let i = 0; i < categoryUrls.length; i++) {
    const url = categoryUrls[i];
    const slug = url.split('/').pop().replace('.html', '');
    process.stdout.write(`[${i + 1}/${categoryUrls.length}] ${slug.slice(0, 50)} ... `);
    try {
      const res = await fc.v1.scrapeUrl(url, { formats: ['markdown'] });
      if (!res.success || !res.markdown) {
        console.log('scrape fail');
        continue;
      }
      const products = parseProducts(res.markdown, url);
      let ins = 0, upd = 0, errs = 0;
      for (const p of products) {
        const result = await upsertProduct(catalogId, p);
        if (result === 'inserted') ins++;
        else if (result === 'updated') upd++;
        else errs++;
      }
      totalProducts += products.length;
      totalInserted += ins;
      totalUpdated += upd;
      totalErrors += errs;
      console.log(`${products.length} products (ins ${ins}, upd ${upd}, err ${errs})`);
    } catch (e) {
      console.log(`ERR ${e.message}`);
    }
    // small delay to be polite
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log('=====================================');
  console.log(`Total products parsed: ${totalProducts}`);
  console.log(`Inserted: ${totalInserted}, Updated: ${totalUpdated}, Errors: ${totalErrors}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
