#!/usr/bin/env node
/**
 * Batch Mecum Extraction Script
 * Extracts vehicles from Mecum auction catalogs at scale
 * 
 * Usage:
 *   node scripts/batch-extract-mecum.js --auction FL26 --limit 500
 *   node scripts/batch-extract-mecum.js --auction all --limit 100
 */

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

// Mecum 2026 Auction Codes
const MECUM_AUCTIONS = {
  'FL26': { name: 'Kissimmee 2026', dates: 'Jan 6-18, 2026', slug: 'kissimmee-2026' },
  'LV26': { name: 'Las Vegas Motorcycles 2026', dates: 'Jan 27-31, 2026', slug: 'las-vegas-motorcycles-2026' },
  'AZ26': { name: 'Glendale 2026', dates: 'Mar 17-21, 2026', slug: 'glendale-2026' },
  'TX26': { name: 'Houston 2026', dates: 'Apr 9-11, 2026', slug: 'houston-2026' },
  'IN26': { name: 'Indianapolis 2026', dates: 'May 8-16, 2026', slug: 'indy-2026' },
  'TU26': { name: 'Tulsa 2026', dates: 'Jun 5-6, 2026', slug: 'tulsa-2026' },
  'PA26': { name: 'Harrisburg 2026', dates: 'Jul 22-25, 2026', slug: 'harrisburg-2026' },
  'CA26': { name: 'Monterey 2026', dates: 'Aug 13-15, 2026', slug: 'monterey-2026' },
  'DFW26': { name: 'Dallas/Fort Worth 2026', dates: 'Oct 21-24, 2026', slug: 'dallas-fort-worth-2026' },
  'LV26B': { name: 'Las Vegas 2026', dates: 'Nov 12-14, 2026', slug: 'las-vegas-2026' },
  'KC26': { name: 'Kansas City 2026', dates: 'Dec 3-5, 2026', slug: 'kansas-city-2026' },
};

// Traditional auction houses to also support
const TRADITIONAL_AUCTIONS = {
  'barrett-jackson': 'https://www.barrett-jackson.com',
  'bonhams': 'https://www.bonhams.com/departments/MOT-CAR/',
  'rm-sothebys': 'https://rmsothebys.com',
  'gooding': 'https://www.goodingco.com',
};

async function extractAuction(auctionCode, limit = 50, delay = 2000) {
  const auction = MECUM_AUCTIONS[auctionCode];
  if (!auction) {
    console.error(`Unknown auction code: ${auctionCode}`);
    console.log('Available auctions:', Object.keys(MECUM_AUCTIONS).join(', '));
    return { error: 'Unknown auction code' };
  }

  const catalogUrl = `https://www.mecum.com/auctions/${auction.slug}/lots/`;
  console.log(`\n🚗 Extracting: ${auction.name}`);
  console.log(`   Dates: ${auction.dates}`);
  console.log(`   Catalog: ${catalogUrl}`);
  console.log(`   Limit: ${limit} vehicles\n`);

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-premium-auction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        url: catalogUrl,
        max_listings: limit,
      }),
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ Extraction initiated for ${auction.name}`);
      console.log(`   Response:`, JSON.stringify(data, null, 2).slice(0, 500));
      return { success: true, auction: auction.name, data };
    } else {
      console.error(`❌ Extraction failed for ${auction.name}:`, data);
      return { success: false, auction: auction.name, error: data };
    }
  } catch (error) {
    console.error(`❌ Network error for ${auction.name}:`, error.message);
    return { success: false, auction: auction.name, error: error.message };
  }
}

async function extractAllAuctions(limitPerAuction = 50, delayBetween = 5000) {
  const results = [];
  const auctionCodes = Object.keys(MECUM_AUCTIONS);
  
  console.log(`\n🏁 Starting batch extraction of ${auctionCodes.length} Mecum auctions`);
  console.log(`   Limit per auction: ${limitPerAuction}`);
  console.log(`   Delay between auctions: ${delayBetween}ms\n`);

  for (const code of auctionCodes) {
    const result = await extractAuction(code, limitPerAuction);
    results.push(result);
    
    // Wait between auctions to avoid rate limiting
    if (delayBetween > 0) {
      console.log(`   ⏳ Waiting ${delayBetween}ms before next auction...`);
      await new Promise(r => setTimeout(r, delayBetween));
    }
  }

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n📊 Extraction Summary:`);
  console.log(`   ✅ Successful: ${successful}/${results.length}`);
  console.log(`   ❌ Failed: ${failed}/${results.length}`);
  
  return results;
}

async function getExtractionStats() {
  // This would query the database for current stats
  // For now, just log a placeholder
  console.log('\n📈 Current Mecum extraction stats would go here');
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    auction: 'FL26',  // Default to Kissimmee
    limit: 100,
    delay: 5000,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--auction' || args[i] === '-a') {
      options.auction = args[i + 1];
      i++;
    } else if (args[i] === '--limit' || args[i] === '-l') {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--delay' || args[i] === '-d') {
      options.delay = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Mecum Batch Extraction Script

Usage:
  node scripts/batch-extract-mecum.js [options]

Options:
  --auction, -a   Auction code (e.g., FL26, IN26) or "all" for all auctions
  --limit, -l     Max vehicles per auction (default: 100)
  --delay, -d     Delay between auctions in ms (default: 5000)
  --help, -h      Show this help

Available Auctions:`);
      for (const [code, info] of Object.entries(MECUM_AUCTIONS)) {
        console.log(`  ${code.padEnd(8)} ${info.name.padEnd(30)} ${info.dates}`);
      }
      process.exit(0);
    }
  }

  return options;
}

// Main execution
async function main() {
  const options = parseArgs();
  
  console.log('🔧 Mecum Batch Extraction Tool');
  console.log('================================\n');

  if (options.auction === 'all') {
    await extractAllAuctions(options.limit, options.delay);
  } else {
    await extractAuction(options.auction, options.limit);
  }

  await getExtractionStats();
}

main().catch(console.error);

