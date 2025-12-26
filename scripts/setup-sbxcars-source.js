#!/usr/bin/env node
// Setup SBX Cars scrape source if it doesn't exist

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

async function setupSource() {
  console.log('🔧 Setting up SBX Cars scrape source...\n')

  // Check if source exists
  const { data: existing } = await supabase
    .from('scrape_sources')
    .select('*')
    .ilike('url', '%sbxcars.com%')
    .maybeSingle()

  if (existing) {
    console.log('✅ Scrape source already exists:')
    console.log(`   ID: ${existing.id}`)
    console.log(`   Name: ${existing.name}`)
    console.log(`   URL: ${existing.url}`)
    console.log(`   Type: ${existing.source_type}`)
    console.log(`   Active: ${existing.is_active}`)
    return existing.id
  }

  // Create source
  console.log('📝 Creating new scrape source...')
  const { data: newSource, error } = await supabase
    .from('scrape_sources')
    .insert({
      url: 'https://sbxcars.com',
      name: 'SBX Cars',
      source_type: 'auction_house',
      is_active: true,
    })
    .select()
    .single()

  if (error) {
    console.error('❌ Error creating source:', error)
    process.exit(1)
  }

  console.log('✅ Created scrape source:')
  console.log(`   ID: ${newSource.id}`)
  console.log(`   Name: ${newSource.source_name}`)
  console.log(`   Domain: ${newSource.domain}`)
  return newSource.id
}

setupSource()
  .then((sourceId) => {
    console.log(`\n✅ Setup complete! Source ID: ${sourceId}\n`)
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Setup failed:', error)
    process.exit(1)
  })

