/**
 * SET IMAGE ANGLE - Ultra Simple
 * 
 * ONLY task: Determine what angle the photo was taken from
 * No complex analysis, just: "What angle is this?"
 * 
 * Model: Claude 3 Haiku (cheapest vision model)
 * Cost: ~$0.00008 per image
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANGLES = [
  'front_center',
  'front_3quarter_driver',
  'front_3quarter_passenger',
  'rear_center',
  'rear_3quarter_driver',
  'rear_3quarter_passenger',
  'driver_side',
  'passenger_side',
  'overhead',
  'undercarriage',
  'interior_front',
  'interior_rear',
  'interior_detail',
  'engine_bay',
  'trunk',
  'detail_shot',
  'work_in_progress',
  'documentation'
]

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { image_url, image_id } = await req.json()
    if (!image_url || !image_id) throw new Error('Missing required params')

    const angle = await detectAngle(image_url)
    
    // Save to database
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )
    
    await supabase
      .from('vehicle_images')
      .update({ angle })
      .eq('id', image_id)

    return new Response(
      JSON.stringify({ success: true, angle }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function detectAngle(imageUrl: string): Promise<string> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) throw new Error('Anthropic key not configured')

  // Download image and convert to base64 (safe for large images)
  const imageResponse = await fetch(imageUrl)
  const imageBuffer = await imageResponse.arrayBuffer()
  
  // Fix: Loop instead of spread to avoid stack overflow on large images
  const bytes = new Uint8Array(imageBuffer)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, Array.from(chunk))
  }
  const base64Image = btoa(binary)
  
  const mediaType = imageResponse.headers.get('content-type') || 'image/jpeg'

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 50,
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
              text: `What angle is this vehicle photo taken from? Answer with ONE of these exact options: ${ANGLES.join(', ')}`
            }
          ]
        }
      ]
    })
  })

  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`)

  const data = await response.json()
  const answer = data.content[0].text.toLowerCase()
  
  // Match to our angles
  for (const angle of ANGLES) {
    if (answer.includes(angle.replace(/_/g, ' ')) || answer.includes(angle)) {
      return angle
    }
  }
  
  // Default fallback
  return 'detail_shot'
}

