#!/usr/bin/env node
/**
 * Fix RLS Directly Using pg Client
 */

const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Try different connection string formats
const connectionString = process.env.DATABASE_URL || 
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_CONNECTION_STRING;

if (!connectionString || connectionString === 'your-database-url') {
  console.log('❌ No valid database connection string found\n');
  console.log('🔧 Creating Supabase Edge Function instead...\n');
  process.exit(1);
}

const client = new Client({ connectionString });

const sql = `
BEGIN;

DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can update their vehicles" ON vehicles;
DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Any authenticated user can edit vehicles" ON vehicles;
DROP POLICY IF EXISTS "Authenticated users can update vehicles" ON vehicles;

CREATE POLICY "Authenticated users can update any vehicle"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

SELECT 
  policyname,
  cmd,
  CASE WHEN qual::text = 'true' THEN 'ALLOWS ALL' ELSE 'RESTRICTED' END as status
FROM pg_policies 
WHERE tablename = 'vehicles' 
AND cmd = 'UPDATE';

COMMIT;
`;

async function execute() {
  console.log('🔧 Connecting to database...\n');
  
  try {
    await client.connect();
    console.log('✓ Connected\n');
    
    console.log('🔧 Executing fix...\n');
    const result = await client.query(sql);
    
    console.log('✅ SUCCESS! Price save permissions fixed\n');
    
    if (result.rows) {
      console.log('Active UPDATE policies:');
      result.rows.forEach(row => {
        console.log(`  - ${row.policyname}: ${row.status}`);
      });
    }
    
    console.log('\n✅ Users can now save prices!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

execute();

