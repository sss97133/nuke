/**
 * backfill-craigslist-vehicles
 *
 * Cleans up legacy Craigslist vehicle data with broken/incomplete make/model.
 * Re-parses description and title with improved logic, queues stubborn cases for AI vision.
 *
 * Input: { batch_size?: number, dry_run?: boolean, use_ai_vision?: boolean, ai_confidence_threshold?: number }
 * Output: { processed, fixed, ai_queued, failed, skipped }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// ENHANCED PARSING UTILITIES (copied from process-cl-queue for consistency)
// ============================================================================

function removeEmojis(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
    .replace(/[★☆✓✔✗✘●○◆◇▶►▷◀◁←→↑↓↔↕⇐⇒⇑⇓⬆⬇⬅➡]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const MODEL_TO_MAKE_MAP: Record<string, string> = {
  'c10': 'Chevrolet', 'c20': 'Chevrolet', 'c30': 'Chevrolet',
  'k10': 'Chevrolet', 'k20': 'Chevrolet', 'k30': 'Chevrolet',
  'c/k': 'Chevrolet', 'ck': 'Chevrolet',
  'silverado': 'Chevrolet', 'cheyenne': 'Chevrolet', 'scottsdale': 'Chevrolet',
  'blazer': 'Chevrolet', 'k5': 'Chevrolet', 'k5 blazer': 'Chevrolet',
  'suburban': 'Chevrolet', 'tahoe': 'Chevrolet',
  'jimmy': 'GMC', 'sierra': 'GMC', 'yukon': 'GMC',
  'squarebody': 'Chevrolet',
  'f100': 'Ford', 'f150': 'Ford', 'f250': 'Ford', 'f350': 'Ford',
  'f-100': 'Ford', 'f-150': 'Ford', 'f-250': 'Ford', 'f-350': 'Ford',
  'bronco': 'Ford', 'ranger': 'Ford', 'mustang': 'Ford',
  'd100': 'Dodge', 'd150': 'Dodge', 'd200': 'Dodge', 'd250': 'Dodge',
  'w100': 'Dodge', 'w150': 'Dodge', 'w200': 'Dodge', 'w250': 'Dodge',
  'ramcharger': 'Dodge', 'power wagon': 'Dodge',
  'wrangler': 'Jeep', 'cherokee': 'Jeep', 'cj5': 'Jeep', 'cj7': 'Jeep',
  'tacoma': 'Toyota', 'tundra': 'Toyota', '4runner': 'Toyota',
  'land cruiser': 'Toyota', 'fj40': 'Toyota', 'fj60': 'Toyota',
  'scout': 'International', 'scout ii': 'International',
  'corvette': 'Chevrolet', 'camaro': 'Chevrolet', 'chevelle': 'Chevrolet',
  'nova': 'Chevrolet', 'impala': 'Chevrolet', 'el camino': 'Chevrolet',
  'gto': 'Pontiac', 'firebird': 'Pontiac', 'trans am': 'Pontiac',
}

function parseDescriptionForDetails(description: string): {
  vin: string | null
  mileage: number | null
  condition: string | null
  engine: string | null
  transmission: string | null
  drivetrain: string | null
  title_status: string | null
} {
  const result = {
    vin: null as string | null,
    mileage: null as number | null,
    condition: null as string | null,
    engine: null as string | null,
    transmission: null as string | null,
    drivetrain: null as string | null,
    title_status: null as string | null,
  }

  if (!description) return result

  const text = description.replace(/\s+/g, ' ')
  const textLower = text.toLowerCase()

  // VIN extraction
  const vinPatterns = [
    /\bvin[:#\s]*([A-HJ-NPR-Z0-9]{17})\b/i,
    /\b([A-HJ-NPR-Z0-9]{17})\b/,
  ]
  for (const pattern of vinPatterns) {
    const match = text.toUpperCase().match(pattern)
    if (match?.[1] && match[1].length === 17) {
      result.vin = match[1]
      break
    }
  }

  // Mileage extraction - comprehensive patterns
  const mileagePatterns = [
    /\b(?:odometer|odo)[:\s]*([\d,]+)/i,                        // "odometer: 125,000"
    /([\d,]+)\s*(?:original|actual)\s*miles?\b/i,               // "68,075 original miles"
    /(?:shows?|has|reads?|only)\s*(\d{1,3})k\s*miles?/i,        // "shows 70k miles"
    /(?:shows?|has|reads?|only)\s*([\d,]+)\s*miles?/i,          // "shows 70,000 miles"
    /(\d{1,3})k\s*(?:original\s+)?mi(?:les?)?\b/i,              // "125k miles" or "70k mi"
    /([\d,]+)\s*miles?\s+(?:from new|on it)/i,                  // "68,075 miles from new"
    /\bmileage[:\s]*([\d,]+)/i,                                 // "mileage: 125,000"
    /([\d,]+)\s*miles?\b/i,                                     // generic "125,000 miles" (last resort)
  ]
  for (const pattern of mileagePatterns) {
    const match = textLower.match(pattern)
    if (match?.[1]) {
      let mileage: number
      const numStr = match[1].replace(/,/g, '')
      // Check if this is a "k miles" pattern (e.g., 70k = 70000)
      if (numStr.length <= 3 && /\dk\s*mi/i.test(match[0])) {
        mileage = parseInt(numStr) * 1000
      } else {
        mileage = parseInt(numStr)
      }
      // Sanity check: mileage should be reasonable
      if (mileage > 0 && mileage <= 500000) {
        result.mileage = mileage
        break
      }
    }
  }

  // Condition
  const conditionSignals: Record<string, string[]> = {
    excellent: ['excellent', 'pristine', 'perfect', 'immaculate', 'showroom', 'mint'],
    good: ['good', 'great', 'nice', 'solid', 'clean', 'runs great', 'runs and drives'],
    fair: ['fair', 'decent', 'okay', 'needs tlc', 'needs work'],
    poor: ['poor', 'rough', 'project', 'parts car', 'barn find', 'non-running'],
    salvage: ['salvage', 'rebuilt', 'flood', 'fire damage']
  }
  for (const [condition, signals] of Object.entries(conditionSignals)) {
    if (signals.some(s => textLower.includes(s))) {
      result.condition = condition
      break
    }
  }

  // Transmission - comprehensive patterns
  if (/\b(automatic|auto)\s*(trans|transmission)?/i.test(textLower)) {
    result.transmission = 'automatic'
  } else if (/\b(th350|th400|turbo\s*350|turbo\s*400|4l60|4l80|700r4|powerglide)\b/i.test(textLower)) {
    result.transmission = 'automatic'
  } else if (/\b(manual|stick|standard)\s*(trans|transmission)?/i.test(textLower)) {
    result.transmission = 'manual'
  } else if (/\b(4|5|6)[- ]?speed\s*(manual|trans)/i.test(textLower)) {
    result.transmission = 'manual'
  }

  // Drivetrain
  if (/\b(4x4|4wd|four wheel drive)\b/i.test(textLower)) result.drivetrain = '4wd'
  else if (/\b(awd|all wheel drive)\b/i.test(textLower)) result.drivetrain = 'awd'
  else if (/\b(2wd|rwd|rear wheel drive)\b/i.test(textLower)) result.drivetrain = 'rwd'

  // Title status
  if (/\b(clean title|clear title)\b/i.test(textLower)) result.title_status = 'clean'
  else if (/\b(salvage title|salvage)\b/i.test(textLower)) result.title_status = 'salvage'
  else if (/\b(rebuilt title|reconstructed)\b/i.test(textLower)) result.title_status = 'rebuilt'
  else if (/\b(no title|lost title|missing title)\b/i.test(textLower)) result.title_status = 'missing'

  return result
}

function extractMakeModelFromTitle(title: string): { make: string | null; model: string | null; year: number | null } {
  if (!title) return { make: null, model: null, year: null }

  const cleaned = removeEmojis(title)
    .replace(/\s+/g, ' ')
    .replace(/\$[\d,]+/g, '') // Remove prices
    .replace(/\([^)]+\)\s*$/g, '') // Remove trailing location
    .trim()

  const result = { make: null as string | null, model: null as string | null, year: null as number | null }

  // Extract year
  const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/)
  if (yearMatch) {
    result.year = parseInt(yearMatch[0])
  }

  // Extract make from known patterns
  const makePattern = /\b(Ford|Chevrolet|Chevy|GMC|Toyota|Honda|Nissan|Datsun|Dodge|Ram|Jeep|BMW|Mercedes|Audi|Volkswagen|VW|Porsche|International|Plymouth|Pontiac|Oldsmobile|Buick|Cadillac|Lincoln|Chrysler|AMC)\b/i
  const makeMatch = cleaned.match(makePattern)
  if (makeMatch) {
    let make = makeMatch[1]
    if (make.toLowerCase() === 'chevy') make = 'Chevrolet'
    if (make.toLowerCase() === 'vw') make = 'Volkswagen'
    result.make = make.charAt(0).toUpperCase() + make.slice(1).toLowerCase()
  }

  // Extract model
  if (result.make) {
    // Remove year and make, what remains is likely model
    let modelText = cleaned
      .replace(/\b(19|20)\d{2}\b/gi, '')
      .replace(new RegExp(`\\b${result.make}\\b`, 'gi'), '')
      .replace(/\bchevy\b/gi, '')
      .trim()

    // Clean up common non-model suffixes
    modelText = modelText
      .replace(/\s+(4x4|4wd|2wd|diesel|gas|automatic|manual|obo|or best offer)\s*$/i, '')
      .replace(/^\s*[-–—]\s*/, '')
      .trim()

    if (modelText.length >= 2) {
      result.model = modelText
    }
  } else {
    // No make found - try to infer from model keywords
    const cleanedLower = cleaned.toLowerCase()
    for (const [modelKey, inferredMake] of Object.entries(MODEL_TO_MAKE_MAP)) {
      if (cleanedLower.includes(modelKey)) {
        result.make = inferredMake
        result.model = modelKey.charAt(0).toUpperCase() + modelKey.slice(1)
        break
      }
    }
  }

  return result
}

function extractLocationFromUrl(url: string): string | null {
  const match = url?.match(/https?:\/\/([^.]+)\.craigslist\.org/)
  if (match && match[1]) {
    const regionCode = match[1]
    const regionMap: Record<string, string> = {
      'sfbay': 'San Francisco Bay Area',
      'losangeles': 'Los Angeles',
      'sandiego': 'San Diego',
      'seattle': 'Seattle',
      'portland': 'Portland',
      'phoenix': 'Phoenix',
      'denver': 'Denver',
      'dallas': 'Dallas',
      'houston': 'Houston',
      'austin': 'Austin',
      'chicago': 'Chicago',
      'detroit': 'Detroit',
      'atlanta': 'Atlanta',
      'miami': 'Miami',
      'boston': 'Boston',
      'newyork': 'New York',
      'philadelphia': 'Philadelphia',
    }
    return regionMap[regionCode.toLowerCase()] || regionCode
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const startTime = Date.now()

    const {
      batch_size = 100,
      dry_run = false,
      use_ai_vision = true,
      ai_confidence_threshold = 0.6,
      offset = 0
    } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, detectSessionInUrl: false }
    })

    console.log(`[backfill-cl] Starting backfill: batch_size=${batch_size}, dry_run=${dry_run}, offset=${offset}`)

    // Query vehicles from Craigslist that need data cleanup
    // Include ALL CL vehicles so we can extract mileage/transmission from descriptions
    const { data: vehicles, error: queryError } = await supabase
      .from('vehicles')
      .select(`
        id, year, make, model, description, listing_title, listing_location,
        discovery_url, discovery_source, origin_metadata, mileage, vin,
        transmission, drivetrain, condition_rating, notes
      `)
      .or('discovery_source.eq.craigslist,discovery_source.eq.craigslist_scrape,discovery_source.eq.craigslist_scrape_test,listing_source.eq.craigslist')
      .order('created_at', { ascending: true })
      .range(offset, offset + batch_size - 1)

    if (queryError) {
      throw new Error(`Query failed: ${queryError.message}`)
    }

    if (!vehicles || vehicles.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No vehicles to process',
          stats: { processed: 0, fixed: 0, ai_queued: 0, failed: 0, skipped: 0 }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`[backfill-cl] Found ${vehicles.length} vehicles to process`)

    const stats = { processed: 0, fixed: 0, ai_queued: 0, failed: 0, skipped: 0 }
    const changes: Array<{ vehicle_id: string; field: string; old_value: any; new_value: any }> = []
    const errors: Array<{ vehicle_id: string; error: string; updates: any }> = []

    for (const vehicle of vehicles) {
      stats.processed++

      try {
        const updates: Record<string, any> = {}
        const vehicleChanges: typeof changes = []

        // Try to extract from title, URL slug, or existing model field
        let titleData = extractMakeModelFromTitle(
          vehicle.listing_title || (vehicle.origin_metadata as any)?.title || ''
        )

        // If no make from title, try URL slug
        if (!titleData.make && vehicle.discovery_url) {
          const urlSlug = vehicle.discovery_url.match(/\/d\/([^\/]+)\/\d+\.html$/)?.[1] || ''
          if (urlSlug) {
            titleData = extractMakeModelFromTitle(urlSlug.replace(/-/g, ' '))
          }
        }

        // If still no make, try to infer from existing model
        if (!titleData.make && vehicle.model) {
          const modelLower = vehicle.model.toLowerCase()
          for (const [modelKey, inferredMake] of Object.entries(MODEL_TO_MAKE_MAP)) {
            if (modelLower.includes(modelKey) || modelLower === modelKey) {
              titleData.make = inferredMake
              break
            }
          }
        }

        // Try to extract from description (or notes for older data)
        const descriptionText = vehicle.description || (vehicle as any).notes || ''
        const descData = parseDescriptionForDetails(descriptionText)

        // Extract location from URL if missing
        if (!vehicle.listing_location && vehicle.discovery_url) {
          const urlLocation = extractLocationFromUrl(vehicle.discovery_url)
          if (urlLocation) {
            updates.listing_location = urlLocation
            vehicleChanges.push({
              vehicle_id: vehicle.id,
              field: 'listing_location',
              old_value: null,
              new_value: urlLocation
            })
          }
        }

        // Fix year if missing
        if (!vehicle.year && titleData.year) {
          updates.year = titleData.year
          vehicleChanges.push({
            vehicle_id: vehicle.id,
            field: 'year',
            old_value: null,
            new_value: titleData.year
          })
        }

        // Fix make if missing or clearly wrong
        const currentMakeBad = !vehicle.make || vehicle.make.length < 2
        if (currentMakeBad && titleData.make) {
          updates.make = titleData.make
          vehicleChanges.push({
            vehicle_id: vehicle.id,
            field: 'make',
            old_value: vehicle.make,
            new_value: titleData.make
          })
        }

        // Fix model if missing or contains junk
        const modelHasJunk = vehicle.model && (
          vehicle.model.includes('$') ||
          vehicle.model.toLowerCase().includes('obo') ||
          vehicle.model.toLowerCase().includes('call') ||
          vehicle.model.toLowerCase().includes('text') ||
          vehicle.model.length > 100
        )
        if ((!vehicle.model || modelHasJunk) && titleData.model) {
          updates.model = titleData.model
          vehicleChanges.push({
            vehicle_id: vehicle.id,
            field: 'model',
            old_value: vehicle.model,
            new_value: titleData.model
          })
        }

        // Fill in missing fields from description
        if (!vehicle.vin && descData.vin) {
          updates.vin = descData.vin
          vehicleChanges.push({ vehicle_id: vehicle.id, field: 'vin', old_value: null, new_value: descData.vin })
        }
        if (!vehicle.mileage && descData.mileage) {
          updates.mileage = descData.mileage
          vehicleChanges.push({ vehicle_id: vehicle.id, field: 'mileage', old_value: null, new_value: descData.mileage })
        }
        if (!vehicle.condition_rating && descData.condition) {
          // Map condition string to numeric rating
          const conditionRatings: Record<string, number> = {
            'excellent': 5, 'good': 4, 'fair': 3, 'poor': 2, 'salvage': 1
          }
          const rating = conditionRatings[descData.condition] || null
          if (rating) {
            updates.condition_rating = rating
            vehicleChanges.push({ vehicle_id: vehicle.id, field: 'condition_rating', old_value: null, new_value: rating })
          }
        }
        if (!vehicle.transmission && descData.transmission) {
          updates.transmission = descData.transmission
          vehicleChanges.push({ vehicle_id: vehicle.id, field: 'transmission', old_value: null, new_value: descData.transmission })
        }
        if (!vehicle.drivetrain && descData.drivetrain) {
          updates.drivetrain = descData.drivetrain
          vehicleChanges.push({ vehicle_id: vehicle.id, field: 'drivetrain', old_value: null, new_value: descData.drivetrain })
        }
        // Note: title_status not stored in vehicles table, skip

        // If we have updates, apply them
        if (Object.keys(updates).length > 0) {
          if (!dry_run) {
            const { error: updateError } = await supabase
              .from('vehicles')
              .update(updates)
              .eq('id', vehicle.id)

            if (updateError) {
              console.error(`[backfill-cl] Failed to update ${vehicle.id}: ${updateError.message}`)
              console.error(`[backfill-cl] Update data was:`, JSON.stringify(updates))
              errors.push({ vehicle_id: vehicle.id, error: updateError.message, updates })
              stats.failed++
              continue
            }
            console.log(`[backfill-cl] Successfully updated ${vehicle.id}:`, JSON.stringify(updates))

            // Log changes to field_extraction_log (with correct column names)
            for (const change of vehicleChanges) {
              await supabase.from('field_extraction_log').insert({
                vehicle_id: vehicle.id,
                source: 'craigslist_backfill',
                field_name: change.field,
                extracted_value: String(change.new_value),
                confidence_score: 0.75,
                extractor_name: 'backfill-craigslist-vehicles',
                extractor_version: '1.0',
                extraction_status: 'extracted'
              }).catch((err) => {
                console.warn(`[backfill-cl] field_extraction_log insert failed (non-fatal): ${err?.message || err}`)
              })
            }
          }

          stats.fixed++
          changes.push(...vehicleChanges)
        } else {
          // No fixes from parsing - check if we should queue for AI
          const stillMissingCritical = !updates.make && !vehicle.make || !updates.model && !vehicle.model

          if (stillMissingCritical && use_ai_vision) {
            // Try to get an image for this vehicle
            const { data: images } = await supabase
              .from('vehicle_images')
              .select('image_url')
              .eq('vehicle_id', vehicle.id)
              .order('is_primary', { ascending: false })
              .limit(1)

            if (images && images.length > 0) {
              // Queue for AI identification
              if (!dry_run) {
                try {
                  const aiResponse = await fetch(
                    `${supabaseUrl}/functions/v1/identify-vehicle-from-image`,
                    {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${serviceRoleKey}`,
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        image_url: images[0].image_url,
                        vehicle_id: vehicle.id,
                        context: {
                          title: vehicle.listing_title,
                          description: vehicle.description?.substring(0, 500)
                        },
                        min_confidence: ai_confidence_threshold
                      })
                    }
                  )

                  const aiResult = await aiResponse.json()
                  if (aiResult.success && aiResult.identification?.confidence >= ai_confidence_threshold) {
                    stats.ai_queued++
                    console.log(`[backfill-cl] AI identified ${vehicle.id}: ${aiResult.identification.year} ${aiResult.identification.make} ${aiResult.identification.model}`)
                  } else {
                    stats.skipped++
                  }
                } catch (aiErr: any) {
                  console.warn(`[backfill-cl] AI identification failed for ${vehicle.id}: ${aiErr.message}`)
                  stats.skipped++
                }
              } else {
                stats.ai_queued++ // Would queue
              }
            } else {
              stats.skipped++ // No image available
            }
          } else {
            stats.skipped++
          }
        }
      } catch (vehicleErr: any) {
        console.error(`[backfill-cl] Error processing ${vehicle.id}:`, vehicleErr.message)
        stats.failed++
      }
    }

    const duration = Date.now() - startTime

    return new Response(
      JSON.stringify({
        success: true,
        dry_run,
        stats,
        changes_preview: changes.slice(0, 20), // Show first 20 changes
        errors_preview: errors.slice(0, 5), // Show first 5 errors for debugging
        next_offset: offset + batch_size,
        has_more: vehicles.length === batch_size,
        duration_ms: duration
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('[backfill-cl] Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
