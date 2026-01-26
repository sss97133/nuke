#!/usr/bin/env node
/**
 * Verify BaT data against actual listing
 * Reads the BaT URL from comments and compares with database
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VEHICLE_ID = 'f7a10a48-4cd8-4ff9-9166-702367d1c859';
const BAT_URL = 'https://bringatrailer.com/listing/1988-jeep-wrangler-32/';

async function main() {
  console.log('🔍 Verifying BaT data for vehicle:', VEHICLE_ID);
  console.log('📋 BaT URL:', BAT_URL);
  console.log('');

  // 1. Get vehicle data from database
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', VEHICLE_ID)
    .single();

  if (vehicleError) {
    console.error('❌ Error fetching vehicle:', vehicleError);
    return;
  }

  console.log('📊 DATABASE DATA:');
  console.log('  Year:', vehicle.year);
  console.log('  Make:', vehicle.make);
  console.log('  Model:', vehicle.model);
  console.log('  VIN:', vehicle.vin);
  console.log('  sale_price:', vehicle.sale_price || 'NULL');
  console.log('  bat_sold_price:', vehicle.bat_sold_price || 'NULL');
  console.log('  sale_date:', vehicle.sale_date || 'NULL');
  console.log('  bat_sale_date:', vehicle.bat_sale_date || 'NULL');
  console.log('  bat_listing_title:', vehicle.bat_listing_title || 'NULL');
  console.log('  bat_auction_url:', vehicle.bat_auction_url || 'NULL');
  console.log('  bat_seller:', vehicle.bat_seller || 'NULL');
  console.log('  bat_buyer:', vehicle.bat_buyer || 'NULL');
  console.log('');

  // 2. Scrape BaT listing
  console.log('🌐 SCRAPING BaT LISTING...');
  try {
    const response = await fetch(BAT_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();
    
    // Extract key data using regex patterns
    const batData = {
      title: extractTitle(html),
      salePrice: extractSalePrice(html),
      saleDate: extractSaleDate(html),
      lotNumber: extractLotNumber(html),
      seller: extractSeller(html),
      buyer: extractBuyer(html),
      vin: extractVIN(html),
      mileage: extractMileage(html),
      year: extractYear(html),
      make: extractMake(html),
      model: extractModel(html),
    };

    console.log('📋 BaT LISTING DATA:');
    console.log('  Title:', batData.title || 'NOT FOUND');
    console.log('  Sale Price:', batData.salePrice ? `$${batData.salePrice.toLocaleString()}` : 'NOT FOUND');
    console.log('  Sale Date:', batData.saleDate || 'NOT FOUND');
    console.log('  Lot Number:', batData.lotNumber || 'NOT FOUND');
    console.log('  Seller:', batData.seller || 'NOT FOUND');
    console.log('  Buyer:', batData.buyer || 'NOT FOUND');
    console.log('  VIN:', batData.vin || 'NOT FOUND');
    console.log('  Mileage:', batData.mileage || 'NOT FOUND');
    console.log('  Year:', batData.year || 'NOT FOUND');
    console.log('  Make:', batData.make || 'NOT FOUND');
    console.log('  Model:', batData.model || 'NOT FOUND');
    console.log('');

    // 3. Compare and report discrepancies
    console.log('🔍 COMPARISON:');
    console.log('');

    const issues = [];

    // Price comparison
    if (batData.salePrice && vehicle.sale_price !== batData.salePrice) {
      issues.push({
        field: 'sale_price',
        expected: batData.salePrice,
        actual: vehicle.sale_price || 0,
        status: '❌ MISMATCH'
      });
    }

    if (batData.salePrice && vehicle.bat_sold_price !== batData.salePrice) {
      issues.push({
        field: 'bat_sold_price',
        expected: batData.salePrice,
        actual: vehicle.bat_sold_price || null,
        status: '❌ MISSING/MISMATCH'
      });
    }

    // Date comparison
    if (batData.saleDate && vehicle.bat_sale_date !== batData.saleDate) {
      issues.push({
        field: 'bat_sale_date',
        expected: batData.saleDate,
        actual: vehicle.bat_sale_date || null,
        status: '❌ MISSING/MISMATCH'
      });
    }

    // Title comparison
    if (batData.title && vehicle.bat_listing_title !== batData.title) {
      issues.push({
        field: 'bat_listing_title',
        expected: batData.title,
        actual: vehicle.bat_listing_title || null,
        status: '❌ MISSING/MISMATCH'
      });
    }

    // VIN comparison
    if (batData.vin && vehicle.vin !== batData.vin) {
      issues.push({
        field: 'vin',
        expected: batData.vin,
        actual: vehicle.vin || null,
        status: '⚠️ MISMATCH'
      });
    }

    // Year/Make/Model comparison
    if (batData.year && vehicle.year !== parseInt(batData.year)) {
      issues.push({
        field: 'year',
        expected: batData.year,
        actual: vehicle.year,
        status: '⚠️ MISMATCH'
      });
    }

    if (batData.make && vehicle.make?.toLowerCase() !== batData.make.toLowerCase()) {
      issues.push({
        field: 'make',
        expected: batData.make,
        actual: vehicle.make,
        status: '⚠️ MISMATCH'
      });
    }

    if (batData.model && vehicle.model?.toLowerCase() !== batData.model.toLowerCase()) {
      issues.push({
        field: 'model',
        expected: batData.model,
        actual: vehicle.model,
        status: '⚠️ MISMATCH'
      });
    }

    // Print issues
    if (issues.length === 0) {
      console.log('✅ All data matches!');
    } else {
      console.log(`❌ Found ${issues.length} issue(s):`);
      issues.forEach(issue => {
        console.log(`  ${issue.status} ${issue.field}:`);
        console.log(`    Expected: ${issue.expected}`);
        console.log(`    Actual: ${issue.actual}`);
        console.log('');
      });
    }

    // 4. Generate SQL fix script
    if (issues.length > 0) {
      console.log('📝 SQL FIX SCRIPT:');
      console.log('');
      console.log('-- Fix data discrepancies');
      console.log(`UPDATE vehicles SET`);
      
      const updates = [];
      if (batData.salePrice && vehicle.sale_price !== batData.salePrice) {
        updates.push(`  sale_price = ${batData.salePrice}`);
      }
      if (batData.salePrice && vehicle.bat_sold_price !== batData.salePrice) {
        updates.push(`  bat_sold_price = ${batData.salePrice}`);
      }
      if (batData.saleDate && vehicle.bat_sale_date !== batData.saleDate) {
        updates.push(`  bat_sale_date = '${batData.saleDate}'`);
      }
      if (batData.title && vehicle.bat_listing_title !== batData.title) {
        const escapedTitle = batData.title.replace(/'/g, "''");
        updates.push(`  bat_listing_title = '${escapedTitle}'`);
      }
      
      if (updates.length > 0) {
        console.log(updates.join(',\n'));
        console.log(`WHERE id = '${VEHICLE_ID}';`);
      }
    }

  } catch (error) {
    console.error('❌ Error scraping BaT:', error);
  }
}

function extractTitle(html) {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  if (match) {
    // Extract just the listing title part
    const title = match[1];
    const titleMatch = title.match(/^([^|]+)/);
    if (titleMatch) {
      return titleMatch[1].trim();
    }
  }
  return null;
}

function extractSalePrice(html) {
  const patterns = [
    /sold\s+for\s+\$?([\d,]+)/i,
    /\$([\d,]+)\s+on\s+[A-Za-z]+\s+\d+/i,
    /Sold\s+for\s+USD\s+\$?([\d,]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10);
    }
  }
  return null;
}

function extractSaleDate(html) {
  const patterns = [
    /sold\s+for[^0-9]*on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
    /([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*\(Lot/i,
    /(\d{4}-\d{2}-\d{2})/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const dateStr = match[1];
      // Try to parse and format as YYYY-MM-DD
      try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      } catch {}
      return dateStr;
    }
  }
  return null;
}

function extractLotNumber(html) {
  const match = html.match(/Lot\s+#?(\d{1,3}(?:,\d{3})*)/i);
  if (match) {
    return match[1].replace(/,/g, '');
  }
  return null;
}

function extractSeller(html) {
  const patterns = [
    /Sold\s+by\s+([A-Za-z0-9\s&]+?)(?:\s+on|\s+for|$)/i,
    /by\s+([A-Za-z0-9\s&]+?)\s+on\s+Bring/i,
    /Consignor[:\s]+([A-Za-z0-9\s&]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function extractBuyer(html) {
  const patterns = [
    /Sold\s+to\s+([A-Za-z0-9\s&]+?)\s+for/i,
    /won\s+by\s+([A-Za-z0-9\s&]+?)(?:\s+for|$)/i,
    /Buyer[:\s]+([A-Za-z0-9\s&]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function extractVIN(html) {
  const match = html.match(/(?:VIN|Chassis)[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
  if (match) {
    return match[1];
  }
  return null;
}

function extractMileage(html) {
  const patterns = [
    /(\d{1,3})k\s+Miles?\s+Shown/i,
    /(\d{1,3}(?:,\d{3})*)\s+Miles?\s+Shown/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let mileage = match[1].replace(/,/g, '');
      if (pattern.source.includes('k\\s')) {
        mileage = mileage + '000';
      }
      return parseInt(mileage, 10);
    }
  }
  return null;
}

function extractYear(html) {
  const match = html.match(/\b(19|20)\d{2}\b/);
  if (match) {
    return match[0];
  }
  return null;
}

function extractMake(html) {
  // Look for common makes in title
  const makes = ['Jeep', 'Ford', 'Chevrolet', 'Chevy', 'GMC', 'Dodge', 'Plymouth', 'Nissan', 'BMW', 'Mercedes', 'Benz'];
  for (const make of makes) {
    if (html.includes(make)) {
      return make;
    }
  }
  return null;
}

function extractModel(html) {
  // This is simplified - would need more sophisticated parsing
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1];
    // Try to extract model from title
    const modelMatch = title.match(/\d{4}\s+[A-Za-z]+\s+([A-Za-z\s]+?)(?:\s+for|\s+sold|$)/i);
    if (modelMatch) {
      return modelMatch[1].trim();
    }
  }
  return null;
}

main().catch(console.error);

