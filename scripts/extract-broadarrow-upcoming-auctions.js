#!/usr/bin/env node
/**
 * Extract Broad Arrow Upcoming Auctions
 * Extracts vehicles from upcoming auctions and treats them as inventory (like Mecum)
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

// Extract from available lots (upcoming auctions)
const availableLotsUrl = 'https://www.broadarrowauctions.com/vehicles/available';
const batchSize = parseInt(process.argv[2]) || 8;
const maxBatches = parseInt(process.argv[3]) || 10;

async function extractBatch(batchNum) {
  console.log(`\n📦 Batch ${batchNum}: Extracting ${batchSize} vehicles from upcoming auctions...`);
  
  try {
    const { data, error } = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: availableLotsUrl,
        site_type: 'broadarrow',
        max_vehicles: batchSize,
        debug: false
      }
    });

    if (error) {
      console.error(`❌ Batch ${batchNum} error:`, error.message);
      return { success: false, error };
    }

    console.log(`✅ Batch ${batchNum} completed:`);
    console.log(`   Context: ${data.extraction_context || 'unknown'}`);
    console.log(`   Discovered: ${data.listings_discovered || 0}`);
    console.log(`   Extracted: ${data.vehicles_extracted || 0}`);
    console.log(`   Created: ${data.vehicles_created || 0}`);
    console.log(`   Updated: ${data.vehicles_updated || 0}`);
    
    if (data.issues && data.issues.length > 0) {
      console.log(`   Issues: ${data.issues.length}`);
    }

    return { success: true, data };
  } catch (error) {
    console.error(`❌ Batch ${batchNum} exception:`, error.message);
    return { success: false, error };
  }
}

async function main() {
  console.log('🔍 Broad Arrow Auctions - Upcoming Auctions Extraction\n');
  console.log('='.repeat(60));
  console.log(`📋 URL: ${availableLotsUrl}`);
  console.log(`📦 Batch size: ${batchSize} vehicles`);
  console.log(`🔄 Max batches: ${maxBatches}`);
  console.log(`📊 Total target: up to ${batchSize * maxBatches} vehicles`);
  console.log(`\n💡 These vehicles will be treated as inventory (upcoming auction lots)\n`);

  const results = {
    totalBatches: 0,
    successfulBatches: 0,
    totalDiscovered: 0,
    totalExtracted: 0,
    totalCreated: 0,
    totalUpdated: 0,
    errors: [],
  };

  for (let i = 1; i <= maxBatches; i++) {
    results.totalBatches++;
    
    const batchResult = await extractBatch(i);
    
    if (batchResult.success && batchResult.data) {
      results.successfulBatches++;
      results.totalDiscovered += batchResult.data.listings_discovered || 0;
      results.totalExtracted += batchResult.data.vehicles_extracted || 0;
      results.totalCreated += batchResult.data.vehicles_created || 0;
      results.totalUpdated += batchResult.data.vehicles_updated || 0;
    } else {
      results.errors.push({ batch: i, error: batchResult.error });
    }

    // Small delay between batches
    if (i < maxBatches) {
      console.log(`\n⏸️  Waiting 2 seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total batches run: ${results.totalBatches}`);
  console.log(`Successful batches: ${results.successfulBatches}`);
  console.log(`Total listings discovered: ${results.totalDiscovered}`);
  console.log(`Total vehicles extracted: ${results.totalExtracted}`);
  console.log(`Total vehicles created: ${results.totalCreated}`);
  console.log(`Total vehicles updated: ${results.totalUpdated}`);
  
  if (results.errors.length > 0) {
    console.log(`\n⚠️  Errors: ${results.errors.length}`);
  }

  console.log('\n✅ Extraction complete!');
  console.log('\nNext steps:');
  console.log('   1. Run: node scripts/broadarrow-comprehensive-report.js');
  console.log('   2. Run: node scripts/compile-contact-network.js');
}

main().catch(console.error);

