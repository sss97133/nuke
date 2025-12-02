#!/usr/bin/env node
/**
 * Apply the Craigslist queue migration directly
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function main() {
  console.log('📝 Applying Craigslist queue migration...\n');

  // Read the migration file
  const migrationSQL = readFileSync('supabase/migrations/20250129_create_cl_listing_queue.sql', 'utf8');
  
  // Execute the migration
  console.log('Executing SQL migration...');
  const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

  if (error) {
    // Try direct execution through fetch
    console.log('Trying alternative method...');
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'apikey': serviceKey
      },
      body: JSON.stringify({ sql: migrationSQL })
    });

    if (!response.ok) {
      // Try splitting into individual statements
      console.log('Executing statements individually...');
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--'));

      for (const stmt of statements) {
        if (!stmt) continue;
        console.log(`  - ${stmt.substring(0, 60)}...`);
        
        const { error: stmtError } = await supabase.rpc('exec_sql', { sql: stmt });
        if (stmtError && !stmtError.message.includes('already exists')) {
          console.error(`    ❌ Error: ${stmtError.message}`);
        } else {
          console.log(`    ✅ Done`);
        }
      }
    }
  }

  // Verify table exists
  const { data: testData, error: testError } = await supabase
    .from('craigslist_listing_queue')
    .select('id')
    .limit(1);

  if (testError) {
    console.error('\n❌ Migration failed - table still does not exist');
    console.error('   Error:', testError.message);
    console.log('\n💡 Manually apply migration in Supabase Dashboard → SQL Editor');
    console.log('   File: supabase/migrations/20250129_create_cl_listing_queue.sql\n');
  } else {
    console.log('\n✅ Migration successful! Queue table is ready.\n');
  }
}

main().catch(console.error);

