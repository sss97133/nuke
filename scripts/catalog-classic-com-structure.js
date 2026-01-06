#!/usr/bin/env node

/**
 * Catalog Classic.com Structure
 * 
 * Step 1: Analyze and catalog Classic.com dealer profile structure
 * Step 2: Store schema in source_site_schemas table
 * 
 * This enables structure-first extraction - we know what to extract before extracting
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
 * Catalog Classic.com dealer profile structure
 */
async function catalogClassicComStructure() {
  console.log('='.repeat(60));
  console.log('CLASSIC.COM STRUCTURE CATALOGING');
  console.log('='.repeat(60));
  console.log('\n📋 Cataloging Classic.com dealer profile structure...\n');

  // Use a sample Classic.com dealer profile
  const sampleUrl = process.argv[2] || 'https://www.classic.com/s/111-motorcars-ZnQygen/';

  console.log(`🔍 Analyzing structure of: ${sampleUrl}\n`);

  try {
    const { data, error } = await supabase.functions.invoke('catalog-dealer-site-structure', {
      body: {
        url: sampleUrl,
        site_type: 'directory'
      }
    });

    if (error) {
      throw error;
    }

    if (data.success) {
      console.log('✅ Structure cataloged successfully!\n');
      console.log('📊 Schema Summary:');
      console.log(`   Domain: ${data.domain}`);
      console.log(`   Schema ID: ${data.schema_id}`);
      console.log(`   Confidence: ${(data.validation.confidence * 100).toFixed(1)}%`);
      console.log(`   Valid: ${data.validation.is_valid ? '✅' : '❌'}`);
      
      if (data.validation.issues?.length > 0) {
        console.log('\n⚠️  Issues:');
        data.validation.issues.forEach(issue => {
          console.log(`   - ${issue}`);
        });
      }

      if (data.schema?.available_fields) {
        console.log(`\n📋 Cataloged Fields (${data.schema.available_fields.length}):`);
        data.schema.available_fields.forEach(field => {
          const required = data.schema.required_fields?.includes(field) ? ' [REQUIRED]' : '';
          console.log(`   - ${field}${required}`);
        });
      }

      console.log('\n✅ Schema stored in source_site_schemas table');
      console.log('   Ready for structure-first extraction!\n');

      return data;
    } else {
      throw new Error(data.error || 'Cataloging failed');
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Verify catalog exists
 */
async function verifyCatalog() {
  console.log('\n🔍 Verifying catalog...\n');

  const { data: schemas, error } = await supabase
    .from('source_site_schemas')
    .select('domain, site_name, site_type, extraction_confidence, is_valid, cataloged_at')
    .eq('domain', 'classic.com')
    .eq('is_valid', true);

  if (error) {
    console.error(`❌ Error: ${error.message}`);
    return;
  }

  if (schemas && schemas.length > 0) {
    console.log('✅ Catalog found:');
    schemas.forEach(schema => {
      console.log(`   Domain: ${schema.domain}`);
      console.log(`   Type: ${schema.site_type}`);
      console.log(`   Confidence: ${(schema.extraction_confidence * 100).toFixed(1)}%`);
      console.log(`   Cataloged: ${new Date(schema.cataloged_at).toLocaleString()}`);
    });
  } else {
    console.log('⚠️  No catalog found. Run cataloging first.');
  }
}

/**
 * Main
 */
async function main() {
  const command = process.argv[2];

  if (command === 'verify' || command === '--verify') {
    await verifyCatalog();
  } else {
    await catalogClassicComStructure();
    await verifyCatalog();
  }
}

main().catch(console.error);

