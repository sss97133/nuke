/**
 * INGEST MOTEC WIRING/LOOMS (CATEGORY + KEY PRODUCTS)
 *
 * Targets:
 *  - Wiring/Looms category page (lists terminated, stub, unterminated looms)
 *  - C12X Input Loom product page (example deep page)
 *
 * Uses existing edge function `scrape-motec-catalog` (which has FIRECRAWL_API_KEY)
 * to extract part numbers, names, descriptions, and product_image_url into
 * catalog_parts. The edge function also writes/updates catalog_sources.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TARGETS = [
  {
    name: 'Wiring Looms Category',
    url: 'https://www.motec.com.au/products/category/Wiring/Looms?id=26',
  },
  {
    name: 'Wire and Tools Category',
    url: 'https://www.motec.com.au/products/category/Wiring/Wire%20and%20Tools?id=27',
  },
  {
    name: 'Connectors Category',
    url: 'https://www.motec.com.au/products/category/Wiring/Connectors?id=28',
  },
  {
    name: 'Pins and Seals Category',
    url: 'https://www.motec.com.au/products/category/Wiring/Pins%20and%20Seals?id=29',
  },
  {
    name: 'Bungs and Mounts Category',
    url: 'https://www.motec.com.au/products/category/Wiring/Bungs%20and%20Mounts?id=30',
  },
  {
    name: 'Buttons Category',
    url: 'https://www.motec.com.au/products/category/Wiring/Buttons?id=31',
  },
  {
    name: 'C12X Input Loom',
    url: 'https://www.motec.com.au/products/C12X%20Input%20Loom',
  },
];

async function ingestTarget(target) {
  try {
    const { data, error } = await supabase.functions.invoke('scrape-motec-catalog', {
      body: {
        url: target.url,
        category_name: target.name,
      },
    });

    if (error) {
      return { success: false, error: error.message, products: 0, stored: 0, updated: 0 };
    }
    if (data?.error) {
      return { success: false, error: data.error, products: 0, stored: 0, updated: 0 };
    }

    return {
      success: true,
      products: data.products_found || 0,
      stored: data.stored || 0,
      updated: data.updated || 0,
      sample: data.products || [],
    };
  } catch (err) {
    return { success: false, error: err.message, products: 0, stored: 0, updated: 0 };
  }
}

async function main() {
  console.log('🚀 Ingesting MoTeC Wiring/Looms');
  console.log('='.repeat(70));

  let totalProducts = 0;
  let totalStored = 0;
  let totalUpdated = 0;
  let failed = 0;

  for (let i = 0; i < TARGETS.length; i++) {
    const target = TARGETS[i];
    console.log(`[${i + 1}/${TARGETS.length}] ${target.name}`);
    console.log(`   URL: ${target.url}`);

    const result = await ingestTarget(target);

    if (result.success) {
      console.log(`   ✅ Found ${result.products} products`);
      console.log(`      Stored: ${result.stored}, Updated: ${result.updated}`);
      if (result.sample?.length) {
        console.log(`      Sample: ${result.sample.slice(0, 3).map((p) => p.part_number).join(', ')}`);
      }
      totalProducts += result.products;
      totalStored += result.stored;
      totalUpdated += result.updated;
    } else {
      console.log(`   ❌ Failed: ${result.error}`);
      failed++;
    }

    if (i < TARGETS.length - 1) {
      console.log('   ⏳ Waiting 2 seconds...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log('='.repeat(70));
  console.log('📊 SUMMARY');
  console.log('='.repeat(70));
  console.log(`Targets: ${TARGETS.length}`);
  console.log(`Failures: ${failed}`);
  console.log(`Products found: ${totalProducts}`);
  console.log(`Stored: ${totalStored}`);
  console.log(`Updated: ${totalUpdated}`);
  console.log('');
  console.log('Image URLs (if present) are stored in catalog_parts.product_image_url.');
  console.log('Run this periodically to refresh MoTeC wiring inventory.');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});


