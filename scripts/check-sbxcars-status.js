#!/usr/bin/env node
// Check SBX Cars ingestion status - queue items, vehicles created, etc.

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

async function checkStatus() {
  console.log('📊 SBX Cars Ingestion Status\n')
  console.log('=' .repeat(60))

  // Get scrape source
  const { data: source } = await supabase
    .from('scrape_sources')
    .select('*')
    .ilike('url', '%sbxcars.com%')
    .maybeSingle()

  if (!source) {
    console.log('⚠️  No scrape source found for sbxcars.com')
  } else {
    console.log(`✅ Scrape Source: ${source.name} (${source.url})`)
    console.log(`   ID: ${source.id}`)
    console.log(`   Active: ${source.is_active ? 'Yes' : 'No'}\n`)
  }

  // Check import_queue stats
  console.log('📋 Import Queue Status:')
  let queueQuery = supabase
    .from('import_queue')
    .select('status, listing_url, listing_title, created_at, processed_at, raw_data')
  
  if (source?.id) {
    queueQuery = queueQuery.or(`source_id.eq.${source.id},listing_url.ilike.%sbxcars.com%`)
  } else {
    queueQuery = queueQuery.ilike('listing_url', '%sbxcars.com%')
  }
  
  const { data: queueItems, error: queueError } = await queueQuery

  if (queueError) {
    console.error('❌ Error fetching queue:', queueError)
  } else {
    const statusCounts = {}
    queueItems.forEach(item => {
      statusCounts[item.status] = (statusCounts[item.status] || 0) + 1
    })

    console.log(`   Total items: ${queueItems.length}`)
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`)
    })

    // Show sample pending items
    const pendingItems = queueItems.filter(i => i.status === 'pending').slice(0, 5)
    if (pendingItems.length > 0) {
      console.log(`\n   Sample pending items (first ${pendingItems.length}):`)
      pendingItems.forEach((item, idx) => {
        const hasRawData = item.raw_data && Object.keys(item.raw_data).length > 1
        console.log(`   ${idx + 1}. ${item.listing_title || item.listing_url}`)
        console.log(`      URL: ${item.listing_url}`)
        console.log(`      Created: ${item.created_at}`)
        console.log(`      Has full data: ${hasRawData ? 'Yes' : 'No (needs scraping)'}`)
      })
    }
  }

  // Check vehicles
  console.log('\n🚗 Vehicles Status:')
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, status, created_at')
    .ilike('discovery_url', '%sbxcars.com%')

  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError)
  } else {
    console.log(`   Total SBX Cars vehicles: ${vehicles.length}`)
    
    const statusCounts = {}
    vehicles.forEach(v => {
      statusCounts[v.status] = (statusCounts[v.status] || 0) + 1
    })
    
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`)
    })

    if (vehicles.length > 0) {
      const recentVehicles = vehicles
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5)
      
      console.log(`\n   Recent vehicles (last ${recentVehicles.length}):`)
      recentVehicles.forEach((v, idx) => {
        console.log(`   ${idx + 1}. ${v.year} ${v.make} ${v.model || ''}`.trim())
        console.log(`      Status: ${v.status}`)
        console.log(`      Created: ${v.created_at}`)
      })
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('\n💡 Next Steps:')
  
  const pendingCount = queueItems?.filter(i => i.status === 'pending').length || 0
  if (pendingCount > 0) {
    const needsScraping = queueItems?.filter(i => {
      if (i.status !== 'pending') return false
      const hasData = i.raw_data && Object.keys(i.raw_data).length > 1
      return !hasData
    }).length || 0

    if (needsScraping > 0) {
      console.log(`   1. Scrape ${needsScraping} pending items with full data using scrape-sbxcars`)
      console.log(`   2. Process the queue using process-import-queue`)
    } else {
      console.log(`   1. Process ${pendingCount} pending items using process-import-queue`)
    }
  } else {
    console.log('   ✅ All items processed!')
  }
  
  console.log('   3. Run discovery periodically to find new listings')
  console.log('   4. Monitor existing vehicles for updates\n')
}

checkStatus().catch(console.error)

