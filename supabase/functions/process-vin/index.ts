import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

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
    const formData = await req.formData()
    const image = formData.get('image')

    if (!image || !(image instanceof File)) {
      throw new Error('No image provided')
    }

    // Convert image to base64
    const buffer = await image.arrayBuffer()
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(buffer)))

    // Use Hugging Face for OCR
    const response = await fetch(
      'https://api-inference.huggingface.co/models/microsoft/trocr-large-printed',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('HUGGING_FACE_ACCESS_TOKEN')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: base64Image }),
      }
    )

    if (!response.ok) {
      throw new Error('Failed to process image with Hugging Face API')
    }

    const result = await response.json()
    console.log('OCR Result:', result)

    // Extract VIN from OCR result (assuming it's in the text)
    const text = result[0]?.generated_text || ''
    const vinMatch = text.match(/[A-HJ-NPR-Z0-9]{17}/)
    const vin = vinMatch ? vinMatch[0] : null

    if (!vin) {
      return new Response(
        JSON.stringify({ error: 'No VIN found in image' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify VIN with NHTSA database
    const nhtsaResponse = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`
    )
    const nhtsaData = await nhtsaResponse.json()

    return new Response(
      JSON.stringify({
        vin,
        data: nhtsaData.Results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error processing VIN:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})