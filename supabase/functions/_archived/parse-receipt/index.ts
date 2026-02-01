import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { imageBase64 } = await req.json()
    
    // Get OpenAI API key from environment (set in Supabase dashboard)
    const openAiKey = Deno.env.get('OPEN_AI_API_KEY')
    if (!openAiKey) {
      throw new Error('OpenAI API key not configured')
    }

    // Call OpenAI Vision API with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 50000) // 50 second timeout
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract ALL tools from this Snap-on transaction history receipt. 
              For each tool line item, extract:
              - part_number (product code like AT4164, SOEXSA103, etc)
              - name (product description)
              - purchase_price (the total price, not list price)
              - purchase_date (transaction date)
              
              Skip payment lines (RA, EC entries).
              Return as JSON array with these exact field names.
              Include ALL tools you can find.`
            },
            {
              type: 'image_url',
              image_url: { 
                url: imageBase64.startsWith('data:') 
                  ? imageBase64 
                  : `data:image/png;base64,${imageBase64}`,
                detail: 'high'
              }
            }
          ]
        }],
        max_tokens: 4096,
        temperature: 0.1
      })
    })
    
    clearTimeout(timeoutId) // Clear timeout if request completes

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', errorText)
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    
    if (!data.choices || !data.choices[0]) {
      console.error('Invalid OpenAI response:', data)
      throw new Error('Invalid response from OpenAI')
    }
    
    const content = data.choices[0].message.content
    let tools = []
    
    try {
      tools = JSON.parse(content)
    } catch (parseError) {
      console.error('Failed to parse AI response:', content)
      throw new Error('Failed to parse AI response')
    }

    return new Response(
      JSON.stringify({ success: true, tools }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})
