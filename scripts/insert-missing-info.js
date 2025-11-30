#!/usr/bin/env node
/**
 * Insert missing information from Craigslist listing
 * - Applies migration to create RPC function
 * - Updates VIN
 * - Updates other missing vehicle fields
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '../.env') })

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const vehicleId = '2b620b41-f53e-440c-aba0-ad61ed41c4a6'
const listingUrl = 'https://sfbay.craigslist.org/sby/cto/d/gilroy-1978-gmc-high-sierra-diesel-now/7898247358.html'

async function applyMigration() {
  console.log('📋 Step 1: Applying migration to create RPC function...\n')
  
  const migrationSQL = readFileSync(
    join(__dirname, '../supabase/migrations/20251204000000_update_vehicle_vin_rpc.sql'),
    'utf8'
  )
  
  // Try to execute via REST API
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ query: migrationSQL })
  })
  
  if (response.ok) {
    console.log('✅ Migration applied successfully\n')
    return true
  } else {
    const errorText = await response.text()
    // Check if function already exists
    if (errorText.includes('already exists') || errorText.includes('duplicate')) {
      console.log('ℹ️  Function may already exist, continuing...\n')
      return true
    }
    console.log('⚠️  Could not apply migration via REST API')
    console.log('   Error:', errorText)
    console.log('   You may need to apply it manually in Supabase dashboard\n')
    return false
  }
}

async function updateVIN() {
  console.log('📝 Step 2: Updating VIN...\n')
  
  // Try RPC function first
  const { data: rpcData, error: rpcError } = await supabase.rpc('update_vehicle_vin_safe', {
    p_vehicle_id: vehicleId,
    p_vin: 'TCZ148Z533444'
  })
  
  if (!rpcError && rpcData && rpcData.length > 0) {
    console.log('✅ VIN updated via RPC function:')
    console.log(`   Vehicle: ${rpcData[0].year} ${rpcData[0].make} ${rpcData[0].model}`)
    console.log(`   VIN: ${rpcData[0].vin}\n`)
    return true
  }
  
  // Fallback: Try direct update (might fail due to trigger, but worth trying)
  console.log('   RPC function not available, trying direct update...')
  const { data: directData, error: directError } = await supabase
    .from('vehicles')
    .update({ vin: 'TCZ148Z533444' })
    .eq('id', vehicleId)
    .select('id, year, make, model, vin')
  
  if (!directError && directData && directData.length > 0) {
    console.log('✅ VIN updated directly:')
    console.log(`   Vehicle: ${directData[0].year} ${directData[0].make} ${directData[0].model}`)
    console.log(`   VIN: ${directData[0].vin}\n`)
    return true
  }
  
  console.log('⚠️  Could not update VIN automatically')
  console.log(`   Error: ${rpcError?.message || directError?.message}`)
  console.log(`   Please update manually: VIN = TCZ148Z533444\n`)
  return false
}

async function updateOtherFields() {
  console.log('📋 Step 3: Updating other missing fields from listing...\n')
  
  // Get current vehicle data
  const { data: vehicle, error: fetchError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single()
  
  if (fetchError || !vehicle) {
    console.error('❌ Could not fetch vehicle:', fetchError?.message)
    return false
  }
  
  // Scrape listing to get all data
  console.log('   Scraping listing for complete data...')
  const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: listingUrl }
  })
  
  if (scrapeError || !scrapeData?.success) {
    console.error('   ⚠️  Could not scrape listing:', scrapeError?.message)
    return false
  }
  
  const updates = {}
  const scraped = scrapeData.data
  
  // Update fields that are missing or different
  if (scraped.trim && scraped.trim !== vehicle.trim) {
    updates.trim = scraped.trim
    console.log(`   📝 Trim: ${vehicle.trim || 'None'} → ${scraped.trim}`)
  }
  
  if (scraped.series && scraped.series !== vehicle.series) {
    updates.series = scraped.series
    console.log(`   📝 Series: ${vehicle.series || 'None'} → ${scraped.series}`)
  }
  
  if (scraped.bed_length && scraped.bed_length !== vehicle.bed_length) {
    updates.bed_length = scraped.bed_length
    console.log(`   📝 Bed Length: ${vehicle.bed_length || 'None'} → ${scraped.bed_length}`)
  }
  
  if (scraped.displacement && scraped.displacement !== vehicle.displacement) {
    updates.displacement = scraped.displacement
    console.log(`   📝 Displacement: ${vehicle.displacement || 'None'} → ${scraped.displacement}L`)
  }
  
  if (scraped.engine_size && scraped.engine_size !== vehicle.engine_size) {
    updates.engine_size = scraped.engine_size
    console.log(`   📝 Engine Size: ${vehicle.engine_size || 'None'} → ${scraped.engine_size}`)
  }
  
  if (Object.keys(updates).length === 0) {
    console.log('   ✅ All fields are up to date\n')
    return true
  }
  
  // Apply updates
  const { data: updated, error: updateError } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('id', vehicleId)
    .select()
  
  if (updateError) {
    console.log(`   ⚠️  Could not update fields: ${updateError.message}\n`)
    return false
  }
  
  console.log(`   ✅ Updated ${Object.keys(updates).length} field(s)\n`)
  return true
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📥 Inserting Missing Information')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log(`Vehicle ID: ${vehicleId}`)
  console.log(`Listing URL: ${listingUrl}\n`)
  
  // Step 1: Apply migration
  await applyMigration()
  
  // Step 2: Update VIN
  await updateVIN()
  
  // Step 3: Update other fields
  await updateOtherFields()
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Process complete!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main().catch(console.error)

