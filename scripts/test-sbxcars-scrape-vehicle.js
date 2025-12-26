#!/usr/bin/env node
// Test scrape-vehicle function with a single SBX Cars URL

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

async function testScrapeVehicle(url) {
  console.log(`🔍 Testing scrape-vehicle with URL: ${url}\n`)

  const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url },
  })

  if (error) {
    console.error('❌ Error:', error)
    if (error.context) {
      console.error('Response status:', error.context.status)
      const text = await error.context.text().catch(() => '')
      if (text) console.error('Response body:', text)
    }
    return null
  }

  console.log('✅ Scrape Results:\n')
  console.log('Year:', data.year)
  console.log('Make:', data.make)
  console.log('Model:', data.model)
  console.log('Title:', data.title)
  console.log('Source:', data.source)
  console.log('Lot Number:', data.lot_number)
  console.log('Asking Price:', data.asking_price)
  console.log('\nFull data structure:')
  console.log(JSON.stringify(data, null, 2))
  
  return data
}

async function main() {
  const testUrl = process.argv[2] || 'https://sbxcars.com/listing/555/2024-mercedes-amg-gt-63-4matic'
  
  await testScrapeVehicle(testUrl)
}

main().catch(console.error)

