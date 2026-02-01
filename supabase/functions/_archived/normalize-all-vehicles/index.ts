import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Vehicle hierarchy knowledge
const TRUCK_SERIES = [
  'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
  'C1500', 'K1500', 'C2500', 'K2500', 'C3500', 'K3500',
  'R1500', 'V1500', 'R2500', 'V2500', 'R3500', 'V3500',
  'C5', 'K5'
]
const TRUCK_TRIMS = ['Cheyenne', 'Silverado', 'Scottsdale', 'Custom Deluxe', 'Big 10', 'Sierra', 'Sierra Classic', 'High Sierra', 'Custom', 'Base']
const TRUCK_MODELS = ['Truck', 'Pickup', 'C/K']

const CAMARO_TRIMS = ['RS', 'SS', 'Z28', 'Z/28', 'LT', 'LS', 'IROC', 'Berlinetta', 'Sport', 'Base']
const CAMARO_MODELS = ['Camaro']

const SUBURBAN_SERIES = ['C10', 'K10', 'C1500', 'K1500', 'C2500', 'K2500', 'R1500', 'V1500', 'R2500', 'V2500']
const SUBURBAN_TRIMS = ['Silverado', 'Cheyenne', 'Custom Deluxe', 'LS', 'LT', 'LTZ']
const SUBURBAN_MODELS = ['Suburban']

const BLAZER_SERIES = ['K5', 'C5']

const getYearNumber = (year: any): number | null => {
  if (typeof year === 'number' && Number.isFinite(year)) return year
  const parsed = Number.parseInt(String(year || ''), 10)
  return Number.isFinite(parsed) ? parsed : null
}

const isRvEra = (year: number | null): boolean => {
  return !!year && year >= 1988 && year <= 1991
}

const normalizeRvPrefix = (prefix: string, year: number | null): string => {
  const upper = prefix.toUpperCase()
  if (upper === 'R' || upper === 'V') {
    return isRvEra(year) ? upper : (upper === 'R' ? 'C' : 'K')
  }
  return upper
}
const BLAZER_TRIMS = ['Silverado', 'Cheyenne', 'Custom', 'Base']
const BLAZER_MODELS = ['Blazer', 'K5 Blazer']

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { vehicle_id, limit = 200 } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://qkgaybvrernstplzjaam.supabase.co'
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    let vehicles: any[] = []
    
    if (vehicle_id) {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model, series, trim, discovery_url, transmission, drivetrain, notes, origin_metadata')
        .eq('id', vehicle_id)
        .single()
      
      if (error) throw error
      if (data) vehicles = [data]
    } else {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model, series, trim, discovery_url, transmission, drivetrain, notes, origin_metadata')
        .limit(limit)
      
      if (error) throw error
      vehicles = data || []
    }
    
    console.log(`Found ${vehicles.length} vehicles to normalize`)

    if (vehicles.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No vehicles to normalize', normalized: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let normalized = 0
    const errors: any[] = []

    for (const vehicle of vehicles) {
      try {
        const updates: any = {}
        let needsUpdate = false
        let originalModel = vehicle.model || ''
        let originalSeries = vehicle.series || ''
        let originalTrim = vehicle.trim || ''
        
        const make = (vehicle.make || '').trim()
        const model = (vehicle.model || '').trim()
        const series = (vehicle.series || '').trim()
        const trim = (vehicle.trim || '').trim()
        const yearNum = getYearNumber(vehicle.year)
        
        const makeLower = make.toLowerCase()
        const modelLower = model.toLowerCase()
        const seriesLower = series.toLowerCase()
        const trimLower = trim.toLowerCase()
        const rvHint = modelLower.includes('r/v') || modelLower.includes('rv')
        
        // Normalize make
        if (makeLower === 'chevy' || makeLower === 'chevrolet') {
          if (make !== 'Chevrolet') {
            updates.make = 'Chevrolet'
            needsUpdate = true
          }
        } else if (makeLower === 'gmc') {
          if (make !== 'GMC') {
            updates.make = 'GMC'
            needsUpdate = true
          }
        } else if (makeLower === 'square') {
          updates.make = 'Chevrolet'
          needsUpdate = true
        } else if (makeLower === 'diesel') {
          // Infer from model
          if (modelLower.includes('sierra') || modelLower.includes('gmc')) {
            updates.make = 'GMC'
          } else {
            updates.make = 'Chevrolet'
          }
          needsUpdate = true
        } else if (makeLower === 'benz') {
          updates.make = 'Mercedes-Benz'
          needsUpdate = true
        } else if (makeLower === 'chev') {
          updates.make = 'Chevrolet'
          needsUpdate = true
        }
        
        // Detect what type of vehicle we're dealing with
        const isTruck = modelLower.includes('truck') || modelLower.includes('pickup') || 
                       modelLower.includes('c/k') || modelLower === 'c/k' ||
                       TRUCK_SERIES.some(s => modelLower.includes(s.toLowerCase())) ||
                       (makeLower.includes('chevrolet') || makeLower.includes('gmc')) && 
                       (modelLower === '' || modelLower === '-' || modelLower.includes('c') || modelLower.includes('k'))
        
        const isCamaro = modelLower.includes('camaro') || CAMARO_MODELS.some(m => modelLower.includes(m.toLowerCase()))
        const isSuburban = modelLower.includes('suburban') || SUBURBAN_MODELS.some(m => modelLower.includes(m.toLowerCase()))
        const isBlazer = modelLower.includes('blazer') || modelLower.includes('k5') || BLAZER_MODELS.some(m => modelLower.includes(m.toLowerCase()))
        
        // Extract series from model field if it's there
        let extractedSeries: string | null = null
        let extractedTrim: string | null = null
        let cleanModel = model
        
        // Check if model contains R/V series (1988-1991 squarebody)
        const rvSeriesInModel = modelLower.match(/\b([rv])\s*-?\s*(1500|2500|3500)\b/i)
        if (rvSeriesInModel && !series) {
          const prefix = normalizeRvPrefix(rvSeriesInModel[1], yearNum)
          extractedSeries = `${prefix}${rvSeriesInModel[2]}`
          cleanModel = cleanModel.replace(new RegExp(`${rvSeriesInModel[1]}\\s*-?\\s*${rvSeriesInModel[2]}`, 'gi'), '').trim()
          needsUpdate = true
        }

        // Check if model contains series designation (C10, K10, C1500, K2500, etc.)
        const seriesInModel = modelLower.match(/\b([ck]\d{2,4}|[ck]1500|[ck]2500|[ck]3500|[ck]5)\b/i)
        if (seriesInModel && !series && !extractedSeries) {
          extractedSeries = seriesInModel[1].toUpperCase()
          cleanModel = cleanModel.replace(new RegExp(seriesInModel[1], 'gi'), '').trim()
          needsUpdate = true
        }
        
        // Check if model contains standalone numbers that are series (1500, 2500, 3500, etc.)
        // Also check for "V1500" (old GMC designation, should be K1500)
        // Handle "2500 HD" pattern - extract the number as series
        const seriesNumberMatch = modelLower.match(/\b([rvk]?1500|[rvk]?2500|[rvk]?3500|250|350)\s*(?:hd)?\b/i)
        if (seriesNumberMatch && !series && (isTruck || isSuburban || makeLower.includes('gmc') || makeLower.includes('chevrolet'))) {
          let number = seriesNumberMatch[1]
          let prefix = 'C' // Default to 2WD
          
          // Handle R/V (1988-1991) and K/C prefixes
          if (number.toLowerCase().startsWith('r') || number.toLowerCase().startsWith('v')) {
            prefix = normalizeRvPrefix(number.charAt(0), yearNum)
            number = number.substring(1)
          } else if (number.toLowerCase().startsWith('k')) {
            prefix = 'K'
            number = number.substring(1)
          } else if (number.toLowerCase().startsWith('c')) {
            prefix = 'C'
            number = number.substring(1)
          } else {
            // No prefix, infer from drivetrain or model context
            const driveLower = (vehicle.drivetrain || '').toLowerCase()
            if (driveLower.includes('4wd') || driveLower.includes('4') || driveLower.includes('4x4')) {
              prefix = 'K'
            } else if (isSuburban && modelLower.includes('v1500')) {
              prefix = 'K' // V1500 is 4WD
            } else {
              prefix = 'C'
            }
          }
          
          // Handle 250/350 vs 2500/3500
          if (number === '250' || number === '350') {
            extractedSeries = `${prefix}${number}0`
          } else {
            extractedSeries = `${prefix}${number}`
          }
          // Remove the number and any "HD" that follows
          cleanModel = cleanModel.replace(new RegExp(seriesNumberMatch[1] + '\\s*hd?', 'gi'), '').trim()
          needsUpdate = true
        }
        
        // Also check for standalone "2500", "3500", "1500" in model (after other cleanup)
        if (!extractedSeries && !series) {
          const standaloneSeries = cleanModel.match(/^\s*(1500|2500|3500|250|350)\s*(?:hd)?\s*$/i)
          if (standaloneSeries && (isTruck || isSuburban || makeLower.includes('gmc') || makeLower.includes('chevrolet'))) {
            const number = standaloneSeries[1]
            const driveLower = (vehicle.drivetrain || '').toLowerCase()
            let prefix = driveLower.includes('4wd') || driveLower.includes('4') || driveLower.includes('4x4') ? 'K' : 'C'
            if (isRvEra(yearNum) && rvHint) {
              if (driveLower.includes('4wd') || driveLower.includes('4') || driveLower.includes('4x4')) {
                prefix = 'V'
              } else if (driveLower.includes('2wd') || driveLower.includes('rwd')) {
                prefix = 'R'
              }
            }
            if (number === '250' || number === '350') {
              extractedSeries = `${prefix}${number}0`
            } else {
              extractedSeries = `${prefix}${number}`
            }
            cleanModel = 'Truck'
            if (isSuburban) cleanModel = 'Suburban'
            needsUpdate = true
          }
        }
        
        // Check if model is just a number (likely series)
        const numberOnly = modelLower.match(/^\s*(\d{3,4})\s*$/)
        if (numberOnly && !series && (isTruck || isSuburban)) {
          const driveLower = (vehicle.drivetrain || '').toLowerCase()
          let prefix = driveLower.includes('4wd') || driveLower.includes('4') ? 'K' : 'C'
          if (isRvEra(yearNum) && rvHint) {
            if (driveLower.includes('4wd') || driveLower.includes('4') || driveLower.includes('4x4')) {
              prefix = 'V'
            } else if (driveLower.includes('2wd') || driveLower.includes('rwd')) {
              prefix = 'R'
            }
          }
          const number = numberOnly[1]
          if (number === '250' || number === '350') {
            extractedSeries = `${prefix}${number}0`
          } else {
            extractedSeries = `${prefix}${number}`
          }
          cleanModel = 'Truck'
          needsUpdate = true
        }
        
        // Extract trim from model field
        let trimInModel: string | null = null
        if (isTruck) {
          const truckTrimMatch = modelLower.match(/\b(cheyenne|silverado|scottsdale|custom deluxe|big 10|sierra classic|high sierra|sierra|custom)\b/i)
          if (truckTrimMatch && !trim) {
            let trimName = truckTrimMatch[1]
            if (trimName.toLowerCase() === 'sierra classic') {
              trimInModel = 'Sierra Classic'
            } else if (trimName.toLowerCase() === 'high sierra') {
              trimInModel = 'High Sierra'
            } else {
              trimInModel = trimName.charAt(0).toUpperCase() + trimName.slice(1).toLowerCase()
            }
            cleanModel = cleanModel.replace(new RegExp(trimName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim()
            needsUpdate = true
          }
        } else if (isCamaro) {
          const camaroTrimMatch = modelLower.match(/\b(rs|ss|z28|z\/28|lt|ls|iroc|berlinetta|sport)\b/i)
          if (camaroTrimMatch && !trim) {
            trimInModel = camaroTrimMatch[1].toUpperCase()
            cleanModel = 'Camaro'
            needsUpdate = true
          }
        } else if (isSuburban) {
          const suburbanTrimMatch = modelLower.match(/\b(silverado|cheyenne|custom deluxe|ls|lt|ltz)\b/i)
          if (suburbanTrimMatch && !trim) {
            trimInModel = suburbanTrimMatch[1].charAt(0).toUpperCase() + suburbanTrimMatch[1].slice(1).toLowerCase()
            cleanModel = 'Suburban'
            needsUpdate = true
          }
        } else if (isBlazer) {
          const blazerTrimMatch = modelLower.match(/\b(silverado|cheyenne|custom)\b/i)
          if (blazerTrimMatch && !trim) {
            trimInModel = blazerTrimMatch[1].charAt(0).toUpperCase() + blazerTrimMatch[1].slice(1).toLowerCase()
            cleanModel = 'Blazer'
            needsUpdate = true
          }
        }
        
        // Check if series field contains model data (wrong field)
        if (series && !model && (seriesLower.includes('truck') || seriesLower.includes('pickup') || seriesLower.includes('camaro') || seriesLower.includes('suburban') || seriesLower.includes('blazer'))) {
          // Series field has model data - swap them
          updates.model = series
          updates.series = null
          needsUpdate = true
        }
        
        // Check if trim field contains series data (wrong field)
        // Handle cases like trim="2500 HD" or trim="C10" or trim="K1500"
        if (trim && !series) {
          // Check if trim is a series designation
          const trimIsSeries = TRUCK_SERIES.some(s => trimLower === s.toLowerCase())
          if (trimIsSeries) {
            // Trim field has series data - move it
            updates.series = trim.toUpperCase()
            updates.trim = null
            needsUpdate = true
          } else {
            // Check if trim contains series number (e.g., "2500 HD", "1500", "3500")
            const seriesInTrim = trimLower.match(/\b([rvk]?1500|[rvk]?2500|[rvk]?3500|250|350)\s*(?:hd)?\b/i)
            if (seriesInTrim) {
              let number = seriesInTrim[1]
              let prefix = 'C'
              
              if (number.toLowerCase().startsWith('r') || number.toLowerCase().startsWith('v')) {
                prefix = normalizeRvPrefix(number.charAt(0), yearNum)
                number = number.substring(1)
              } else if (number.toLowerCase().startsWith('k')) {
                prefix = 'K'
                number = number.substring(1)
              } else if (number.toLowerCase().startsWith('c')) {
                prefix = 'C'
                number = number.substring(1)
              } else {
                const driveLower = (vehicle.drivetrain || '').toLowerCase()
                prefix = driveLower.includes('4wd') || driveLower.includes('4') || driveLower.includes('4x4') ? 'K' : 'C'
                if (isRvEra(yearNum) && rvHint) {
                  if (driveLower.includes('4wd') || driveLower.includes('4') || driveLower.includes('4x4')) {
                    prefix = 'V'
                  } else if (driveLower.includes('2wd') || driveLower.includes('rwd')) {
                    prefix = 'R'
                  }
                }
              }
              
              if (number === '250' || number === '350') {
                extractedSeries = `${prefix}${number}0`
              } else {
                extractedSeries = `${prefix}${number}`
              }
              updates.trim = null
              needsUpdate = true
            }
          }
        }
        
        // Check if trim field contains model data (wrong field) - like "Suburban" in trim when model is "Truck"
        if (trim && model && modelLower === 'truck' && (trimLower.includes('suburban') || trimLower.includes('blazer') || trimLower.includes('jimmy'))) {
          // Trim field has model data - move it to model
          if (trimLower.includes('suburban')) {
            updates.model = 'Suburban'
          } else if (trimLower.includes('blazer') || trimLower.includes('jimmy')) {
            updates.model = makeLower.includes('gmc') ? 'Jimmy' : 'Blazer'
          }
          updates.trim = null
          needsUpdate = true
        }
        
        // Check if trim field contains model data (wrong field) - general case
        if (trim && !model && (trimLower.includes('truck') || trimLower.includes('pickup') || trimLower.includes('camaro') || trimLower.includes('suburban') || trimLower.includes('blazer'))) {
          // Trim field has model data - move it
          updates.model = trim
          updates.trim = null
          needsUpdate = true
        }
        
        // Check if model contains other model names (like "Suburban" when it should be the model)
        if (model && modelLower.includes('truck') && (modelLower.includes('suburban') || modelLower.includes('blazer') || modelLower.includes('jimmy'))) {
          if (modelLower.includes('suburban')) {
            cleanModel = 'Suburban'
            cleanModel = cleanModel.replace(/truck/gi, '').replace(/suburban/gi, 'Suburban').trim()
            needsUpdate = true
          } else if (modelLower.includes('blazer') || modelLower.includes('jimmy')) {
            cleanModel = makeLower.includes('gmc') ? 'Jimmy' : 'Blazer'
            cleanModel = cleanModel.replace(/truck/gi, '').trim()
            needsUpdate = true
          }
        }
        
        // Extract trim from model if series is already present (e.g., "Suburban K2500 LS" → series="K2500", trim="LS")
        // Also extract from original model before cleanup
        if ((series || extractedSeries) && !trim && (isSuburban || isTruck)) {
          const trimAfterSeries = modelLower.match(/\b(ls|lt|ltz|slt|slt1|slt2|silverado|cheyenne|custom deluxe|base|custom)\b/i)
          if (trimAfterSeries) {
            let trimName = trimAfterSeries[1].toUpperCase()
            // Normalize trim names
            if (trimName === 'SLT' || trimName === 'SLT1' || trimName === 'SLT2') trimName = 'SLT'
            else if (trimName === 'LS') trimName = 'LS'
            else if (trimName === 'LT') trimName = 'LT'
            else if (trimName === 'LTZ') trimName = 'LTZ'
            else {
              trimName = trimAfterSeries[1].charAt(0).toUpperCase() + trimAfterSeries[1].slice(1).toLowerCase()
            }
            trimInModel = trimName
            cleanModel = cleanModel.replace(new RegExp(trimAfterSeries[1], 'gi'), '').trim()
            needsUpdate = true
          }
        }
        
        // Clean up model field - remove descriptive text, engine info, etc.
        cleanModel = cleanModel
          .replace(/\b(4x4|4wd|rwd|lowered|lifted|dually|single cab|crew cab|extended cab|stepside|fleet side|obs|square body|body|classic|lowered)\b/gi, '')
          .replace(/\b(v6|v8|i4|i6)\b/gi, '') // Engine type
          .replace(/\b\d+\.\d+l\b/gi, '') // Engine liters (7.4L, 5.7L, 8.1L, etc.)
          .replace(/\b\d+ci\b/gi, '') // Engine cubic inches (454ci, etc.)
          .replace(/\b\d+k\s*miles?\b/gi, '') // Mileage
          .replace(/\b\d+\s*miles?\b/gi, '') // Other mileage formats
          .replace(/\b(1500|2500|3500|250|350|r1500|r2500|r3500|v1500|v2500|v3500|k1500|k2500|k3500|c1500|c2500|c3500)\s*hd\b/gi, '') // Remove "HD" suffix
          .replace(/\bhd\b/gi, '') // Remove standalone "HD"
          .replace(/["']/g, '') // Remove quotes
          .replace(/&#215;/g, '') // Remove HTML entity for ×
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim()
        
        // Remove series numbers and designations that might still be in model
        if (cleanModel) {
          cleanModel = cleanModel
            .replace(/\b(1500|2500|3500|250|350|r1500|r2500|r3500|v1500|v2500|v3500|k1500|k2500|k3500|c1500|c2500|c3500|c10|k10|c20|k20|c30|k30|k2500|c2500)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
        }
        
        // Normalize model name
        if (isTruck) {
          if (cleanModel && cleanModel.toLowerCase() !== 'truck' && 
              !cleanModel.toLowerCase().includes('camaro') && 
              !cleanModel.toLowerCase().includes('suburban') &&
              !cleanModel.toLowerCase().includes('blazer')) {
            cleanModel = 'Truck'
            needsUpdate = true
          } else if (!cleanModel || cleanModel === '-' || cleanModel.toLowerCase() === 'c/k') {
            cleanModel = 'Truck'
            needsUpdate = true
          }
        } else if (isCamaro && cleanModel.toLowerCase() !== 'camaro') {
          cleanModel = 'Camaro'
          needsUpdate = true
        } else if (isSuburban && cleanModel.toLowerCase() !== 'suburban') {
          cleanModel = 'Suburban'
          needsUpdate = true
        } else if (isBlazer && !cleanModel.toLowerCase().includes('blazer')) {
          cleanModel = 'Blazer'
          needsUpdate = true
        }
        
        // Apply extracted series
        if (extractedSeries && !series) {
          updates.series = extractedSeries
          needsUpdate = true
        }
        
        // Apply extracted trim
        if (trimInModel && !trim) {
          updates.trim = trimInModel
          needsUpdate = true
        }
        
        // Clean trim field if it contains engine/displacement info
        if (trim && trimLower) {
          let cleanTrim = trim
          // Remove engine/displacement info from trim
          cleanTrim = cleanTrim
            .replace(/\b\d+\.\d+l\b/gi, '') // Engine liters (7.4L, 5.7L, 8.1L, etc.)
            .replace(/\b\d+ci\b/gi, '') // Engine cubic inches
            .replace(/\b(4x4|4wd|rwd)\b/gi, '') // Drivetrain
            .replace(/&#215;/g, '') // HTML entity
            .replace(/\s+/g, ' ')
            .trim()
          
          // If trim contains a valid trim name, extract it
          if (cleanTrim !== trim) {
            const validTrimMatch = cleanTrim.match(/\b(ls|lt|ltz|slt|slt1|slt2|silverado|cheyenne|custom deluxe|base|custom|sierra|sierra classic|high sierra|rs|ss|z28|z\/28|iroc|berlinetta|sport)\b/i)
            if (validTrimMatch) {
              let trimName = validTrimMatch[1]
              if (trimName.toUpperCase() === 'SLT' || trimName.toUpperCase() === 'SLT1' || trimName.toUpperCase() === 'SLT2') {
                cleanTrim = 'SLT'
              } else if (trimName.toLowerCase() === 'sierra classic') {
                cleanTrim = 'Sierra Classic'
              } else if (trimName.toLowerCase() === 'high sierra') {
                cleanTrim = 'High Sierra'
              } else {
                cleanTrim = trimName.toUpperCase() // LS, LT, LTZ, RS, SS, etc.
              }
            } else {
              cleanTrim = cleanTrim // Keep cleaned version
            }
            updates.trim = cleanTrim
            needsUpdate = true
          }
        }
        
        // Update model if changed
        if (cleanModel !== model && cleanModel) {
          updates.model = cleanModel
          needsUpdate = true
        }
        
        // Normalize drivetrain
        if (vehicle.drivetrain) {
          const driveLower = vehicle.drivetrain.toLowerCase().trim()
          if (driveLower === 'rwd' || driveLower.includes('rear')) {
            if (vehicle.drivetrain !== 'RWD') {
              updates.drivetrain = 'RWD'
              needsUpdate = true
            }
          } else if (driveLower === '4wd' || driveLower.includes('4') || driveLower === 'awd') {
            if (vehicle.drivetrain !== '4WD') {
              updates.drivetrain = '4WD'
              needsUpdate = true
            }
          } else if (driveLower === 'fwd' || driveLower.includes('front')) {
            if (vehicle.drivetrain !== 'FWD') {
              updates.drivetrain = 'FWD'
              needsUpdate = true
            }
          }
        }
        
        // Apply updates
        if (needsUpdate) {
          const { error: updateError } = await supabase
            .from('vehicles')
            .update(updates)
            .eq('id', vehicle.id)

          if (updateError) {
            throw updateError
          }

          normalized++
          const changes = Object.keys(updates).join(', ')
          console.log(`✅ ${vehicle.id}: ${changes}`)
        }

      } catch (error: any) {
        console.error(`Error normalizing ${vehicle.id}:`, error.message)
        errors.push({ vehicle_id: vehicle.id, error: error.message })
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: vehicles.length,
        normalized,
        errors: errors.length > 0 ? errors : undefined
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Normalization error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

