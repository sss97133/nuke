#!/usr/bin/env node
/**
 * Fix all vehicles missing descriptions by re-scraping their listings
 */

import { createClient } from '@supabase/supabase-js'
import { exec } from 'child_process'
import { promisify } from 'util'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '../.env') })

const execAsync = promisify(exec)

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function getVehiclesNeedingDescriptions() {
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata, description, description_source')
    .or('discovery_url.ilike.%craigslist%,origin_metadata->>listing_url.ilike.%craigslist%')
    .order('created_at', { ascending: false })
    .limit(100)
  
  if (error) {
    throw new Error(`Failed to fetch vehicles: ${error.message}`)
  }
  
  // Filter to vehicles missing descriptions
  return (vehicles || []).filter(v => {
    const hasDesc = v.description && v.description.length > 100
    const hasSource = v.description_source === 'craigslist_listing'
    return !hasDesc || !hasSource
  })
}

async function fixVehicle(vehicle) {
  const listingUrl = vehicle.discovery_url || vehicle.origin_metadata?.listing_url
  
  if (!listingUrl || !listingUrl.includes('craigslist')) {
    return { success: false, reason: 'no_url' }
  }
  
  try {
    const { stdout, stderr } = await execAsync(
      `VEHICLE_ID=${vehicle.id} LISTING_URL="${listingUrl}" node scripts/re-scrape-and-update-vehicle.js`,
      { cwd: join(__dirname, '..'), maxBuffer: 10 * 1024 * 1024 }
    )
    
    // Check if description was added
    const { data: updated } = await supabase
      .from('vehicles')
      .select('description, description_source')
      .eq('id', vehicle.id)
      .single()
    
    const hasDesc = updated?.description && updated.description.length > 100
    const hasSource = updated?.description_source === 'craigslist_listing'
    
    return { 
      success: hasDesc && hasSource, 
      description: hasDesc ? updated.description.length : 0 
    }
  } catch (error) {
    return { success: false, reason: 'error', error: error.message }
  }
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔧 Fix Missing Descriptions')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  const vehicles = await getVehiclesNeedingDescriptions()
  console.log(`Found ${vehicles.length} vehicles needing descriptions\n`)
  
  if (vehicles.length === 0) {
    console.log('✅ All vehicles have descriptions!')
    return
  }
  
  const results = {
    total: vehicles.length,
    fixed: 0,
    failed: 0,
    errors: []
  }
  
  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i]
    console.log(`[${i + 1}/${vehicles.length}] ${vehicle.year} ${vehicle.make} ${vehicle.model}`)
    
    const result = await fixVehicle(vehicle)
    
    if (result.success) {
      results.fixed++
      console.log(`   ✅ Fixed (${result.description} chars)\n`)
    } else {
      results.failed++
      results.errors.push({
        vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        error: result.error || result.reason
      })
      console.log(`   ❌ Failed: ${result.error || result.reason}\n`)
    }
    
    // Rate limiting
    if (i < vehicles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📊 Summary')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log(`   Total: ${results.total}`)
  console.log(`   ✅ Fixed: ${results.fixed}`)
  console.log(`   ❌ Failed: ${results.failed}`)
  
  if (results.errors.length > 0) {
    console.log('\n   Errors:')
    results.errors.forEach(err => {
      console.log(`   - ${err.vehicle}: ${err.error}`)
    })
  }
}

main().catch(console.error)

