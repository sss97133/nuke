/**
 * MASSIVE EXTRACTION RUN
 *
 * Goals:
 * - Craigslist: 1962-1999 vehicles across major regions
 * - All auction sites: Scale up to thousands of vehicles
 * - Data quality: Audit and fix as we go
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Craigslist regions to search
const CRAIGSLIST_REGIONS = [
  'sfbay', 'losangeles', 'phoenix', 'dallas', 'houston', 'denver',
  'seattle', 'portland', 'chicago', 'atlanta', 'miami', 'boston',
  'detroit', 'minneapolis', 'sandiego', 'sacramento', 'orangecounty',
  'austin', 'nashville', 'raleigh', 'tampa', 'philadelphia',
  'lasvegas', 'saltlakecity', 'albuquerque', 'tucson'
];

// Year range focus: 1962-1999
const MIN_YEAR = 1962;
const MAX_YEAR = 1999;

// Search strategies for classic vehicles
const SEARCH_TERMS = [
  // Generic classics
  '', // Empty = just year filter
  'classic',
  'vintage',
  'muscle',
  'restored',
  'project',
  'barn find',
  // Popular makes
  'porsche',
  'ferrari',
  'corvette',
  'mustang',
  'camaro',
  'chevelle',
  'gto',
  'cuda',
  'challenger',
  'charger',
  '911',
  'datsun',
  'bmw',
  'mercedes',
  'jaguar',
  'bronco',
  'k5',
  'c10',
  'squarebody',
];

interface ExtractionStats {
  regionsSearched: number;
  searchesPerformed: number;
  listingsFound: number;
  vehiclesSaved: number;
  skipped: number;
  errors: number;
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function extractCraigslistListing(url: string): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<span[^>]*id="titletextonly"[^>]*>([^<]+)</i) ||
                       html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch?.[1]?.trim() || '';

    // Parse year
    const yearMatch = title.match(/\b(19[6-9]\d|199\d)\b/) ||
                      html.match(/\b(19[6-9]\d|199\d)\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    if (!year || year < MIN_YEAR || year > MAX_YEAR) return null;

    // Parse make
    const makes = [
      'Porsche', 'Ferrari', 'Lamborghini', 'Mercedes', 'BMW', 'Audi',
      'Chevrolet', 'Chevy', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac',
      'Jaguar', 'Aston Martin', 'Bentley', 'Maserati', 'Alfa Romeo',
      'Toyota', 'Nissan', 'Honda', 'Mazda', 'Datsun',
      'Jeep', 'Land Rover', 'McLaren', 'Lotus', 'MG', 'Triumph',
      'Volkswagen', 'VW', 'Volvo', 'Fiat',
      'Lincoln', 'Mercury', 'Oldsmobile', 'AMC', 'International'
    ];

    let make: string | null = null;
    for (const m of makes) {
      if (title.toLowerCase().includes(m.toLowerCase())) {
        make = m === 'Chevy' ? 'Chevrolet' : m === 'VW' ? 'Volkswagen' : m;
        break;
      }
    }

    if (!make) return null;

    // Extract price
    const priceMatch = html.match(/\$\s*([\d,]+)/);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;

    // Extract location
    const locationMatch = html.match(/<small>\s*\(([^)]+)\)/);
    const location = locationMatch?.[1]?.trim() || null;

    // Extract mileage
    const bodyMatch = html.match(/<section[^>]*id="postingbody"[^>]*>([\s\S]*?)<\/section>/i);
    const body = bodyMatch?.[1]?.replace(/<[^>]+>/g, ' ') || '';
    const mileageMatch = body.match(/([\d,]+)\s*(?:miles|mi\b|k\s*miles)/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;

    // Extract VIN
    const vinMatch = body.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i) ||
                     html.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
    const vin = vinMatch?.[1] || null;

    // Extract model from title
    const afterMake = title.split(new RegExp(make, 'i'))[1];
    const model = afterMake
      ? afterMake.replace(/^\s*[-:]\s*/, '').trim().split(/\s+/).slice(0, 3).join(' ')
      : null;

    // Extract images
    const imageMatches = html.match(/https:\/\/images\.craigslist\.org\/[^"'\s]+/g);
    const images = imageMatches ? [...new Set(imageMatches)].slice(0, 20) : [];

    return {
      year,
      make,
      model: model || 'Unknown',
      price,
      vin,
      mileage,
      location,
      listing_url: url,
      discovery_url: url,
      seller_type: 'private',
      images,
      listing_title: title,
    };
  } catch (err) {
    return null;
  }
}

async function searchCraigslistRegion(region: string, term: string, stats: ExtractionStats): Promise<void> {
  const queryParam = term ? `query=${encodeURIComponent(term)}&` : '';
  const url = `https://${region}.craigslist.org/search/cta?${queryParam}min_auto_year=${MIN_YEAR}&max_auto_year=${MAX_YEAR}&sort=date`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      stats.errors++;
      return;
    }

    const html = await response.text();
    stats.searchesPerformed++;

    // Extract listing URLs
    const listingMatches = html.match(/href="(https:\/\/[^"]+\.craigslist\.org\/[^"]+\/d\/[^"]+\.html)"/g);
    if (!listingMatches) return;

    const listingUrls = [...new Set(
      listingMatches
        .map(m => m.match(/href="([^"]+)"/)?.[1])
        .filter(Boolean)
    )] as string[];

    stats.listingsFound += listingUrls.length;

    // Check which we already have
    const { data: existing } = await supabase
      .from('vehicles')
      .select('listing_url')
      .in('listing_url', listingUrls.slice(0, 50));

    const existingUrls = new Set((existing || []).map((e: any) => e.listing_url));

    // Process new listings
    for (const listingUrl of listingUrls) {
      if (existingUrls.has(listingUrl)) {
        stats.skipped++;
        continue;
      }

      const vehicle = await extractCraigslistListing(listingUrl);
      if (!vehicle) continue;

      // Save to database
      const { error } = await supabase.from('vehicles').insert({
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        price: vehicle.price,
        vin: vehicle.vin,
        mileage: vehicle.mileage,
        location: vehicle.location,
        listing_url: vehicle.listing_url,
        discovery_url: vehicle.discovery_url,
        seller_type: vehicle.seller_type,
        listing_title: vehicle.listing_title,
        auction_source: 'Craigslist',
      });

      if (!error) {
        stats.vehiclesSaved++;
        console.log(`  ✓ ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      } else if (!error.message.includes('duplicate')) {
        stats.errors++;
      }

      // Rate limit individual fetches
      await delay(500);
    }

  } catch (err: any) {
    stats.errors++;
    console.log(`  Error: ${err.message}`);
  }
}

async function runCraigslistExtraction(): Promise<ExtractionStats> {
  console.log('\n' + '='.repeat(60));
  console.log('CRAIGSLIST EXTRACTION: 1962-1999 VEHICLES');
  console.log('='.repeat(60));

  const stats: ExtractionStats = {
    regionsSearched: 0,
    searchesPerformed: 0,
    listingsFound: 0,
    vehiclesSaved: 0,
    skipped: 0,
    errors: 0,
  };

  for (const region of CRAIGSLIST_REGIONS) {
    console.log(`\n📍 Region: ${region}`);
    stats.regionsSearched++;

    for (const term of SEARCH_TERMS.slice(0, 10)) { // First 10 terms per region
      console.log(`  🔍 "${term || 'all'}"`);
      await searchCraigslistRegion(region, term, stats);
      await delay(2000); // Rate limit between searches
    }

    // Progress report
    console.log(`\n  Progress: ${stats.vehiclesSaved} saved, ${stats.listingsFound} found`);

    await delay(3000); // Rate limit between regions
  }

  return stats;
}

async function runAuctionExtraction(): Promise<ExtractionStats> {
  console.log('\n' + '='.repeat(60));
  console.log('AUCTION EXTRACTION: ALL PLATFORMS');
  console.log('='.repeat(60));

  const stats: ExtractionStats = {
    regionsSearched: 0,
    searchesPerformed: 0,
    listingsFound: 0,
    vehiclesSaved: 0,
    skipped: 0,
    errors: 0,
  };

  // Call the ralph-wiggum-extract edge function
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  console.log('Invoking ralph-wiggum-extract with run_loop action...');

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/ralph-wiggum-extract`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'run_loop',
        max_extractions: 10, // 10 rounds of extraction
      }),
    });

    const result = await response.json();
    console.log('Ralph Wiggum result:', JSON.stringify(result, null, 2));

    if (result.summary) {
      stats.vehiclesSaved = result.summary.vehicles_extracted || 0;
    }
  } catch (err: any) {
    console.log(`Ralph Wiggum error: ${err.message}`);
    stats.errors++;
  }

  // Also invoke Craigslist squarebodies
  console.log('\nInvoking Craigslist squarebodies extraction...');

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/ralph-wiggum-extract`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'extract_craigslist',
      }),
    });

    const result = await response.json();
    console.log('Craigslist squarebodies result:', JSON.stringify(result, null, 2));

    if (result.summary) {
      stats.vehiclesSaved += result.summary.vehicles_saved || 0;
      stats.listingsFound += result.summary.listings_found || 0;
    }
  } catch (err: any) {
    console.log(`Craigslist squarebodies error: ${err.message}`);
    stats.errors++;
  }

  // Also invoke Hemmings extraction
  console.log('\nInvoking Hemmings extraction...');

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/ralph-wiggum-extract`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'extract_hemmings',
      }),
    });

    const result = await response.json();
    console.log('Hemmings result:', JSON.stringify(result, null, 2));

    if (result.summary) {
      stats.vehiclesSaved += result.summary.vehicles_saved || 0;
      stats.listingsFound += result.summary.listings_found || 0;
    }
  } catch (err: any) {
    console.log(`Hemmings error: ${err.message}`);
    stats.errors++;
  }

  return stats;
}

async function runDataQualityAudit() {
  console.log('\n' + '='.repeat(60));
  console.log('DATA QUALITY AUDIT');
  console.log('='.repeat(60));

  // Count vehicles by source
  const { data: sourceCounts } = await supabase
    .from('vehicles')
    .select('auction_source')
    .not('auction_source', 'is', null);

  const counts: Record<string, number> = {};
  for (const v of sourceCounts || []) {
    counts[v.auction_source] = (counts[v.auction_source] || 0) + 1;
  }

  console.log('\nVehicles by source:');
  for (const [source, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`);
  }

  // Count vehicles with Unknown make/model
  const { count: unknownCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .or('make.eq.Unknown,model.eq.Unknown');

  console.log(`\nVehicles with Unknown make/model: ${unknownCount}`);

  // Count vehicles missing price
  const { count: noPriceCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .is('price', null);

  console.log(`Vehicles missing price: ${noPriceCount}`);

  // Count vehicles missing VIN
  const { count: noVinCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .is('vin', null);

  console.log(`Vehicles missing VIN: ${noVinCount}`);

  // Count total vehicles
  const { count: totalCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTOTAL VEHICLES: ${totalCount}`);

  // Count vehicles in target year range (1962-1999)
  const { count: targetRangeCount } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .gte('year', 1962)
    .lte('year', 1999);

  console.log(`Vehicles in 1962-1999 range: ${targetRangeCount}`);
}

async function main() {
  console.log('🚀 MASSIVE EXTRACTION RUN STARTING');
  console.log(`Time: ${new Date().toISOString()}`);

  // Run Craigslist extraction
  const clStats = await runCraigslistExtraction();
  console.log('\n📊 Craigslist Results:');
  console.log(`  Regions searched: ${clStats.regionsSearched}`);
  console.log(`  Searches performed: ${clStats.searchesPerformed}`);
  console.log(`  Listings found: ${clStats.listingsFound}`);
  console.log(`  Vehicles saved: ${clStats.vehiclesSaved}`);
  console.log(`  Skipped: ${clStats.skipped}`);
  console.log(`  Errors: ${clStats.errors}`);

  // Run auction extraction (via edge functions)
  const auctionStats = await runAuctionExtraction();
  console.log('\n📊 Auction Results:');
  console.log(`  Vehicles saved: ${auctionStats.vehiclesSaved}`);
  console.log(`  Listings found: ${auctionStats.listingsFound}`);
  console.log(`  Errors: ${auctionStats.errors}`);

  // Run data quality audit
  await runDataQualityAudit();

  console.log('\n✅ MASSIVE EXTRACTION RUN COMPLETE');
  console.log(`Time: ${new Date().toISOString()}`);
}

main().catch(console.error);
