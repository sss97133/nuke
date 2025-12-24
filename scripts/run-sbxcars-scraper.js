#!/usr/bin/env node
// Run SBX Cars scraper with Firecrawl

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load env vars
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

async function runScraper() {
  const args = process.argv.slice(2)
  const singleUrl = args.find(arg => arg.startsWith('http'))
  const maxListings = parseInt(args.find(arg => /^\d+$/.test(arg))) || 5

  if (singleUrl) {
    console.log(`🔍 Scraping single listing: ${singleUrl}\n`)
    const { data, error } = await supabase.functions.invoke('scrape-sbxcars', {
      body: {
        listing_url: singleUrl,
        use_firecrawl: true,
      },
    })

    if (error) {
      console.error('❌ Error:', error)
      if (error.context) {
        console.error('Response status:', error.context.status)
        const text = await error.context.text().catch(() => '')
        console.error('Response body:', text)
      }
      process.exit(1)
    }

    console.log('\n✅ Result:', JSON.stringify(data, null, 2))
  } else {
    console.log(`🚀 Running SBX Cars scraper with Firecrawl (max ${maxListings} listings)...\n`)

    const { data, error } = await supabase.functions.invoke('scrape-sbxcars', {
      body: {
        max_listings: maxListings,
        use_firecrawl: true,
      },
    })

    if (error) {
      console.error('❌ Error:', error)
      if (error.context) {
        console.error('Response status:', error.context.status)
        const text = await error.context.text().catch(() => '')
        console.error('Response body:', text)
      }
      process.exit(1)
    }

    console.log('\n✅ Result:', JSON.stringify(data, null, 2))
  }
}

runScraper().catch(console.error)

