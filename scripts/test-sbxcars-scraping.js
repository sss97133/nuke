#!/usr/bin/env node
// Test SBX Cars scraping function - scrapes full details for listings

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

async function testScraping() {
  console.log('🔍 Testing SBX Cars scraping function...\n')

  // Test with a single listing URL (you can modify this)
  // For now, let's test with discovery to get a real URL
  console.log('Step 1: Getting a sample listing URL from discovery...')
  const { data: discoveryData, error: discoveryError } = await supabase.functions.invoke('discover-sbxcars-listings', {
    body: {
      max_pages: 1,
      sections: ['auctions'],
    },
  })

  if (discoveryError) {
    console.error('❌ Discovery error:', discoveryError)
    process.exit(1)
  }

  console.log(`✅ Discovery found ${discoveryData.stats.urls_found} URLs\n`)

  // Get a listing URL from the queue or use a test URL
  const { data: queueItem } = await supabase
    .from('import_queue')
    .select('listing_url')
    .like('listing_url', '%sbxcars.com%')
    .eq('status', 'pending')
    .limit(1)
    .single()

  if (!queueItem?.listing_url) {
    console.log('⚠️  No pending SBX Cars listings in queue. Using a test URL...')
    console.log('Please provide a listing URL to test, or add one to the import_queue')
    process.exit(0)
  }

  const testUrl = queueItem.listing_url
  console.log(`Step 2: Testing scrape-sbxcars with URL: ${testUrl}\n`)

  const { data, error } = await supabase.functions.invoke('scrape-sbxcars', {
    body: {
      listing_url: testUrl,
      use_firecrawl: true,
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

  console.log('\n✅ Scraping Results:\n')
  if (data.listing) {
    console.log('📋 Listing Data:')
    console.log(`  Title: ${data.listing.title}`)
    console.log(`  Year: ${data.listing.year}`)
    console.log(`  Make: ${data.listing.make}`)
    console.log(`  Model: ${data.listing.model}`)
    console.log(`  Current Bid: ${data.listing.current_bid}`)
    console.log(`  Images: ${data.listing.images?.length || 0} images`)
    console.log(`  Auction Status: ${data.listing.auction_status}`)
    console.log(`  Lot Number: ${data.listing.lot_number}`)
    console.log(`  Description length: ${data.listing.description?.length || 0} chars`)
  } else {
    console.log(JSON.stringify(data, null, 2))
  }
}

testScraping().catch(console.error)

