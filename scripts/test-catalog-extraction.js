#!/usr/bin/env node

/**
 * Test Catalog-Guided Extraction
 * 
 * Step 1: Catalog Classic.com dealer profile structure
 * Step 2: Extract using the catalog
 * Step 3: Compare with AI fallback
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
let envConfig = {};
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env')
];

for (const envPath of possiblePaths) {
  try {
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath });
      if (!result.error) {
        envConfig = result.parsed || {};
      }
      break;
    }
  } catch (e) {}
}

const SUPABASE_URL = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
// Prefer service role key for edge function invocation, fallback to anon key
const SUPABASE_KEY = envConfig.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || 
                     envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY ||
                     envConfig.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY ||
                     envConfig.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error('❌ SUPABASE keys not found.');
  console.error('   Please set one of:');
  console.error('   - VITE_SUPABASE_SERVICE_ROLE_KEY');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  console.error('   - VITE_SUPABASE_ANON_KEY');
  console.error('   - SUPABASE_ANON_KEY');
  console.error('\n   Or ensure .env.local file exists with these values.');
  process.exit(1);
}

console.log(`✅ Using Supabase URL: ${SUPABASE_URL}`);
console.log(`✅ Using key: ${SUPABASE_KEY.substring(0, 20)}...\n`);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TEST_URL = 'https://www.classic.com/s/111-motorcars-ZnQygen/';

async function main() {
  console.log('='.repeat(70));
  console.log('CATALOG-GUIDED EXTRACTION TEST');
  console.log('='.repeat(70));
  console.log(`\n📋 Test URL: ${TEST_URL}\n`);

  try {
    // Step 1: Catalog the structure
    console.log('🔍 Step 1: Cataloging site structure...\n');
    const { data: catalogData, error: catalogError } = await supabase.functions.invoke('catalog-dealer-site-structure', {
      body: {
        url: TEST_URL,
        site_type: 'directory'
      }
    });

    if (catalogError) {
      throw new Error(`Catalog error: ${catalogError.message}`);
    }

    if (!catalogData.success) {
      throw new Error(`Cataloging failed: ${catalogData.error}`);
    }

    console.log('✅ Structure cataloged successfully!');
    console.log(`   Domain: ${catalogData.domain}`);
    console.log(`   Confidence: ${(catalogData.validation.confidence * 100).toFixed(1)}%`);
    console.log(`   Valid: ${catalogData.validation.is_valid ? '✅' : '❌'}`);
    
    if (catalogData.schema?.available_fields) {
      console.log(`   Fields cataloged: ${catalogData.schema.available_fields.length}`);
    }

    // Step 2: Extract using catalog
    console.log('\n🔍 Step 2: Extracting data using catalog...\n');
    const extractResult = await supabase.functions.invoke('extract-using-catalog', {
      body: {
        url: TEST_URL,
        use_catalog: true,
        fallback_to_ai: false // Test catalog only first
      }
    });

    const extractData = extractResult.data;
    const extractError = extractResult.error;

    if (extractError) {
      console.error('❌ Extraction error details:', JSON.stringify(extractError, null, 2));
      throw new Error(`Extraction error: ${extractError.message || JSON.stringify(extractError)}`);
    }
    
    // Check if response indicates error
    if (extractData && !extractData.success) {
      console.error('❌ Extraction failed:', extractData.error);
      throw new Error(`Extraction failed: ${extractData.error || 'Unknown error'}`);
    }

    if (!extractData.success) {
      throw new Error(`Extraction failed: ${extractData.error}`);
    }

    console.log(`✅ Extraction complete (method: ${extractData.extraction_method})`);
    console.log(`   Completeness: ${(extractData.completeness * 100).toFixed(1)}%`);
    
    if (extractData.validation) {
      console.log(`   Required fields missing: ${extractData.validation.missing_required.length}`);
      console.log(`   Optional fields missing: ${extractData.validation.missing_optional.length}`);
    }

    console.log('\n📊 Extracted Data:');
    console.log(JSON.stringify(extractData.data, null, 2));

    // Step 3: Compare with AI fallback (if catalog had issues)
    if (extractData.validation?.missing_required?.length > 0) {
      console.log('\n🔍 Step 3: Trying AI fallback for missing fields...\n');
      const { data: fallbackData, error: fallbackError } = await supabase.functions.invoke('extract-using-catalog', {
        body: {
          url: TEST_URL,
          use_catalog: true,
          fallback_to_ai: true
        }
      });

      if (!fallbackError && fallbackData.success) {
        console.log(`✅ AI fallback complete (method: ${fallbackData.extraction_method})`);
        console.log(`   Completeness: ${(fallbackData.completeness * 100).toFixed(1)}%`);
        console.log('\n📊 AI Fallback Data:');
        console.log(JSON.stringify(fallbackData.data, null, 2));
      }
    }

    console.log('\n✅ Test complete!\n');

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
