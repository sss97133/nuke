/**
 * identify-vehicle-from-image
 *
 * Uses AI vision to identify vehicle year, make, model, and trim from an image.
 * Tiered approach: Gemini Flash (free) -> GPT-4o-mini -> GPT-4o
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

/**
 * Fetch an image and return as base64.
 * Retries once on 429 with a 2s delay.
 */
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 1s, 3s
        await new Promise(r => setTimeout(r, attempt * 2000))
        console.log(`[identify-vehicle] Image fetch retry #${attempt}...`)
      }

      const response = await fetch(imageUrl, {
        signal: AbortSignal.timeout(20000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': new URL(imageUrl).origin + '/',
        }
      })

      if (response.status === 429) {
        lastError = new Error(`Rate limited (429) fetching image (attempt ${attempt + 1})`)
        continue
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
      }

      // Detect mime type from response headers or URL
      const contentType = response.headers.get('content-type') || detectMimeType(imageUrl)

      const arrayBuffer = await response.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)

      if (uint8Array.length === 0) {
        throw new Error('Empty image response')
      }

      // Convert to base64 using chunks to avoid stack overflow on large images
      const chunkSize = 8192
      let binary = ''
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length))
        binary += String.fromCharCode(...chunk)
      }

      const base64 = btoa(binary)
      console.log(`[identify-vehicle] Image fetched: ${uint8Array.length} bytes, ${base64.length} base64 chars, type=${contentType}`)
      return { base64, mimeType: contentType }
    } catch (err: any) {
      lastError = err
      if (err.message?.includes('Rate limited')) continue
      // Don't retry non-rate-limit errors
      throw err
    }
  }

  throw lastError || new Error('Failed to fetch image after retries')
}

function detectMimeType(imageUrl: string): string {
  const lower = imageUrl.toLowerCase()
  if (lower.includes('.png')) return 'image/png'
  if (lower.includes('.gif')) return 'image/gif'
  if (lower.includes('.webp')) return 'image/webp'
  return 'image/jpeg'
}

// Track errors per tier for reporting
const tierErrors: Record<string, string> = {}

async function identifyWithTier(
  supabase: any,
  userId: string | null,
  imageBase64: string | null,
  imageMimeType: string,
  imageUrl: string,
  context: { title?: string; description?: string } | null,
  tier: AnalysisTier
): Promise<VehicleIdentification | null> {
  try {
    console.log(`[identify-vehicle] ${tier}: getting LLM config...`)
    const config = await getLLMConfig(supabase, userId, undefined, undefined, tier)
    console.log(`[identify-vehicle] ${tier}: provider=${config.provider} model=${config.model} keyLen=${config.apiKey?.length || 0}`)

    // If we don't have base64 and provider needs it, skip this tier
    if (!imageBase64 && config.provider !== 'openai') {
      throw new Error(`Image fetch failed and ${config.provider} requires base64 - skipping`)
    }

    // Build context string if available
    let contextString = ''
    if (context?.title) {
      contextString += `\n\nListing title: "${context.title}"`
    }
    if (context?.description) {
      const truncatedDesc = context.description.substring(0, 500)
      contextString += `\n\nListing description excerpt: "${truncatedDesc}..."`
    }

    const fullPrompt = IDENTIFICATION_PROMPT + (contextString ? `\n\nAdditional context from the listing:${contextString}` : '')

    // Build messages based on provider
    // Use base64 when available, URL pass-through for OpenAI when not
    let messages: any[]

    if (config.provider === 'openai') {
      const imageContent = imageBase64
        ? { url: `data:${imageMimeType};base64,${imageBase64}`, detail: 'high' }
        : { url: imageUrl, detail: 'high' as const }
      console.log(`[identify-vehicle] ${tier}: using ${imageBase64 ? 'base64' : 'URL pass-through'} for OpenAI`)
      messages = [{
        role: 'user',
        content: [
          { type: 'text', text: fullPrompt },
          { type: 'image_url', image_url: imageContent }
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
              media_type: imageMimeType,
              data: imageBase64
            }
          },
          { type: 'text', text: fullPrompt }
        ]
      }]
    } else if (config.provider === 'google') {
      messages = [{
        role: 'user',
        content: [
          { type: 'text', text: fullPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${imageMimeType};base64,${imageBase64}`
            }
          }
        ]
      }]
    } else {
      throw new Error(`Unsupported provider: ${config.provider}`)
    }

    console.log(`[identify-vehicle] ${tier}: calling LLM (${config.provider}/${config.model})...`)
    const result = await callLLM(config, messages, {
      temperature: 0.3,
      maxTokens: 1000,
      vision: true
    })
    console.log(`[identify-vehicle] ${tier}: LLM responded, content length=${result.content?.length || 0}`)

    // Parse the JSON response
    const content = result.content || ''

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    } else {
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
    console.error(`[identify-vehicle] ${tier} FAILED: ${error.message}`)
    tierErrors[tier] = error.message
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
      max_tier = 'tier3'
    } = await req.json()

    if (!image_url) {
      throw new Error('Missing required parameter: image_url')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, detectSessionInUrl: false }
    })

    // Normalize Cloudinary URLs to force JPEG format (AVIF/WebP rejected by OpenAI vision)
    let normalizedImageUrl = image_url
    if (image_url.includes('res.cloudinary.com') && image_url.includes('/upload/')) {
      normalizedImageUrl = image_url.replace('/upload/', '/upload/f_jpg/')
      console.log(`[identify-vehicle] Cloudinary URL detected, forcing JPEG: ${normalizedImageUrl.substring(0, 100)}...`)
    }

    console.log(`[identify-vehicle] Starting identification for: ${normalizedImageUrl.substring(0, 100)}...`)

    // Fetch image ONCE and reuse across all tiers (avoids rate limiting from multiple fetches)
    let imageBase64: string | null = null
    let imageMimeType: string = detectMimeType(normalizedImageUrl)
    let imageFetchFailed = false
    try {
      const imageData = await fetchImageAsBase64(normalizedImageUrl)
      imageBase64 = imageData.base64
      imageMimeType = imageData.mimeType
    } catch (fetchErr: any) {
      console.warn(`[identify-vehicle] Failed to fetch image locally: ${fetchErr.message}`)
      console.log(`[identify-vehicle] Will attempt URL-pass-through mode (OpenAI can fetch URLs directly)`)
      imageFetchFailed = true
    }

    // Tiered approach: try cheaper models first, escalate if confidence is low
    const tiers: AnalysisTier[] = ['tier1', 'tier2', 'tier3', 'expert']
    const maxTierIndex = tiers.indexOf(max_tier as AnalysisTier)
    let allowedTiers = tiers.slice(0, maxTierIndex + 1)

    // If image fetch failed, prioritize OpenAI tiers (can use URL pass-through)
    // tier2 and tier3 use OpenAI, so start with tier2 when we don't have base64
    if (imageFetchFailed) {
      console.log(`[identify-vehicle] Image fetch failed - prioritizing OpenAI tiers (URL pass-through)`)
      // Reorder: OpenAI tiers first (tier2=gpt-4o-mini, tier3=gpt-4o), then others
      allowedTiers = allowedTiers.filter(t => t === 'tier2' || t === 'tier3')
      if (allowedTiers.length === 0) {
        allowedTiers = ['tier2'] // Fallback to at least tier2
      }
    }

    let bestResult: VehicleIdentification | null = null
    const attempts: Array<{ tier: string; result: VehicleIdentification | null; error?: string }> = []

    // Clear tier errors
    for (const t of allowedTiers) { tierErrors[t] = '' }

    for (const tier of allowedTiers) {
      console.log(`[identify-vehicle] Trying ${tier}...`)

      const result = await identifyWithTier(
        supabase, user_id || null,
        imageBase64, imageMimeType, normalizedImageUrl,
        context || null, tier
      )

      attempts.push({
        tier,
        result,
        error: result ? undefined : (tierErrors[tier] || 'Failed to get result')
      })

      if (result) {
        if (result.confidence >= min_confidence) {
          bestResult = result
          console.log(`[identify-vehicle] ${tier} succeeded with confidence ${result.confidence}`)
          break
        }

        if (!bestResult || result.confidence > bestResult.confidence) {
          bestResult = result
        }

        if (result.confidence < 0.4) {
          console.log(`[identify-vehicle] ${tier} confidence ${result.confidence} too low, escalating...`)
          continue
        }

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
