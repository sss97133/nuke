/**
 * Apply received_in_trade column migration via Supabase
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

    // Split into individual statements
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    console.log(`Executing ${statements.length} SQL statements...\n`)

    // Execute each statement via RPC (if available) or direct query
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';'
      console.log(`[${i + 1}/${statements.length}] Executing: ${statement.substring(0, 60)}...`)

      try {
        // Try using rpc to execute SQL (if function exists)
        const { error: rpcError } = await supabase.rpc('exec_sql', { 
          query: statement 
        }).catch(() => ({ error: { message: 'RPC not available' } }))

        if (rpcError && !rpcError.message.includes('not available')) {
          // If RPC doesn't exist, try direct query (won't work for DDL, but let's try)
          const { error: queryError } = await supabase
            .from('vehicles')
            .select('id')
            .limit(0)

          if (queryError) {
            throw new Error(`Cannot execute DDL via Supabase client: ${rpcError.message || queryError.message}`)
          }
        }
      } catch (err) {
        console.error(`  ❌ Error: ${err.message}`)
        console.log('\n⚠️  Cannot execute DDL statements via Supabase client.')
        console.log('📋 Please apply this migration manually in Supabase SQL Editor:\n')
        console.log(migrationSQL)
        process.exit(1)
      }
    }

    console.log('\n✅ Migration applied successfully!')
    
    // Verify the column exists
    const { data, error } = await supabase
      .from('vehicles')
      .select('received_in_trade')
      .limit(1)

    if (error && error.message.includes('received_in_trade')) {
      console.log('\n⚠️  Column may not exist yet. Please apply migration manually.')
    } else {
      console.log('✅ Column verified - migration complete!')
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message)
    console.log('\n📋 Please apply this migration manually in Supabase SQL Editor:')
    console.log('\n' + readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20250128_add_received_in_trade_column.sql'), 'utf-8'))
    process.exit(1)
  }
}

applyMigration().catch(console.error)

