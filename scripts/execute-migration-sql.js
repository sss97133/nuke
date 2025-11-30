/**
 * Execute migration SQL using Supabase Management API
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

async function executeMigration() {
  console.log('📋 Executing migration via Supabase Management API...\n')

  const migrationSQL = readFileSync(
    join(__dirname, '..', 'supabase', 'migrations', '20250128_add_received_in_trade_column.sql'),
    'utf-8'
  )

  // Use Supabase Management API to execute SQL
  // This requires the Management API which may not be available
  // Let's try using the REST API with pg_net extension if available
  
  try {
    // Try to use pg_net to execute SQL via HTTP
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: migrationSQL })
    })

    if (response.ok) {
      const data = await response.json()
      console.log('✅ Migration executed successfully!')
      console.log('Response:', data)
      return
    } else {
      const errorText = await response.text()
      console.log('⚠️  RPC function not available')
      console.log('Response:', errorText)
    }
  } catch (err) {
    console.log('⚠️  Could not execute via REST API')
  }

  // Fallback: Use Supabase client to create a function that executes the SQL
  console.log('\n📋 Migration SQL to execute:\n')
  console.log(migrationSQL)
  console.log('\n💡 Please execute this SQL in your Supabase Dashboard → SQL Editor')
  console.log('   Or use the Supabase CLI: supabase db push')
}

executeMigration().catch(console.error)

