import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { vehicle_id, vin } = await req.json()
    
    if (!vehicle_id || !vin) {
      throw new Error('Missing vehicle_id or vin')
    }

    console.log(`Decoding VIN ${vin} for vehicle ${vehicle_id}`)

    // Call NHTSA VPIC API
    const nhtsaResponse = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`
    )

    if (!nhtsaResponse.ok) {
      throw new Error(`NHTSA API error: ${nhtsaResponse.status}`)
    }

    const nhtsaData = await nhtsaResponse.json()
    const results = nhtsaData.Results || []

    // Parse relevant fields from NHTSA response
    const getValue = (variableId: number): string | null => {
      const result = results.find((r: any) => r.VariableId === variableId)
      return result?.Value || null
    }

    const decoded: any = {}
    
    // Basic info
    if (getValue(26)) decoded.make = getValue(26) // Make
    if (getValue(28)) {
      let model = getValue(28)
      // Normalize NHTSA's redundant model names
      // "C/K 30 Series K30" → "K30"
      // "C/K 10 Series C10" → "C10"
      if (model?.includes('C/K') && model?.includes('Series')) {
        const seriesMatch = model.match(/(C|K)\d{2,4}/)
        if (seriesMatch) {
          model = seriesMatch[0] // Extract just "K30", "C10", etc.
        }
      }
      decoded.model = model
    }
    if (getValue(29)) decoded.year = parseInt(getValue(29) || '') // Model Year
    if (getValue(109)) decoded.trim = getValue(109) // Trim
    
    // Engine
    if (getValue(71)) decoded.engine_size = getValue(71) // Engine Configuration
    if (getValue(72)) decoded.displacement = getValue(72) // Displacement (L)
    if (getValue(13)) decoded.engine_cylinders = parseInt(getValue(13) || '') // Engine Cylinders
    if (getValue(69)) decoded.fuel_type = getValue(69)?.toLowerCase() // Fuel Type
    
    // Drivetrain
    if (getValue(10)) decoded.transmission = getValue(10)?.toLowerCase() // Transmission Style
    if (getValue(52)) decoded.drivetrain = getValue(52) // Drive Type
    
    // Body
    if (getValue(5)) {
      let bodyStyle = getValue(5)
      
      // Normalize NHTSA's weird classifications
      // NHTSA calls Blazer/Jimmy/Bronco "Minivan" or "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)"
      if (bodyStyle?.includes('Minivan') || bodyStyle?.includes('MPV')) {
        // Check if it's actually a truck-based SUV
        const modelLower = (decoded.model || '').toLowerCase()
        const makeLower = (decoded.make || '').toLowerCase()
        if (modelLower.includes('blazer') || modelLower.includes('jimmy') || 
            modelLower.includes('bronco') || modelLower.includes('ramcharger') ||
            modelLower.includes('suburban') || modelLower.includes('tahoe') ||
            modelLower.includes('yukon') || modelLower.includes('wagoneer')) {
          bodyStyle = 'SUV'
        }
      }
      
      // Simplify long NHTSA descriptions
      if (bodyStyle?.includes('Sport Utility')) bodyStyle = 'SUV'
      if (bodyStyle?.includes('Pickup')) bodyStyle = 'Truck'
      if (bodyStyle?.includes('Sedan')) bodyStyle = 'Sedan'
      if (bodyStyle?.includes('Coupe')) bodyStyle = 'Coupe'
      
      decoded.body_style = bodyStyle
    }
    if (getValue(14)) decoded.doors = parseInt(getValue(14) || '') // Doors
    
    // Other specs
    if (getValue(25)) decoded.manufacturer = getValue(25) // Manufacturer Name
    if (getValue(31)) decoded.plant_city = getValue(31) // Plant City
    if (getValue(32)) decoded.plant_country = getValue(32) // Plant Country

    console.log('Decoded data:', decoded)

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    // Get current vehicle data to avoid overwriting user-entered data
    const { data: currentVehicle } = await supabase
      .from('vehicles')
      .select('make, model, year, engine_size, transmission, drivetrain, body_style, doors, fuel_type')
      .eq('id', vehicle_id)
      .single()

    // Only update fields that are empty (don't overwrite existing data)
    const updates: any = {}
    if (!currentVehicle?.make && decoded.make) updates.make = decoded.make
    if (!currentVehicle?.model && decoded.model) updates.model = decoded.model
    if (!currentVehicle?.year && decoded.year) updates.year = decoded.year
    if (!currentVehicle?.engine_size && decoded.engine_size) updates.engine_size = decoded.engine_size
    if (!currentVehicle?.transmission && decoded.transmission) updates.transmission = decoded.transmission
    if (!currentVehicle?.drivetrain && decoded.drivetrain) updates.drivetrain = decoded.drivetrain
    if (!currentVehicle?.body_style && decoded.body_style) updates.body_style = decoded.body_style
    if (!currentVehicle?.doors && decoded.doors) updates.doors = decoded.doors
    if (!currentVehicle?.fuel_type && decoded.fuel_type) updates.fuel_type = decoded.fuel_type

    // Update vehicle if we have any new data
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicle_id)

      if (updateError) {
        console.error('Vehicle update error:', updateError)
      } else {
        console.log(`Updated ${Object.keys(updates).length} fields from VIN decode`)
      }

      // Create field_sources for decoded fields
      for (const [field, value] of Object.entries(updates)) {
        await supabase
          .from('vehicle_field_sources')
          .insert({
            vehicle_id: vehicle_id,
            field_name: field,
            field_value: String(value),
            source_type: 'ai_scraped',
            source_url: `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}`,
            confidence_score: 95,
            extraction_method: 'vin_decode',
            metadata: {
              source: 'NHTSA VPIC',
              vin: vin,
              decoded_at: new Date().toISOString()
            }
          })
          .then(() => console.log(`Field source created: ${field}`))
          .catch(err => console.warn(`Field source error for ${field}:`, err.message))
      }
    } else {
      console.log('No empty fields to update - vehicle already has complete data')
    }

    return new Response(
      JSON.stringify({
        success: true,
        vin,
        decoded_fields: Object.keys(updates),
        message: `Decoded ${Object.keys(updates).length} fields`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('VIN decode error:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 500 
      }
    )
  }
})

