#!/usr/bin/env node
// Test scrape-sbxcars to create source

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

config({ path: join(__dirname, '../nuke_frontend/.env.local') })
config({ path: join(__dirname, '../.env.local') })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

async function test() {
  console.log('🔍 Invoking scrape-sbxcars to create source...\n')
  
  const { data, error } = await supabase.functions.invoke('scrape-sbxcars', {
    body: { max_listings: 1, use_firecrawl: false }
  })

  if (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }

  console.log('✅ Result:', JSON.stringify(data, null, 2))
}

test().catch(console.error)

