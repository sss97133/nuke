import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { vehicle_id, limit = 20 } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://qkgaybvrernstplzjaam.supabase.co'
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get vehicles to normalize
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
      // Normalize ALL vehicles, not just Craigslist ones
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model, series, trim, discovery_url, transmission, drivetrain, notes, origin_metadata, discovery_source')
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

        // Normalize make: "Chevy" → "Chevrolet", "Gmc" → "GMC", "Square" → "Chevrolet", "Diesel" → infer from model
        if (vehicle.make) {
          const makeLower = vehicle.make.toLowerCase().trim()
          if (makeLower === 'chevy' || makeLower === 'chevrolet') {
            if (vehicle.make !== 'Chevrolet') {
              updates.make = 'Chevrolet'
              needsUpdate = true
            }
          } else if (makeLower === 'gmc') {
            if (vehicle.make !== 'GMC') {
              updates.make = 'GMC'
              needsUpdate = true
            }
          } else if (makeLower === 'square') {
            // Common error: "Square body" gets split into make="Square", model="body"
            updates.make = 'Chevrolet'
            needsUpdate = true
          } else if (makeLower === 'diesel') {
            // "Diesel" is not a make - infer from model or default to Chevrolet
            // Check if model contains GMC indicators
            const modelLower = (vehicle.model || '').toLowerCase()
            if (modelLower.includes('sierra') || modelLower.includes('gmc')) {
              updates.make = 'GMC'
            } else {
              updates.make = 'Chevrolet' // Default for squarebody trucks
            }
            needsUpdate = true
          }
        }

        // Normalize model: Extract series/trim from model field if it contains them
        // Examples: "c10 cheyenne" → model="Truck", series="C10", trim="Cheyenne"
        //           "k10 4x4 square body" → model="Truck", series="K10"
        //           "3500 lowered dually" → model="Truck", series="C3500" or "K3500"
        if (vehicle.model) {
          const modelLower = vehicle.model.toLowerCase().trim()
          const yearNum = getYearNumber(vehicle.year)
          let newModel = vehicle.model
          let extractedSeries: string | null = null
          let extractedTrim: string | null = null
          
          // Check for R/V series (1988-1991 squarebody)
          const rvSeriesMatch = modelLower.match(/\b([rv])\s*-?\s*(1500|2500|3500)\b/i)
          if (rvSeriesMatch) {
            const prefix = normalizeRvPrefix(rvSeriesMatch[1], yearNum)
            extractedSeries = `${prefix}${rvSeriesMatch[2]}`
            newModel = newModel.replace(new RegExp(`${rvSeriesMatch[1]}\\s*-?\\s*${rvSeriesMatch[2]}`, 'gi'), '').trim()
          }

          // Check if model contains series designation (C10, K10, C20, K20, C3500, K3500, etc.)
          const seriesMatch = modelLower.match(/\b([ck]\d{2,4}|[ck]1500|[ck]2500|[ck]3500)\b/)
          if (seriesMatch && !extractedSeries) {
            extractedSeries = seriesMatch[1].toUpperCase()
            // Remove series from model
            newModel = newModel.replace(new RegExp(seriesMatch[1], 'gi'), '').trim()
          }
          
          // Check if model is just a number (3500, 2500, etc.) - likely a series
          const numberOnlyMatch = modelLower.match(/^\s*(\d{3,4})\s*$/)
          if (numberOnlyMatch && !extractedSeries) {
            // Infer series based on drivetrain (if available) or default to C
            const driveLower = (vehicle.drivetrain || '').toLowerCase()
            const inferred4wd = driveLower.includes('4wd') || driveLower.includes('4') || modelLower.includes('4x4') || modelLower.includes('4wd')
            let prefix = inferred4wd ? 'K' : 'C'
            if (isRvEra(yearNum) && (modelLower.includes('r/v') || modelLower.includes('rv'))) {
              if (driveLower.includes('4wd') || modelLower.includes('4x4') || modelLower.includes('4wd')) {
                prefix = 'V'
              } else if (driveLower.includes('2wd') || modelLower.includes('2wd') || driveLower.includes('rwd')) {
                prefix = 'R'
              }
            }
            extractedSeries = `${prefix}${numberOnlyMatch[1]}`
            newModel = 'Truck'
            needsUpdate = true
          }
          
          // Check if model contains trim (Cheyenne, Silverado, Scottsdale, Sierra, High Sierra, etc.)
          const trimMatch = modelLower.match(/\b(cheyenne|silverado|scottsdale|custom deluxe|big 10|sierra classic|high sierra|sierra)\b/i)
          if (trimMatch) {
            let trimName = trimMatch[1]
            // Handle multi-word trims
            if (trimName.toLowerCase() === 'sierra classic') {
              extractedTrim = 'Sierra Classic'
            } else if (trimName.toLowerCase() === 'high sierra') {
              extractedTrim = 'High Sierra'
            } else {
              extractedTrim = trimName.charAt(0).toUpperCase() + trimName.slice(1).toLowerCase()
            }
            // Remove trim from model (handle both "sierra" and "sierra classic")
            newModel = newModel.replace(new RegExp(trimName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim()
            // Also remove "high" if it's part of "high sierra"
            if (trimName.toLowerCase().includes('sierra') && modelLower.includes('high')) {
              newModel = newModel.replace(/\bhigh\b/gi, '').trim()
            }
          }
          
          // Remove common descriptive words that shouldn't be in model
          newModel = newModel
            .replace(/\b(4x4|4wd|rwd|lowered|lifted|dually|single cab|crew cab|extended cab|stepside|fleet side|obs|square body|body|classic)\b/gi, '')
            .replace(/\b\d+k\s*miles?\b/gi, '') // Remove mileage
            .replace(/\b\d+\s*miles?\b/gi, '') // Remove other mileage formats
            .replace(/\b\d{3,4}\b/g, '') // Remove standalone numbers (series designations)
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim()
          
          // Check if remaining model contains trim names that should be extracted
          const remainingTrimMatch = newModel.match(/\b(sierra classic|high sierra|sierra|silverado|cheyenne|scottsdale|custom deluxe|big 10)\b/i)
          if (remainingTrimMatch && !extractedTrim) {
            let trimName = remainingTrimMatch[1]
            if (trimName.toLowerCase() === 'sierra classic') {
              extractedTrim = 'Sierra Classic'
            } else if (trimName.toLowerCase() === 'high sierra') {
              extractedTrim = 'High Sierra'
            } else {
              extractedTrim = trimName.charAt(0).toUpperCase() + trimName.slice(1).toLowerCase()
            }
            newModel = newModel.replace(new RegExp(trimName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').trim()
            needsUpdate = true
          }
          
          // Handle Camaro variants (RS, SS, Z28, etc.) - extract trim from model
          if (modelLower.includes('camaro')) {
            const camaroTrimMatch = modelLower.match(/\b(rs|ss|z28|z\/28|lt|ls|iroc)\b/i)
            if (camaroTrimMatch && !extractedTrim) {
              extractedTrim = camaroTrimMatch[1].toUpperCase()
              newModel = 'Camaro'
              needsUpdate = true
            } else {
              newModel = 'Camaro'
            }
          }
          
          // Remove quotes and clean up
          newModel = newModel.replace(/["']/g, '').trim()
          
          // If model is now empty or just contains "truck"/"pickup"/"c/k", normalize to "Truck"
          if (!newModel || newModel.toLowerCase().includes('truck') || newModel.toLowerCase().includes('pickup') || newModel.toLowerCase() === 'c/k' || newModel === '-' || newModel.toLowerCase() === 'high' || newModel.toLowerCase() === 'diesel') {
            newModel = 'Truck'
          }
          
          // Update model if changed
          if (newModel !== vehicle.model) {
            updates.model = newModel
            needsUpdate = true
          }
          
          // Update series if extracted and not already set
          if (extractedSeries && !vehicle.series) {
            updates.series = extractedSeries
            needsUpdate = true
          }
          
          // Update trim if extracted and not already set
          if (extractedTrim && !vehicle.trim) {
            updates.trim = extractedTrim
            needsUpdate = true
          }
          
          // Special case: "Square" make + "body" model → Chevrolet Truck
          if (vehicle.make && vehicle.make.toLowerCase() === 'square' && vehicle.model.toLowerCase() === 'body') {
            updates.make = 'Chevrolet'
            updates.model = 'Truck'
            needsUpdate = true
          }
        }

        // Normalize drivetrain: "rwd" → "RWD", "4wd" → "4WD"
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

        // Re-scrape if we have a discovery_url to get better data
        if (vehicle.discovery_url && (!vehicle.series || !vehicle.trim)) {
          try {
            console.log(`Re-scraping ${vehicle.id} to get series/trim...`)
            const scrapeResponse = await fetch(`${supabaseUrl}/functions/v1/scrape-vehicle`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ url: vehicle.discovery_url })
            })

            if (scrapeResponse.ok) {
              const scrapeData = await scrapeResponse.json()
              if (scrapeData.data) {
                const data = scrapeData.data
                
                // Update series if missing
                if (data.series && !vehicle.series) {
                  updates.series = data.series
                  needsUpdate = true
                }
                
                // Update trim if missing
                if (data.trim && !vehicle.trim) {
                  updates.trim = data.trim
                  needsUpdate = true
                }
                
                // Store engine_status and transmission_status in notes or origin_metadata
                if (data.engine_status) {
                  const originMeta = (vehicle.origin_metadata as any) || {}
                  if (!originMeta.engine_status) {
                    originMeta.engine_status = data.engine_status
                    updates.origin_metadata = originMeta
                    needsUpdate = true
                  }
                }
                
                if (data.transmission_status) {
                  const originMeta = (vehicle.origin_metadata as any) || {}
                  if (!originMeta.transmission_status) {
                    originMeta.transmission_status = data.transmission_status
                    if (data.transmission_status === 'No Transmission') {
                      updates.transmission = null
                    }
                    updates.origin_metadata = originMeta
                    needsUpdate = true
                  }
                }
              }
            }
          } catch (scrapeError: any) {
            console.error(`Failed to re-scrape ${vehicle.id}:`, scrapeError.message)
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
          console.log(`✅ Normalized ${vehicle.id}:`, Object.keys(updates).join(', '))
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

