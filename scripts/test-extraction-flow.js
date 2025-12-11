#!/usr/bin/env node

/**
 * Test script for the unified extraction flow
 * Tests: Extract → AI Proof → Re-extract
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_ANON_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Test the unified extraction flow
 */
async function testExtractionFlow(testUrl) {
  console.log('='.repeat(60));
  console.log('TESTING UNIFIED EXTRACTION FLOW');
  console.log('='.repeat(60));
  console.log(`\n🔍 Testing URL: ${testUrl}\n`);

  try {
    const { data, error } = await supabase.functions.invoke('extract-with-proof-and-backfill', {
      body: {
        url: testUrl,
        source_type: 'dealer_website',
        skip_proofreading: false,  // Enable AI proofreading
        skip_re_extraction: false  // Enable re-extraction if needed
      }
    });

    if (error) {
      throw error;
    }

    if (data.success) {
      console.log('✅ Extraction succeeded!\n');
      console.log(`📊 Results:`);
      console.log(`   Extraction Method: ${data.extraction_method}`);
      console.log(`   Confidence: ${(data.confidence * 100).toFixed(1)}%`);
      console.log(`   Proofreading Applied: ${data.proofreading_applied ? '✅' : '❌'}`);
      console.log(`   Re-extraction Applied: ${data.re_extraction_applied ? '✅' : '❌'}`);
      console.log(`   Missing Fields: ${data.missing_fields.length > 0 ? data.missing_fields.join(', ') : 'None'}\n`);
      
      console.log(`📝 Extracted Data:`);
      console.log(`   VIN: ${data.data.vin || '❌ Missing'}`);
      console.log(`   Year: ${data.data.year || '❌ Missing'}`);
      console.log(`   Make: ${data.data.make || '❌ Missing'}`);
      console.log(`   Model: ${data.data.model || '❌ Missing'}`);
      console.log(`   Price: ${data.data.price || data.data.asking_price || '❌ Missing'}`);
      console.log(`   Mileage: ${data.data.mileage || '❌ Missing'}`);
      
      return {
        success: true,
        confidence: data.confidence,
        hasAllCriticalFields: data.missing_fields.length === 0
      };
    } else {
      console.error('❌ Extraction failed:', data.error);
      return { success: false, error: data.error };
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Test multiple URLs
 */
async function runTests() {
  const testUrls = [
    // Add test URLs here
    'https://www.classic.com/s/111-motorcars-ZnQygen/',
    // 'https://nashville.craigslist.org/ctd/d/nashville-2003-ford-l-powerstroke-fx4/7899809394.html',
  ];

  const results = [];

  for (const url of testUrls) {
    if (!url) continue;
    
    const result = await testExtractionFlow(url);
    results.push({ url, ...result });
    
    // Rate limit between tests
    if (testUrls.indexOf(url) < testUrls.length - 1) {
      console.log('\n⏳ Waiting 3 seconds before next test...\n');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const highConfidence = succeeded.filter(r => r.confidence >= 0.8);
  const complete = succeeded.filter(r => r.hasAllCriticalFields);

  console.log(`\n✅ Succeeded: ${succeeded.length}/${results.length}`);
  console.log(`❌ Failed: ${failed.length}/${results.length}`);
  console.log(`📊 High Confidence (≥80%): ${highConfidence.length}/${succeeded.length}`);
  console.log(`✨ Complete (All Critical Fields): ${complete.length}/${succeeded.length}`);

  if (failed.length > 0) {
    console.log(`\n❌ Failed URLs:`);
    failed.forEach(r => console.log(`   - ${r.url}: ${r.error}`));
  }

  return results;
}

// Main
const args = process.argv.slice(2);
if (args.length > 0) {
  // Test single URL
  testExtractionFlow(args[0]).then(result => {
    process.exit(result.success ? 0 : 1);
  });
} else {
  // Run all tests
  runTests().then(results => {
    const allSucceeded = results.every(r => r.success);
    process.exit(allSucceeded ? 0 : 1);
  });
}

