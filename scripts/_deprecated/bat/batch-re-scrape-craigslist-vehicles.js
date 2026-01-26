#!/usr/bin/env node
/**
 * Batch re-scrape all Craigslist vehicles to extract missing information
 * - Descriptions
 * - VINs
 * - Timeline events
 * - Source attribution
 */

import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '../.env') })

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Database connection for direct SQL (bypasses triggers)
const DB_PASSWORD = process.env.DB_PASSWORD || 'RbzKq32A0uhqvJMQ'
const DB_URL = `postgresql://postgres.qkgaybvrernstplzjaam:${DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`

// Import functions from re-scrape script
import { scrapeListing, getCurrentVehicle, updateVehicleDirectSQL, formatDescriptionWithSource, trackDescriptionSource, createDiscoveryTimelineEvent } from './re-scrape-and-update-vehicle.js'

async function getAllCraigslistVehicles() {
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata, user_id, created_at, description, description_source')
    .or('discovery_url.ilike.%craigslist%,origin_metadata->>listing_url.ilike.%craigslist%')
    .order('created_at', { ascending: false })
    .limit(500) // Process up to 500 vehicles
  
  if (error) {
    throw new Error(`Failed to fetch vehicles: ${error.message}`)
  }
  
  return vehicles || []
}

async function processVehicle(vehicle, index, total) {
  const listingUrl = vehicle.discovery_url || vehicle.origin_metadata?.listing_url
  
  if (!listingUrl || !listingUrl.includes('craigslist')) {
    console.log(`\n[${index + 1}/${total}] ⏭️  Skipping ${vehicle.year} ${vehicle.make} ${vehicle.model} - No CL URL`)
    return { success: false, reason: 'no_url' }
  }
  
  console.log(`\n${'='.repeat(60)}`)
  console.log(`[${index + 1}/${total}] 🔄 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`)
  console.log(`   Vehicle ID: ${vehicle.id}`)
  console.log(`   Listing URL: ${listingUrl}`)
  console.log(`${'='.repeat(60)}`)
  
  try {
    // Step 1: Get current vehicle data
    const currentVehicle = await getCurrentVehicle(vehicle.id)
    
    if (!currentVehicle) {
      console.log('   ⚠️  Vehicle not found')
      return { success: false, reason: 'not_found' }
    }
    
    // Step 2: Scrape listing
    console.log('📋 Scraping listing...')
    const scrapedData = await scrapeListing(listingUrl, vehicle.id)
    
    if (!scrapedData) {
      console.log('   ⚠️  Failed to scrape listing')
      return { success: false, reason: 'scrape_failed' }
    }
    
    console.log(`   ✅ Scraped: ${scrapedData.year} ${scrapedData.make} ${scrapedData.model || scrapedData.series}`)
    console.log(`   VIN: ${scrapedData.vin || 'Not found'}`)
    console.log(`   Images: ${scrapedData.images?.length || 0} found`)
    
    // Step 3: Compare and build updates
    const updates = {}
    let hasUpdates = false
    
    // VIN
    if (scrapedData.vin && (!currentVehicle.vin || currentVehicle.vin !== scrapedData.vin)) {
      updates.vin = scrapedData.vin
      hasUpdates = true
    }
    
    // Description - always update if missing or significantly shorter
    if (scrapedData.description && scrapedData.description.trim().length > 0) {
      const scrapedDesc = scrapedData.description.trim()
      const currentDesc = currentVehicle.description || ''
      
      // Update if no description or if scraped is much longer
      if (!currentDesc || currentDesc.length < scrapedDesc.length * 0.7) {
        const formattedDescription = formatDescriptionWithSource(
          scrapedDesc,
          listingUrl,
          scrapedData.posted_date || scrapedData.updated_date
        )
        
        updates.description = formattedDescription
        updates.description_source = 'craigslist_listing'
        updates.description_generated_at = new Date().toISOString()
        hasUpdates = true
        console.log(`   📝 Description: ${currentDesc ? `${currentDesc.length} chars` : 'None'} → ${formattedDescription.length} chars`)
      }
    }
    
    // Other fields (series, trim, etc.)
    if (scrapedData.series && (!currentVehicle.series || currentVehicle.series !== scrapedData.series)) {
      updates.series = scrapedData.series
      hasUpdates = true
    }
    
    if (scrapedData.trim && (!currentVehicle.trim || currentVehicle.trim !== scrapedData.trim)) {
      updates.trim = scrapedData.trim
      hasUpdates = true
    }
    
    // Step 4: Apply updates if any
    if (hasUpdates && Object.keys(updates).length > 0) {
      console.log(`\n📤 Updating ${Object.keys(updates).length} field(s)...`)
      try {
        const updated = await updateVehicleDirectSQL(updates, vehicle.id)
        console.log('   ✅ Vehicle updated successfully')
        
        // Track description source
        if (updates.description) {
          await trackDescriptionSource(vehicle.id, listingUrl, scrapedData.images?.length || 0)
        }
      } catch (error) {
        console.log(`   ⚠️  Update error: ${error.message}`)
        // Continue to timeline event even if update fails
      }
    } else {
      console.log('   ℹ️  No updates needed')
    }
    
    // Step 5: Create/update timeline event (always do this)
    await createDiscoveryTimelineEvent(vehicle.id, listingUrl, scrapedData, vehicle.user_id)
    
    return { success: true, updates: Object.keys(updates).length }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`)
    return { success: false, reason: 'error', error: error.message }
  }
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔄 BATCH RE-SCRAPE CRAIGSLIST VEHICLES')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  try {
    // Get all Craigslist vehicles
    console.log('📋 Fetching all Craigslist vehicles...')
    const vehicles = await getAllCraigslistVehicles()
    console.log(`   ✅ Found ${vehicles.length} vehicles\n`)
    
    if (vehicles.length === 0) {
      console.log('   ℹ️  No vehicles to process')
      return
    }
    
    // Process each vehicle
    const results = {
      total: vehicles.length,
      success: 0,
      skipped: 0,
      failed: 0,
      errors: []
    }
    
    for (let i = 0; i < vehicles.length; i++) {
      const result = await processVehicle(vehicles[i], i, vehicles.length)
      
      if (result.success) {
        results.success++
      } else if (result.reason === 'no_url' || result.reason === 'scrape_failed') {
        results.skipped++
      } else {
        results.failed++
        results.errors.push({
          vehicle: `${vehicles[i].year} ${vehicles[i].make} ${vehicles[i].model}`,
          error: result.error || result.reason
        })
      }
      
      // Rate limiting - wait 2 seconds between vehicles
      if (i < vehicles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
    
    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('📊 BATCH PROCESSING SUMMARY')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    console.log(`   Total vehicles: ${results.total}`)
    console.log(`   ✅ Successfully processed: ${results.success}`)
    console.log(`   ⏭️  Skipped: ${results.skipped}`)
    console.log(`   ❌ Failed: ${results.failed}`)
    
    if (results.errors.length > 0) {
      console.log('\n   Errors:')
      results.errors.forEach(err => {
        console.log(`   - ${err.vehicle}: ${err.error}`)
      })
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ Batch processing complete!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

main()

