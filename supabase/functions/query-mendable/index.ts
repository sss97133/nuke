
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { query } = await req.json()
    const apiKey = Deno.env.get('MENDABLE_API_KEY')

    if (!apiKey) {
      throw new Error('Mendable API key not configured')
    }

    console.log('Querying Mendable with:', query)
    
    const response = await fetch('https://api.mendable.ai/v1/newChat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{
          role: "user",
          content: query
        }],
        systemPrompt: "You are a helpful assistant providing automotive and vehicle related information.",
        temperature: 0.7,
        maxTokens: 500
      })
    })

    if (!response.ok) {
      console.error('Mendable API error:', response.status, await response.text())
      throw new Error(`Mendable API returned ${response.status}`)
    }

    const data = await response.json()
    console.log('Mendable response:', data)

    return new Response(
      JSON.stringify({ answer: data.message || data.response || "No response from AI" }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        } 
      }
    )
  } catch (error) {
    console.error('Error in query-mendable:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error instanceof Error ? error.stack : undefined 
      }),
      { 
        status: 500,
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )
  }
})
