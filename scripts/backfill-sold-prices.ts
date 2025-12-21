/**
 * Backfill Sold Prices Script
 * 
 * Finds vehicles that are missing sold price data and helps record them.
 * This script identifies vehicles that:
 * - Are marked as sold but missing sale_price
 * - Have sale_date but no sale_price
 * - Have bat_sold_price but no sale_price
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface VehicleMissingPrice {
  id: string;
  year: number | null;
  make: string;
  model: string;
  sale_status: string | null;
  sale_price: number | null;
  sale_date: string | null;
  bat_sold_price: number | null;
  bat_sale_date: string | null;
  bat_auction_url: string | null;
  asking_price: number | null;
  current_value: number | null;
}

async function findVehiclesMissingSoldPrice(): Promise<VehicleMissingPrice[]> {
  console.log('🔍 Finding vehicles missing sold price data...\n');

  // Find vehicles marked as sold but missing sale_price
  const { data: soldMissingPrice, error: error1 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_status, sale_price, sale_date, bat_sold_price, bat_sale_date, bat_auction_url, asking_price, current_value')
    .eq('sale_status', 'sold')
    .or('sale_price.is.null,sale_price.eq.0');

  if (error1) {
    console.error('Error fetching sold vehicles:', error1);
  }

  // Find vehicles with sale_date but no sale_price
  const { data: hasDateNoPrice, error: error2 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_status, sale_price, sale_date, bat_sold_price, bat_sale_date, bat_auction_url, asking_price, current_value')
    .not('sale_date', 'is', null)
    .or('sale_price.is.null,sale_price.eq.0');

  if (error2) {
    console.error('Error fetching vehicles with sale_date:', error2);
  }

  // Find vehicles with bat_sold_price but no sale_price
  const { data: hasBatPriceNoSalePrice, error: error3 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_status, sale_price, sale_date, bat_sold_price, bat_sale_date, bat_auction_url, asking_price, current_value')
    .not('bat_sold_price', 'is', null)
    .or('sale_price.is.null,sale_price.eq.0');

  if (error3) {
    console.error('Error fetching vehicles with bat_sold_price:', error3);
  }

  // Combine and deduplicate
  const all = [
    ...(soldMissingPrice || []),
    ...(hasDateNoPrice || []),
    ...(hasBatPriceNoSalePrice || [])
  ];

  // Deduplicate by id
  const unique = Array.from(
    new Map(all.map(v => [v.id, v])).values()
  );

  return unique;
}

/**
 * Scrape BaT listing for sold price
 */
async function scrapeBaTPrice(batUrl: string): Promise<{ price: number | null; saleDate: string | null }> {
  try {
    console.log(`  📡 Scraping BaT: ${batUrl}`);
    
    const response = await fetch(batUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // Extract price from title tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : '';

    // Extract price from title: "sold for $11,000"
    const priceMatch = title.match(/\$([\d,]+)/);
    const dateMatch = title.match(/(\w+ \d+, \d{4})/);

    // Try to find price in page content - more comprehensive patterns
    let pagePrice = null;
    const pricePatterns = [
      /sold for \$([\d,]+)/i,
      /final bid: \$([\d,]+)/i,
      /high bid.*?\$([\d,]+)/i,
      /reserve not met.*?\$([\d,]+)/i,
      /reserve met.*?\$([\d,]+)/i,
      /\$([\d,]+)\s*(?:was|is|final|sold)/i,
      /USD\s*\$([\d,]+)/i,
    ];

    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match) {
        pagePrice = match[1].replace(/,/g, '');
        break;
      }
    }

    // Also check for JSON data in the page (BAT_VMS or similar)
    const batVmsMatch = html.match(/var BAT_VMS = ({[^;]+});/);
    if (batVmsMatch) {
      try {
        const batData = JSON.parse(batVmsMatch[1]);
        // Look for highest bid in comments
        if (batData.comments && Array.isArray(batData.comments)) {
          let maxBid = 0;
          for (const comment of batData.comments) {
            if (comment.type === 'bat-bid' && comment.bidAmount && comment.bidAmount > maxBid) {
              maxBid = comment.bidAmount;
            }
            // Also check for "Reserve not met" comments with prices
            if (comment.content && comment.content.match(/reserve not met.*?\$([\d,]+)/i)) {
              const reserveMatch = comment.content.match(/\$([\d,]+)/);
              if (reserveMatch) {
                const reservePrice = parseInt(reserveMatch[1].replace(/,/g, ''));
                if (reservePrice > maxBid) maxBid = reservePrice;
              }
            }
          }
          if (maxBid > 0 && (!pagePrice || maxBid > parseInt(pagePrice))) {
            pagePrice = maxBid.toString();
          }
        }
      } catch (e) {
        // JSON parse failed, ignore
      }
    }

    // Check for seller comments mentioning sale price (e.g., "sold for $68K")
    const sellerCommentMatch = html.match(/sold for \$?([\d,]+)K/i);
    if (sellerCommentMatch) {
      const kPrice = parseInt(sellerCommentMatch[1].replace(/,/g, '')) * 1000;
      if (!pagePrice || kPrice > parseInt(pagePrice)) {
        pagePrice = kPrice.toString();
      }
    }

    const priceFromTitle = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
    const price = priceFromTitle || (pagePrice ? parseInt(pagePrice) : null);
    
    // Parse date from title
    let saleDate: string | null = null;
    if (dateMatch) {
      try {
        const date = new Date(dateMatch[1]);
        saleDate = date.toISOString().split('T')[0]; // YYYY-MM-DD format
      } catch (e) {
        // Date parsing failed, ignore
      }
    }

    return { price, saleDate };
  } catch (error: any) {
    console.error(`  ❌ Scrape error: ${error.message}`);
    return { price: null, saleDate: null };
  }
}

async function backfillSoldPrice(
  vehicle: VehicleMissingPrice,
  scrapeBat: boolean = true
): Promise<{ success: boolean; error?: string; source?: string }> {
  try {
    let salePrice: number | null = null;
    let saleDate: string | null = null;
    let source = 'backfill_script';

    // Priority 1: Use bat_sold_price if already in database
    if (vehicle.bat_sold_price) {
      salePrice = vehicle.bat_sold_price;
      saleDate = vehicle.bat_sale_date || vehicle.sale_date || null;
      source = 'bat_import';
    }
    // Priority 2: Scrape BaT URL if available
    else if (scrapeBat && vehicle.bat_auction_url) {
      const scraped = await scrapeBaTPrice(vehicle.bat_auction_url);
      if (scraped.price) {
        salePrice = scraped.price;
        saleDate = scraped.saleDate || vehicle.sale_date || null;
        source = 'bat_scraped';
      }
    }
    // Priority 3: Use asking_price if vehicle was for sale
    if (!salePrice && vehicle.asking_price && vehicle.asking_price > 0) {
      salePrice = vehicle.asking_price;
      saleDate = vehicle.sale_date || null;
      source = 'estimated_from_asking';
    }
    // Priority 4: Use current_value as fallback
    if (!salePrice && vehicle.current_value && vehicle.current_value > 0) {
      salePrice = vehicle.current_value;
      saleDate = vehicle.sale_date || null;
      source = 'estimated_from_value';
    }

    if (!salePrice || salePrice <= 0) {
      return {
        success: false,
        error: 'No price data available to backfill'
      };
    }

    // Update vehicle
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({
        sale_price: salePrice,
        sale_date: saleDate,
        sale_status: 'sold',
        updated_at: new Date().toISOString()
      })
      .eq('id', vehicle.id);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    // The database trigger will automatically log this to vehicle_price_history
    // But we can also manually add an entry with metadata
    await supabase
      .from('vehicle_price_history')
      .insert({
        vehicle_id: vehicle.id,
        price_type: 'sale',
        value: salePrice,
        source: source,
        as_of: saleDate || new Date().toISOString(),
        notes: `Backfilled from ${source}`,
        confidence: source === 'bat_import' ? 100 : 70,
        is_estimate: source !== 'bat_import'
      });

    return { success: true, source: source };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('🚀 Starting sold price backfill...\n');

  const vehicles = await findVehiclesMissingSoldPrice();

  if (vehicles.length === 0) {
    console.log('✅ No vehicles missing sold price data!');
    return;
  }

  console.log(`Found ${vehicles.length} vehicles missing sold price data:\n`);

  // Group by data availability
  const withBatPrice = vehicles.filter(v => v.bat_sold_price);
  const withBatUrl = vehicles.filter(v => v.bat_auction_url && !v.bat_sold_price);
  const withoutBatData = vehicles.filter(v => !v.bat_sold_price && !v.bat_auction_url);

  console.log(`  - ${withBatPrice.length} have bat_sold_price (can auto-backfill immediately)`);
  console.log(`  - ${withBatUrl.length} have bat_auction_url (can scrape for price)`);
  console.log(`  - ${withoutBatData.length} need manual entry (no BaT data)\n`);

  // Show first 10 vehicles
  console.log('First 10 vehicles:');
  vehicles.slice(0, 10).forEach((v, i) => {
    console.log(`  ${i + 1}. ${v.year || '?'} ${v.make} ${v.model}`);
    console.log(`     ID: ${v.id}`);
    console.log(`     sale_status: ${v.sale_status || 'null'}`);
    console.log(`     sale_date: ${v.sale_date || 'null'}`);
    console.log(`     bat_sold_price: ${v.bat_sold_price || 'null'}`);
    console.log(`     asking_price: ${v.asking_price || 'null'}`);
    console.log('');
  });

  // Ask if user wants to proceed with auto-backfill
  if (withBatPrice.length > 0) {
    console.log(`\n💡 ${withBatPrice.length} vehicles can be auto-backfilled using bat_sold_price.`);
    console.log('   Run with --auto flag to automatically backfill these vehicles.\n');
  }

  // If --auto flag, backfill vehicles
  if (process.argv.includes('--auto')) {
    console.log('🔄 Auto-backfilling vehicles...\n');

    let successCount = 0;
    let errorCount = 0;

    // First, backfill vehicles with bat_sold_price (fast, no scraping needed)
    for (const vehicle of withBatPrice) {
      const result = await backfillSoldPrice(vehicle, false); // Don't scrape, use existing data
      if (result.success) {
        successCount++;
        console.log(`✅ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: $${vehicle.bat_sold_price} (from bat_sold_price)`);
      } else {
        errorCount++;
        console.error(`❌ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: ${result.error}`);
      }
    }

    // Then, try scraping BaT URLs for vehicles without bat_sold_price
    const withBatUrl = vehicles.filter(v => v.bat_auction_url && !v.bat_sold_price);
    console.log(`\n📡 Scraping ${withBatUrl.length} BaT URLs for sold prices...\n`);

    // Process all vehicles, not just 20
    const batchSize = 20;
    const totalBatches = Math.ceil(withBatUrl.length / batchSize);
    
    for (let batch = 0; batch < totalBatches; batch++) {
      const batchVehicles = withBatUrl.slice(batch * batchSize, (batch + 1) * batchSize);
      console.log(`\n📦 Processing batch ${batch + 1}/${totalBatches} (${batchVehicles.length} vehicles)...\n`);
      
      for (const vehicle of batchVehicles) {
        const result = await backfillSoldPrice(vehicle, true); // Scrape BaT
        if (result.success) {
          successCount++;
          const sourceLabel = result.source === 'bat_scraped' ? 'scraped' : result.source || 'found';
          console.log(`✅ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: ${sourceLabel}`);
        } else {
          errorCount++;
          console.error(`❌ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: ${result.error}`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`\n📊 Batch ${batch + 1} Results: ${successCount} succeeded, ${errorCount} failed`);
      
      // Small delay between batches
      if (batch < totalBatches - 1) {
        console.log('⏳ Waiting 5 seconds before next batch...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  
    console.log(`\n✅ Final Results: ${successCount} succeeded, ${errorCount} failed`);
    console.log(`💡 Processed ${withBatUrl.length} vehicles total`);
  }
}

main().catch(console.error);

