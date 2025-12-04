/**
 * Decode VIN Edge Function
 * Decodes VINs using NHTSA VPIC API and stores results in database
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface VINDecodeResult {
  vin: string;
  normalized_vin: string;
  valid: boolean;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine_size: string | null;
  engine_cylinders: number | null;
  displacement_cc: number | null;
  displacement_liters: string | null;
  fuel_type: string | null;
  transmission: string | null;
  transmission_speeds: string | null;
  drivetrain: string | null;
  body_type: string | null;
  doors: number | null;
  manufacturer: string | null;
  plant_country: string | null;
  plant_city: string | null;
  series: string | null;
  vehicle_type: string | null;
  gvwr: string | null;
  brake_system: string | null;
  error_message: string | null;
  confidence: number;
  decoded_at: string;
  provider: string;
  raw_data: any;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { vin, vehicle_id, source } = await req.json()
    if (!vin) throw new Error('Missing vin parameter')

    console.log(`Decoding VIN: ${vin}`)

    // Normalize VIN
    const normalizedVIN = vin.replace(/[^A-Z0-9]/gi, '').toUpperCase()
    
    // Validate VIN format
    if (normalizedVIN.length !== 17) {
      throw new Error(`Invalid VIN length: ${normalizedVIN.length}. Must be 17 characters.`)
    }

    // Check cache in vin_decode_cache table (if exists)
    const { data: cached } = await supabase
      .from('vin_decode_cache')
      .select('*')
      .eq('vin', normalizedVIN)
      .gte('decoded_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // 7 days cache
      .maybeSingle()

    if (cached) {
      console.log('✅ VIN found in cache')
      
      // Update vehicle if vehicle_id provided
      if (vehicle_id && cached.valid) {
        await updateVehicleFromVINDecode(supabase, vehicle_id, cached, source || 'vin_decoder')
      }
      
      return new Response(
        JSON.stringify({ success: true, cached: true, ...cached }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Call NHTSA VPIC API
    console.log('Calling NHTSA VPIC API...')
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${normalizedVIN}?format=json`
    )

    if (!response.ok) {
      throw new Error(`NHTSA API error: ${response.status}`)
    }

    const data = await response.json()
    const results = data.Results || []

    // Parse NHTSA response
    const decoded = parseNHTSAResponse(normalizedVIN, results)
    
    // Store in cache
    const { error: cacheError } = await supabase
      .from('vin_decode_cache')
      .upsert({
        vin: decoded.normalized_vin,
        valid: decoded.valid,
        year: decoded.year,
        make: decoded.make,
        model: decoded.model,
        trim: decoded.trim,
        engine_size: decoded.engine_size,
        engine_cylinders: decoded.engine_cylinders,
        displacement_cc: decoded.displacement_cc,
        displacement_liters: decoded.displacement_liters,
        fuel_type: decoded.fuel_type,
        transmission: decoded.transmission,
        transmission_speeds: decoded.transmission_speeds,
        drivetrain: decoded.drivetrain,
        body_type: decoded.body_type,
        doors: decoded.doors,
        manufacturer: decoded.manufacturer,
        plant_country: decoded.plant_country,
        plant_city: decoded.plant_city,
        series: decoded.series,
        vehicle_type: decoded.vehicle_type,
        gvwr: decoded.gvwr,
        brake_system: decoded.brake_system,
        error_message: decoded.error_message,
        confidence: decoded.confidence,
        decoded_at: decoded.decoded_at,
        provider: decoded.provider,
        raw_data: results
      }, { onConflict: 'vin' })

    if (cacheError) {
      console.warn('Failed to cache VIN decode:', cacheError)
    }

    // Update vehicle if vehicle_id provided
    if (vehicle_id && decoded.valid) {
      await updateVehicleFromVINDecode(supabase, vehicle_id, decoded, source || 'vin_decoder')
    }

    console.log('✅ VIN decoded successfully')

    return new Response(
      JSON.stringify({ success: true, cached: false, ...decoded }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function parseNHTSAResponse(vin: string, results: any[]): VINDecodeResult {
  const getValue = (variableId: number): string | null => {
    const item = results.find(r => r.VariableId === variableId)
    return item?.Value && item.Value !== 'Not Applicable' && item.Value !== '' ? item.Value : null
  }

  const getValueByName = (name: string): string | null => {
    const item = results.find(r => r.Variable === name)
    return item?.Value && item.Value !== 'Not Applicable' && item.Value !== '' ? item.Value : null
  }

  const year = getValue(29) // Model Year
  const make = getValue(26) // Make
  const model = getValue(28) // Model
  const trim = getValue(109) // Trim
  
  const engineSize = getValue(13) // Displacement (L)
  const engineCylinders = getValue(9) // Engine Number of Cylinders
  const displacementCC = getValue(11) // Displacement (CC)
  const fuelType = getValue(24) // Fuel Type - Primary
  
  const transmission = getValue(37) // Transmission Style
  const transmissionSpeeds = getValue(38) // Transmission Speeds
  
  const drivetrain = getValue(15) // Drive Type
  const bodyType = getValue(5) // Body Class
  const doors = getValue(14) // Doors
  
  const manufacturer = getValue(27) // Manufacturer Name
  const plantCountry = getValue(75) // Plant Country
  const plantCity = getValue(76) // Plant City
  
  const series = getValue(34) // Series
  const vehicleType = getValue(39) // Vehicle Type
  const gvwr = getValue(25) // GVWR
  const brakeSystem = getValue(6) // Brake System Type

  // Calculate confidence score based on how much data was decoded
  let confidence = 0
  const importantFields = [year, make, model, engineSize, transmission, bodyType]
  const validFields = importantFields.filter(f => f !== null).length
  confidence = Math.round((validFields / importantFields.length) * 100)

  return {
    vin: vin,
    normalized_vin: vin,
    valid: make !== null && year !== null,
    year: year ? parseInt(year) : null,
    make: make,
    model: model,
    trim: trim,
    engine_size: engineSize,
    engine_cylinders: engineCylinders ? parseInt(engineCylinders) : null,
    displacement_cc: displacementCC ? parseInt(displacementCC) : null,
    displacement_liters: engineSize,
    fuel_type: fuelType,
    transmission: transmission,
    transmission_speeds: transmissionSpeeds,
    drivetrain: drivetrain,
    body_type: bodyType,
    doors: doors ? parseInt(doors) : null,
    manufacturer: manufacturer,
    plant_country: plantCountry,
    plant_city: plantCity,
    series: series,
    vehicle_type: vehicleType,
    gvwr: gvwr,
    brake_system: brakeSystem,
    error_message: make === null ? 'Could not decode VIN - may be invalid or not in NHTSA database' : null,
    confidence: confidence,
    decoded_at: new Date().toISOString(),
    provider: 'nhtsa',
    raw_data: results
  }
}

async function updateVehicleFromVINDecode(
  supabase: any,
  vehicle_id: string,
  decoded: VINDecodeResult,
  source: string
) {
  const updates: any = {}
  
  // Auto-fill empty fields
  if (decoded.year) updates.year = decoded.year
  if (decoded.make) updates.make = decoded.make
  if (decoded.model) updates.model = decoded.model
  if (decoded.trim) updates.trim_level = decoded.trim
  if (decoded.body_type) updates.body_type = decoded.body_type
  if (decoded.engine_size) updates.engine_displacement = decoded.engine_size
  if (decoded.transmission) updates.transmission = decoded.transmission
  if (decoded.drivetrain) updates.drivetrain = decoded.drivetrain
  
  // Add source tracking
  updates.vin_source = source
  updates.vin_confidence = decoded.confidence
  updates.vin_decoded_at = decoded.decoded_at

  const { error } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('id', vehicle_id)

  if (error) {
    console.error('Failed to update vehicle from VIN decode:', error)
    throw error
  }

  console.log(`✅ Vehicle ${vehicle_id} updated from VIN decode`)
}

