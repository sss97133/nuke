/**
 * Auto-Fix BaT Prices
 * 
 * Automatically detects and fixes price mismatches between database and BaT listings
 * 
 * Runs:
 * - Daily via cron (checks all vehicles with BaT URLs)
 * - On-demand via API call (fix specific vehicle)
 * - Triggered from UI when viewing vehicle profile
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BaTPriceData {
  price: number | null;
  saleDate: string | null;
  lotNumber: string | null;
  title: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { vehicle_id, action = 'check_and_fix' } = await req.json().catch(() => ({}));

    console.log(`🔍 Auto-fix BaT prices: ${action}${vehicle_id ? ` for vehicle ${vehicle_id}` : ''}`);

    let result;

    switch (action) {
      case 'check_and_fix':
        if (vehicle_id) {
          result = await fixVehiclePrice(supabase, vehicle_id);
        } else {
          result = await checkAllVehicles(supabase);
        }
        break;

      case 'check_only':
        result = await checkVehiclesForIssues(supabase, vehicle_id);
        break;

      case 'fix_batch':
        result = await fixBatchVehicles(supabase);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        result,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('❌ Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

/**
 * Scrape BaT listing for price data using fetch (no Playwright needed)
 */
async function scrapeBaTPrice(batUrl: string): Promise<BaTPriceData> {
  console.log(`  📡 Scraping: ${batUrl}`);
  
  try {
    // Fetch the HTML page
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
    const lotMatch = title.match(/Lot #([\d,]+)/);
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

    const priceFromTitle = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
    const price = priceFromTitle || (pagePrice ? parseInt(pagePrice) : null);
    const lotNumber = lotMatch ? lotMatch[1].replace(/,/g, '') : null;
    const dateFromTitle = dateMatch ? dateMatch[1] : null;

    return {
      price,
      saleDate: dateFromTitle,
      lotNumber,
      title: title,
    };
  } catch (error) {
    console.error(`  ❌ Scrape error: ${error.message}`);
    return { price: null, saleDate: null, lotNumber: null, title: null };
  }
}

/**
 * Fix price for a specific vehicle
 */
async function fixVehiclePrice(supabase: any, vehicleId: string) {
  console.log(`🔧 Fixing vehicle: ${vehicleId}`);

  // Get vehicle data
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();

  if (error || !vehicle) {
    throw new Error(`Vehicle not found: ${vehicleId}`);
  }

  if (!vehicle.bat_auction_url) {
    return {
      vehicle_id: vehicleId,
      status: 'skipped',
      reason: 'No BaT URL',
    };
  }

  // Scrape BaT for current price
  const batData = await scrapeBaTPrice(vehicle.bat_auction_url);

  if (!batData.price) {
    return {
      vehicle_id: vehicleId,
      status: 'failed',
      reason: 'Could not extract price from BaT',
    };
  }

  const issues: string[] = [];
  const fixes: any = {};

  // Check and fix sale_price
  if (vehicle.sale_price !== batData.price) {
    issues.push(`sale_price mismatch: ${vehicle.sale_price} != ${batData.price}`);
    fixes.sale_price = batData.price;
  }

  // Check and fix bat_sold_price
  if (vehicle.bat_sold_price !== batData.price) {
    issues.push(`bat_sold_price mismatch: ${vehicle.bat_sold_price} != ${batData.price}`);
    fixes.bat_sold_price = batData.price;
  }

  // Check and fix bat_sale_date
  if (batData.saleDate && vehicle.bat_sale_date !== batData.saleDate) {
    // Convert "April 15, 2024" to date format
    const saleDate = new Date(batData.saleDate).toISOString().split('T')[0];
    if (vehicle.bat_sale_date !== saleDate) {
      issues.push(`bat_sale_date mismatch: ${vehicle.bat_sale_date} != ${saleDate}`);
      fixes.bat_sale_date = saleDate;
    }
  }

  // Update bat_listing_title if missing
  if (!vehicle.bat_listing_title && batData.title) {
    const shortTitle = batData.title.split('|')[0].trim();
    fixes.bat_listing_title = shortTitle;
  }

  if (Object.keys(fixes).length === 0) {
    return {
      vehicle_id: vehicleId,
      status: 'ok',
      message: 'No issues found',
    };
  }

  // Apply fixes
  const { error: updateError } = await supabase
    .from('vehicles')
    .update(fixes)
    .eq('id', vehicleId);

  if (updateError) {
    throw new Error(`Update failed: ${updateError.message}`);
  }

  // Log the fix
  if (Object.keys(fixes).length > 0) {
    await supabase.rpc('log_price_fix', {
      p_vehicle_id: vehicleId,
      p_old_sale_price: vehicle.sale_price,
      p_new_sale_price: fixes.sale_price || vehicle.sale_price,
      p_old_bat_sold_price: vehicle.bat_sold_price,
      p_new_bat_sold_price: fixes.bat_sold_price || vehicle.bat_sold_price,
      p_old_bat_sale_date: vehicle.bat_sale_date,
      p_new_bat_sale_date: fixes.bat_sale_date || vehicle.bat_sale_date,
      p_bat_url: vehicle.bat_auction_url,
      p_bat_lot_number: batData.lotNumber,
      p_status: 'fixed',
      p_error_message: null,
    });
  }

  // Add field source attribution
  if (fixes.sale_price) {
    await supabase.from('vehicle_field_sources').upsert({
      vehicle_id: vehicleId,
      field_name: 'sale_price',
      field_value: String(batData.price),
      source_type: 'ai_scraped',
      source_url: vehicle.bat_auction_url,
      extraction_method: 'url_scraping',
      confidence_score: 100,
      metadata: {
        source: 'BaT_listing',
        extracted_at: new Date().toISOString(),
        lot_number: batData.lotNumber,
        auto_fixed: true,
      },
    }, {
      onConflict: 'vehicle_id,field_name,source_type,source_url',
    });
  }

  if (fixes.bat_sold_price) {
    await supabase.from('vehicle_field_sources').upsert({
      vehicle_id: vehicleId,
      field_name: 'bat_sold_price',
      field_value: String(batData.price),
      source_type: 'ai_scraped',
      source_url: vehicle.bat_auction_url,
      extraction_method: 'url_scraping',
      confidence_score: 100,
      metadata: {
        source: 'BaT_listing',
        extracted_at: new Date().toISOString(),
        lot_number: batData.lotNumber,
        auto_fixed: true,
      },
    }, {
      onConflict: 'vehicle_id,field_name,source_type,source_url',
    });
  }

  return {
    vehicle_id: vehicleId,
    status: 'fixed',
    issues,
    fixes,
    bat_price: batData.price,
  };
}

/**
 * Check all vehicles with BaT URLs for price issues
 */
async function checkAllVehicles(supabase: any) {
  console.log('🔍 Checking all vehicles with BaT URLs...');

  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, bat_auction_url, sale_price, bat_sold_price')
    .not('bat_auction_url', 'is', null)
    .limit(100); // Process in batches

  if (!vehicles || vehicles.length === 0) {
    return { checked: 0, fixed: 0, issues: [] };
  }

  const results = [];
  let fixed = 0;

  for (const vehicle of vehicles) {
    try {
      const result = await fixVehiclePrice(supabase, vehicle.id);
      results.push(result);
      if (result.status === 'fixed') {
        fixed++;
      }
      // Rate limit
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      results.push({
        vehicle_id: vehicle.id,
        status: 'error',
        error: error.message,
      });
    }
  }

  return {
    checked: vehicles.length,
    fixed,
    results,
  };
}

/**
 * Check vehicles for issues without fixing
 */
async function checkVehiclesForIssues(supabase: any, vehicleId?: string) {
  const query = supabase
    .from('vehicles')
    .select('id, year, make, model, bat_auction_url, sale_price, bat_sold_price, bat_sale_date')
    .not('bat_auction_url', 'is', null);

  if (vehicleId) {
    query.eq('id', vehicleId);
  } else {
    query.limit(50);
  }

  const { data: vehicles } = await query;

  const issues = [];

  for (const vehicle of vehicles || []) {
    // Check for obvious issues
    if (vehicle.sale_price === 0 && vehicle.bat_auction_url) {
      issues.push({
        vehicle_id: vehicle.id,
        vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        issue: 'sale_price is 0 but has BaT URL',
        severity: 'high',
      });
    }

    if (!vehicle.bat_sold_price && vehicle.bat_auction_url) {
      issues.push({
        vehicle_id: vehicle.id,
        vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        issue: 'bat_sold_price is missing',
        severity: 'medium',
      });
    }
  }

  return {
    checked: vehicles?.length || 0,
    issues,
  };
}

/**
 * Fix a batch of vehicles (for cron job)
 */
async function fixBatchVehicles(supabase: any) {
  // Get vehicles with price issues
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id')
    .not('bat_auction_url', 'is', null)
    .or('sale_price.eq.0,bat_sold_price.is.null')
    .limit(10); // Process 10 at a time

  if (!vehicles || vehicles.length === 0) {
    return { processed: 0, fixed: 0 };
  }

  let fixed = 0;
  for (const vehicle of vehicles) {
    try {
      const result = await fixVehiclePrice(supabase, vehicle.id);
      if (result.status === 'fixed') {
        fixed++;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Error fixing ${vehicle.id}:`, error);
    }
  }

  return {
    processed: vehicles.length,
    fixed,
  };
}

