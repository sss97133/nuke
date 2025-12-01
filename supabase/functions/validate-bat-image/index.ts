import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ValidationRequest {
  image_id: string;
  image_url: string;
  vehicle_id: string;
  expected_vehicle?: {
    year: number;
    make: string;
    model: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    )

    const { image_id, image_url, vehicle_id, expected_vehicle }: ValidationRequest = await req.json()

    console.log(`🔍 Validating BAT image: ${image_id} for vehicle ${vehicle_id}`)

    // Get vehicle info if not provided
    let vehicleInfo = expected_vehicle;
    if (!vehicleInfo) {
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .select('year, make, model')
        .eq('id', vehicle_id)
        .single()

      if (vehicleError || !vehicle) {
        throw new Error(`Vehicle not found: ${vehicle_id}`)
      }

      vehicleInfo = {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model
      }
    }

    // Use Claude 3.5 Haiku (cheapest model) to analyze the image
    const validationResult = await validateImageWithAI(image_url, vehicleInfo)

    // Get current ai_scan_metadata
    const currentMetadata = await getCurrentMetadata(supabase, image_id)

    // Update image record with validation results in ai_scan_metadata
    const { error: updateError } = await supabase
      .from('vehicle_images')
      .update({
        ai_scan_metadata: {
          ...currentMetadata,
          validation: {
            validated_at: new Date().toISOString(),
            matches_vehicle: validationResult.matches,
            confidence: validationResult.confidence,
            detected_vehicle: validationResult.detected,
            expected_vehicle: vehicleInfo,
            mismatch_reason: validationResult.mismatch_reason,
            validation_status: validationResult.matches ? 'valid' : 'mismatch'
          }
        }
      })
      .eq('id', image_id)

    if (updateError) {
      console.error('Error updating image metadata:', updateError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        validation: validationResult,
        image_id,
        vehicle_id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('❌ Validation error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function getCurrentMetadata(supabase: any, imageId: string): Promise<any> {
  const { data: image } = await supabase
    .from('vehicle_images')
    .select('ai_scan_metadata')
    .eq('id', imageId)
    .single()

  return image?.ai_scan_metadata || {}
}

async function validateImageWithAI(
  imageUrl: string,
  expectedVehicle: { year: number; make: string; model: string }
): Promise<any> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  // Validate expected vehicle data
  if (!expectedVehicle.year || !expectedVehicle.make || !expectedVehicle.model) {
    throw new Error('Invalid vehicle data: year, make, and model are required')
  }

  const prompt = `You are an expert automotive appraiser. Analyze this vehicle image and determine if it matches the expected vehicle.

EXPECTED VEHICLE:
- Year: ${expectedVehicle.year}
- Make: ${expectedVehicle.make}
- Model: ${expectedVehicle.model}

TASK:
1. Identify the vehicle in the image (year, make, model)
2. Compare it to the expected vehicle
3. Determine if they match
4. Provide confidence score (0-100)
5. If they don't match, explain why

Return ONLY valid JSON in this exact format:
{
  "detected": {
    "year": detected_year_number_or_null,
    "make": "detected_make_or_null",
    "model": "detected_model_or_null",
    "confidence": confidence_0_to_100
  },
  "matches": true_or_false,
  "confidence": overall_confidence_0_to_100,
  "mismatch_reason": "explanation_if_not_matching_or_null",
  "analysis": "brief_description_of_what_you_see"
}

Be strict - if you cannot clearly identify the vehicle or if there's any doubt, mark as mismatch.`

  // Retry logic with exponential backoff
  const maxRetries = 3
  let lastError: Error | null = null
  let result: any = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Add timeout protection (25 seconds)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 25000)

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022', // Cheapest Anthropic vision model
          max_tokens: 500,
          temperature: 0.1,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'url',
                    url: imageUrl
                  }
                },
                {
                  type: 'text',
                  text: prompt
                }
              ]
            }
          ]
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      // Handle rate limits (429) with retry-after
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') || '60'
        const delay = parseInt(retryAfter) * 1000
        
        if (attempt < maxRetries) {
          console.log(`Rate limited, waiting ${retryAfter}s before retry ${attempt + 1}/${maxRetries}`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        } else {
          throw new Error(`Rate limit exceeded after ${maxRetries} retries`)
        }
      }

      if (!response.ok) {
        const errorText = await response.text()
        // Don't retry on client errors (400, 401, 403)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`Anthropic API error: ${response.status} - ${errorText}`)
        }
        // Retry on server errors (500+)
        if (attempt < maxRetries) {
          const delay = 1000 * Math.pow(2, attempt) // Exponential backoff: 1s, 2s, 4s
          console.log(`Server error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
        throw new Error(`Anthropic API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      const contentText = data.content?.[0]?.text

      if (!contentText) {
        throw new Error('No response from Anthropic')
      }

      // Extract JSON from response (Claude may wrap in markdown)
      const jsonMatch = contentText.match(/\{[\s\S]*\}/)
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(contentText)
      
      // Success - break out of retry loop
      break

    } catch (error: any) {
      lastError = error
      
      // Don't retry on abort (timeout) or client errors
      if (error.name === 'AbortError' || (error.message?.includes('400') || error.message?.includes('401') || error.message?.includes('403'))) {
        throw error
      }
      
      // Retry on network errors or server errors
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt) // Exponential backoff
        console.log(`Validation attempt ${attempt + 1} failed, retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
    }
  }

  // If we get here, all retries failed
  if (lastError || !result) {
    throw lastError || new Error('Validation failed after all retries')
  }

  // Process result and return validation
  const normalize = (str: string | null) => str ? str.toLowerCase().trim() : null

  // Vehicle name synonyms - common variations that refer to the same vehicle
  // Expanded list for better matching across all vehicle types
  const modelSynonyms: { [key: string]: string[] } = {
    // Jaguar
    'xke': ['e-type', 'etype', 'e type', 'e-type roadster'],
    'e-type': ['xke', 'etype', 'e type', 'xke roadster'],
    'etype': ['xke', 'e-type', 'e type'],
    'e type': ['xke', 'e-type', 'etype'],
    // Porsche
    '911': ['carrera', 'carrera 911'],
    'carrera': ['911', 'carrera 911'],
    // Chevrolet
    'corvette': ['vette', 'stingray'],
    'vette': ['corvette', 'stingray'],
    'stingray': ['corvette', 'vette'],
    'c10': ['c-10', 'c 10', 'cheyenne'],
    'c20': ['c-20', 'c 20'],
    'k10': ['k-10', 'k 10'],
    'k20': ['k-20', 'k 20'],
    'suburban': ['sub', 'burban'],
    'silverado': ['silverado 1500', 'silverado 2500'],
    // Ford
    'mustang': ['stang', 'mustang gt'],
    'stang': ['mustang', 'mustang gt'],
    'f-150': ['f150', 'f 150', 'f150 raptor'],
    'f150': ['f-150', 'f 150', 'f-150 raptor'],
    'bronco': ['bronco ii', 'bronco 2'],
    'raptor': ['f-150 raptor', 'f150 raptor'],
    // GMC
    'sierra': ['sierra 1500', 'sierra 2500'],
    // Dodge/Ram
    'ram': ['ram 1500', 'ram 2500', 'dodge ram'],
    'charger': ['dodge charger'],
    'challenger': ['dodge challenger'],
    // Toyota
    'land cruiser': ['landcruiser', 'fj40', 'fj60'],
    'fj40': ['land cruiser', 'landcruiser'],
    // General patterns
    'series i': ['series 1', 'series one'],
    'series ii': ['series 2', 'series two'],
    'series iii': ['series 3', 'series three']
  }

  const normalizeModel = (model: string | null): string | null => {
    if (!model) return null
    const normalized = normalize(model)
    if (!normalized) return null
    
    // Check if this model has synonyms
    for (const [key, synonyms] of Object.entries(modelSynonyms)) {
      if (normalized.includes(key)) {
        // Return the base name for comparison
        return key
      }
      for (const synonym of synonyms) {
        if (normalized.includes(synonym)) {
          return key
        }
      }
    }
    
    return normalized
  }

  const detectedMake = normalize(result.detected?.make)
  const detectedModel = normalizeModel(result.detected?.model)
  const expectedMake = normalize(expectedVehicle.make)
  const expectedModel = normalizeModel(expectedVehicle.model)

  // Check if matches - also check if models contain each other (for variations like "XKE Series I 3.8 Roadster" vs "E-Type Series I")
  const makeMatches = detectedMake && expectedMake && detectedMake === expectedMake
  
  let modelMatches = false
  if (detectedModel && expectedModel) {
    // Exact match
    if (detectedModel === expectedModel) {
      modelMatches = true
    } else {
      // Check if one contains the other (for variations)
      modelMatches = detectedModel.includes(expectedModel) || expectedModel.includes(detectedModel)
      // Also check synonyms
      if (!modelMatches) {
        const detectedBase = normalizeModel(detectedModel)
        const expectedBase = normalizeModel(expectedModel)
        modelMatches = detectedBase === expectedBase
      }
    }
  }
  
  const yearMatches = result.detected?.year && 
    Math.abs(result.detected.year - expectedVehicle.year) <= 2 // Allow 2 year variance

  const matches = makeMatches && modelMatches && yearMatches && result.matches !== false

  return {
    detected: result.detected || {},
    matches,
    confidence: result.confidence || (matches ? 85 : 20),
    mismatch_reason: matches ? null : (result.mismatch_reason || 
      `Detected: ${result.detected?.year || '?'} ${result.detected?.make || '?'} ${result.detected?.model || '?'}, Expected: ${expectedVehicle.year} ${expectedVehicle.make} ${expectedVehicle.model}`),
    analysis: result.analysis || ''
  }
}
