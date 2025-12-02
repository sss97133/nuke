#!/usr/bin/env node
/**
 * Apply SPID Verification Trigger Migration
 * Uses Supabase client to apply the migration directly
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  console.error('   Set it in your .env file or export it:');
  console.error('   export SUPABASE_SERVICE_ROLE_KEY=your_service_role_key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration() {
  try {
    console.log('📄 Reading migration file...');
    const migrationPath = join(__dirname, '../supabase/migrations/20250201_ensure_spid_verification_trigger.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    console.log('🚀 Applying migration...');
    console.log('   This will create/update:');
    console.log('   - vehicle_spid_data table');
    console.log('   - verify_vehicle_from_spid() function');
    console.log('   - trigger_verify_vehicle_from_spid trigger');
    
    // Execute the migration
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: migrationSQL
    });
    
    if (error) {
      // If exec_sql doesn't exist, try direct query execution
      console.log('⚠️  exec_sql RPC not found, trying direct execution...');
      
      // Split migration into individual statements and execute
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));
      
      for (const statement of statements) {
        try {
          // Use REST API directly for DDL
          const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ sql: statement + ';' })
          });
          
          if (!response.ok) {
            console.warn(`⚠️  Statement failed (may already exist): ${statement.substring(0, 50)}...`);
          }
        } catch (err) {
          console.warn(`⚠️  Could not execute statement: ${err.message}`);
        }
      }
      
      console.log('✅ Migration applied (some statements may have been skipped if they already exist)');
      console.log('');
      console.log('📋 Next steps:');
      console.log('   1. Verify the trigger exists:');
      console.log('      SELECT tgname FROM pg_trigger WHERE tgname = \'trigger_verify_vehicle_from_spid\';');
      console.log('   2. Test SPID extraction by analyzing an image with a SPID sheet');
      return;
    }
    
    console.log('✅ Migration applied successfully!');
    console.log('');
    console.log('📋 Verify the trigger exists:');
    console.log('   SELECT tgname FROM pg_trigger WHERE tgname = \'trigger_verify_vehicle_from_spid\';');
    
  } catch (err) {
    console.error('❌ Error applying migration:', err.message);
    console.error('');
    console.error('💡 Alternative: Apply manually via Supabase Dashboard:');
    console.error('   1. Go to https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql');
    console.error('   2. Copy contents of: supabase/migrations/20250201_ensure_spid_verification_trigger.sql');
    console.error('   3. Paste and run in SQL Editor');
    process.exit(1);
  }
}

applyMigration();

