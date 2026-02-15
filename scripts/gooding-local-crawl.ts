#!/usr/bin/env npx tsx
/**
 * Gooding & Company Local Crawler
 *
 * Fetches Gatsby page-data JSON locally (edge function can't reach goodingco.com).
 * Structured JSON — no HTML parsing needed.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/gooding-local-crawl.ts
 */

import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD!;
const DATABASE_URL = `postgresql://postgres.qkgaybvrernstplzjaam:${DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2, idleTimeoutMillis: 30000 });

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [GOODING] ${msg}`);
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function discoverLotUrls(): Promise<string[]> {
  log('Fetching sitemap...');
  const resp = await fetch('https://www.goodingco.com/sitemap.xml', { headers: HEADERS });
  if (!resp.ok) throw new Error(`Sitemap fetch failed: ${resp.status}`);
  const xml = await resp.text();

  const urls: string[] = [];
  const matches = xml.matchAll(/https:\/\/www\.goodingco\.com\/lot\/([^<\s]+)/g);
  for (const m of matches) urls.push(m[0]);
  log(`Found ${urls.length} lot URLs in sitemap`);
  return urls;
}

interface GoodingVehicle {
  url: string;
  slug: string;
  year: number | null;
  make: string | null;
  model: string | null;
  title: string | null;
  vin: string | null;
  chassis: string | null;
  coachwork: string | null;
  lotNumber: string | null;
  salePrice: number | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  auctionName: string | null;
  auctionDate: string | null;
  status: string;
  imageUrls: string[];
  highlights: string[];
}

function extractVin(text: string): string | null {
  if (!text) return null;
  const patterns = [
    /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/,
    /\b([JKLSTWY][A-HJ-NPR-Z0-9]{16})\b/,
    /\b(WP0[A-HJ-NPR-Z0-9]{14})\b/,
    /\b(WDB[A-HJ-NPR-Z0-9]{14})\b/,
    /\b(ZFF[A-HJ-NPR-Z0-9]{14})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

function buildCloudinaryUrl(publicId: string): string {
  return `https://res.cloudinary.com/gooding-company/image/upload/w_1800,c_limit,q_auto,f_auto/${publicId}`;
}

async function fetchLotData(url: string): Promise<GoodingVehicle | null> {
  const slug = url.split('/lot/')[1]?.split('/')[0]?.replace(/\/$/, '');
  if (!slug) return null;

  const pageDataUrl = `https://www.goodingco.com/page-data/lot/${slug}/page-data.json`;
  const resp = await fetch(pageDataUrl, { headers: HEADERS });
  if (!resp.ok) return null;

  const json = await resp.json();
  const data = json?.result?.data;
  if (!data) return null;

  const lot = data.contentfulLot;
  const item = data.contentfulLot?.item;
  const auction = data.contentfulLot?.auction;

  if (!item) return null;

  const year = item.modelYear || item.year || null;
  const make = typeof item.make === 'object' ? item.make?.name : item.make || null;
  const model = item.model || null;
  const title = item.title || [year, make, model].filter(Boolean).join(' ');

  // VIN extraction
  const searchText = [
    ...(item.highlights || []),
    ...(item.specifications || []),
    ...(item.notes?.notes || ''),
  ].join(' ');
  let vin = extractVin(searchText);

  const chassis = item.chassis || null;
  const coachwork = item.coachwork || null;

  // If no VIN, try chassis as VIN for modern cars
  if (!vin && chassis && chassis.length === 17) vin = chassis.toUpperCase();

  const lotNumber = lot?.lotNumber || null;
  const salePrice = lot?.salePrice || null;
  const estimateLow = lot?.estimateLow || null;
  const estimateHigh = lot?.estimateHigh || null;

  const auctionName = auction?.name || null;
  const auctionDate = auction?.date || null;

  // Status (must be in vehicles_sale_status_check: sold, unsold, available, upcoming, etc.)
  let status = 'available';
  if (salePrice && salePrice > 0) status = 'sold';
  else if (auctionDate) {
    const aDate = new Date(auctionDate);
    if (aDate < new Date()) status = 'unsold';
    else status = 'upcoming';
  }

  // Images from cloudinary
  const imageUrls: string[] = [];
  const seenPublicIds = new Set<string>();
  const imageArrays = [
    item.cloudinaryImagesCombined,
    item.cloudinaryImages1,
    item.cloudinaryImages2,
    item.cloudinaryImages3,
    item.cloudinaryImages4,
    item.cloudinaryImages5,
    item.cloudinaryImages6,
  ];
  for (const arr of imageArrays) {
    if (!Array.isArray(arr)) continue;
    for (const img of arr) {
      const pid = img?.public_id;
      if (pid && !seenPublicIds.has(pid)) {
        seenPublicIds.add(pid);
        imageUrls.push(buildCloudinaryUrl(pid));
      }
    }
  }

  // Highlights
  const highlights = (item.highlights || []).map((h: string) => stripHtml(h)).filter(Boolean);

  return {
    url, slug, year, make, model, title, vin, chassis, coachwork,
    lotNumber, salePrice, estimateLow, estimateHigh,
    auctionName, auctionDate, status, imageUrls, highlights,
  };
}

async function main() {
  console.log('='.repeat(50));
  console.log('  GOODING & COMPANY LOCAL CRAWLER');
  console.log('='.repeat(50));

  const lotUrls = await discoverLotUrls();

  const client = await pool.connect();
  await client.query('SET statement_timeout = 60000');

  // Check which URLs already exist
  log('Checking existing vehicles...');
  const existingRes = await client.query(
    `SELECT discovery_url FROM vehicles WHERE discovery_source = 'gooding'`
  );
  const existingUrls = new Set(existingRes.rows.map((r: any) => r.discovery_url));
  log(`Existing Gooding vehicles: ${existingUrls.size}`);

  // Filter to new URLs only
  const newUrls = lotUrls.filter(u => !existingUrls.has(u));
  log(`New URLs to process: ${newUrls.length}`);

  if (newUrls.length === 0) {
    log('All lot URLs already in database');
    client.release();
    await pool.end();
    return;
  }

  let created = 0;
  let failed = 0;

  for (let i = 0; i < newUrls.length; i++) {
    await new Promise(r => setTimeout(r, 200));

    try {
      const vehicle = await fetchLotData(newUrls[i]);
      if (!vehicle || (!vehicle.year && !vehicle.make)) {
        failed++;
        continue;
      }

      const titleStr = vehicle.title?.slice(0, 200) || `${vehicle.year} ${vehicle.make} ${vehicle.model}`.slice(0, 200);
      const metadata = JSON.stringify({
        source: 'gooding_local_crawl',
        lot_number: vehicle.lotNumber,
        auction_name: vehicle.auctionName,
        estimate_low: vehicle.estimateLow,
        estimate_high: vehicle.estimateHigh,
        chassis: vehicle.chassis,
        coachwork: vehicle.coachwork,
        highlights: vehicle.highlights?.slice(0, 5),
        imported_at: new Date().toISOString(),
      });

      const insertRes = await client.query(
        `INSERT INTO vehicles (title, year, make, model, vin, sale_price,
          listing_url, discovery_url, discovery_source, sale_status, is_public, origin_metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          titleStr, vehicle.year,
          typeof vehicle.make === 'string' ? vehicle.make.toLowerCase() : null,
          typeof vehicle.model === 'string' ? vehicle.model.toLowerCase() : null,
          vehicle.vin, vehicle.salePrice,
          vehicle.url, vehicle.url, 'gooding',
          vehicle.status, true, metadata,
        ]
      );

      const vehicleId = insertRes.rows[0].id;

      // Save images
      if (vehicle.imageUrls.length > 0) {
        const imgValues: any[] = [];
        const imgPlaceholders: string[] = [];
        const maxImages = Math.min(vehicle.imageUrls.length, 20);
        for (let j = 0; j < maxImages; j++) {
          const off = j * 4;
          imgPlaceholders.push(`($${off+1},$${off+2},$${off+3},$${off+4})`);
          imgValues.push(vehicleId, vehicle.imageUrls[j], j, 'gooding');
        }
        await client.query(
          `INSERT INTO vehicle_images (vehicle_id, image_url, position, source)
           VALUES ${imgPlaceholders.join(',')}
           ON CONFLICT DO NOTHING`,
          imgValues
        ).catch(() => {});
      }

      created++;
      if (created % 50 === 0) {
        log(`Progress: ${i + 1}/${newUrls.length} (created=${created})`);
      }
    } catch (err: any) {
      failed++;
      if (failed % 20 === 0) log(`Errors: ${failed} (latest: ${err.message?.slice(0, 80)})`);
    }
  }

  client.release();
  await pool.end();

  console.log('\n' + '='.repeat(50));
  console.log('  GOODING CRAWL COMPLETE');
  console.log('='.repeat(50));
  console.log(`Processed: ${newUrls.length}`);
  console.log(`  Created: ${created}`);
  console.log(`  Failed:  ${failed}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
