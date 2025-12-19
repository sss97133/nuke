#!/usr/bin/env node

/**
 * Apply vehicle_images table migration
 * This script applies the migration to ensure the vehicle_images table exists
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   - VITE_SUPABASE_URL or SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration() {
  console.log('🚀 Applying vehicle_images table migration...\n');

  try {
    // Read the migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20251219000001_ensure_vehicle_images_table.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('📄 Migration file loaded');
    console.log(`   Path: ${migrationPath}\n`);

    // Split the migration into individual statements
    // PostgreSQL doesn't support executing multiple statements in one call via REST API
    // So we'll use RPC or execute via SQL editor approach
    
    // For Supabase, we need to use the REST API's rpc function or execute SQL directly
    // Since we can't execute arbitrary SQL via REST API easily, we'll check if table exists first
    // and then guide the user to apply via dashboard
    
    console.log('🔍 Checking if vehicle_images table exists...');
    
    const { data: tableCheck, error: checkError } = await supabase
      .from('vehicle_images')
      .select('id')
      .limit(1);

    if (checkError) {
      if (checkError.message.includes('does not exist') || checkError.code === '42P01') {
        console.log('❌ Table does not exist - migration needs to be applied\n');
        console.log('📝 To apply this migration, you have two options:\n');
        console.log('Option 1: Supabase Dashboard (Recommended)');
        console.log('   1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new');
        console.log('   2. Copy the contents of: supabase/migrations/20251219000001_ensure_vehicle_images_table.sql');
        console.log('   3. Paste and run\n');
        console.log('Option 2: Using Supabase CLI');
        console.log('   supabase db push\n');
        console.log('Migration file location:');
        console.log(`   ${migrationPath}\n`);
        
        // Try to execute via RPC if available
        console.log('🔄 Attempting to apply via RPC...');
        try {
          // Some Supabase setups have an execute_sql function
          const { data: rpcResult, error: rpcError } = await supabase.rpc('exec_sql', {
            sql: migrationSQL
          });
          
          if (!rpcError && rpcResult) {
            console.log('✅ Migration applied successfully via RPC!');
            return;
          }
        } catch (rpcErr) {
          console.log('⚠️  RPC method not available, please use Dashboard or CLI\n');
        }
        
        process.exit(1);
      } else {
        throw checkError;
      }
    } else {
      console.log('✅ vehicle_images table already exists!');
      console.log('   Verifying columns...\n');
      
      // Check for some key columns
      const { data: sampleData } = await supabase
        .from('vehicle_images')
        .select('filename, file_size, ai_processing_status, is_document')
        .limit(1);
      
      if (sampleData !== null) {
        console.log('✅ Table structure appears complete');
        console.log('   (Some columns may be null in existing rows, which is normal)\n');
      }
      
      console.log('💡 If you\'re still getting errors, the migration may need to add missing columns.');
      console.log('   You can still run the migration - it\'s idempotent and safe.\n');
    }

  } catch (error) {
    console.error('❌ Error applying migration:', error.message);
    console.error('\n📝 Please apply the migration manually:');
    console.error('   1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new');
    console.error('   2. Copy contents of: supabase/migrations/20251219000001_ensure_vehicle_images_table.sql');
    console.error('   3. Paste and run');
    process.exit(1);
  }
}

applyMigration().catch(console.error);

