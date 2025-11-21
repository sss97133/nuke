/**
 * Generate comprehensive data report for a vehicle
 * Compares DB data, BaT listing, and UI display
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                     process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || 
                     process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const VEHICLE_ID = 'f7a10a48-4cd8-4ff9-9166-702367d1c859';

async function getBaTData(batUrl) {
  console.log(`\n📡 Scraping BaT listing: ${batUrl}\n`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(batUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    const data = await page.evaluate(() => {
      const title = document.title;
      
      // Extract price from title
      const priceMatch = title.match(/\$([\d,]+)/);
      const lotMatch = title.match(/Lot #([\d,]+)/);
      const dateMatch = title.match(/(\w+ \d+, \d{4})/);
      
      // Try to find price in page content
      let pagePrice = null;
      const priceSelectors = [
        '.sold-price',
        '.final-price',
        '[class*="price"]',
        '[class*="sold"]'
      ];
      
      for (const selector of priceSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.textContent || '';
          const match = text.match(/\$([\d,]+)/);
          if (match) {
            pagePrice = match[1].replace(/,/g, '');
            break;
          }
        }
      }
      
      // Search all text for price patterns
      const allText = document.body.textContent || '';
      const pricePatterns = [
        /sold for \$([\d,]+)/i,
        /final bid: \$([\d,]+)/i,
        /\$([\d,]+)\s*(?:was|is|final)/i
      ];
      
      for (const pattern of pricePatterns) {
        const match = allText.match(pattern);
        if (match) {
          pagePrice = match[1].replace(/,/g, '');
          break;
        }
      }
      
      return {
        title,
        priceFromTitle: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
        lotNumber: lotMatch ? lotMatch[1] : null,
        dateFromTitle: dateMatch ? dateMatch[1] : null,
        pagePrice: pagePrice ? parseInt(pagePrice) : null,
        url: window.location.href
      };
    });
    
    await browser.close();
    return data;
  } catch (error) {
    await browser.close();
    console.error(`❌ Error scraping BaT: ${error.message}`);
    return null;
  }
}

async function generateReport() {
  console.log('='.repeat(80));
  console.log('VEHICLE DATA REPORT');
  console.log('='.repeat(80));
  console.log(`Vehicle ID: ${VEHICLE_ID}\n`);
  
  // Get vehicle data
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', VEHICLE_ID)
    .single();
  
  if (vehicleError || !vehicle) {
    console.error('❌ Error fetching vehicle:', vehicleError);
    return;
  }
  
  console.log('📊 DATABASE DATA:');
  console.log('-'.repeat(80));
  console.log(`Year: ${vehicle.year}`);
  console.log(`Make: ${vehicle.make}`);
  console.log(`Model: ${vehicle.model}`);
  console.log(`Trim: ${vehicle.trim || 'N/A'}`);
  console.log(`VIN: ${vehicle.vin || 'N/A'}`);
  console.log(`\n💰 PRICE DATA:`);
  console.log(`  sale_price: ${vehicle.sale_price || 'NULL'} ${vehicle.sale_price === 0 ? '⚠️  (ZERO!)' : ''}`);
  console.log(`  bat_sold_price: ${vehicle.bat_sold_price || 'NULL'} ${!vehicle.bat_sold_price ? '⚠️  (MISSING!)' : ''}`);
  console.log(`  sale_date: ${vehicle.sale_date || 'NULL'}`);
  console.log(`  bat_sale_date: ${vehicle.bat_sale_date || 'NULL'} ${!vehicle.bat_sale_date ? '⚠️  (MISSING!)' : ''}`);
  console.log(`  asking_price: ${vehicle.asking_price || 'NULL'}`);
  console.log(`  purchase_price: ${vehicle.purchase_price || 'NULL'}`);
  console.log(`  current_value: ${vehicle.current_value || 'NULL'}`);
  console.log(`\n🔗 BaT DATA:`);
  console.log(`  bat_auction_url: ${vehicle.bat_auction_url || 'NULL'}`);
  console.log(`  bat_listing_title: ${vehicle.bat_listing_title || 'NULL'}`);
  console.log(`  bat_seller: ${vehicle.bat_seller || 'NULL'}`);
  console.log(`  bat_buyer: ${vehicle.bat_buyer || 'NULL'}`);
  
  // Get field sources
  const { data: fieldSources } = await supabase
    .from('vehicle_field_sources')
    .select('*')
    .eq('vehicle_id', VEHICLE_ID)
    .in('field_name', ['sale_price', 'bat_sold_price', 'price', 'final_price', 'sold_price'])
    .order('created_at', { ascending: false });
  
  console.log(`\n📝 FIELD SOURCES (Price-related):`);
  console.log('-'.repeat(80));
  if (fieldSources && fieldSources.length > 0) {
    fieldSources.forEach(fs => {
      console.log(`  ${fs.field_name}: ${fs.field_value}`);
      console.log(`    Source: ${fs.source_type} | Confidence: ${fs.confidence_score || 'N/A'}`);
      console.log(`    URL: ${fs.source_url || 'N/A'}`);
      console.log(`    Created: ${fs.created_at}`);
      console.log('');
    });
  } else {
    console.log('  ⚠️  No price-related field sources found!');
  }
  
  // Get BaT data
  if (vehicle.bat_auction_url) {
    const batData = await getBaTData(vehicle.bat_auction_url);
    
    if (batData) {
      console.log('\n🌐 BaT LISTING DATA:');
      console.log('-'.repeat(80));
      console.log(`  Title: ${batData.title}`);
      console.log(`  Price from Title: $${batData.priceFromTitle || 'N/A'}`);
      console.log(`  Price from Page: $${batData.pagePrice || 'N/A'}`);
      console.log(`  Lot Number: ${batData.lotNumber || 'N/A'}`);
      console.log(`  Sale Date: ${batData.dateFromTitle || 'N/A'}`);
      
      // Determine actual BaT price
      const batPrice = batData.priceFromTitle || batData.pagePrice;
      
      console.log(`\n🔍 COMPARISON:`);
      console.log('-'.repeat(80));
      console.log(`  BaT Listing Price: $${batPrice || 'UNKNOWN'}`);
      console.log(`  DB sale_price: $${vehicle.sale_price || 0}`);
      console.log(`  DB bat_sold_price: $${vehicle.bat_sold_price || 'NULL'}`);
      
      if (batPrice) {
        if (vehicle.sale_price !== batPrice) {
          console.log(`  ❌ MISMATCH: sale_price (${vehicle.sale_price}) != BaT price (${batPrice})`);
        }
        if (vehicle.bat_sold_price !== batPrice) {
          console.log(`  ❌ MISMATCH: bat_sold_price (${vehicle.bat_sold_price || 'NULL'}) != BaT price (${batPrice})`);
        }
        if (vehicle.sale_price === batPrice && vehicle.bat_sold_price === batPrice) {
          console.log(`  ✅ Prices match!`);
        }
      }
    }
  }
  
  console.log(`\n💻 UI DISPLAY (from VehicleHeader.tsx):`);
  console.log('-'.repeat(80));
  console.log(`  The UI shows:`);
  console.log(`    1. "Recorded Sale" - amount: ${vehicle.sale_price || 'NULL'}`);
  if (vehicle.bat_sold_price && vehicle.bat_sold_price !== vehicle.sale_price) {
    console.log(`    2. "Bring a Trailer Result" - amount: ${vehicle.bat_sold_price}`);
  }
  console.log(`    3. "Asking Price" - amount: ${vehicle.asking_price || 'NULL'}`);
  
  console.log(`\n📋 RECOMMENDATIONS:`);
  console.log('-'.repeat(80));
  if (vehicle.bat_auction_url) {
    const batData = await getBaTData(vehicle.bat_auction_url);
    if (batData && batData.priceFromTitle) {
      console.log(`  1. Update sale_price to: $${batData.priceFromTitle}`);
      console.log(`  2. Update bat_sold_price to: $${batData.priceFromTitle}`);
      if (batData.dateFromTitle) {
        console.log(`  3. Update bat_sale_date to: ${batData.dateFromTitle}`);
      }
      if (batData.lotNumber) {
        console.log(`  4. Store lot number in metadata`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(80));
}

generateReport().catch(console.error);

