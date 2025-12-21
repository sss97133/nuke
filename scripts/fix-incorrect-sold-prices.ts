/**
 * Fix Incorrect Sold Prices
 * 
 * Finds vehicles with suspiciously low prices (likely data errors)
 * and scrapes BaT URLs to get the correct prices.
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

interface PriceFix {
  vehicleId: string;
  year: number | null;
  make: string;
  model: string;
  currentPrice: number;
  correctPrice: number | null;
  batUrl: string | null;
  success: boolean;
  error?: string;
}

/**
 * Scrape BaT listing for sold price
 */
async function scrapeBaTPrice(batUrl: string): Promise<{ price: number | null; saleDate: string | null }> {
  try {
    console.log(`  📡 Scraping: ${batUrl}`);
    
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

    // Try to find price in page content
    let pagePrice = null;
    const pricePatterns = [
      /sold for \$([\d,]+)/i,
      /final bid: \$([\d,]+)/i,
      /\$([\d,]+)\s*(?:was|is|final)/i,
    ];

    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match) {
        pagePrice = match[1].replace(/,/g, '');
        break;
      }
    }

    // Also check for "Reserve not met" or "Sold for $X" in comments/JSON
    const batVmsMatch = html.match(/var BAT_VMS = ({[^;]+});/);
    if (batVmsMatch) {
      try {
        const batData = JSON.parse(batVmsMatch[1]);
        // Look for sold price in comments
        if (batData.comments) {
          for (const comment of batData.comments) {
            if (comment.type === 'bat-bid' && comment.bidAmount) {
              pagePrice = Math.max(pagePrice || 0, comment.bidAmount);
            }
          }
        }
      } catch (e) {
        // JSON parse failed, ignore
      }
    }

    // Check for seller comment mentioning sale price (e.g., "sold for $68K")
    const sellerCommentMatch = html.match(/sold for \$?([\d,]+)K/i);
    if (sellerCommentMatch) {
      const kPrice = parseInt(sellerCommentMatch[1].replace(/,/g, '')) * 1000;
      if (kPrice > (pagePrice || 0)) {
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

/**
 * Find vehicles with suspiciously low prices
 */
async function findSuspiciousPrices(): Promise<Array<{
  vehicle_id: string;
  year: number | null;
  make: string;
  model: string;
  sale_price: number;
  bat_auction_url: string | null;
  external_listing_id: string | null;
  external_final_price: number | null;
}>> {
  console.log('🔍 Finding vehicles with suspiciously low prices...\n');

  // Find vehicles with sale_price < 1000 (likely wrong)
  // Focus on prices 10-999 which are likely missing zeros
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_price, bat_auction_url')
    .not('sale_price', 'is', null)
    .lt('sale_price', 1000)
    .gte('sale_price', 10)  // Focus on prices that might be missing zeros
    .not('make', 'is', null)
    .neq('make', 'Bring a Trailer')
    .neq('make', 'Bring');  // Exclude non-vehicles

  if (vehiclesError) {
    console.error('Error fetching vehicles:', vehiclesError);
    return [];
  }

  // Also check external_listings
  const { data: listings, error: listingsError } = await supabase
    .from('external_listings')
    .select('vehicle_id, final_price, listing_url')
    .not('final_price', 'is', null)
    .lt('final_price', 1000)
    .gt('final_price', 0)
    .eq('listing_status', 'sold');

  if (listingsError) {
    console.error('Error fetching external_listings:', listingsError);
  }

  // Combine and deduplicate
  const suspicious: Map<string, any> = new Map();

  for (const vehicle of (vehicles || [])) {
    if (!suspicious.has(vehicle.id)) {
      suspicious.set(vehicle.id, {
        vehicle_id: vehicle.id,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        sale_price: vehicle.sale_price,
        bat_auction_url: vehicle.bat_auction_url,
        external_listing_id: null,
        external_final_price: null
      });
    }
  }

  for (const listing of (listings || [])) {
    if (!listing.vehicle_id) continue;
    
    if (suspicious.has(listing.vehicle_id)) {
      suspicious.get(listing.vehicle_id).external_final_price = listing.final_price;
      suspicious.get(listing.vehicle_id).external_listing_id = listing.id;
    } else {
      // Get vehicle info
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('id, year, make, model, sale_price, bat_auction_url')
        .eq('id', listing.vehicle_id)
        .single();

      if (vehicle) {
        suspicious.set(listing.vehicle_id, {
          vehicle_id: listing.vehicle_id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          sale_price: vehicle.sale_price,
          bat_auction_url: vehicle.bat_auction_url || listing.listing_url,
          external_listing_id: listing.id,
          external_final_price: listing.final_price
        });
      }
    }
  }

  return Array.from(suspicious.values());
}

/**
 * Fix price for a vehicle
 */
async function fixPrice(vehicle: any): Promise<PriceFix> {
  const result: PriceFix = {
    vehicleId: vehicle.vehicle_id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    currentPrice: vehicle.sale_price || vehicle.external_final_price || 0,
    correctPrice: null,
    batUrl: vehicle.bat_auction_url,
    success: false
  };

  if (!vehicle.bat_auction_url) {
    result.error = 'No BaT URL available';
    return result;
  }

  // Scrape BaT for correct price
  const scraped = await scrapeBaTPrice(vehicle.bat_auction_url);
  
  if (!scraped.price || scraped.price <= 0) {
    result.error = 'Could not extract price from BaT';
    return result;
  }

  result.correctPrice = scraped.price;

  // Only update if the scraped price is significantly different (at least 10x)
  // This catches cases like 68 -> 68000
  if (scraped.price < result.currentPrice * 10) {
    // But also check if current price is suspiciously low and scraped is reasonable
    // (e.g., current is 68, scraped is 68000)
    if (result.currentPrice < 1000 && scraped.price >= 10000) {
      // This looks like a missing zeros case - proceed
    } else {
      result.error = `Scraped price (${scraped.price}) is not significantly higher than current (${result.currentPrice})`;
      return result;
    }
  }

  try {
    // Update vehicle
    const { error: vehicleError } = await supabase
      .from('vehicles')
      .update({
        sale_price: scraped.price,
        sale_date: scraped.saleDate || vehicle.sale_date,
        sale_status: 'sold',
        updated_at: new Date().toISOString()
      })
      .eq('id', vehicle.vehicle_id);

    if (vehicleError) {
      result.error = vehicleError.message;
      return result;
    }

    // Update external_listing if it exists
    if (vehicle.external_listing_id) {
      await supabase
        .from('external_listings')
        .update({
          final_price: scraped.price,
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicle.external_listing_id);
    }

    result.success = true;
  } catch (error: any) {
    result.error = error.message;
  }

  return result;
}

async function main() {
  console.log('🚀 Starting price fix process...\n');

  const suspicious = await findSuspiciousPrices();

  if (suspicious.length === 0) {
    console.log('✅ No suspicious prices found!');
    return;
  }

  console.log(`Found ${suspicious.length} vehicles with suspiciously low prices:\n`);

  // Show first 10
  suspicious.slice(0, 10).forEach((v, i) => {
    console.log(`  ${i + 1}. ${v.year || '?'} ${v.make} ${v.model}: $${v.sale_price || v.external_final_price}`);
    console.log(`     URL: ${v.bat_auction_url || 'N/A'}\n`);
  });

  if (suspicious.length > 10) {
    console.log(`  ... and ${suspicious.length - 10} more\n`);
  }

  console.log('🔧 Fixing prices by scraping BaT URLs...\n');

  const results: PriceFix[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (const vehicle of suspicious) {
    const result = await fixPrice(vehicle);
    results.push(result);

    if (result.success) {
      successCount++;
      console.log(`✅ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: $${result.currentPrice} → $${result.correctPrice?.toLocaleString()}`);
    } else {
      errorCount++;
      console.error(`❌ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: ${result.error}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n📊 Results: ${successCount} fixed, ${errorCount} failed`);
  
  // Show summary
  if (successCount > 0) {
    console.log('\n✅ Successfully fixed:');
    results.filter(r => r.success).forEach(r => {
      console.log(`  - ${r.year || '?'} ${r.make} ${r.model}: $${r.currentPrice} → $${r.correctPrice?.toLocaleString()}`);
    });
  }
}

main().catch(console.error);

