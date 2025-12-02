/**
 * TIER 1: BASIC ORGANIZATION (Ultra-Cheap & Fast)
 * 
 * Model: GPT-4o-mini
 * Cost: ~$0.0001 per image
 * 
 * Purpose: Quick categorization and quality assessment
 * - Angle detection
 * - Basic category
 * - Image quality
 * - Major components
 * - Basic condition
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { image_url, image_id, vehicle_id, estimated_resolution, user_id } = await req.json()
    if (!image_url) throw new Error('Missing image_url')

    console.log(`Tier 1 analysis: ${image_id}`)

    // Get user API key or fallback to system key
    const { getUserApiKey } = await import('../_shared/getUserApiKey.ts')
    const apiKeyResult = await getUserApiKey(
      supabase,
      user_id || null,
      'anthropic',
      'ANTHROPIC_API_KEY'
    )

    if (!apiKeyResult.apiKey) {
      throw new Error('No API key available (neither user nor system key configured)')
    }

    console.log(`Using ${apiKeyResult.source} API key for analysis`)

    // Quick analysis with Claude (using user's key if available)
    const analysis = await runTier1Analysis(image_url, estimated_resolution || 'medium', apiKeyResult.apiKey)
    
    // Check for SPID sheet if vehicle_id is provided
    let spidData = null
    if (vehicle_id && image_url) {
      try {
        const { detectSPIDSheet } = await import('../_shared/detectSPIDSheet.ts')
        const spidResponse = await detectSPIDSheet(image_url, vehicle_id, supabase, user_id)
        if (spidResponse?.is_spid_sheet && spidResponse.confidence > 70) {
          spidData = spidResponse.extracted_data
          console.log('✅ SPID sheet detected in tier1 analysis:', spidData)
          
          // Save SPID data to dedicated table (triggers auto-verification)
          const { error: spidSaveError } = await supabase
            .from('vehicle_spid_data')
            .upsert({
              vehicle_id: vehicle_id,
              image_id: image_id,
              vin: spidData.vin || null,
              model_code: spidData.model_code || null,
              build_date: spidData.build_date || null,
              sequence_number: spidData.sequence_number || null,
              paint_code_exterior: spidData.paint_code_exterior || null,
              paint_code_interior: spidData.paint_code_interior || null,
              engine_code: spidData.engine_code || null,
              transmission_code: spidData.transmission_code || null,
              axle_ratio: spidData.axle_ratio || null,
              rpo_codes: spidData.rpo_codes || [],
              extraction_confidence: spidResponse.confidence,
              raw_text: spidResponse.raw_text || null,
              extraction_model: 'gpt-4o'
            }, {
              onConflict: 'vehicle_id',
              ignoreDuplicates: false
            })
          
          if (spidSaveError) {
            console.error('Failed to save SPID data:', spidSaveError)
          } else {
            console.log('✅ SPID data saved - auto-verification triggered')
          }
        }
      } catch (err) {
        console.warn('SPID detection failed in tier1:', err)
        // Don't fail the whole analysis if SPID detection fails
      }
    }
    
    // Save to database
    if (image_id) {
      const { data: currentImage } = await supabase
        .from('vehicle_images')
        .select('ai_scan_metadata')
        .eq('id', image_id)
        .single()
      
      const metadata = currentImage?.ai_scan_metadata || {}
      
      const updateData: any = {
        ai_scan_metadata: {
          ...metadata,
          tier_1_analysis: analysis,
          processing_tier_reached: 1,
          scanned_at: new Date().toISOString(),
          ...(spidData ? { spid: spidData } : {})
        },
        image_category: analysis.category || 'exterior',
        category: analysis.category || 'general'
      }
      
      if (estimated_resolution) {
        updateData.estimated_resolution = estimated_resolution
      }
      
      const { data: updatedImage, error: updateError } = await supabase
        .from('vehicle_images')
        .update(updateData)
        .eq('id', image_id)
        .select()
        .single()
      
      if (updateError) {
        console.error('Failed to update image with analysis results:', updateError)
        throw new Error(`Database update failed: ${updateError.message}`)
      }
      
      if (!updatedImage) {
        console.error('Image update returned no data')
        throw new Error('Image update returned no data')
      }
      
      console.log('✅ Analysis results saved to database:', {
        image_id,
        has_tier1: !!updatedImage.ai_scan_metadata?.tier_1_analysis,
        angle: updatedImage.angle,
        category: updatedImage.category,
        has_spid: !!spidData
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        tier: 1,
        ...analysis
      }),
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

async function runTier1Analysis(imageUrl: string, estimatedResolution: string, anthropicKey: string) {
  if (!anthropicKey) throw new Error('Anthropic API key not provided')

  const prompt = `Analyze this vehicle image and provide basic organization data.

Return ONLY valid JSON with this structure:
{
  "angle": "front_3quarter|front_center|rear_3quarter|rear_center|driver_side|passenger_side|overhead|undercarriage|interior_front|interior_rear|engine_bay|trunk|detail_shot|work_progress",
  "category": "exterior_body|interior|engine_mechanical|undercarriage|wheels_tires|trunk_storage|documentation|work_progress",
  "components_visible": ["hood", "door_driver", "fender_front", "wheel", etc],
  "condition_glance": "excellent_clean|good_maintained|average_wear|poor_neglected|damaged|under_restoration",
  "image_quality": {
    "lighting": "good|adequate|poor",
    "focus": "sharp|acceptable|blurry",
    "sufficient_for_detail": true|false,
    "suitable_for_expert": true|false,
    "overall_score": 1-10
  },
  "basic_observations": "Brief description"
}

Be fast and accurate. This is for organization only.`

  // Convert image to base64 for Claude (safe for large images)
  const imageResponse = await fetch(imageUrl)
  const imageBuffer = await imageResponse.arrayBuffer()
  
  // Fix: Don't use spread operator on large arrays (causes stack overflow)
  const bytes = new Uint8Array(imageBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64Image = btoa(binary)
  
  // Get media type and normalize it to valid values for Claude
  let mediaType = imageResponse.headers.get('content-type') || 'image/jpeg'
  
  // Claude only accepts: image/jpeg, image/png, image/gif, image/webp
  // Normalize any variations
  if (mediaType.includes('jpeg') || mediaType.includes('jpg')) {
    mediaType = 'image/jpeg'
  } else if (mediaType.includes('png')) {
    mediaType = 'image/png'
  } else if (mediaType.includes('gif')) {
    mediaType = 'image/gif'
  } else if (mediaType.includes('webp')) {
    mediaType = 'image/webp'
  } else {
    // Default to jpeg for unknown types
    mediaType = 'image/jpeg'
  }
  
  console.log('Image media type:', mediaType)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Image
              }
            },
            {
              type: "text",
              text: prompt
            }
          ]
        }
      ]
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.content[0].text
  
  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  const result = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content)
  
  // Ensure image_quality exists
  if (!result.image_quality) {
    result.image_quality = {
      lighting: 'adequate',
      focus: 'acceptable',
      sufficient_for_detail: true,
      suitable_for_expert: false,
      overall_score: 5
    }
  }
  
  // Enhance with resolution info
  result.image_quality.estimated_resolution = estimatedResolution
  
  // Determine if suitable for expert analysis
  result.image_quality.suitable_for_expert = (
    estimatedResolution === 'high' &&
    result.image_quality.focus === 'sharp' &&
    result.image_quality.lighting !== 'poor'
  )
  
  return result
}

