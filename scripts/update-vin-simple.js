#!/usr/bin/env node
/**
 * Update vehicle VIN directly using service role (bypasses RLS)
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
const vin = 'TCZ148Z533444'

console.log(`Updating VIN for vehicle ${vehicleId}...`)
console.log(`VIN: ${vin}\n`)

// Use RPC function to bypass recursive triggers
const { data, error } = await supabase.rpc('update_vehicle_vin_safe', {
  p_vehicle_id: vehicleId,
  p_vin: vin
})

if (error) {
  console.error('❌ Error:', error.message)
  console.error('Full error:', error)
  process.exit(1)
} else {
  console.log('✅ VIN updated successfully:')
  if (data && data.length > 0) {
    const vehicle = data[0]
    console.log(`   Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`)
    console.log(`   VIN: ${vehicle.vin}`)
  } else {
    console.log('   (No data returned)')
  }
}

