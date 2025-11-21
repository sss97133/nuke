/**
 * Fix missing BAT seller/buyer info for vehicles that have bat_auction_url
 * but are missing this data in origin_metadata
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function scrapeBATListing(batUrl) {
  try {
    console.log(`\n🔍 Scraping: ${batUrl}`);
    
    const response = await fetch(batUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    const bodyText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    
    // Extract seller
    const sellerPatterns = [
      /Sold\s+by\s+([A-Za-z0-9\s&]+?)(?:\s+on|\s+for|$)/i,
      /by\s+([A-Za-z0-9\s&]+?)\s+on\s+Bring\s+a\s+Trailer/i,
      /Consignor[:\s]+([A-Za-z0-9\s&]+)/i,
      /Seller[:\s]+([A-Za-z0-9\s&]+)/i
    ];
    
    let seller = null;
    for (const pattern of sellerPatterns) {
      const match = bodyText.match(pattern);
      if (match && match[1]) {
        seller = match[1].trim();
        break;
      }
    }
    
    // Extract buyer
    const buyerPatterns = [
      /Sold\s+to\s+([A-Za-z0-9\s&]+?)\s+for/i,
      /won\s+by\s+([A-Za-z0-9\s&]+?)(?:\s+for|$)/i,
      /Buyer[:\s]+([A-Za-z0-9\s&]+)/i,
      /Purchased\s+by\s+([A-Za-z0-9\s&]+)/i
    ];
    
    let buyer = null;
    for (const pattern of buyerPatterns) {
      const match = bodyText.match(pattern);
      if (match && match[1]) {
        buyer = match[1].trim();
        break;
      }
    }
    
    // Extract sale price
    const priceMatch = bodyText.match(/Sold\s+for\s+(?:USD\s+)?\$?([\d,]+)/i);
    const salePrice = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
    
    // Extract sale date
    const dateMatch = bodyText.match(/Sold\s+on\s+([^<]+)/i);
    const saleDate = dateMatch ? dateMatch[1].trim() : null;
    
    return { seller, buyer, salePrice, saleDate };
  } catch (error) {
    console.error(`  ❌ Error scraping: ${error.message}`);
    return { seller: null, buyer: null, salePrice: null, saleDate: null };
  }
}

async function fixVehicleBATInfo(vehicleId, batUrl) {
  console.log(`\n📋 Vehicle: ${vehicleId}`);
  console.log(`   BAT URL: ${batUrl}`);
  
  // Get current vehicle data
  const { data: vehicle, error: fetchError } = await supabase
    .from('vehicles')
    .select('origin_metadata, profile_origin')
    .eq('id', vehicleId)
    .single();
  
  if (fetchError) {
    console.error(`  ❌ Error fetching vehicle: ${fetchError.message}`);
    return false;
  }
  
  const currentMetadata = vehicle.origin_metadata || {};
  const needsSeller = !currentMetadata.bat_seller;
  const needsBuyer = !currentMetadata.bat_buyer;
  
  if (!needsSeller && !needsBuyer) {
    console.log(`  ✓ Already has seller and buyer info`);
    return true;
  }
  
  console.log(`   Missing: ${needsSeller ? 'seller' : ''} ${needsBuyer ? 'buyer' : ''}`);
  
  // Scrape BAT listing
  const scraped = await scrapeBATListing(batUrl);
  
  if (!scraped.seller && !scraped.buyer) {
    console.log(`  ⚠️  Could not extract seller/buyer from listing`);
    return false;
  }
  
  // Update origin_metadata
  const updatedMetadata = {
    ...currentMetadata,
    ...(scraped.seller && { bat_seller: scraped.seller }),
    ...(scraped.buyer && { bat_buyer: scraped.buyer }),
    ...(scraped.salePrice && { bat_sale_price: scraped.salePrice }),
    ...(scraped.saleDate && { bat_sale_date: scraped.saleDate }),
    bat_scraped_at: new Date().toISOString()
  };
  
  const { error: updateError } = await supabase
    .from('vehicles')
    .update({ origin_metadata: updatedMetadata })
    .eq('id', vehicleId);
  
  if (updateError) {
    console.error(`  ❌ Error updating: ${updateError.message}`);
    return false;
  }
  
  console.log(`  ✅ Updated:`);
  if (scraped.seller) console.log(`     Seller: ${scraped.seller}`);
  if (scraped.buyer) console.log(`     Buyer: ${scraped.buyer}`);
  if (scraped.salePrice) console.log(`     Sale Price: $${scraped.salePrice.toLocaleString()}`);
  
  return true;
}

async function main() {
  console.log('🔧 Fixing missing BAT seller/buyer info...\n');
  
  // Get vehicles with bat_auction_url but missing seller/buyer in metadata
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, bat_auction_url, origin_metadata, profile_origin')
    .not('bat_auction_url', 'is', null)
    .or('profile_origin.eq.bat_import,profile_origin.eq.manual_entry');
  
  if (error) {
    console.error('Error fetching vehicles:', error);
    process.exit(1);
  }
  
  console.log(`Found ${vehicles.length} vehicles with BAT URLs\n`);
  
  let fixed = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const vehicle of vehicles) {
    const metadata = vehicle.origin_metadata || {};
    const hasSeller = metadata.bat_seller;
    const hasBuyer = metadata.bat_buyer;
    
    if (hasSeller && hasBuyer) {
      skipped++;
      continue;
    }
    
    const success = await fixVehicleBATInfo(vehicle.id, vehicle.bat_auction_url);
    if (success) {
      fixed++;
    } else {
      failed++;
    }
    
    // Rate limiting - wait 1 second between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Skipped (already complete): ${skipped}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total: ${vehicles.length}`);
}

main().catch(console.error);

