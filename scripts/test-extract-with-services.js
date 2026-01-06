#!/usr/bin/env node

/**
 * Test extraction with services support
 * 
 * Step 1: Recatalog with services field
 * Step 2: Extract and show services
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load env vars
let envConfig = {};
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env')
];

for (const envPath of possiblePaths) {
  try {
    if (fs.existsSync(envPath)) {
      envConfig = dotenv.parse(fs.readFileSync(envPath));
      break;
    }
  } catch (e) {}
}

const SUPABASE_URL = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_KEY = envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 
                     envConfig.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error('❌ Supabase API key not found');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TEST_URL = 'https://www.classic.com/s/111-motorcars-ZnQygen/';

async function testExtractionWithServices() {
  console.log('='.repeat(60));
  console.log('TEST: EXTRACTION WITH SERVICES');
  console.log('='.repeat(60));
  console.log(`\n📋 Testing URL: ${TEST_URL}\n`);

  // STEP 1: Recatalog with services field
  console.log('🔍 STEP 1: Recataloging with services field...\n');
  try {
    const { data: catalogResult, error: catalogError } = await supabase.functions.invoke('catalog-dealer-site-structure', {
      body: {
        url: TEST_URL,
        site_type: 'directory'
      }
    });

    if (catalogError) {
      throw catalogError;
    }

    if (!catalogResult.success) {
      throw new Error(catalogResult.error || 'Cataloging failed');
    }

    console.log('✅ Structure cataloged!');
    console.log(`   Domain: ${catalogResult.domain}`);
    console.log(`   Confidence: ${(catalogResult.validation.confidence * 100).toFixed(1)}%`);
    console.log(`   Fields: ${catalogResult.schema?.available_fields?.length || 0}`);
    
    if (catalogResult.schema?.available_fields) {
      const hasServices = catalogResult.schema.available_fields.includes('services_offered');
      console.log(`   Services field: ${hasServices ? '✅' : '❌'}\n`);
    }

    // STEP 2: Extract using the catalog
    console.log('🔍 STEP 2: Extracting with services...\n');
    
    // Wait for catalog to be fully saved
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify catalog exists
    const { data: verifyCatalog } = await supabase
      .from('source_site_schemas')
      .select('domain, is_valid, available_fields')
      .eq('domain', 'classic.com')
      .maybeSingle();
    
    if (verifyCatalog) {
      console.log(`✅ Catalog verified: ${verifyCatalog.domain}, valid: ${verifyCatalog.is_valid}`);
      console.log(`   Fields: ${verifyCatalog.available_fields?.length || 0}\n`);
    } else {
      console.log('⚠️  Catalog not found in database\n');
    }

    const { data: extractResult, error: extractError } = await supabase.functions.invoke('extract-using-catalog', {
      body: {
        url: TEST_URL,
        use_catalog: true,
        fallback_to_ai: false
      }
    });

    if (extractError) {
      throw extractError;
    }

    if (!extractResult.success) {
      throw new Error(extractResult.error || 'Extraction failed');
    }

    console.log('✅ Extraction complete!\n');
    console.log(`📊 Extracted Data:`);
    console.log(JSON.stringify(extractResult.data, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('SERVICES EXTRACTION');
    console.log('='.repeat(60));
    
    if (extractResult.data.services_offered) {
      console.log(`✅ Services extracted: ${JSON.stringify(extractResult.data.services_offered)}`);
      console.log(`   Count: ${Array.isArray(extractResult.data.services_offered) ? extractResult.data.services_offered.length : 1}`);
    } else {
      console.log('⚠️  No services extracted');
    }

    console.log('\n✅ Test complete!');
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

testExtractionWithServices();

