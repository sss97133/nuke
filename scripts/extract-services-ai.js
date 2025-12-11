#!/usr/bin/env node

/**
 * Extract Services using AI extraction
 * 
 * Use AI to extract services from dealer website
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

const DEALER_WEBSITE = process.argv[2] || 'https://www.111motorcars.com';

async function extractServicesWithAI() {
  console.log('='.repeat(60));
  console.log('EXTRACT SERVICES USING AI');
  console.log('='.repeat(60));
  console.log(`\n🌐 Dealer Website: ${DEALER_WEBSITE}\n`);

  try {
    console.log('🔍 Extracting services with AI...\n');
    
    const { data: extractResult, error: extractError } = await supabase.functions.invoke('extract-with-proof-and-backfill', {
      body: {
        url: DEALER_WEBSITE,
        source_type: 'dealer_website',
        skip_proofreading: false,
        skip_re_extraction: false
      }
    });

    if (extractError) {
      throw extractError;
    }

    if (!extractResult.success) {
      throw new Error(extractResult.error || 'Extraction failed');
    }

    console.log('✅ AI Extraction complete!\n');
    console.log(`📊 Extracted Data:`);
    console.log(JSON.stringify(extractResult.data, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('SERVICES ANALYSIS');
    console.log('='.repeat(60));
    
    const data = extractResult.data || {};
    
    // Look for services in various fields
    if (data.services_offered) {
      const services = Array.isArray(data.services_offered) 
        ? data.services_offered 
        : [data.services_offered];
      console.log(`✅ Services found: ${services.length}`);
      services.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
    }
    
    if (data.description) {
      console.log(`\n📝 Description:`);
      console.log(`   ${data.description.substring(0, 200)}...`);
      
      // Try to extract services from description
      const serviceKeywords = ['service', 'repair', 'parts', 'restoration', 'sales', 'custom'];
      const found = serviceKeywords.filter(kw => 
        data.description.toLowerCase().includes(kw)
      );
      if (found.length > 0) {
        console.log(`\n🔍 Services mentioned in description: ${found.join(', ')}`);
      }
    }
    
    console.log(`\n📊 Extraction Stats:`);
    console.log(`   Method: ${extractResult.extraction_method}`);
    console.log(`   Confidence: ${(extractResult.confidence * 100).toFixed(1)}%`);
    console.log(`   Completeness: ${(extractResult.completeness || 0) * 100}%`);
    
    if (extractResult.missing_fields?.length > 0) {
      console.log(`   Missing fields: ${extractResult.missing_fields.join(', ')}`);
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.context) {
      console.error('   Context:', error.context);
    }
    process.exit(1);
  }
}

extractServicesWithAI();

