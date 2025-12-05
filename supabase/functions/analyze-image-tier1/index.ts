/**
 * TIER 1: BASIC ORGANIZATION (Ultra-Cheap & Fast)
 * 
 * Priority: 
 * 1. Gemini 1.5 Flash (Free/Cheap, High Quality)
 * 2. Claude 3 Haiku (Cheap, Fast)
 * 3. GPT-4o-mini (Cheap, High Quality)
 * 
 * Purpose: Quick categorization and quality assessment
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts"

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

    let analysis = null
    let provider = 'none'
    let usageStats = null
    
    // Get user API key or fallback to system key
    const { getUserApiKey } = await import('../_shared/getUserApiKey.ts')
    
    const errors = []

    // 1. Try Gemini
    const geminiKeyResult = await getUserApiKey(supabase, user_id || null, 'google', 'GEMINI_API_KEY')
    if (geminiKeyResult.apiKey) {
      try {
        console.log(`Using Gemini (${geminiKeyResult.source})`)
        const result = await runTier1AnalysisGemini(image_url, estimated_resolution || 'medium', geminiKeyResult.apiKey)
        analysis = result.data
        usageStats = result.usage
        provider = 'gemini'
      } catch (e) {
        console.error('Gemini analysis failed:', e)
        errors.push(`Gemini: ${e.message}`)
      }
    }

    // 2. Try Anthropic if Gemini failed
    if (!analysis) {
      const anthropicKeyResult = await getUserApiKey(supabase, user_id || null, 'anthropic', 'ANTHROPIC_API_KEY')
      if (anthropicKeyResult.apiKey) {
        try {
          console.log(`Using Anthropic (${anthropicKeyResult.source})`)
          const result = await runTier1AnalysisAnthropic(image_url, estimated_resolution || 'medium', anthropicKeyResult.apiKey)
          analysis = result.data
          usageStats = result.usage
          provider = 'anthropic'
        } catch (e) {
          console.error('Anthropic analysis failed:', e)
          errors.push(`Anthropic: ${e.message}`)
        }
      }
    }

    // 3. Try OpenAI if others failed
    if (!analysis) {
      const openaiKeyResult = await getUserApiKey(supabase, user_id || null, 'openai', 'OPENAI_API_KEY')
      if (openaiKeyResult.apiKey) {
        try {
          console.log(`Using OpenAI (${openaiKeyResult.source})`)
          const result = await runTier1AnalysisOpenAI(image_url, estimated_resolution || 'medium', openaiKeyResult.apiKey)
          analysis = result.data
          usageStats = result.usage
          provider = 'openai'
        } catch (e) {
          console.error('OpenAI analysis failed:', e)
          errors.push(`OpenAI: ${e.message}`)
        }
      }
    }

    if (!analysis) {
      if (errors.length === 0) errors.push('No valid API keys available')
      throw new Error(`Analysis failed. ${errors.join(', ')}`)
    }
    
    // Check for SPID sheet if vehicle_id is provided
    let spidData = null
    if (vehicle_id && image_url) {
      try {
        const { detectSPIDSheet } = await import('../_shared/detectSPIDSheet.ts')
        const spidResponse = await detectSPIDSheet(image_url, vehicle_id, supabase, user_id)
        if (spidResponse?.is_spid_sheet && spidResponse.confidence > 70) {
          spidData = spidResponse.extracted_data
          console.log('✅ SPID sheet detected in tier1 analysis:', {
            vin: spidData.vin,
            model_code: spidData.model_code,
            rpo_codes: spidData.rpo_codes?.length || 0,
            confidence: spidResponse.confidence
          })
          
          // Insert SPID data - this triggers comprehensive verification via database trigger
          const { error: spidError } = await supabase.from('vehicle_spid_data').upsert({
              vehicle_id: vehicle_id,
              image_id: image_id,
              vin: spidData.vin || null,
              model_code: spidData.model_code || null,
              build_date: spidData.build_date || null,
              sequence_number: spidData.sequence_number || null,
              paint_code_exterior: spidData.paint_code_exterior || null,
              paint_code_interior: spidData.paint_code_interior || null,
              rpo_codes: spidData.rpo_codes || [],
              engine_code: spidData.engine_code || null,
              transmission_code: spidData.transmission_code || null,
              axle_ratio: spidData.axle_ratio || null,
              extraction_confidence: spidResponse.confidence,
              raw_text: spidResponse.raw_text || null,
              extraction_model: provider
            }, { onConflict: 'vehicle_id', ignoreDuplicates: false })
          
          if (spidError) {
            console.error('Failed to store SPID data:', spidError)
          } else {
            console.log('✅ SPID data stored - verification triggered automatically')
            
            // Trigger VIN decoding if VIN was extracted
            if (spidData.vin) {
              console.log(`🔍 Triggering VIN decode for: ${spidData.vin}`)
              // The database trigger handles this, but we can also call directly for faster response
              try {
                const decodeResponse = await fetch(
                  `${Deno.env.get('SUPABASE_URL')}/functions/v1/decode-vin`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${Deno.env.get('SERVICE_ROLE_KEY')}`
                    },
                    body: JSON.stringify({
                      vin: spidData.vin,
                      vehicle_id: vehicle_id,
                      source: 'spid'
                    })
                  }
                )
                
                if (decodeResponse.ok) {
                  const decodeData = await decodeResponse.json()
                  console.log('✅ VIN decoded:', {
                    valid: decodeData.valid,
                    year: decodeData.year,
                    make: decodeData.make,
                    model: decodeData.model
                  })
                } else {
                  console.warn('VIN decode failed:', await decodeResponse.text())
                }
              } catch (decodeErr) {
                console.warn('Failed to trigger VIN decode:', decodeErr)
              }
            }
          }
        }
      } catch (err) {
        console.warn('SPID detection failed in tier1:', err)
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
          provider: provider,
          usage: usageStats,
          ...(spidData ? { spid: spidData } : {})
        },
        image_category: analysis.category || 'exterior',
        category: analysis.category || 'general',
        ai_processing_status: 'completed',
        ai_processing_completed_at: new Date().toISOString()
      }
      
      if (estimated_resolution) {
        updateData.estimated_resolution = estimated_resolution
      }
      
      const { error: updateError } = await supabase
        .from('vehicle_images')
        .update(updateData)
        .eq('id', image_id)
      
      if (updateError) throw new Error(`Database update failed: ${updateError.message}`)
      
      console.log('✅ Analysis saved:', { image_id, provider, cost: usageStats?.cost })
      
      // 🔍 FORENSIC: Auto-detect receipt/document images and trigger extraction
      // If image is categorized as documentation or contains receipt-like content, extract it
      const isDocumentation = analysis.category === 'documentation' || 
                              analysis.category === 'work_progress' ||
                              (analysis.basic_observations && (
                                analysis.basic_observations.toLowerCase().includes('receipt') ||
                                analysis.basic_observations.toLowerCase().includes('invoice') ||
                                analysis.basic_observations.toLowerCase().includes('work order') ||
                                analysis.basic_observations.toLowerCase().includes('bill')
                              ));
      
      if (isDocumentation && vehicle_id && image_id) {
        console.log('📄 Receipt/document detected - triggering extraction...');
        
        // Get image URL
        const { data: imageData } = await supabase
          .from('vehicle_images')
          .select('image_url')
          .eq('id', image_id)
          .single();
        
        if (imageData?.image_url) {
          // Trigger smart-receipt-linker asynchronously (non-blocking)
          supabase.functions.invoke('smart-receipt-linker', {
            body: {
              documentId: image_id,
              vehicleId: vehicle_id,
              documentUrl: imageData.image_url
            }
          }).then(({ data, error }) => {
            if (error) {
              console.warn('⚠️ Receipt extraction trigger failed (non-blocking):', error);
            } else {
              console.log('✅ Receipt extraction triggered:', data);
            }
          }).catch(err => {
            console.warn('⚠️ Receipt extraction error (non-blocking):', err);
          });
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, tier: 1, provider, usage: usageStats, ...analysis }),
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

const ANALYSIS_PROMPT = `Analyze this vehicle image and provide basic organization data.
Return ONLY valid JSON with this structure:
{
  "angle": "front_3quarter|front_center|rear_3quarter|rear_center|driver_side|passenger_side|overhead|undercarriage|interior_front|interior_rear|engine_bay|trunk|detail_shot|work_progress|document",
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
  "basic_observations": "Brief description. IMPORTANT: If this image contains a receipt, invoice, work order, or document, mention it explicitly (e.g., 'Receipt from shop', 'Work order visible', 'Invoice document')"
}

CRITICAL: If this image shows a receipt, invoice, work order, bill, or any document with text/numbers, set category to "documentation" and mention it in basic_observations.`

async function runTier1AnalysisGemini(imageUrl: string, estimatedResolution: string, apiKey: string) {
  const imgResp = await fetch(imageUrl)
  if (!imgResp.ok) throw new Error('Failed to fetch image for Gemini')
  
  const arrayBuffer = await imgResp.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  
  // Use Deno's standard library base64 encoder (robust, no stack limits)
  const encodedBase64 = base64Encode(bytes)
  const mimeType = imgResp.headers.get('content-type') || 'image/jpeg'

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: ANALYSIS_PROMPT },
          { inline_data: { mime_type: mimeType, data: encodedBase64 } }
        ]
      }],
      generationConfig: { response_mime_type: "application/json" }
    })
  })

  if (!response.ok) {
    const txt = await response.text()
    throw new Error(`Gemini API error: ${response.status} - ${txt}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned no text')
  
  // Usage tracking
  const usage = data.usageMetadata || {}
  const usageStats = {
    promptTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
    totalTokens: usage.totalTokenCount || 0,
    cost: calculateCost('gemini', 'gemini-2.0-flash', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0)
  }

  return { data: processAnalysisResult(text, estimatedResolution), usage: usageStats }
}

async function runTier1AnalysisAnthropic(imageUrl: string, estimatedResolution: string, apiKey: string) {
  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) throw new Error('Failed to fetch image for Anthropic')
  
  const imageBuffer = await imageResponse.arrayBuffer()
  const bytes = new Uint8Array(imageBuffer)
  
  // Use Deno's robust base64 encoder
  const base64Image = base64Encode(bytes)
  
  let mediaType = imageResponse.headers.get('content-type') || 'image/jpeg'
  if (mediaType.includes('jpg')) mediaType = 'image/jpeg'

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
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
              source: { type: "base64", media_type: mediaType, data: base64Image }
            },
            { type: "text", text: ANALYSIS_PROMPT }
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
  
  const usage = data.usage || {}
  const usageStats = {
    promptTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    cost: calculateCost('anthropic', 'claude-3-haiku', usage.input_tokens || 0, usage.output_tokens || 0)
  }

  return { data: processAnalysisResult(content, estimatedResolution), usage: usageStats }
}

async function runTier1AnalysisOpenAI(imageUrl: string, estimatedResolution: string, apiKey: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: ANALYSIS_PROMPT },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ]
    })
  })

  if (!response.ok) {
    const txt = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${txt}`)
  }

  const data = await response.json()
  const usage = data.usage || {}
  const usageStats = {
    promptTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || 0,
    cost: calculateCost('openai', 'gpt-4o-mini', usage.prompt_tokens || 0, usage.completion_tokens || 0)
  }

  return { data: processAnalysisResult(data.choices[0].message.content, estimatedResolution), usage: usageStats }
}

function calculateCost(provider: string, model: string, inputTokens: number, outputTokens: number) {
  let cost = 0;
  // Prices per 1M tokens (as of late 2024/early 2025 estimates)
  if (provider === 'gemini') {
    // Gemini 1.5 Flash: Free tier available, otherwise ~$0.35/1M input, $1.05/1M output
    // Assuming paid tier for scale
    cost = (inputTokens / 1000000 * 0.35) + (outputTokens / 1000000 * 1.05);
  } else if (provider === 'openai') {
    // gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output
    cost = (inputTokens / 1000000 * 0.15) + (outputTokens / 1000000 * 0.60);
  } else if (provider === 'anthropic') {
    // claude-3-haiku: $0.25 / 1M input, $1.25 / 1M output
    cost = (inputTokens / 1000000 * 0.25) + (outputTokens / 1000000 * 1.25);
  }
  return Number(cost.toFixed(6));
}

function processAnalysisResult(jsonString: string, estimatedResolution: string) {
  let result;
  try {
    result = JSON.parse(jsonString)
  } catch (e) {
    const match = jsonString.match(/```json\n([\s\S]*)\n```/) || jsonString.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        result = JSON.parse(match[1] || match[0])
      } catch (e2) {
        throw new Error('Invalid JSON from AI')
      }
    } else {
      throw new Error('Invalid JSON from AI')
    }
  }

  if (!result.image_quality) {
    result.image_quality = {
      lighting: 'adequate',
      focus: 'acceptable',
      sufficient_for_detail: true,
      suitable_for_expert: false,
      overall_score: 5
    }
  }
  
  result.image_quality.estimated_resolution = estimatedResolution
  result.image_quality.suitable_for_expert = (
    estimatedResolution === 'high' &&
    result.image_quality.focus === 'sharp' &&
    result.image_quality.lighting !== 'poor'
  )
  
  return result
}
