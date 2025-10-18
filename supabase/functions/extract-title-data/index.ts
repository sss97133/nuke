import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { image_url } = await req.json()

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: 'Missing image_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    console.log('Extracting title data from:', image_url)

    // Call OpenAI Vision to extract title data
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Fast and cheap model
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract vehicle title information from this document image.

Look for:
- VIN (17-character Vehicle Identification Number)
- Year (4 digits)
- Make (manufacturer like Ford, Chevrolet, etc)
- Model (like F-150, Mustang, Camaro, etc)
- Owner name
- Registration state

Return ONLY valid JSON with these fields (use null if not found):
{
  "vin": "string or null",
  "year": "string or null",
  "make": "string or null",
  "model": "string or null",
  "owner_name": "string or null",
  "state": "string or null"
}

Be accurate. If you're not sure, return null for that field.`
            },
            {
              type: 'image_url',
              image_url: {
                url: image_url,
                detail: 'high'
              }
            }
          ]
        }],
        max_tokens: 500,
        temperature: 0.1 // Low temperature for accuracy
      })
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', response.status, errorText)
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    
    if (!data.choices || !data.choices[0]) {
      console.error('Invalid OpenAI response:', data)
      throw new Error('Invalid response from OpenAI')
    }

    const content = data.choices[0].message.content
    console.log('Extracted content:', content)

    // Parse JSON response
    let extracted
    try {
      // Remove markdown code blocks if present
      const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim()
      extracted = JSON.parse(cleanContent)
    } catch (parseError) {
      console.error('Failed to parse JSON:', content, parseError)
      throw new Error('Failed to parse extraction results')
    }

    return new Response(
      JSON.stringify(extracted),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Title extraction error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        details: String(error)
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

