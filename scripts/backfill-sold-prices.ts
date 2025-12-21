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
    .is('sale_price', null);

  if (error1) {
    console.error('Error fetching sold vehicles:', error1);
  }

  // Find vehicles with sale_date but no sale_price
  const { data: hasDateNoPrice, error: error2 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_status, sale_price, sale_date, bat_sold_price, bat_sale_date, bat_auction_url, asking_price, current_value')
    .not('sale_date', 'is', null)
    .is('sale_price', null);

  if (error2) {
    console.error('Error fetching vehicles with sale_date:', error2);
  }

  // Find vehicles with bat_sold_price but no sale_price
  const { data: hasBatPriceNoSalePrice, error: error3 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_status, sale_price, sale_date, bat_sold_price, bat_sale_date, bat_auction_url, asking_price, current_value')
    .not('bat_sold_price', 'is', null)
    .is('sale_price', null);

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

async function backfillSoldPrice(
  vehicle: VehicleMissingPrice,
  useBatPrice: boolean = true
): Promise<{ success: boolean; error?: string }> {
  try {
    let salePrice: number | null = null;
    let saleDate: string | null = null;
    let source = 'backfill_script';

    // Priority 1: Use bat_sold_price if available
    if (useBatPrice && vehicle.bat_sold_price) {
      salePrice = vehicle.bat_sold_price;
      saleDate = vehicle.bat_sale_date || vehicle.sale_date || null;
      source = 'bat_import';
    }
    // Priority 2: Use asking_price if vehicle was for sale
    else if (vehicle.asking_price && vehicle.asking_price > 0) {
      salePrice = vehicle.asking_price;
      saleDate = vehicle.sale_date || null;
      source = 'estimated_from_asking';
    }
    // Priority 3: Use current_value as fallback
    else if (vehicle.current_value && vehicle.current_value > 0) {
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

    return { success: true };
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

  // Group by whether they have bat_sold_price
  const withBatPrice = vehicles.filter(v => v.bat_sold_price);
  const withoutBatPrice = vehicles.filter(v => !v.bat_sold_price);

  console.log(`  - ${withBatPrice.length} have bat_sold_price (can auto-backfill)`);
  console.log(`  - ${withoutBatPrice.length} need manual review\n`);

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

  // If --auto flag, backfill vehicles with bat_sold_price
  if (process.argv.includes('--auto')) {
    console.log('🔄 Auto-backfilling vehicles with bat_sold_price...\n');

    let successCount = 0;
    let errorCount = 0;

    for (const vehicle of withBatPrice) {
      const result = await backfillSoldPrice(vehicle, true);
      if (result.success) {
        successCount++;
        console.log(`✅ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: $${vehicle.bat_sold_price}`);
      } else {
        errorCount++;
        console.error(`❌ ${vehicle.year || '?'} ${vehicle.make} ${vehicle.model}: ${result.error}`);
      }
    }

    console.log(`\n📊 Results: ${successCount} succeeded, ${errorCount} failed`);
  }
}

main().catch(console.error);

