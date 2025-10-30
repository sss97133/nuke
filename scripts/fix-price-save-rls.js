#!/usr/bin/env node
/**
 * Fix Price Save RLS Permissions
 * Executes SQL to fix conflicting policies on vehicles table
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase credentials');
  console.error('Need: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function fixPriceSavePermissions() {
  console.log('🔧 Fixing price save permissions...\n');

  const sql = `
-- Drop ALL conflicting UPDATE policies on vehicles table
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can update their vehicles" ON vehicles;
DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Any authenticated user can edit vehicles" ON vehicles;
DROP POLICY IF EXISTS "Authenticated users can update vehicles" ON vehicles;

-- Create ONE simple UPDATE policy
CREATE POLICY "Authenticated users can update any vehicle"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
`;

  try {
    // Execute via RPC (requires a function on the database)
    // Since we can't execute raw SQL directly via REST API, we need to check current policies first
    
    console.log('📊 Checking current UPDATE policies on vehicles table...\n');
    
    const { data: policies, error: policyError } = await supabase
      .rpc('exec_sql', { 
        query: `
          SELECT policyname, cmd, qual::text, with_check::text 
          FROM pg_policies 
          WHERE tablename = 'vehicles' 
          AND cmd = 'UPDATE'
        ` 
      })
      .single();

    if (policyError) {
      console.log('⚠️  Cannot query policies via RPC (function may not exist)\n');
      console.log('📝 Manual steps required:\n');
      console.log('1. Go to: https://qkgaybvrernstplzjaam.supabase.co/project/qkgaybvrernstplzjaam/sql/new');
      console.log('2. Copy and paste the contents of FIX_PRICE_SAVE_NOW.sql');
      console.log('3. Click RUN\n');
      
      console.log('SQL to run:');
      console.log('─'.repeat(60));
      const fixSql = fs.readFileSync(path.join(__dirname, '..', 'FIX_PRICE_SAVE_NOW.sql'), 'utf8');
      console.log(fixSql);
      console.log('─'.repeat(60));
      return;
    }

    console.log('Current policies:', policies);
    console.log('\n✅ To fix: Run FIX_PRICE_SAVE_NOW.sql in Supabase SQL Editor');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n📝 Please run manually in Supabase SQL Editor:');
    console.log('https://qkgaybvrernstplzjaam.supabase.co/project/qkgaybvrernstplzjaam/sql/new');
  }
}

fixPriceSavePermissions();

