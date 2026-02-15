#!/usr/bin/env npx tsx
/**
 * GAA Classic Cars Local Crawler
 *
 * Fetches listing pages locally (Supabase edge function can't reach gaaclassiccars.com).
 * Parses vehicle data via regex, inserts directly to DB via pg.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/gaa-local-crawl.ts
 */

import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD!;
const DATABASE_URL = `postgresql://postgres.qkgaybvrernstplzjaam:${DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2, idleTimeoutMillis: 30000 });

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [GAA] ${msg}`);
}

const INVENTORY_URL = 'https://www.gaaclassiccars.com/vehicles?q%5Bbranch_id_eq%5D=62';
const RESULTS_URL = 'https://www.gaaclassiccars.com/vehicles/results?q%5Bbranch_id_eq%5D=59';

async function fetchPage(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

interface GAAItem {
  url: string;
  gaaId: string | null;
  vin: string | null;
  lotNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  imageUrl: string | null;
  salePrice: number | null;
  highestBid: number | null;
  sold: boolean;
  notSold: boolean;
  auctionDate: string | null;
}

function parseListingGrid(html: string): GAAItem[] {
  const items: GAAItem[] = [];
  // Split by vehicle items
  const vehicleBlocks = html.split(/class="gaa-vehicle-item"/g);

  for (let i = 1; i < vehicleBlocks.length; i++) {
    const block = vehicleBlocks[i];
    const content = block.slice(0, 3000); // Limit for performance

    // URL
    const urlMatch = block.match(/href="(\/vehicles\/(\d+)\/[^"]+)"/);
    const url = urlMatch ? `https://www.gaaclassiccars.com${urlMatch[1]}` : null;
    const gaaId = urlMatch ? urlMatch[2] : null;
    if (!url) continue;

    // VIN
    const vinMatch = content.match(/class=['"]vehicle-vin['"][^>]*style=['"]display:\s*none[^'"]*['"][^>]*>([\w\d]+)/);
    const vin = vinMatch && vinMatch[1].length === 17 ? vinMatch[1].toUpperCase() : null;

    // Lot number
    const lotMatch = content.match(/Lot\s*&#?35;?\s*<span[^>]*>([^<]+)/i) || content.match(/Lot\s*#\s*(\w+)/i);
    const lotNumber = lotMatch ? lotMatch[1].trim() : null;

    // Year
    const yearMatch = content.match(/<h3>(\d{4})<\/h3>/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    // Make
    const makeMatch = content.match(/<h3>\d{4}<\/h3>\s*<h3>([^<]+)<\/h3>/i);
    const make = makeMatch ? makeMatch[1].trim() : null;

    // Model
    const modelMatch = content.match(/class=['"]model['"][^>]*>([^<]+)<\/div>/);
    const model = modelMatch ? modelMatch[1].trim() : null;

    // Image
    const imgMatch = content.match(/<img[^>]*src="(https:\/\/cdn\.dealeraccelerate\.com\/gaa\/[^"]+)"/);
    const imageUrl = imgMatch ? imgMatch[1] : null;

    // Sale price
    const priceMatch = content.match(/Sale\s*Price:\s*<\/span>\s*<strong>\s*\$?([\d,]+)/i);
    const salePrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

    // Highest bid
    const bidMatch = content.match(/Highest\s*Bid:\s*<\/span>\s*<strong>\s*\$?([\d,]+)/i);
    const highestBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null;

    // Status
    const sold = content.includes('gaa-inventory-sold-banner') || (salePrice !== null && salePrice > 0);
    const notSold = content.includes('gaa-not-sold') || content.toLowerCase().includes('not sold');

    // Auction date
    const dateMatch = content.match(/<span>\s*(\d{4}\s+\w+)\s*<\/span>/i);
    const auctionDate = dateMatch ? dateMatch[1].trim() : null;

    items.push({ url, gaaId, vin, lotNumber, year, make, model, imageUrl, salePrice, highestBid, sold, notSold, auctionDate });
  }

  return items;
}

function getTotalPages(html: string): number {
  const match = html.match(/Page\s+\d+\s+of\s+(\d+)/i);
  return match ? parseInt(match[1]) : 1;
}

async function crawlType(baseUrl: string, typeName: string): Promise<GAAItem[]> {
  log(`Crawling ${typeName}...`);
  const allItems: GAAItem[] = [];

  const firstPage = await fetchPage(baseUrl);
  const totalPages = getTotalPages(firstPage);
  log(`  ${typeName}: ${totalPages} pages`);

  const page1Items = parseListingGrid(firstPage);
  allItems.push(...page1Items);
  log(`  Page 1: ${page1Items.length} items`);

  for (let p = 2; p <= totalPages; p++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const url = `${baseUrl}&page=${p}`;
      const html = await fetchPage(url);
      const items = parseListingGrid(html);
      allItems.push(...items);
      if (p % 10 === 0) log(`  Page ${p}/${totalPages}: ${items.length} items (total: ${allItems.length})`);
    } catch (err: any) {
      log(`  Page ${p} error: ${err.message}`);
    }
  }

  log(`  ${typeName}: ${allItems.length} total items from ${totalPages} pages`);
  return allItems;
}

async function main() {
  console.log('='.repeat(50));
  console.log('  GAA CLASSIC CARS LOCAL CRAWLER');
  console.log('='.repeat(50));

  const client = await pool.connect();
  await client.query('SET statement_timeout = 60000');

  let totalCreated = 0;
  let totalUpdated = 0;

  // Crawl both inventory and results
  const inventoryItems = await crawlType(INVENTORY_URL, 'inventory');
  const resultsItems = await crawlType(RESULTS_URL, 'results');
  const allItems = [...inventoryItems, ...resultsItems];

  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueItems = allItems.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });

  log(`Total unique items: ${uniqueItems.length}`);

  // Batch insert/update
  const BATCH = 50;
  for (let i = 0; i < uniqueItems.length; i += BATCH) {
    const batch = uniqueItems.slice(i, i + BATCH);
    const urls = batch.map(b => b.url);

    // Check existing
    const existing = await client.query(
      'SELECT id, discovery_url FROM vehicles WHERE discovery_url = ANY($1)',
      [urls]
    );
    const existingMap = new Map<string, string>();
    for (const row of existing.rows) existingMap.set(row.discovery_url, row.id);

    // Insert new items
    const newItems = batch.filter(b => !existingMap.has(b.url));
    if (newItems.length > 0) {
      const values: any[] = [];
      const placeholders: string[] = [];
      for (let j = 0; j < newItems.length; j++) {
        const item = newItems[j];
        const offset = j * 12;
        placeholders.push(`($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10},$${offset+11},$${offset+12})`);

        const title = [item.year, item.make, item.model].filter(Boolean).join(' ');
        const status = item.sold ? 'sold' : item.notSold ? 'not_sold' : 'available';
        const metadata = JSON.stringify({
          source: 'gaa_local_crawl',
          gaa_vehicle_id: item.gaaId,
          lot_number: item.lotNumber,
          auction_date: item.auctionDate,
          highest_bid: item.highestBid,
          imported_at: new Date().toISOString(),
        });

        values.push(
          title.slice(0, 200) || null,
          item.year,
          item.make?.toLowerCase() || null,
          item.model?.toLowerCase() || null,
          item.vin?.toUpperCase() || null,
          item.salePrice,
          item.url,
          item.url,
          'gaa_classic_cars',
          status,
          true,
          metadata,
        );
      }

      try {
        await client.query(
          `INSERT INTO vehicles (title, year, make, model, vin, sale_price, listing_url, discovery_url, discovery_source, sale_status, is_public, origin_metadata)
           VALUES ${placeholders.join(',')}`,
          values
        );
        totalCreated += newItems.length;
      } catch (err: any) {
        log(`Batch insert error: ${err.message?.slice(0, 100)}`);
      }
    }

    // Update existing items with sale price if we have it
    for (const item of batch) {
      const vid = existingMap.get(item.url);
      if (vid && item.salePrice) {
        try {
          await client.query(
            `UPDATE vehicles SET sale_price=$1, sale_status=$2, updated_at=NOW() WHERE id=$3 AND sale_price IS NULL`,
            [item.salePrice, item.sold ? 'sold' : 'active', vid]
          );
          totalUpdated++;
        } catch {}
      }
    }

    if ((i + BATCH) % 200 === 0) {
      log(`Progress: ${Math.min(i + BATCH, uniqueItems.length)}/${uniqueItems.length} (created=${totalCreated}, updated=${totalUpdated})`);
    }
  }

  client.release();
  await pool.end();

  console.log('\n' + '='.repeat(50));
  console.log('  GAA CRAWL COMPLETE');
  console.log('='.repeat(50));
  console.log(`Total items: ${uniqueItems.length}`);
  console.log(`  Created: ${totalCreated}`);
  console.log(`  Updated: ${totalUpdated}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
