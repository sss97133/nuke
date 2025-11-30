/**
 * Add received_in_trade column to vehicles table
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function addColumn() {
  console.log('Adding received_in_trade column to vehicles table...')

  // Check if column already exists
  const { data: columns, error: checkError } = await supabase.rpc('exec_sql', {
    query: `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'vehicles' 
      AND column_name = 'received_in_trade'
    `
  }).catch(() => ({ data: null, error: null }))

  if (columns && columns.length > 0) {
    console.log('✅ Column already exists')
    return
  }

  // Use raw SQL via Supabase REST API (service role can execute)
  // Since we can't use exec_sql directly, we'll use a workaround
  // by creating a migration function or using the management API
  
  // Alternative: Use pg_catalog query to check, then add via SQL
  const migrationSQL = `
    ALTER TABLE vehicles 
      ADD COLUMN IF NOT EXISTS received_in_trade BOOLEAN DEFAULT FALSE;

    CREATE INDEX IF NOT EXISTS idx_vehicles_received_in_trade 
      ON vehicles(received_in_trade) 
      WHERE received_in_trade = true;

    COMMENT ON COLUMN vehicles.received_in_trade IS 
      'Indicates if this vehicle was received as part of a trade transaction (including partial trades)';
  `

  console.log('⚠️  Cannot execute DDL via Supabase client directly')
  console.log('📋 Please run this SQL manually in Supabase SQL Editor:')
  console.log('\n' + migrationSQL + '\n')
  
  // Try to use edge function or direct connection
  // For now, just output the SQL
  console.log('Or apply via migration file: supabase/migrations/20250128_add_received_in_trade_column.sql')
}

addColumn().catch(console.error)

