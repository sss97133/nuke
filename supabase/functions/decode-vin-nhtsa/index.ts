/**
 * NHTSA VIN Decoder Edge Function
 *
 * Decodes VINs using NHTSA's free VPIC API and fetches recall information.
 *
 * API Endpoints used:
 * - VIN Decode: https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{vin}?format=json
 * - Recalls: https://api.nhtsa.gov/recalls/recallsByVehicle?make={make}&model={model}&modelYear={year}
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

interface VehicleSpecs {
  vin: string
  valid: boolean
  year: number | null
  make: string | null
  model: string | null
  trim: string | null
  series: string | null
  body_type: string | null
  vehicle_type: string | null
  doors: number | null
  engine: {
    displacement_liters: string | null
    displacement_cc: number | null
    cylinders: number | null
    configuration: string | null
    fuel_type: string | null
    horsepower: number | null
  }
  transmission: {
    style: string | null
    speeds: string | null
  }
  drivetrain: string | null
  manufacturer: string | null
  plant: {
    country: string | null
    city: string | null
    company: string | null
  }
  gvwr: string | null
  curb_weight: number | null
  brake_system: string | null
  steering_type: string | null
  error_code: string | null
  error_message: string | null
}

interface RecallInfo {
  campaign_number: string
  recall_date: string
  component: string
  summary: string
  consequence: string
  remedy: string
  manufacturer: string
  notes: string | null
}

interface DecodeResponse {
  success: boolean
  vehicle: VehicleSpecs
  recalls: RecallInfo[]
  recall_count: number
  decoded_at: string
  raw_vin_data?: any
  raw_recall_data?: any
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { vin, include_raw_data = false } = await req.json()

    if (!vin) {
      return new Response(
        JSON.stringify({ error: 'VIN is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Normalize VIN - remove spaces, dashes, make uppercase
    const normalizedVIN = vin.replace(/[^A-Z0-9]/gi, '').toUpperCase()

    // Validate VIN length (modern VINs are 17 characters)
    if (normalizedVIN.length !== 17) {
      return new Response(
        JSON.stringify({
          error: `Invalid VIN length: ${normalizedVIN.length}. Modern VINs must be 17 characters.`,
          vin: normalizedVIN
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Decoding VIN: ${normalizedVIN}`)

    // Step 1: Decode VIN via NHTSA VPIC API
    const vinResponse = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${normalizedVIN}?format=json`
    )

    if (!vinResponse.ok) {
      throw new Error(`NHTSA VIN API error: ${vinResponse.status} ${vinResponse.statusText}`)
    }

    const vinData = await vinResponse.json()
    const results = vinData.Results || []

    // Parse VIN decode results
    const vehicleSpecs = parseVINResults(normalizedVIN, results)

    // Step 2: Fetch recalls if we have make, model, and year
    let recalls: RecallInfo[] = []
    let rawRecallData: any = null

    if (vehicleSpecs.make && vehicleSpecs.model && vehicleSpecs.year) {
      try {
        const recallResponse = await fetch(
          `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(vehicleSpecs.make)}&model=${encodeURIComponent(vehicleSpecs.model)}&modelYear=${vehicleSpecs.year}`
        )

        if (recallResponse.ok) {
          const recallData = await recallResponse.json()
          rawRecallData = recallData
          recalls = parseRecallResults(recallData.results || [])
          console.log(`Found ${recalls.length} recalls for ${vehicleSpecs.year} ${vehicleSpecs.make} ${vehicleSpecs.model}`)
        } else {
          console.warn(`Recall API returned ${recallResponse.status}: ${recallResponse.statusText}`)
        }
      } catch (recallError) {
        console.error('Error fetching recalls:', recallError)
        // Continue without recalls - don't fail the whole request
      }
    }

    // Build response
    const response: DecodeResponse = {
      success: vehicleSpecs.valid,
      vehicle: vehicleSpecs,
      recalls: recalls,
      recall_count: recalls.length,
      decoded_at: new Date().toISOString()
    }

    // Include raw data if requested (useful for debugging)
    if (include_raw_data) {
      response.raw_vin_data = results
      response.raw_recall_data = rawRecallData
    }

    console.log(`VIN decode complete: ${vehicleSpecs.year} ${vehicleSpecs.make} ${vehicleSpecs.model}`)

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('VIN decode error:', error)
    return new Response(
      JSON.stringify({
        error: 'Failed to decode VIN',
        details: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * Parse NHTSA VPIC API response into structured vehicle specs
 */
function parseVINResults(vin: string, results: any[]): VehicleSpecs {
  // Helper to get value by variable ID
  const getById = (variableId: number): string | null => {
    const item = results.find(r => r.VariableId === variableId)
    const value = item?.Value
    if (!value || value === 'Not Applicable' || value === '' || value === 'null') {
      return null
    }
    return value.trim()
  }

  // Helper to get numeric value
  const getNumericById = (variableId: number): number | null => {
    const value = getById(variableId)
    if (!value) return null
    const num = parseFloat(value)
    return isNaN(num) ? null : num
  }

  // NHTSA Variable IDs (from VPIC API documentation)
  // https://vpic.nhtsa.dot.gov/api/vehicles/GetAllVariables?format=json
  const VARS = {
    // Basic info
    MODEL_YEAR: 29,
    MAKE: 26,
    MODEL: 28,
    TRIM: 109,
    SERIES: 34,

    // Body
    BODY_CLASS: 5,
    VEHICLE_TYPE: 39,
    DOORS: 14,

    // Engine
    DISPLACEMENT_L: 13,
    DISPLACEMENT_CC: 11,
    ENGINE_CYLINDERS: 9,
    ENGINE_CONFIG: 12,
    FUEL_TYPE_PRIMARY: 24,
    ENGINE_HP: 71,

    // Transmission
    TRANSMISSION_STYLE: 37,
    TRANSMISSION_SPEEDS: 38,

    // Drivetrain
    DRIVE_TYPE: 15,

    // Manufacturer
    MANUFACTURER_NAME: 27,
    PLANT_COUNTRY: 75,
    PLANT_CITY: 76,
    PLANT_COMPANY: 77,

    // Other specs
    GVWR: 25,
    CURB_WEIGHT: 54,
    BRAKE_SYSTEM: 6,
    STEERING_TYPE: 36,

    // Error info
    ERROR_CODE: 143,
    ERROR_TEXT: 191
  }

  const year = getNumericById(VARS.MODEL_YEAR)
  const make = getById(VARS.MAKE)
  const model = getById(VARS.MODEL)
  const errorCode = getById(VARS.ERROR_CODE)

  // Check if decoding was successful
  // Error codes: 0 = success, other codes indicate issues
  const valid = make !== null && year !== null && (errorCode === '0' || errorCode === null)

  return {
    vin: vin,
    valid: valid,
    year: year ? Math.round(year) : null,
    make: make,
    model: model,
    trim: getById(VARS.TRIM),
    series: getById(VARS.SERIES),
    body_type: getById(VARS.BODY_CLASS),
    vehicle_type: getById(VARS.VEHICLE_TYPE),
    doors: getNumericById(VARS.DOORS) ? Math.round(getNumericById(VARS.DOORS)!) : null,
    engine: {
      displacement_liters: getById(VARS.DISPLACEMENT_L),
      displacement_cc: getNumericById(VARS.DISPLACEMENT_CC) ? Math.round(getNumericById(VARS.DISPLACEMENT_CC)!) : null,
      cylinders: getNumericById(VARS.ENGINE_CYLINDERS) ? Math.round(getNumericById(VARS.ENGINE_CYLINDERS)!) : null,
      configuration: getById(VARS.ENGINE_CONFIG),
      fuel_type: getById(VARS.FUEL_TYPE_PRIMARY),
      horsepower: getNumericById(VARS.ENGINE_HP) ? Math.round(getNumericById(VARS.ENGINE_HP)!) : null
    },
    transmission: {
      style: getById(VARS.TRANSMISSION_STYLE),
      speeds: getById(VARS.TRANSMISSION_SPEEDS)
    },
    drivetrain: getById(VARS.DRIVE_TYPE),
    manufacturer: getById(VARS.MANUFACTURER_NAME),
    plant: {
      country: getById(VARS.PLANT_COUNTRY),
      city: getById(VARS.PLANT_CITY),
      company: getById(VARS.PLANT_COMPANY)
    },
    gvwr: getById(VARS.GVWR),
    curb_weight: getNumericById(VARS.CURB_WEIGHT) ? Math.round(getNumericById(VARS.CURB_WEIGHT)!) : null,
    brake_system: getById(VARS.BRAKE_SYSTEM),
    steering_type: getById(VARS.STEERING_TYPE),
    error_code: errorCode,
    error_message: valid ? null : getById(VARS.ERROR_TEXT) || 'Could not decode VIN - may be invalid or not in NHTSA database'
  }
}

/**
 * Parse NHTSA Recalls API response into structured recall info
 */
function parseRecallResults(results: any[]): RecallInfo[] {
  return results.map(recall => ({
    campaign_number: recall.NHTSACampaignNumber || recall.campaignNumber || '',
    recall_date: recall.ReportReceivedDate || recall.reportReceivedDate || '',
    component: recall.Component || recall.component || '',
    summary: recall.Summary || recall.summary || '',
    consequence: recall.Consequence || recall.consequence || '',
    remedy: recall.Remedy || recall.remedy || '',
    manufacturer: recall.Manufacturer || recall.manufacturer || '',
    notes: recall.Notes || recall.notes || null
  }))
}
