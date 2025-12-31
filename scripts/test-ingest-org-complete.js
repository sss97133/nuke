#!/usr/bin/env node

/**
 * Test script for ingest-org-complete Edge Function
 * Uses Supabase client which automatically handles authentication
 * 
 * Usage: node scripts/test-ingest-org-complete.js [url]
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from multiple possible locations
const envPaths = [
  resolve(__dirname, '../nuke_frontend/.env.local'),
  resolve(__dirname, '../.env.local'),
  resolve(__dirname, '../.env'),
];

let envConfig = {};
for (const envPath of envPaths) {
  try {
    if (readFileSync(envPath, { encoding: 'utf8' })) {
      envConfig = dotenv.parse(readFileSync(envPath, { encoding: 'utf8' }));
      break;
    }
  } catch (e) {
    // File doesn't exist, continue
  }
}

const supabaseUrl = process.env.SUPABASE_URL || 
                    process.env.VITE_SUPABASE_URL || 
                    envConfig.VITE_SUPABASE_URL ||
                    'https://qkgaybvrernstplzjaam.supabase.co';

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                   process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
                   envConfig.SUPABASE_SERVICE_ROLE_KEY ||
                   process.env.SUPABASE_ANON_KEY ||
                   process.env.VITE_SUPABASE_ANON_KEY ||
                   envConfig.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: API key not found');
  console.error('');
  console.error('Set one of:');
  console.error('  - SUPABASE_SERVICE_ROLE_KEY');
  console.error('  - VITE_SUPABASE_ANON_KEY (in nuke_frontend/.env.local)');
  console.error('  - SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const testUrl = process.argv[2] || 'https://www.velocityrestorations.com/';

async function testIngestOrgComplete() {
  console.log('🧪 Testing ingest-org-complete Edge Function');
  console.log('=============================================');
  console.log('');
  console.log(`📍 URL: ${testUrl}`);
  console.log(`🔗 Supabase URL: ${supabaseUrl}`);
  console.log('');

  console.log('📡 Calling Edge Function...');
  console.log('');

  const startTime = Date.now();

  try {
    const { data, error } = await supabase.functions.invoke('ingest-org-complete', {
      body: { url: testUrl },
    });

    const duration = Date.now() - startTime;
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log('');

    if (error) {
      console.error('❌ Error:', error.message);
      if (error.context) {
        console.error('Context:', JSON.stringify(error.context, null, 2));
      }
      process.exit(1);
    }

    if (!data) {
      console.error('❌ No data returned from function');
      process.exit(1);
    }

    if (data.success) {
      console.log('✅ Success!');
      console.log('');
      console.log('📋 Results:');
      console.log(`   Organization ID: ${data.organization_id || 'N/A'}`);
      console.log(`   Organization Name: ${data.organization_name || 'N/A'}`);
      console.log(`   Vehicles Found: ${data.vehicles?.found || 0}`);
      console.log(`   Vehicles Inserted: ${data.vehicles?.inserted || 0}`);
      console.log(`   Vehicles Errors: ${data.vehicles?.errors || 0}`);
      console.log('');
      console.log('📊 Statistics:');
      console.log(`   Org Fields Extracted: ${data.stats?.org_fields_extracted || 0}`);
      console.log(`   Vehicles Found: ${data.stats?.vehicles_found || 0}`);
      console.log(`   Vehicles With Images: ${data.stats?.vehicles_with_images || 0}`);
      console.log('');
      
      const orgName = data.organization_name || 'Unknown';
      const vehiclesInserted = data.vehicles?.inserted || 0;
      console.log(`✅ Test passed! Ingested ${vehiclesInserted} vehicles for ${orgName}`);
    } else {
      console.error('❌ Function returned success: false');
      console.error('Error:', data.error);
      if (data.stack) {
        console.error('\nStack trace:');
        console.error(data.stack);
      }
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testIngestOrgComplete().catch(console.error);

