#!/usr/bin/env node
/**
 * Execute Price Save Fix via Supabase Client
 * Uses service role key to directly execute SQL
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function executeFix() {
  console.log('🔧 Executing price save fix...\n');

  try {
    // Step 1: Drop old policies
    console.log('Step 1: Dropping conflicting policies...');
    const dropPolicies = [
      "Users can update their own vehicles",
      "Owners can update vehicles",
      "Owners can update their vehicles",
      "Contributors can update vehicles",
      "Any authenticated user can edit vehicles",
      "Authenticated users can update vehicles"
    ];

    for (const policy of dropPolicies) {
      const { error } = await supabase.rpc('exec_sql', {
        sql: `DROP POLICY IF EXISTS "${policy}" ON vehicles`
      });
      if (!error) console.log(`  ✓ Dropped: ${policy}`);
    }

    // Step 2: Create new simple policy
    console.log('\nStep 2: Creating new policy...');
    const { error: createError } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE POLICY "Authenticated users can update any vehicle"
          ON vehicles
          FOR UPDATE
          TO authenticated
          USING (true)
          WITH CHECK (true)
      `
    });

    if (createError) {
      throw new Error(`Failed to create policy: ${createError.message}`);
    }
    console.log('  ✓ Created: Authenticated users can update any vehicle');

    // Step 3: Verify
    console.log('\nStep 3: Verifying policies...');
    const { data: policies, error: verifyError } = await supabase
      .from('pg_policies')
      .select('policyname, cmd')
      .eq('tablename', 'vehicles')
      .eq('cmd', 'UPDATE');

    if (verifyError) {
      console.log('⚠️  Could not verify (pg_policies may not be exposed)');
    } else {
      console.log('\nActive UPDATE policies:');
      policies?.forEach(p => console.log(`  - ${p.policyname}`));
    }

    console.log('\n✅ Price save fix applied successfully!');
    console.log('   Users can now save prices in all editors.\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.log('\n📝 Fallback: Run FIX_PRICE_SAVE_NOW.sql manually in Supabase SQL Editor');
    console.log('   URL: https://qkgaybvrernstplzjaam.supabase.co/project/qkgaybvrernstplzjaam/sql/new\n');
    process.exit(1);
  }
}

executeFix();

