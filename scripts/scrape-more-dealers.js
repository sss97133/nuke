#!/usr/bin/env node

/**
 * Scrape additional dealers from CLASSIC.COM's directory
 */

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

// More dealers from CLASSIC.COM that likely have squarebodies
const DEALERS = [
  // Truck-focused dealers
  { name: 'Classic Trucks', url: 'https://www.classictrucks.com/' },
  { name: 'Truck Craft', url: 'https://www.truckcraft.com/' },
  { name: 'Texas Trucks & Classics', url: 'https://www.texastrucksandclassics.com/' },
  { name: 'Classic Parts of America', url: 'https://www.classicparts.com/' },
  
  // Large classic car dealers
  { name: 'Restore A Muscle Car', url: 'https://www.restoreamusclecar.com/' },
  { name: 'RK Motors Charlotte', url: 'https://www.rkmotorscharlotte.com/' },
  { name: 'Worldwide Vintage Autos', url: 'https://www.worldwidevintageautos.com/' },
  { name: 'Classic Car Deals', url: 'https://www.classiccardeals.com/' },
  { name: 'Motorcar Classics', url: 'https://www.motorcarclassics.com/' },
  { name: 'Grand Touring Automobiles', url: 'https://www.grandtouringautomobiles.com/' },
  
  // Regional dealers
  { name: 'Arizona Classic Car Sales', url: 'https://www.arizonaclassiccarsales.com/' },
  { name: 'California Classic Cars', url: 'https://www.californiaclassiccars.com/' },
  { name: 'Texas Classic Cars', url: 'https://www.texasclassiccars.com/' },
  { name: 'Florida Classic Cars', url: 'https://www.floridaclassiccars.com/' },
  
  // Auction aggregators
  { name: 'Cars On Line', url: 'https://www.carsonline.com/search/chevrolet/c10' },
  { name: 'Old Car Online', url: 'https://www.oldcaronline.com/chevrolet/c10' },
  { name: 'Collector Car Network', url: 'https://www.collectorcarnetwork.com/' },
  
  // More Classic.com dealers
  { name: 'Russo and Steele', url: 'https://www.russoandsteele.com/' },
  { name: 'Mecum Auctions', url: 'https://www.mecum.com/lots/chevrolet/c10/' },
  { name: 'Barrett-Jackson', url: 'https://www.barrett-jackson.com/Events/Event/Lots/chevrolet' },
  
  // Specialty dealers
  { name: 'C10 Builders Guide', url: 'https://www.c10buildersguide.com/' },
  { name: 'LMC Truck', url: 'https://www.lmctruck.com/' },
  { name: 'Brothers Trucks', url: 'https://www.brotherstrucks.com/' },
  { name: 'Classic Industries', url: 'https://www.classicindustries.com/' }
];

let stats = {
  scraped: 0,
  failed: 0,
  listings_found: 0,
  listings_queued: 0,
  orgs_created: 0
};

async function scrapeDealer(dealer) {
  console.log(`[${stats.scraped + stats.failed + 1}/${DEALERS.length}] ${dealer.name}`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/scrape-multi-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        source_url: dealer.url,
        source_type: 'dealer',
        extract_listings: true,
        extract_dealer_info: true,
        use_llm_extraction: true,
        max_listings: 100
      })
    });

    const result = await response.json();
    
    if (result.success) {
      stats.scraped++;
      stats.listings_found += result.listings_found || 0;
      stats.listings_queued += result.listings_queued || 0;
      if (result.organization_id) stats.orgs_created++;
      
      console.log(`  OK: ${result.listings_found} found, ${result.listings_queued} queued`);
      if (result.dealer_info?.name) {
        console.log(`  Org: ${result.dealer_info.name}`);
      }
    } else {
      stats.failed++;
      console.log(`  FAIL: ${result.error?.substring(0, 80)}`);
    }
  } catch (error) {
    stats.failed++;
    console.log(`  ERROR: ${error.message?.substring(0, 80)}`);
  }
}

async function main() {
  console.log('='.repeat(50));
  console.log('ADDITIONAL DEALERS SCRAPER');
  console.log(`Targeting ${DEALERS.length} dealers`);
  console.log('='.repeat(50));
  console.log('');

  for (const dealer of DEALERS) {
    await scrapeDealer(dealer);
    // 5 second delay to avoid rate limits
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('\n' + '='.repeat(50));
  console.log('FINAL STATS:');
  console.log('='.repeat(50));
  console.log(`Dealers scraped: ${stats.scraped}`);
  console.log(`Dealers failed: ${stats.failed}`);
  console.log(`Listings found: ${stats.listings_found}`);
  console.log(`Listings queued: ${stats.listings_queued}`);
  console.log(`Organizations created: ${stats.orgs_created}`);
}

main().catch(console.error);

