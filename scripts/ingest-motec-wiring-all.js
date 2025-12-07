/**
 * INGEST MOTEC WIRING (ALL CATEGORIES) WITH FIRECRAWL + DIRECT DB UPSERT
 *
 * Targets:
 *  - Looms
 *  - Wire and Tools
 *  - Connectors
 *  - Pins and Seals
 *  - Bungs and Mounts
 *  - Buttons
 *  - C12X Input Loom (product page)
 *
 * Uses firecrawl to fetch html/markdown and cheerio to extract part numbers,
 * names, descriptions, and nearby images. Upserts into catalog_parts.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import FirecrawlApp from '@mendable/firecrawl-js';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const firecrawlKey = process.env.FIRECRAWL_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!firecrawlKey) {
  console.error('❌ Missing FIRECRAWL_API_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const firecrawl = new FirecrawlApp({ apiKey: firecrawlKey });

const TARGETS = [
  { name: 'Wiring Looms Category', url: 'https://www.motec.com.au/products/category/Wiring/Looms?id=26' },
  { name: 'Wire and Tools Category', url: 'https://www.motec.com.au/products/category/Wiring/Wire%20and%20Tools?id=27' },
  { name: 'Connectors Category', url: 'https://www.motec.com.au/products/category/Wiring/Connectors?id=28' },
  { name: 'Pins and Seals Category', url: 'https://www.motec.com.au/products/category/Wiring/Pins%20and%20Seals?id=29' },
  { name: 'Bungs and Mounts Category', url: 'https://www.motec.com.au/products/category/Wiring/Bungs%20and%20Mounts?id=30' },
  { name: 'Buttons Category', url: 'https://www.motec.com.au/products/category/Wiring/Buttons?id=31' },
  { name: 'C12X Input Loom', url: 'https://www.motec.com.au/products/C12X%20Input%20Loom' },
];

function extractProducts(html, markdown, category) {
  const $ = cheerio.load(html || '');
  const products = [];
  const seen = new Set();

  $('[class*=content], body').each((_, el) => {
    const text = $(el).text();
    if (!text || !text.includes('Part No')) return;
  });

  $('[class*=content], body').find('*').each((_, node) => {
    const text = $(node).text().trim();
    if (!text) return;
    const match = text.match(/Part No[:\s]*#?\s*([A-Za-z0-9._-]+)/i);
    if (!match) return;
    const partNumber = match[1].trim();
    if (seen.has(partNumber)) return;

    // Find name: nearest previous heading
    let name = null;
    let current = node;
    while (current && !name) {
      current = current.prev;
      if (current && current.type === 'tag' && /^h[1-6]$/.test(current.tagName)) {
        name = $(current).text().trim();
        break;
      }
    }
    if (!name) {
      name = $(node).closest('div').find('h5,h4,h3,h2').first().text().trim();
    }

    // Description: next paragraph
    let description = null;
    const nextP = $(node).nextAll('p').first();
    if (nextP && nextP.text()) {
      description = nextP.text().trim();
    }

    // Image: look in same block
    let imageUrl = null;
    const img = $(node).closest('div').find('img').first();
    if (img && img.attr('src')) {
      const src = img.attr('src');
      imageUrl = src.startsWith('http') ? src : `https://www.motec.com.au${src}`;
    }

    products.push({
      part_number: partNumber,
      name: name || partNumber,
      description: description || null,
      image_url: imageUrl || null,
      category,
    });
    seen.add(partNumber);
  });

  // Fallback: parse markdown blocks with Part No
  if (products.length === 0 && markdown) {
    const blocks = markdown.split('\n\n');
    for (const block of blocks) {
      if (!block.includes('Part No')) continue;
      const pm = block.match(/Part No[:\s]*#?\s*([A-Za-z0-9._-]+)/i);
      if (!pm) continue;
      const pn = pm[1].trim();
      if (seen.has(pn)) continue;
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const heading = lines.find((l) => l.startsWith('###') || l.startsWith('#####')) || lines[0];
      const cleanedName = heading.replace(/^[#\s]+/, '').trim();
      const descLine = lines.find((l) => l && !l.startsWith('#') && !l.includes('Part No'));
      products.push({
        part_number: pn,
        name: cleanedName || pn,
        description: descLine || null,
        image_url: null,
        category,
      });
      seen.add(pn);
    }
  }

  return products;
}

async function getCatalogId() {
  const { data: source } = await supabase
    .from('catalog_sources')
    .select('id')
    .eq('provider', 'Motec')
    .single();
  if (source) return source.id;
  const { data: inserted } = await supabase
    .from('catalog_sources')
    .insert({ name: 'Motec', provider: 'Motec', base_url: 'https://www.motec.com.au' })
    .select()
    .single();
  return inserted?.id;
}

async function upsertProducts(catalogId, products) {
  let stored = 0;
  let updated = 0;
  for (const p of products) {
    if (!p.part_number || !p.name) continue;
    const { data: existing } = await supabase
      .from('catalog_parts')
      .select('id')
      .eq('catalog_id', catalogId)
      .eq('part_number', p.part_number)
      .single();
    if (existing) {
      await supabase
        .from('catalog_parts')
        .update({
          name: p.name,
          description: p.description,
          product_image_url: p.image_url,
          category: p.category,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      updated++;
    } else {
      await supabase.from('catalog_parts').insert({
        catalog_id: catalogId,
        part_number: p.part_number,
        name: p.name,
        description: p.description,
        product_image_url: p.image_url,
        category: p.category,
        application_data: { supplier: 'Motec', category: p.category },
      });
      stored++;
    }
  }
  return { stored, updated };
}

async function main() {
  console.log('🚀 Ingesting MoTeC Wiring (all categories) via Firecrawl + direct upsert');
  const catalogId = await getCatalogId();
  let totalFound = 0;
  let totalStored = 0;
  let totalUpdated = 0;
  let failures = 0;

  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    console.log(`[${i + 1}/${TARGETS.length}] ${t.name}`);
    console.log(`   URL: ${t.url}`);
    try {
      let resp = null;
      if (typeof firecrawl.crawlUrl === 'function') {
        resp = await firecrawl.crawlUrl({
          url: t.url,
          formats: ['html', 'markdown'],
          includeTags: ['body'],
        });
      } else {
        const raw = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: t.url,
            formats: ['html', 'markdown'],
          }),
        });
        if (!raw.ok) throw new Error(`Firecrawl HTTP ${raw.status}`);
        resp = await raw.json();
        resp.data = resp.data || {};
      }
      const html = resp?.data?.html || '';
      const markdown = resp?.data?.markdown || '';
      if (!html && !markdown) {
        throw new Error('Empty Firecrawl response');
      }
      const products = extractProducts(html, markdown, t.name);
      console.log(`   Parsed ${products.length} products`);
      const { stored, updated } = await upsertProducts(catalogId, products);
      totalFound += products.length;
      totalStored += stored;
      totalUpdated += updated;
      console.log(`   ✅ Stored: ${stored}, Updated: ${updated}`);
    } catch (err) {
      failures++;
      console.log(`   ❌ Failed: ${err.message}`);
    }
    if (i < TARGETS.length - 1) {
      console.log('   ⏳ Waiting 1.5 seconds...');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log('='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Targets: ${TARGETS.length}`);
  console.log(`Failures: ${failures}`);
  console.log(`Products found (parsed): ${totalFound}`);
  console.log(`Stored: ${totalStored}`);
  console.log(`Updated: ${totalUpdated}`);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});


