#!/usr/bin/env npx tsx
/**
 * Mecum Algolia Direct Extractor
 *
 * Queries Mecum's Algolia search API directly to get auction results.
 * No browser needed - much faster and more reliable.
 *
 * Usage:
 *   npx tsx scripts/mecum-algolia-extract.ts --auction "Kissimmee 2024"
 *   npx tsx scripts/mecum-algolia-extract.ts --list-auctions
 *   npx tsx scripts/mecum-algolia-extract.ts --all --limit 1000
 */

const ALGOLIA_URL = "https://u6cfcq7v52-dsn.algolia.net/1/indexes/*/queries" +
  "?x-algolia-api-key=0291c46cde807bcb428a021a96138fcb" +
  "&x-algolia-application-id=U6CFCQ7V52";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Mecum buyer's premium: 10% on hammer price
function calculateBuyersPremium(hammerPrice: number): number {
  return Math.round(hammerPrice * 0.10);
}

interface AlgoliaHit {
  post_id: number;
  post_title: string;
  permalink: string;
  lot_number_meta?: string;
  hammer_price_meta?: number;
  highest_bid_or_price?: number;
  sold?: number;
  bid_goes_on?: number;
  color_meta?: string;
  interior_meta?: string;
  engine_configuration_meta?: string;
  transmission_type_meta?: string;
  images_meta?: { url: string }[];
  taxonomies?: {
    auction_tax?: { name: string; slug: string }[];
    make?: { name: string }[];
    model?: { name: string }[];
    lot_year?: { name: string }[];
    sale_result?: { name: string }[];
  };
}

interface ExtractedResult {
  title: string;
  url: string;
  lotNumber: string;
  year: number | null;
  make: string | null;
  model: string | null;
  hammerPrice: number;
  totalPrice: number;
  status: 'sold' | 'bid_goes_on' | 'unsold';
  auction: string;
  exteriorColor: string | null;
  interiorColor: string | null;
  engine: string | null;
  transmission: string | null;
  imageUrl: string | null;
}

async function queryAlgolia(auctionName: string, page: number = 0, hitsPerPage: number = 1000): Promise<{ hits: AlgoliaHit[], total: number }> {
  const payload = {
    requests: [{
      indexName: "wp_posts_lot_feature_sort_asc",
      facetFilters: [[`taxonomies.auction_tax.name:${auctionName}`]],
      hitsPerPage,
      page,
      attributesToRetrieve: [
        "post_id", "post_title", "permalink",
        "lot_number_meta", "hammer_price_meta", "highest_bid_or_price",
        "sold", "bid_goes_on",
        "color_meta", "interior_meta", "engine_configuration_meta", "transmission_type_meta",
        "images_meta", "taxonomies"
      ]
    }]
  };

  const res = await fetch(ALGOLIA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  return {
    hits: data.results?.[0]?.hits || [],
    total: data.results?.[0]?.nbHits || 0
  };
}

async function listAuctions(): Promise<{ name: string; count: number }[]> {
  const payload = {
    requests: [{
      indexName: "wp_posts_lot_feature_sort_asc",
      facets: ["taxonomies.auction_tax.name"],
      hitsPerPage: 0,
      maxValuesPerFacet: 200
    }]
  };

  const res = await fetch(ALGOLIA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  const facets = data.results?.[0]?.facets?.["taxonomies.auction_tax.name"] || {};

  return Object.entries(facets)
    .map(([name, count]) => ({ name, count: count as number }))
    .sort((a, b) => b.count - a.count);
}

function parseHit(hit: AlgoliaHit): ExtractedResult | null {
  const hammerPrice = hit.hammer_price_meta || hit.highest_bid_or_price || 0;
  if (hammerPrice === 0) return null;

  let status: 'sold' | 'bid_goes_on' | 'unsold' = 'unsold';
  if (hit.sold === 1) status = 'sold';
  else if (hit.bid_goes_on === 1) status = 'bid_goes_on';

  // Parse year from taxonomy or title
  let year: number | null = null;
  const yearTax = hit.taxonomies?.lot_year?.[0]?.name;
  if (yearTax) {
    year = parseInt(yearTax);
  } else {
    const yearMatch = hit.post_title.match(/^(\d{4})\s/);
    if (yearMatch) year = parseInt(yearMatch[1]);
  }

  return {
    title: hit.post_title,
    url: `https://www.mecum.com${hit.permalink}`,
    lotNumber: hit.lot_number_meta || '',
    year,
    make: hit.taxonomies?.make?.[0]?.name || null,
    model: hit.taxonomies?.model?.[0]?.name || null,
    hammerPrice,
    totalPrice: hammerPrice + calculateBuyersPremium(hammerPrice),
    status,
    auction: hit.taxonomies?.auction_tax?.[0]?.slug || '',
    exteriorColor: hit.color_meta || null,
    interiorColor: hit.interior_meta || null,
    engine: hit.engine_configuration_meta || null,
    transmission: hit.transmission_type_meta || null,
    imageUrl: hit.images_meta?.[0]?.url || null,
  };
}

async function extractAuction(auctionName: string, limit?: number): Promise<ExtractedResult[]> {
  console.log(`\nExtracting: ${auctionName}`);

  const results: ExtractedResult[] = [];
  let page = 0;
  const hitsPerPage = 1000;

  while (true) {
    const { hits, total } = await queryAlgolia(auctionName, page, hitsPerPage);

    if (page === 0) {
      console.log(`  Total lots: ${total}`);
    }

    for (const hit of hits) {
      const parsed = parseHit(hit);
      if (parsed) {
        results.push(parsed);
        if (limit && results.length >= limit) break;
      }
    }

    if (hits.length < hitsPerPage || (limit && results.length >= limit)) break;
    page++;

    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  }

  const sold = results.filter(r => r.status === 'sold').length;
  const bidGoesOn = results.filter(r => r.status === 'bid_goes_on').length;
  console.log(`  Extracted: ${results.length} (${sold} sold, ${bidGoesOn} bid goes on)`);

  return results;
}

async function updateDatabase(results: ExtractedResult[]): Promise<{ matched: number; updated: number }> {
  let matched = 0;
  let updated = 0;

  for (const result of results) {
    if (result.status !== 'sold' || result.hammerPrice === 0) continue;

    // Find matching vehicle by URL
    const { data: vehicles } = await fetch(
      `${SUPABASE_URL}/rest/v1/vehicles?discovery_url=eq.${encodeURIComponent(result.url)}&select=id,sale_price`,
      { headers: { 'apikey': SUPABASE_KEY! } }
    ).then(r => r.json()).then(d => ({ data: d }));

    if (vehicles && vehicles.length > 0 && !vehicles[0].sale_price) {
      matched++;

      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicles[0].id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY!,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sale_price: result.totalPrice,
          sale_status: 'sold',
          origin_metadata: {
            hammer_price: result.hammerPrice,
            buyers_premium: result.totalPrice - result.hammerPrice,
            lot_number: result.lotNumber,
            auction: result.auction,
            extracted_from: 'algolia_api',
          },
          updated_at: new Date().toISOString(),
        }),
      });

      if (updateRes.ok) {
        updated++;
        console.log(`    ✓ ${result.title.slice(0, 40)} → $${result.totalPrice.toLocaleString()}`);
      }
    }
  }

  return { matched, updated };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list-auctions')) {
    console.log('═══════════════════════════════════════════════');
    console.log('  Mecum Auctions (from Algolia)');
    console.log('═══════════════════════════════════════════════\n');

    const auctions = await listAuctions();
    auctions.slice(0, 50).forEach(a => {
      console.log(`  ${a.name.split('|')[0].padEnd(45)} ${a.count.toLocaleString().padStart(6)}`);
    });
    return;
  }

  let auctionArg: string | null = null;
  let limit: number | undefined;
  let updateDb = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--auction' && args[i + 1]) {
      auctionArg = args[i + 1];
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
    } else if (args[i] === '--update-db') {
      updateDb = true;
    }
  }

  if (!auctionArg && !args.includes('--all')) {
    console.log('Usage:');
    console.log('  npx tsx scripts/mecum-algolia-extract.ts --list-auctions');
    console.log('  npx tsx scripts/mecum-algolia-extract.ts --auction "Kissimmee 2024"');
    console.log('  npx tsx scripts/mecum-algolia-extract.ts --auction "Kissimmee 2024" --update-db');
    console.log('  npx tsx scripts/mecum-algolia-extract.ts --all --limit 5000');
    return;
  }

  console.log('═══════════════════════════════════════════════');
  console.log('  Mecum Algolia Direct Extractor');
  console.log('═══════════════════════════════════════════════');

  const auctions = await listAuctions();
  let toProcess: string[] = [];

  if (args.includes('--all')) {
    // Get auction names that match the pattern (e.g., "Kissimmee 2024|...")
    toProcess = auctions
      .filter(a => /\d{4}\|/.test(a.name)) // Has year and timestamp separator
      .map(a => a.name)
      .slice(0, 50); // Top 50 auctions
  } else if (auctionArg) {
    // Find matching auction
    const match = auctions.find(a => a.name.toLowerCase().includes(auctionArg!.toLowerCase()));
    if (match) {
      toProcess = [match.name];
    } else {
      console.log(`\nAuction not found: ${auctionArg}`);
      console.log('Use --list-auctions to see available auctions');
      return;
    }
  }

  let totalExtracted = 0;
  let totalSold = 0;
  let totalUpdated = 0;

  for (const auctionName of toProcess) {
    const results = await extractAuction(auctionName, limit);
    totalExtracted += results.length;
    totalSold += results.filter(r => r.status === 'sold').length;

    if (updateDb && results.length > 0) {
      const { updated } = await updateDatabase(results);
      totalUpdated += updated;
    }

    // Output some results as JSON for verification
    if (toProcess.length === 1 && results.length > 0) {
      console.log('\nSample results:');
      results.slice(0, 5).forEach(r => {
        console.log(`  ${r.year || '????'} ${r.make || '???'} ${(r.model || '').slice(0, 20).padEnd(20)} $${r.hammerPrice.toLocaleString().padStart(10)} → $${r.totalPrice.toLocaleString().padStart(10)} (${r.status})`);
      });
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  Auctions processed: ${toProcess.length}`);
  console.log(`  Total with prices: ${totalExtracted}`);
  console.log(`  Total sold: ${totalSold}`);
  if (updateDb) {
    console.log(`  Database updated: ${totalUpdated}`);
  }
  console.log('═══════════════════════════════════════════════');
}

main().catch(console.error);
