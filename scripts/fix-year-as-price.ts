/**
 * Fix Year-as-Price Bug
 * 
 * Fixes vehicles where sale_price was incorrectly set to the year value.
 * Attempts to scrape BaT URLs for correct prices, otherwise sets sale_price to NULL.
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

interface FixResult {
  vehicleId: string;
  year: number | null;
  make: string;
  model: string;
  oldPrice: number;
  newPrice: number | null;
  batUrl: string | null;
  success: boolean;
  method: 'scraped' | 'nulled' | 'error';
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
    const priceMatch = title.match(/sold for \$([\d,]+)/i);
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
 * Fix a single vehicle
 */
async function fixVehicle(vehicle: {
  id: string;
  year: number | null;
  make: string;
  model: string;
  sale_price: number;
  bat_auction_url: string | null;
}): Promise<FixResult> {
  const result: FixResult = {
    vehicleId: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    oldPrice: vehicle.sale_price,
    newPrice: null,
    batUrl: vehicle.bat_auction_url,
    success: false,
    method: 'error'
  };

  // Try to scrape BaT URL if available
  if (vehicle.bat_auction_url) {
    const scraped = await scrapeBaTPrice(vehicle.bat_auction_url);
    
    if (scraped.price && scraped.price > 1000) { // Only use if reasonable price
      result.newPrice = scraped.price;
      result.method = 'scraped';
      
      try {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            sale_price: scraped.price,
            sale_date: scraped.saleDate || null,
            sale_status: scraped.price ? 'sold' : 'available',
            updated_at: new Date().toISOString()
          })
          .eq('id', vehicle.id);

        if (updateError) {
          result.error = updateError.message;
          return result;
        }

        result.success = true;
        return result;
      } catch (error: any) {
        result.error = error.message;
        return result;
      }
    }
  }

  // If scraping failed or no BaT URL, set sale_price to NULL
  result.method = 'nulled';
  result.newPrice = null;
  
  try {
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({
        sale_price: null,
        sale_status: 'available',
        updated_at: new Date().toISOString()
      })
      .eq('id', vehicle.id);

    if (updateError) {
      result.error = updateError.message;
      return result;
    }

    result.success = true;
    return result;
  } catch (error: any) {
    result.error = error.message;
    return result;
  }
}

async function main() {
  console.log('🚀 Starting year-as-price fix...\n');

  // Find all vehicles where sale_price = year
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_price, bat_auction_url')
    .not('sale_price', 'is', null)
    .not('year', 'is', null)
    .lt('sale_price', 10000) // Only check reasonable years
    .gte('sale_price', 1900); // Only check reasonable years

  if (error) {
    console.error('Error fetching vehicles:', error);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles with year-as-price issue found!');
    return;
  }

  // Filter to only those where sale_price exactly equals year
  const affected = vehicles.filter(v => v.sale_price === v.year);

  if (affected.length === 0) {
    console.log('✅ No vehicles with sale_price = year found!');
    return;
  }

  console.log(`Found ${affected.length} vehicles with sale_price = year:\n`);

  // Show first 10
  affected.slice(0, 10).forEach((v, i) => {
    console.log(`  ${i + 1}. ${v.year || '?'} ${v.make} ${v.model}: $${v.sale_price} (should be NULL or real price)`);
    console.log(`     URL: ${v.bat_auction_url || 'N/A'}\n`);
  });

  if (affected.length > 10) {
    console.log(`  ... and ${affected.length - 10} more\n`);
  }

  console.log('🔧 Fixing prices...\n');

  const results: FixResult[] = [];
  let scrapedCount = 0;
  let nulledCount = 0;
  let errorCount = 0;

  for (const vehicle of affected) {
    const result = await fixVehicle(vehicle);
    results.push(result);

    if (result.success) {
      if (result.method === 'scraped') {
        scrapedCount++;
        console.log(`✅ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: $${result.oldPrice} → $${result.newPrice?.toLocaleString()} (scraped from BaT)`);
      } else {
        nulledCount++;
        console.log(`✅ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: $${result.oldPrice} → NULL (no BaT URL or scrape failed)`);
      }
    } else {
      errorCount++;
      console.error(`❌ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: ${result.error}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n📊 Results:`);
  console.log(`  - Scraped from BaT: ${scrapedCount}`);
  console.log(`  - Set to NULL: ${nulledCount}`);
  console.log(`  - Errors: ${errorCount}`);
  console.log(`  - Total: ${affected.length}`);
}

main().catch(console.error);

