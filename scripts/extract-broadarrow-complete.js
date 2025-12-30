#!/usr/bin/env node
/**
 * Extract Complete Broad Arrow Data
 * - Extract all inventory from results pages
 * - Extract upcoming auctions
 * - Compile all contributors
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function extractInventory() {
  console.log('\n🚀 Extracting Broad Arrow Inventory...\n');
  
  // Extract from main results page
  const resultsUrl = 'https://www.broadarrowauctions.com/vehicles/results?q%5Bbranch_id_eq%5D=26&q%5Bs%5D%5B0%5D%5Bname_dir%5D=stock.asc';
  
  console.log(`📋 Extracting from: ${resultsUrl}`);
  console.log(`   This will extract all vehicles with contributor information...\n`);
  
  try {
    // Invoke the extraction function - start with 50 vehicles to avoid timeout
    // Can run multiple times to extract more
    const maxVehicles = parseInt(process.argv[2]) || 50;
    
    console.log(`   Max vehicles per run: ${maxVehicles}`);
    console.log(`   💡 Tip: Run multiple times with different batches, or increase max with: node scripts/extract-broadarrow-complete.js 100\n`);
    
    const { data, error } = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: resultsUrl,
        site_type: 'broadarrow',
        max_vehicles: maxVehicles,
        debug: false
      }
    });

    if (error) {
      console.error('❌ Extraction error:', error);
      return { success: false, error };
    }

    console.log('✅ Extraction completed!\n');
    console.log('📊 Results:');
    console.log(`   Listings discovered: ${data.listings_discovered || 0}`);
    console.log(`   Vehicles extracted: ${data.vehicles_extracted || 0}`);
    console.log(`   Vehicles created: ${data.vehicles_created || 0}`);
    console.log(`   Vehicles updated: ${data.vehicles_updated || 0}`);
    
    if (data.issues && data.issues.length > 0) {
      console.log(`\n⚠️  Issues (${data.issues.length}):`);
      data.issues.slice(0, 10).forEach((issue, idx) => {
        console.log(`   ${idx + 1}. ${issue}`);
      });
      if (data.issues.length > 10) {
        console.log(`   ... and ${data.issues.length - 10} more issues`);
      }
    }
    
    return { success: true, data };
  } catch (error) {
    console.error('❌ Exception during extraction:', error);
    return { success: false, error };
  }
}

async function extractUpcomingAuctions() {
  console.log('\n📅 Extracting Upcoming Auctions...\n');
  
  // Try to extract from upcoming auctions page
  // Note: This would need to be implemented in the extraction function
  // For now, we'll query what we have in the database
  console.log('ℹ️  Upcoming auctions extraction will be available after scraping auction pages');
  console.log('   Current implementation extracts from results pages');
  
  return { success: true, note: 'Upcoming auctions require additional scraping implementation' };
}

async function main() {
  console.log('🔍 Broad Arrow Auctions - Complete Data Extraction\n');
  console.log('='.repeat(60));
  
  // Step 1: Extract inventory
  const extractionResult = await extractInventory();
  
  if (!extractionResult.success) {
    console.error('\n❌ Extraction failed. Exiting.');
    process.exit(1);
  }
  
  // Step 2: Extract upcoming auctions
  await extractUpcomingAuctions();
  
  // Step 3: Generate report
  console.log('\n📊 Generating comprehensive report...\n');
  
  // Import and run the comprehensive report script
  try {
    const { generateReport } = await import('./broadarrow-comprehensive-report.js');
    await generateReport();
  } catch (error) {
    console.error('Error generating report:', error);
    console.log('\n💡 Run the report script separately: node scripts/broadarrow-comprehensive-report.js');
  }
  
  console.log('\n✅ Complete!');
  console.log('\nNext steps:');
  console.log('   1. Run: node scripts/broadarrow-comprehensive-report.js (for detailed report)');
  console.log('   2. Run: node scripts/compile-contact-network.js (for contributor network)');
}

main().catch(console.error);

