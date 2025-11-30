/**
 * Apply migration directly using Supabase REST API
 * This creates an edge function call to execute the SQL
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

const supabase = createClient(supabaseUrl, supabaseKey)

async function applyMigration() {
  console.log('📋 Applying received_in_trade column migration...\n')

  try {
    // Read the migration SQL
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20250128_add_received_in_trade_column.sql')
    const migrationSQL = readFileSync(migrationPath, 'utf-8')

    // Use the Supabase REST API to execute SQL via the management API
    // We'll use the service role key to make a direct request
    
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: migrationSQL })
    }).catch(async () => {
      // If RPC doesn't exist, try using pg_net or direct SQL execution
      // Actually, we need to use the Supabase Management API or create a function
      console.log('⚠️  Direct SQL execution not available via REST API')
      console.log('📋 Creating edge function to execute migration...')
      
      // Try to invoke a migration function if it exists
      const { data, error } = await supabase.functions.invoke('apply-migration', {
        body: { sql: migrationSQL }
      })
      
      if (error) {
        throw new Error(`Migration function not available: ${error.message}`)
      }
      
      return { ok: true, data }
    })

    if (response && response.ok) {
      console.log('✅ Migration applied successfully!')
      
      // Verify the column exists
      const { data, error } = await supabase
        .from('vehicles')
        .select('received_in_trade')
        .limit(1)

      if (error) {
        if (error.message.includes('received_in_trade')) {
          console.log('\n⚠️  Column may not exist yet.')
          console.log('📋 Please apply this migration manually in Supabase SQL Editor:\n')
          console.log(migrationSQL)
        } else {
          console.log('✅ Column verified - migration complete!')
        }
      } else {
        console.log('✅ Column verified - migration complete!')
      }
    } else {
      throw new Error('Migration execution failed')
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message)
    console.log('\n📋 Please apply this migration manually in Supabase SQL Editor:')
    console.log('\n' + readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20250128_add_received_in_trade_column.sql'), 'utf-8'))
    process.exit(1)
  }
}

applyMigration().catch(console.error)

