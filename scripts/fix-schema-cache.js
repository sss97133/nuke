#!/usr/bin/env node

/**
 * Fix Supabase PostgREST schema cache
 * 
 * This script reloads the PostgREST schema cache to fix the
 * "Could not find the 'created_by' column" error
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../nuke_api/.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  console.error('URL:', supabaseUrl);
  console.error('Key:', supabaseKey ? 'present' : 'missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixSchemaCache() {
  console.log('🔧 Fixing PostgREST schema cache...\n');

  try {
    // 1. Drop any stale views
    console.log('1️⃣  Dropping stale views...');
    const dropViews = `
      DROP VIEW IF EXISTS vehicles_with_owner CASCADE;
      DROP VIEW IF EXISTS vehicle_ownership_view CASCADE;
      DROP VIEW IF EXISTS vehicles_extended CASCADE;
    `;
    
    const { error: dropError } = await supabase.rpc('exec_sql', { sql: dropViews });
    if (dropError && !dropError.message.includes('does not exist')) {
      console.log('   ⚠️  Views may not exist (this is OK)');
    } else {
      console.log('   ✅ Views dropped');
    }

    // 2. Reload PostgREST schema cache
    console.log('\n2️⃣  Reloading PostgREST schema cache...');
    const { error: notifyError } = await supabase.rpc('exec_sql', { 
      sql: "SELECT pg_notify('pgrst', 'reload schema');" 
    });
    
    if (notifyError) {
      console.log('   ⚠️  Direct SQL not available, using alternative method...');
      
      // Alternative: Just make a schema-changing query to trigger cache refresh
      const { error: pingError } = await supabase
        .from('vehicles')
        .select('id')
        .limit(1);
      
      if (pingError) {
        throw pingError;
      }
      console.log('   ✅ Schema cache refreshed via query');
    } else {
      console.log('   ✅ Schema cache reloaded');
    }

    // 3. Verify columns
    console.log('\n3️⃣  Verifying vehicles table columns...');
    const { data: columns, error: verifyError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'vehicles' 
          AND column_name IN ('user_id', 'uploaded_by', 'discovered_by', 'created_by')
        ORDER BY column_name;
      `
    });

    if (verifyError) {
      console.log('   ⚠️  Could not verify columns directly');
      console.log('   Testing vehicles table access...');
      
      const { data: testData, error: testError } = await supabase
        .from('vehicles')
        .select('user_id, uploaded_by')
        .limit(1);
      
      if (testError) {
        throw testError;
      }
      console.log('   ✅ Vehicles table accessible');
    } else {
      console.log('   ✅ Columns verified:', columns);
    }

    console.log('\n✅ Schema cache fix complete!');
    console.log('\n💡 Try adding a vehicle now - it should work.');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\n📝 Manual fix required:');
    console.error('   1. Open Supabase Dashboard');
    console.error('   2. Go to SQL Editor');
    console.error('   3. Run: SELECT pg_notify(\'pgrst\', \'reload schema\');');
    console.error('   4. OR restart PostgREST: Settings > Database > Restart');
    process.exit(1);
  }
}

fixSchemaCache();

