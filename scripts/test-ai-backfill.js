#!/usr/bin/env node

/**
 * Test AI Backfill for Missing Fields
 * 
 * Tests catalog extraction + AI backfill on actual dealer website
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
const SUPABASE_KEY = envConfig.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || 
                     envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY ||
                     envConfig.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY ||
                     envConfig.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error('❌ SUPABASE keys not found.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TEST_URL = process.argv[2] || 'https://www.111motorcars.com/';

async function main() {
  console.log('='.repeat(70));
  console.log('AI BACKFILL TEST');
  console.log('='.repeat(70));
  console.log(`\n📋 Test URL: ${TEST_URL}\n`);

  try {
    // Step 1: Extract using catalog (will trigger AI backfill if fields missing)
    console.log('🔍 Extracting data (catalog + AI backfill)...\n');
    const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-using-catalog', {
      body: {
        url: TEST_URL,
        use_catalog: true,
        fallback_to_ai: true
      }
    });

    if (extractError) {
      throw new Error(`Extraction error: ${extractError.message || JSON.stringify(extractError)}`);
    }

    if (!extractData.success) {
      throw new Error(`Extraction failed: ${extractData.error || 'Unknown error'}`);
    }

    console.log(`✅ Extraction complete (method: ${extractData.extraction_method})`);
    console.log(`   Completeness: ${(extractData.completeness * 100).toFixed(1)}%`);
    console.log(`   AI Backfill Used: ${extractData.ai_backfill_used ? '✅' : '❌'}`);
    
    if (extractData.validation) {
      console.log(`   Required fields missing: ${extractData.validation.missing_required.length}`);
      console.log(`   Optional fields missing: ${extractData.validation.missing_optional.length}`);
      if (extractData.validation.missing_required.length > 0) {
        console.log(`   Missing required: ${extractData.validation.missing_required.join(', ')}`);
      }
    }

    console.log('\n📊 Extracted Data:');
    console.log(JSON.stringify(extractData.data, null, 2));

    // Highlight key fields
    if (extractData.data) {
      console.log('\n🔑 Key Fields:');
      if (extractData.data.name) console.log(`   Name: ${extractData.data.name}`);
      if (extractData.data.address || extractData.data.city) {
        console.log(`   Address: ${[extractData.data.address, extractData.data.city, extractData.data.state, extractData.data.zip].filter(Boolean).join(', ')}`);
      }
      if (extractData.data.phone) console.log(`   Phone: ${extractData.data.phone}`);
      if (extractData.data.services_offered && Array.isArray(extractData.data.services_offered)) {
        console.log(`   Services: ${extractData.data.services_offered.join(', ')}`);
      }
      if (extractData.data.dealer_license) console.log(`   License: ${extractData.data.dealer_license}`);
    }

    console.log('\n✅ Test complete!\n');

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

