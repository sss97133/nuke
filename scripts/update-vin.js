#!/usr/bin/env node
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

const { data, error } = await supabase
  .from('vehicles')
  .update({ vin: vin })
  .eq('id', vehicleId)
  .select('id, year, make, model, vin')

if (error) {
  console.error('❌ Error:', error.message)
  process.exit(1)
} else {
  console.log('✅ VIN updated successfully:')
  console.log(`   Vehicle: ${data[0].year} ${data[0].make} ${data[0].model}`)
  console.log(`   VIN: ${data[0].vin}`)
}

