#!/usr/bin/env node
// Test SBX Cars discovery function

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

async function testDiscovery() {
  console.log('🔍 Testing SBX Cars discovery function...\n')

  const { data, error } = await supabase.functions.invoke('discover-sbxcars-listings', {
    body: {
      max_pages: 5, // Just test with first few pages
      sections: ['auctions'], // Test with one section first
    },
  })

  if (error) {
    console.error('❌ Error:', error)
    if (error.context) {
      console.error('Response status:', error.context.status)
      const text = await error.context.text().catch(() => '')
      if (text) console.error('Response body:', text)
    }
    process.exit(1)
  }

  console.log('\n✅ Discovery Results:\n')
  console.log(JSON.stringify(data, null, 2))
}

testDiscovery().catch(console.error)

