/**
 * LLM-Powered Price Extraction from Vehicle Descriptions
 * 
 * Extracts asking prices from vehicle descriptions using LLM.
 * Handles obfuscated prices like "$14.500", "fourteen five hundred", etc.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ExtractPriceRequest {
  description: string
  current_price?: number | null
  vehicle_id?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { description, current_price, vehicle_id }: ExtractPriceRequest = await req.json()

    if (!description || !description.trim()) {
      return new Response(
        JSON.stringify({ error: 'Description is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get OpenAI API key (prefer service key, fallback to env var)
    const openaiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('OPEN_AI_API_KEY')
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    // Build focused prompt for price extraction
    const prompt = buildPriceExtractionPrompt(description, current_price)

    // Call OpenAI with minimal token usage for cost efficiency
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Use cheapest model for simple extraction
        messages: [
          {
            role: 'system',
            content: `You are a vehicle listing price extraction specialist. Extract the asking price from vehicle descriptions, even when obfuscated. Return ONLY valid JSON with price as a number.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1, // Low temperature for consistent extraction
        max_tokens: 200 // Minimal tokens for simple extraction
      })
    })

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text()
      throw new Error(`OpenAI API error: ${errorText}`)
    }

    const aiData = await openaiResponse.json()
    const extractedJson = JSON.parse(aiData.choices[0].message.content)

    // Validate and normalize extracted price
    const extractedPrice = extractedJson.price ? parseInt(String(extractedJson.price).replace(/[^0-9]/g, '')) : null
    
    // Validate price is reasonable
    if (extractedPrice && (extractedPrice < 100 || extractedPrice > 10000000)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Extracted price is out of reasonable range',
          price: null,
          confidence: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const confidence = extractedJson.confidence || (extractedPrice ? 0.85 : 0)

    // If vehicle_id provided and we found a price, optionally update the database
    if (vehicle_id && extractedPrice && (!current_price || extractedPrice > current_price)) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey)
        
        // Only update if current price is missing or suspiciously low
        if (!current_price || current_price < 3000) {
          const { error: updateError } = await supabase
            .from('vehicles')
            .update({ 
              asking_price: extractedPrice,
              updated_at: new Date().toISOString()
            })
            .eq('id', vehicle_id)
          
          if (updateError) {
            console.warn('Failed to update vehicle price:', updateError)
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        price: extractedPrice,
        confidence,
        explanation: extractedJson.explanation || null,
        was_updated: vehicle_id && extractedPrice && (!current_price || extractedPrice > current_price) ? true : false
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Price extraction error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        price: null,
        confidence: 0
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * Build focused prompt for price extraction
 */
function buildPriceExtractionPrompt(description: string, currentPrice?: number | null): string {
  const descriptionPreview = description.substring(0, 2000) // Limit to 2k chars for cost efficiency
  
  return `Extract the asking price from this vehicle listing description.

DESCRIPTION:
${descriptionPreview}
${currentPrice ? `\nCURRENT PRICE IN SYSTEM: $${currentPrice.toLocaleString()}` : ''}

CRITICAL INSTRUCTIONS:
- Extract the ASKING PRICE (what the seller wants), not auction bids, not monthly payments
- Handle obfuscated formats like:
  * "$14.500" (European format = $14,500)
  * "fourteen five hundred" (text = $14,500)
  * "14k5" (shorthand = $14,500)
  * "ASKING $14500" (with or without commas)
- Ignore phrases like "call for price", "price on request", monthly payment amounts
- If price is clearly stated, extract it as a number (remove $, commas, periods used as thousands separators)
- If price is ambiguous or missing, return null

Return JSON:
{
  "price": 14500,  // integer price in dollars, or null if not found/unclear
  "confidence": 0.95,  // 0-1 confidence score
  "explanation": "Found 'ASKING $14.500' in description, converted European format to $14,500"
}

Return ONLY valid JSON, no other text.`
}


