/**
 * Map Unmapped Sold Prices
 * 
 * Finds sold price data in unmapped sources and maps it to vehicles.sale_price:
 * 
 * 1. external_listings.final_price → vehicles.sale_price
 * 2. vehicles.sold_price → vehicles.sale_price (if different field)
 * 3. vehicles.winning_bid → vehicles.sale_price
 * 4. vehicles.high_bid → vehicles.sale_price (if vehicle is sold)
 * 5. vehicles.price → vehicles.sale_price (if vehicle is sold)
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

interface MappingResult {
  source: string;
  vehicleId: string;
  year: number | null;
  make: string;
  model: string;
  mappedPrice: number;
  mappedDate: string | null;
  success: boolean;
  error?: string;
}

/**
 * Map final_price from external_listings to vehicles.sale_price
 */
async function mapExternalListings(): Promise<MappingResult[]> {
  console.log('🔍 Mapping external_listings.final_price → vehicles.sale_price...\n');

  const { data: listings, error } = await supabase
    .from('external_listings')
    .select(`
      vehicle_id,
      final_price,
      sold_at,
      listing_status
    `)
    .eq('listing_status', 'sold')
    .not('final_price', 'is', null);

  if (error) {
    console.error('Error fetching external_listings:', error);
    return [];
  }

  // Get vehicle data separately
  const vehicleIds = [...new Set((listings || []).map(l => l.vehicle_id).filter(Boolean))];
  
  if (vehicleIds.length === 0) {
    return [];
  }

  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_price, sale_date')
    .in('id', vehicleIds)
    .or('sale_price.is.null,sale_price.eq.0');

  if (vehiclesError) {
    console.error('Error fetching vehicles:', vehiclesError);
    return [];
  }

  const vehicleMap = new Map((vehicles || []).map(v => [v.id, v]));

  if (error) {
    console.error('Error fetching external_listings:', error);
    return [];
  }

  const results: MappingResult[] = [];

  for (const listing of (listings || [])) {
    if (!listing.vehicle_id) continue;
    
    const vehicle = vehicleMap.get(listing.vehicle_id);
    if (!vehicle) continue;

    const finalPrice = listing.final_price;
    if (!finalPrice || finalPrice <= 0) continue;

    // Validate price - flag suspiciously low prices (likely data errors)
    // Prices under $1000 for vehicles are almost certainly wrong
    // Also check if price might be missing zeros (e.g., 68 instead of 68000)
    if (finalPrice < 1000) {
      console.warn(`  ⚠️  Suspiciously low price for ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: $${finalPrice}`);
      console.warn(`     Listing URL: ${listing.listing_url || 'N/A'}`);
      
      // Check if it might be missing zeros (common data entry error)
      // If price is between 10-999, it might be missing "000" suffix
      if (finalPrice >= 10 && finalPrice <= 999) {
        const possiblePrice = finalPrice * 1000;
        console.warn(`     Possible correct price: $${possiblePrice.toLocaleString()} (${finalPrice} * 1000)`);
        console.warn(`     ⚠️  SKIPPING - needs manual verification to confirm\n`);
      } else {
        console.warn(`     Skipping - needs manual verification\n`);
      }
      continue;
    }

    // Skip if vehicle already has a sale_price
    if (vehicle.sale_price && vehicle.sale_price > 0) continue;

    try {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({
          sale_price: finalPrice,
          sale_date: listing.sold_at ? new Date(listing.sold_at).toISOString().split('T')[0] : vehicle.sale_date,
          sale_status: 'sold',
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicle.id);

      if (updateError) {
        results.push({
          source: 'external_listings',
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mappedPrice: finalPrice,
          mappedDate: listing.sold_at ? new Date(listing.sold_at).toISOString().split('T')[0] : null,
          success: false,
          error: updateError.message
        });
      } else {
        results.push({
          source: 'external_listings',
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mappedPrice: finalPrice,
          mappedDate: listing.sold_at ? new Date(listing.sold_at).toISOString().split('T')[0] : null,
          success: true
        });
      }
    } catch (error: any) {
      results.push({
        source: 'external_listings',
        vehicleId: vehicle.id,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        mappedPrice: finalPrice,
        mappedDate: null,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Map unmapped price fields from vehicles table
 */
async function mapVehiclePriceFields(): Promise<MappingResult[]> {
  console.log('🔍 Mapping vehicles price fields (sold_price, winning_bid, high_bid, price)...\n');

  // Find vehicles with sold_price but no sale_price
  const { data: withSoldPrice, error: error1 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sold_price, sale_price, sale_date, sale_status')
    .not('sold_price', 'is', null)
    .or('sale_price.is.null,sale_price.eq.0');

  // Find vehicles with winning_bid but no sale_price (if sold)
  const { data: withWinningBid, error: error2 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, winning_bid, sale_price, sale_date, sale_status')
    .not('winning_bid', 'is', null)
    .eq('sale_status', 'sold')
    .or('sale_price.is.null,sale_price.eq.0');

  // Find vehicles with high_bid but no sale_price (if sold)
  const { data: withHighBid, error: error3 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, high_bid, sale_price, sale_date, sale_status')
    .not('high_bid', 'is', null)
    .eq('sale_status', 'sold')
    .or('sale_price.is.null,sale_price.eq.0');

  // Find vehicles with price but no sale_price (if sold)
  const { data: withPrice, error: error4 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, price, sale_price, sale_date, sale_status')
    .not('price', 'is', null)
    .eq('sale_status', 'sold')
    .or('sale_price.is.null,sale_price.eq.0');

  const results: MappingResult[] = [];

  // Map sold_price
  for (const vehicle of (withSoldPrice || [])) {
    if (vehicle.sold_price && vehicle.sold_price > 0) {
      try {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            sale_price: vehicle.sold_price,
            sale_status: 'sold',
            updated_at: new Date().toISOString()
          })
          .eq('id', vehicle.id);

        results.push({
          source: 'vehicles.sold_price',
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mappedPrice: vehicle.sold_price,
          mappedDate: vehicle.sale_date,
          success: !updateError,
          error: updateError?.message
        });
      } catch (error: any) {
        results.push({
          source: 'vehicles.sold_price',
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mappedPrice: vehicle.sold_price,
          mappedDate: vehicle.sale_date,
          success: false,
          error: error.message
        });
      }
    }
  }

  // Map winning_bid
  for (const vehicle of (withWinningBid || [])) {
    if (vehicle.winning_bid && vehicle.winning_bid > 0) {
      try {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            sale_price: vehicle.winning_bid,
            sale_status: 'sold',
            updated_at: new Date().toISOString()
          })
          .eq('id', vehicle.id);

        results.push({
          source: 'vehicles.winning_bid',
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mappedPrice: vehicle.winning_bid,
          mappedDate: vehicle.sale_date,
          success: !updateError,
          error: updateError?.message
        });
      } catch (error: any) {
        results.push({
          source: 'vehicles.winning_bid',
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mappedPrice: vehicle.winning_bid,
          mappedDate: vehicle.sale_date,
          success: false,
          error: error.message
        });
      }
    }
  }

  // Map high_bid
  for (const vehicle of (withHighBid || [])) {
    if (vehicle.high_bid && vehicle.high_bid > 0) {
      try {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            sale_price: vehicle.high_bid,
            sale_status: 'sold',
            updated_at: new Date().toISOString()
          })
          .eq('id', vehicle.id);

        results.push({
          source: 'vehicles.high_bid',
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mappedPrice: vehicle.high_bid,
          mappedDate: vehicle.sale_date,
          success: !updateError,
          error: updateError?.message
        });
      } catch (error: any) {
        results.push({
          source: 'vehicles.high_bid',
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mappedPrice: vehicle.high_bid,
          mappedDate: vehicle.sale_date,
          success: false,
          error: error.message
        });
      }
    }
  }

  // Map price
  for (const vehicle of (withPrice || [])) {
    if (vehicle.price && vehicle.price > 0) {
      try {
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            sale_price: vehicle.price,
            sale_status: 'sold',
            updated_at: new Date().toISOString()
          })
          .eq('id', vehicle.id);

        results.push({
          source: 'vehicles.price',
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mappedPrice: vehicle.price,
          mappedDate: vehicle.sale_date,
          success: !updateError,
          error: updateError?.message
        });
      } catch (error: any) {
        results.push({
          source: 'vehicles.price',
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          mappedPrice: vehicle.price,
          mappedDate: vehicle.sale_date,
          success: false,
          error: error.message
        });
      }
    }
  }

  return results;
}

async function main() {
  console.log('🚀 Starting unmapped sold price mapping...\n');

  const allResults: MappingResult[] = [];

  // Map external_listings
  const externalResults = await mapExternalListings();
  allResults.push(...externalResults);

  // Map vehicle price fields
  const vehicleResults = await mapVehiclePriceFields();
  allResults.push(...vehicleResults);

  // Summary
  console.log('\n📊 Mapping Summary:\n');
  console.log(`Total mappings attempted: ${allResults.length}`);
  
  const successful = allResults.filter(r => r.success);
  const failed = allResults.filter(r => !r.success);

  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}\n`);

  // Group by source
  const bySource = allResults.reduce((acc, r) => {
    if (!acc[r.source]) acc[r.source] = { success: 0, failed: 0 };
    if (r.success) acc[r.source].success++;
    else acc[r.source].failed++;
    return acc;
  }, {} as Record<string, { success: number; failed: number }>);

  console.log('By source:');
  for (const [source, counts] of Object.entries(bySource)) {
    console.log(`  ${source}: ${counts.success} succeeded, ${counts.failed} failed`);
  }

  // Show first 10 successful mappings
  if (successful.length > 0) {
    console.log('\n✅ First 10 successful mappings:');
    successful.slice(0, 10).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.year || '?'} ${r.make} ${r.model}: $${r.mappedPrice.toLocaleString()} (from ${r.source})`);
    });
  }

  // Show failures
  if (failed.length > 0) {
    console.log('\n❌ Failures:');
    failed.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.year || '?'} ${r.make} ${r.model}: ${r.error}`);
    });
  }
}

main().catch(console.error);

