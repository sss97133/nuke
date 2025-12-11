#!/usr/bin/env node

/**
 * Extract Services from Dealer Website
 * 
 * Catalog the dealer website structure and extract services offered
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

const DEALER_WEBSITE = 'https://www.111motorcars.com';

async function extractDealerServices() {
  console.log('='.repeat(60));
  console.log('EXTRACT SERVICES FROM DEALER WEBSITE');
  console.log('='.repeat(60));
  console.log(`\n🌐 Dealer Website: ${DEALER_WEBSITE}\n`);

  // STEP 1: Catalog dealer website structure
  console.log('🔍 STEP 1: Cataloging dealer website structure...\n');
  try {
    const { data: catalogResult, error: catalogError } = await supabase.functions.invoke('catalog-dealer-site-structure', {
      body: {
        url: DEALER_WEBSITE,
        site_type: 'dealer_website'
      }
    });

    if (catalogError) {
      throw catalogError;
    }

    if (!catalogResult.success) {
      throw new Error(catalogResult.error || 'Cataloging failed');
    }

    console.log('✅ Website cataloged!');
    console.log(`   Domain: ${catalogResult.domain}`);
    console.log(`   Confidence: ${(catalogResult.validation.confidence * 100).toFixed(1)}%`);
    console.log(`   Fields: ${catalogResult.schema?.available_fields?.length || 0}`);
    
    if (catalogResult.schema?.available_fields) {
      const hasServices = catalogResult.schema.available_fields.includes('services_offered');
      console.log(`   Services field: ${hasServices ? '✅' : '❌'}\n`);
    }

    // STEP 2: Extract using catalog
    console.log('🔍 STEP 2: Extracting services from website...\n');
    
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { data: extractResult, error: extractError } = await supabase.functions.invoke('extract-using-catalog', {
      body: {
        url: DEALER_WEBSITE,
        use_catalog: true,
        fallback_to_ai: true // Allow AI fallback for services
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
    console.log('SERVICES EXTRACTION RESULT');
    console.log('='.repeat(60));
    
    if (extractResult.data.services_offered) {
      const services = Array.isArray(extractResult.data.services_offered) 
        ? extractResult.data.services_offered 
        : [extractResult.data.services_offered];
      
      console.log(`✅ Services extracted: ${services.length} service(s)`);
      services.forEach((service, i) => {
        console.log(`   ${i + 1}. ${service}`);
      });
      
      console.log('\n📋 Services Array (ready for database):');
      console.log(JSON.stringify(services, null, 2));
    } else {
      console.log('⚠️  No services extracted from website');
      console.log('   This might mean:');
      console.log('   - Services not clearly listed on homepage');
      console.log('   - Need to extract from services page (/services)');
      console.log('   - Need to extract from navigation menu');
    }

    console.log('\n✅ Extraction complete!');
    console.log(`   Method: ${extractResult.extraction_method}`);
    console.log(`   Completeness: ${(extractResult.completeness * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.context) {
      console.error('   Context:', error.context);
    }
    process.exit(1);
  }
}

extractDealerServices();

