/**
 * Auto-Fix Vehicle Profile Edge Function
 * 
 * When images are uploaded:
 * 1. Extract VIN, make, model, series, year, colors from images
 * 2. Decode VIN to get factory specs
 * 3. Compare to existing profile data
 * 4. AUTO-CORRECT mismatches with high confidence
 * 5. FLAG conflicts for review if low confidence
 * 6. Return what was fixed
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ExtractedVehicleData {
  vin?: string
  year?: number
  make?: string
  model?: string
  series?: string
  trim?: string
  exterior_color?: string
  interior_color?: string
  body_style?: string
  drivetrain?: string
  engine_size?: string
  transmission?: string
  confidence: number
  extraction_method: 'vin_decode' | 'vision_ai' | 'combined'
  evidence: {
    field: string
    value: any
    source: string // "VIN decode", "Visible in image 3", etc.
    confidence: number
  }[]
}

interface ProfileFix {
  field: string
  old_value: any
  new_value: any
  confidence: number
  evidence: string
  action: 'corrected' | 'added' | 'flagged_conflict'
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { vehicle_id, image_ids } = await req.json()

    if (!vehicle_id || !image_ids || !Array.isArray(image_ids) || image_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: vehicle_id, image_ids' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log(`[Auto-Fix] Starting for vehicle ${vehicle_id} with ${image_ids.length} images`)

    // Step 1: Get current vehicle profile
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicle_id)
      .single()

    if (vehicleError || !vehicle) {
      throw new Error('Vehicle not found')
    }

    // Step 2: Get sample images (first 5 for analysis)
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id, image_url')
      .in('id', image_ids.slice(0, 5))

    if (imagesError || !images || images.length === 0) {
      throw new Error('Images not found')
    }

    // Step 3: Extract vehicle data from images using Vision AI
    const extracted = await extractVehicleDataFromImages(images.map(img => img.image_url), vehicle)

    // Step 4: Compare and fix
    const fixes = await compareAndFix(vehicle, extracted, supabase)

    return new Response(
      JSON.stringify({
        success: true,
        fixes,
        extracted_data: extracted,
        message: fixes.length > 0 
          ? `Auto-corrected ${fixes.filter(f => f.action === 'corrected').length} fields`
          : 'Profile data matches images - no corrections needed'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[Auto-Fix] Error:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        stack: error.stack
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function extractVehicleDataFromImages(
  imageUrls: string[],
  currentData: any
): Promise<ExtractedVehicleData> {
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const prompt = `Analyze these vehicle images and extract the following data:

CRITICAL INSTRUCTIONS:
1. Look for VIN (on dashboard, door jamb, title, registration)
2. Identify make, model, year from badges, body style, design cues
3. Identify series (C10, K5, K1500, Silverado, etc.) from emblems/badges
4. Note exterior and interior colors
5. Identify body style, drivetrain indicators (4WD badges, etc.)

CURRENT PROFILE DATA (might be WRONG):
Year: ${currentData.year || 'Unknown'}
Make: ${currentData.make || 'Unknown'}
Model: ${currentData.model || 'Unknown'}
Series: ${currentData.series || 'Unknown'}
Trim: ${currentData.trim || 'Unknown'}
Exterior Color: ${currentData.exterior_color_primary || 'Unknown'}
Interior Color: ${currentData.interior_color_primary || 'Unknown'}

Your job: Extract the ACTUAL data from images and identify what's WRONG.

Return JSON:
{
  "vin": "if visible in images",
  "year": number,
  "make": "GMC/Chevrolet/etc",
  "model": "C10/Blazer/etc",
  "series": "C10/K10/K5/etc - IMPORTANT!",
  "trim": "High Sierra/Silverado/etc",
  "exterior_color": "actual color visible",
  "interior_color": "actual color visible",
  "body_style": "Pickup/SUV/etc",
  "drivetrain": "2WD/4WD/AWD",
  "engine_size": "if visible on badges",
  "transmission": "if determinable",
  "confidence": 0-100,
  "evidence": [
    {"field": "series", "value": "C10", "source": "Badge visible in image 2", "confidence": 95},
    {"field": "year", "value": 1983, "source": "VIN decode + body style", "confidence": 98}
  ]
}

Return ONLY JSON. Be specific about what you see.`

  const userMessage = {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      ...imageUrls.slice(0, 5).map(url => ({
        type: 'image' as const,
        source: {
          type: 'url' as const,
          url
        }
      }))
    ]
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-opus-20240229',
      max_tokens: 2000,
      messages: [userMessage]
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.content[0].text

  // Parse JSON
  let jsonText = content
  const jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/) || content.match(/(\{[\s\S]*\})/)
  if (jsonMatch) {
    jsonText = jsonMatch[1] || jsonMatch[0]
  }

  const extracted = JSON.parse(jsonText) as ExtractedVehicleData
  
  // If VIN found, decode it for authoritative data
  if (extracted.vin) {
    const vinData = await decodeVIN(extracted.vin)
    if (vinData) {
      // Merge VIN data (authoritative) with vision data
      extracted.year = vinData.year || extracted.year
      extracted.make = vinData.make || extracted.make
      extracted.model = vinData.model || extracted.model
      extracted.body_style = vinData.body_style || extracted.body_style
      extracted.extraction_method = 'combined'
      
      // Add VIN decode evidence
      extracted.evidence.push({
        field: 'vin',
        value: extracted.vin,
        source: 'VIN decoded via NHTSA',
        confidence: 100
      })
    }
  }

  return extracted
}

async function decodeVIN(vin: string): Promise<any> {
  try {
    const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`)
    const data = await response.json()
    
    if (!data.Results) return null

    const results = data.Results
    const getValue = (variable: string) => {
      const item = results.find((r: any) => r.Variable === variable)
      return item?.Value || null
    }

    return {
      year: parseInt(getValue('Model Year')) || null,
      make: getValue('Make') || null,
      model: getValue('Model') || null,
      body_style: getValue('Body Class') || null,
      trim: getValue('Trim') || null,
      engine: getValue('Engine Configuration') || null,
      drivetrain: getValue('Drive Type') || null
    }
  } catch (err) {
    console.error('VIN decode failed:', err)
    return null
  }
}

async function compareAndFix(
  currentVehicle: any,
  extracted: ExtractedVehicleData,
  supabase: any
): Promise<ProfileFix[]> {
  const fixes: ProfileFix[] = []
  const updates: any = {}

  // Define field mappings and confidence thresholds
  const fieldMappings = [
    { current: 'year', extracted: 'year', threshold: 90 },
    { current: 'make', extracted: 'make', threshold: 85 },
    { current: 'model', extracted: 'model', threshold: 85 },
    { current: 'series', extracted: 'series', threshold: 80 },
    { current: 'trim', extracted: 'trim', threshold: 75 },
    { current: 'exterior_color_primary', extracted: 'exterior_color', threshold: 70 },
    { current: 'interior_color_primary', extracted: 'interior_color', threshold: 70 },
    { current: 'body_style', extracted: 'body_style', threshold: 80 },
    { current: 'drivetrain', extracted: 'drivetrain', threshold: 85 },
    { current: 'vin', extracted: 'vin', threshold: 100 }
  ]

  for (const mapping of fieldMappings) {
    const currentValue = currentVehicle[mapping.current]
    const extractedValue = extracted[mapping.extracted as keyof ExtractedVehicleData]
    
    if (!extractedValue) continue // No extracted data for this field

    const evidence = extracted.evidence.find(e => e.field === mapping.extracted)
    const confidence = evidence?.confidence || extracted.confidence

    // Check if needs fixing
    const needsFix = !currentValue || 
                     currentValue === '' || 
                     currentValue === 'Unknown' ||
                     (currentValue && extractedValue && 
                      currentValue.toString().toLowerCase() !== extractedValue.toString().toLowerCase())

    if (needsFix) {
      if (confidence >= mapping.threshold) {
        // HIGH CONFIDENCE: Auto-fix
        updates[mapping.current] = extractedValue
        fixes.push({
          field: mapping.current,
          old_value: currentValue || 'Missing',
          new_value: extractedValue,
          confidence,
          evidence: evidence?.source || 'Extracted from images',
          action: currentValue ? 'corrected' : 'added'
        })
      } else {
        // LOW CONFIDENCE: Flag for review
        fixes.push({
          field: mapping.current,
          old_value: currentValue || 'Missing',
          new_value: extractedValue,
          confidence,
          evidence: evidence?.source || 'Extracted from images',
          action: 'flagged_conflict'
        })
      }
    }
  }

  // Apply updates if any
  if (Object.keys(updates).length > 0) {
    console.log(`[Auto-Fix] Applying ${Object.keys(updates).length} corrections:`, updates)
    
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', currentVehicle.id)

    if (updateError) {
      console.error('[Auto-Fix] Error applying updates:', updateError)
      throw new Error(`Failed to apply corrections: ${updateError.message}`)
    }

    // Log the auto-fix to vehicle metadata
    const { error: logError } = await supabase
      .from('vehicles')
      .update({
        metadata: {
          ...currentVehicle.metadata,
          auto_fixes: {
            last_run: new Date().toISOString(),
            total_fixes: fixes.filter(f => f.action === 'corrected').length,
            history: [
              ...(currentVehicle.metadata?.auto_fixes?.history || []),
              {
                timestamp: new Date().toISOString(),
                fixes: fixes.filter(f => f.action === 'corrected')
              }
            ].slice(-10) // Keep last 10 auto-fix runs
          }
        }
      })
      .eq('id', currentVehicle.id)

    if (logError) {
      console.warn('[Auto-Fix] Failed to log fix history:', logError)
    }
  }

  return fixes
}

// Deno deploy expects this
export default Deno.serve

