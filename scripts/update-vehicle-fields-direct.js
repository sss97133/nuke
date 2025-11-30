#!/usr/bin/env node
/**
 * Update vehicle fields directly (only fields that exist in schema)
 */

import { createClient } from '@supabase/supabase-js'
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

const vehicleId = '2b620b41-f53e-440c-aba0-ad61ed41c4a6'

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📝 Updating Vehicle Information')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  
  // Get current vehicle
  const { data: vehicle, error: fetchError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single()
  
  if (fetchError || !vehicle) {
    console.error('❌ Could not fetch vehicle:', fetchError?.message)
    process.exit(1)
  }
  
  console.log('Current vehicle:', vehicle.year, vehicle.make, vehicle.model)
  console.log('Current VIN:', vehicle.vin || 'None\n')
  
  // Prepare updates - only include fields that exist
  const updates = {}
  
  // VIN (most important)
  if (!vehicle.vin || vehicle.vin !== 'TCZ148Z533444') {
    updates.vin = 'TCZ148Z533444'
    console.log('📝 Will update VIN: TCZ148Z533444')
  }
  
  // Trim (if column exists)
  if (vehicle.hasOwnProperty('trim')) {
    // Listing says "High Sierra" but scraper got "Silverado" - use High Sierra from listing
    if (vehicle.trim !== 'High Sierra') {
      updates.trim = 'High Sierra'
      console.log('📝 Will update trim: High Sierra')
    }
  }
  
  // Series (if column exists)
  if (vehicle.hasOwnProperty('series')) {
    if (!vehicle.series || vehicle.series !== 'C10') {
      updates.series = 'C10'
      console.log('📝 Will update series: C10')
    }
  }
  
  // Displacement (if column exists)
  if (vehicle.hasOwnProperty('displacement')) {
    if (!vehicle.displacement || vehicle.displacement !== '7.4') {
      updates.displacement = '7.4'
      console.log('📝 Will update displacement: 7.4L')
    }
  }
  
  // Engine size (if column exists)
  if (vehicle.hasOwnProperty('engine_size')) {
    if (!vehicle.engine_size || vehicle.engine_size !== '7.4L V8') {
      updates.engine_size = '7.4L V8'
      console.log('📝 Will update engine_size: 7.4L V8')
    }
  }
  
  if (Object.keys(updates).length === 0) {
    console.log('\n✅ All fields are already up to date!')
    return
  }
  
  console.log(`\n📤 Updating ${Object.keys(updates).length} field(s)...\n`)
  
  // Try to update - might fail on VIN due to trigger, but other fields should work
  const { data: updated, error: updateError } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('id', vehicleId)
    .select()
  
  if (updateError) {
    console.error('❌ Update error:', updateError.message)
    
    // If VIN update failed, try updating other fields separately
    if (updates.vin && updateError.message.includes('stack depth')) {
      console.log('\n⚠️  VIN update blocked by trigger. Updating other fields separately...\n')
      
      const otherUpdates = { ...updates }
      delete otherUpdates.vin
      
      if (Object.keys(otherUpdates).length > 0) {
        const { data: otherData, error: otherError } = await supabase
          .from('vehicles')
          .update(otherUpdates)
          .eq('id', vehicleId)
          .select()
        
        if (otherError) {
          console.error('❌ Other fields update error:', otherError.message)
        } else {
          console.log('✅ Other fields updated successfully')
          if (otherData && otherData.length > 0) {
            console.log('   Updated vehicle:', otherData[0])
          }
        }
      }
      
      console.log('\n⚠️  VIN needs manual update:')
      console.log('   Go to Supabase dashboard → vehicles table')
      console.log('   Find vehicle ID: 2b620b41-f53e-440c-aba0-ad61ed41c4a6')
      console.log('   Set vin = TCZ148Z533444')
      console.log('\n   Or apply migration first:')
      console.log('   supabase/migrations/20251204000000_update_vehicle_vin_rpc.sql')
    }
  } else {
    console.log('✅ All fields updated successfully!')
    if (updated && updated.length > 0) {
      const v = updated[0]
      console.log(`\n   Vehicle: ${v.year} ${v.make} ${v.model}`)
      console.log(`   VIN: ${v.vin || 'None'}`)
      if (v.trim) console.log(`   Trim: ${v.trim}`)
      if (v.series) console.log(`   Series: ${v.series}`)
      if (v.displacement) console.log(`   Displacement: ${v.displacement}L`)
      if (v.engine_size) console.log(`   Engine: ${v.engine_size}`)
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main().catch(console.error)

