#!/usr/bin/env node
// Run SBX Cars scraper in batches to avoid timeouts

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

async function runBatches(totalListings, batchSize = 10) {
  const batches = Math.ceil(totalListings / batchSize)
  let totalQueued = 0
  let totalSkipped = 0
  let totalErrors = 0

  console.log(`🚀 Running SBX Cars scraper in ${batches} batches of ${batchSize} listings each...\n`)

  for (let i = 0; i < batches; i++) {
    const batchNum = i + 1
    const listingsInBatch = Math.min(batchSize, totalListings - totalQueued - totalSkipped)
    
    if (listingsInBatch <= 0) break

    console.log(`\n📦 Batch ${batchNum}/${batches} - Scraping ${listingsInBatch} listings...`)

    try {
      const { data, error } = await supabase.functions.invoke('scrape-sbxcars', {
        body: {
          max_listings: listingsInBatch,
          use_firecrawl: true,
        },
      })

      if (error) {
        console.error(`❌ Batch ${batchNum} error:`, error)
        if (error.context) {
          console.error('Response status:', error.context.status)
          const text = await error.context.text().catch(() => '')
          if (text) console.error('Response body:', text)
        }
        totalErrors++
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }

      if (data?.stats) {
        totalQueued += data.stats.queued || 0
        totalSkipped += data.stats.skipped || 0
        totalErrors += data.stats.errors || 0
        console.log(`✅ Batch ${batchNum} complete: ${data.stats.queued} queued, ${data.stats.skipped} skipped, ${data.stats.errors} errors`)
      } else {
        console.log(`✅ Batch ${batchNum} complete:`, JSON.stringify(data, null, 2))
      }

      // Wait between batches to avoid overwhelming the system
      if (i < batches - 1) {
        console.log('⏳ Waiting 3 seconds before next batch...')
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    } catch (err) {
      console.error(`❌ Batch ${batchNum} exception:`, err)
      totalErrors++
    }
  }

  console.log(`\n🎉 All batches complete!`)
  console.log(`📊 Total stats:`)
  console.log(`   Queued: ${totalQueued}`)
  console.log(`   Skipped: ${totalSkipped}`)
  console.log(`   Errors: ${totalErrors}`)
}

const args = process.argv.slice(2)
const totalListings = parseInt(args[0]) || 50
const batchSize = parseInt(args[1]) || 10

runBatches(totalListings, batchSize).catch(console.error)

