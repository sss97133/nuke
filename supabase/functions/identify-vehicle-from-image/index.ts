/**
 * identify-vehicle-from-image
 *
 * Uses AI vision to identify vehicle year, make, model, and trim from an image.
 * Tiered approach: Gemini Flash (free) → GPT-4o-mini → GPT-4o
 *
 * Input: { image_url, context?: { title?, description? }, vehicle_id? }
 * Output: { year, make, model, trim, body_style, confidence, reasoning, model_used }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getLLMConfig, callLLM, type AnalysisTier } from '../_shared/llmProvider.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface VehicleIdentification {
  year: number | null
  make: string | null
  model: string | null
  trim: string | null
  body_style: string | null
  generation: string | null
  confidence: number
  reasoning: string
  model_used: string
  provider: string
  duration_ms: number
  tier_used: string
}

const IDENTIFICATION_PROMPT = `You are an expert automotive appraiser and vehicle identifier. Analyze this image to identify the vehicle.

Look for:
1. Body style and proportions (sedan, coupe, truck, SUV, etc.)
2. Front grille design and headlight shape
3. Side profile and roofline
4. Rear design and taillights
5. Wheels and wheel arches
6. Any visible badges, emblems, or model names
7. Era/generation indicators (design language, features)

Based on the image, provide your best identification:

Respond in JSON format:
{
  "year": <4-digit year or null if uncertain>,
  "year_range": "<e.g. '1973-1987' if can only narrow to a range>",
  "make": "<manufacturer name>",
  "model": "<model name>",
  "trim": "<trim level if identifiable, else null>",
  "body_style": "<sedan|coupe|hatchback|wagon|convertible|truck|suv|van|other>",
  "generation": "<generation name/number if known, e.g. 'C3' for Corvette>",
  "confidence": <0.0-1.0 how confident you are>,
  "reasoning": "<brief explanation of key identifying features you observed>"
}

Be conservative with confidence scores:
- 0.9+ = Very certain (clear badges visible, distinctive unmistakable design)
- 0.7-0.9 = Confident (strong visual match, generation identifiable)
- 0.5-0.7 = Moderate (body style clear but specific model uncertain)
- <0.5 = Low (can only identify general class of vehicle)

If the image doesn't clearly show a vehicle or is too blurry/obscured, set confidence below 0.3.`

async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  // Convert to base64
  let binary = ''
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }

  return btoa(binary)
}

function detectMimeType(imageUrl: string): string {
  const lower = imageUrl.toLowerCase()
  if (lower.includes('.png')) return 'image/png'
  if (lower.includes('.gif')) return 'image/gif'
  if (lower.includes('.webp')) return 'image/webp'
  return 'image/jpeg' // Default to JPEG
}

async function identifyWithTier(
  supabase: any,
  userId: string | null,
  imageUrl: string,
  context: { title?: string; description?: string } | null,
  tier: AnalysisTier
): Promise<VehicleIdentification | null> {
  try {
    const config = await getLLMConfig(supabase, userId, undefined, undefined, tier)

    // Fetch and encode image
    const base64Image = await fetchImageAsBase64(imageUrl)
    const mimeType = detectMimeType(imageUrl)

    // Build context string if available
    let contextString = ''
    if (context?.title) {
      contextString += `\n\nListing title: "${context.title}"`
    }
    if (context?.description) {
      // Truncate description to avoid token limits
      const truncatedDesc = context.description.substring(0, 500)
      contextString += `\n\nListing description excerpt: "${truncatedDesc}..."`
    }

    const fullPrompt = IDENTIFICATION_PROMPT + (contextString ? `\n\nAdditional context from the listing:${contextString}` : '')

    // Build messages based on provider
    let messages: any[]

    if (config.provider === 'openai') {
      messages = [{
        role: 'user',
        content: [
          { type: 'text', text: fullPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: 'high'
            }
          }
        ]
      }]
    } else if (config.provider === 'anthropic') {
      messages = [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: base64Image
            }
          },
          { type: 'text', text: fullPrompt }
        ]
      }]
    } else if (config.provider === 'google') {
      // Google/Gemini format - the llmProvider handles conversion
      messages = [{
        role: 'user',
        content: [
          { type: 'text', text: fullPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`
            }
          }
        ]
      }]
    } else {
      throw new Error(`Unsupported provider: ${config.provider}`)
    }

    const result = await callLLM(config, messages, {
      temperature: 0.3, // Lower temperature for more consistent identification
      maxTokens: 1000,
      vision: true
    })

    // Parse the JSON response
    const content = result.content || ''

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    } else {
      // Try to find JSON object directly
      const objectMatch = content.match(/\{[\s\S]*\}/)
      if (objectMatch) {
        jsonStr = objectMatch[0]
      }
    }

    const parsed = JSON.parse(jsonStr)

    return {
      year: parsed.year || null,
      make: parsed.make || null,
      model: parsed.model || null,
      trim: parsed.trim || null,
      body_style: parsed.body_style || null,
      generation: parsed.generation || null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reasoning: parsed.reasoning || '',
      model_used: config.model,
      provider: config.provider,
      duration_ms: result.duration_ms || 0,
      tier_used: tier
    }
  } catch (error: any) {
    console.warn(`[identify-vehicle] ${tier} failed:`, error.message)
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const startTime = Date.now()

    const {
      image_url,
      context,
      vehicle_id,
      user_id,
      min_confidence = 0.5,
      max_tier = 'tier3' // Don't go to 'expert' by default (expensive)
    } = await req.json()

    if (!image_url) {
      throw new Error('Missing required parameter: image_url')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, detectSessionInUrl: false }
    })

    console.log(`[identify-vehicle] Starting identification for: ${image_url.substring(0, 100)}...`)

    // Tiered approach: try cheaper models first, escalate if confidence is low
    const tiers: AnalysisTier[] = ['tier1', 'tier2', 'tier3', 'expert']
    const maxTierIndex = tiers.indexOf(max_tier as AnalysisTier)
    const allowedTiers = tiers.slice(0, maxTierIndex + 1)

    let bestResult: VehicleIdentification | null = null
    const attempts: Array<{ tier: string; result: VehicleIdentification | null; error?: string }> = []

    for (const tier of allowedTiers) {
      console.log(`[identify-vehicle] Trying ${tier}...`)

      const result = await identifyWithTier(supabase, user_id || null, image_url, context || null, tier)

      attempts.push({
        tier,
        result,
        error: result ? undefined : 'Failed to get result'
      })

      if (result) {
        // If confidence meets threshold, we're done
        if (result.confidence >= min_confidence) {
          bestResult = result
          console.log(`[identify-vehicle] ${tier} succeeded with confidence ${result.confidence}`)
          break
        }

        // Keep this result if it's better than what we have
        if (!bestResult || result.confidence > bestResult.confidence) {
          bestResult = result
        }

        // If confidence is very low, try next tier
        if (result.confidence < 0.4) {
          console.log(`[identify-vehicle] ${tier} confidence ${result.confidence} too low, escalating...`)
          continue
        }

        // Moderate confidence - accept it
        console.log(`[identify-vehicle] ${tier} confidence ${result.confidence} acceptable`)
        break
      }
    }

    const totalDuration = Date.now() - startTime

    if (!bestResult) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to identify vehicle from image',
          attempts,
          duration_ms: totalDuration
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // If vehicle_id provided, optionally update the vehicle record
    if (vehicle_id && bestResult.confidence >= min_confidence) {
      try {
        const updateData: any = {}

        // Only update fields that are missing on the vehicle
        const { data: existingVehicle } = await supabase
          .from('vehicles')
          .select('year, make, model, body_style, origin_metadata')
          .eq('id', vehicle_id)
          .single()

        if (existingVehicle) {
          if (!existingVehicle.year && bestResult.year) {
            updateData.year = bestResult.year
          }
          if (!existingVehicle.make && bestResult.make) {
            updateData.make = bestResult.make
          }
          if (!existingVehicle.model && bestResult.model) {
            updateData.model = bestResult.model
          }
          if (!existingVehicle.body_style && bestResult.body_style) {
            updateData.body_style = bestResult.body_style
          }

          // Store AI identification in origin_metadata
          const existingMeta = existingVehicle.origin_metadata || {}
          updateData.origin_metadata = {
            ...existingMeta,
            ai_vehicle_identification: {
              ...bestResult,
              identified_at: new Date().toISOString(),
              source_image_url: image_url
            }
          }

          if (Object.keys(updateData).length > 0) {
            await supabase
              .from('vehicles')
              .update(updateData)
              .eq('id', vehicle_id)

            console.log(`[identify-vehicle] Updated vehicle ${vehicle_id} with AI identification`)
          }
        }
      } catch (updateErr: any) {
        console.warn(`[identify-vehicle] Failed to update vehicle (non-fatal):`, updateErr.message)
      }
    }

    // Log to field_extraction_log for tracking
    if (vehicle_id) {
      try {
        const fieldsToLog = [
          { field_name: 'year', field_value: bestResult.year?.toString() || null, confidence: bestResult.confidence },
          { field_name: 'make', field_value: bestResult.make, confidence: bestResult.confidence },
          { field_name: 'model', field_value: bestResult.model, confidence: bestResult.confidence },
          { field_name: 'body_style', field_value: bestResult.body_style, confidence: bestResult.confidence },
        ].filter(f => f.field_value)

        for (const field of fieldsToLog) {
          await supabase.from('field_extraction_log').insert({
            vehicle_id,
            source: 'ai_image_identification',
            field_name: field.field_name,
            extracted_value: field.field_value,
            confidence: field.confidence,
            extraction_method: `${bestResult.provider}/${bestResult.model_used}`,
            status: 'extracted',
            metadata: {
              image_url,
              tier_used: bestResult.tier_used,
              reasoning: bestResult.reasoning
            }
          })
        }
      } catch (logErr: any) {
        console.warn(`[identify-vehicle] Failed to log extraction (non-fatal):`, logErr.message)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        identification: bestResult,
        attempts: attempts.map(a => ({ tier: a.tier, success: !!a.result, confidence: a.result?.confidence })),
        duration_ms: totalDuration
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('[identify-vehicle] Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
