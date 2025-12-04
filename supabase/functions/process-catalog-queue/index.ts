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
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) throw new Error('GEMINI_API_KEY required')

    // Get next pending chunk
    const { data: chunk } = await supabase
      .from('catalog_text_chunks')
      .select('*')
      .eq('status', 'pending')
      .order('chunk_index')
      .limit(1)
      .single()

    if (!chunk) {
      return new Response(JSON.stringify({ message: 'No pending chunks' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`Processing chunk ${chunk.chunk_index}`)

    // Mark as processing
    await supabase
      .from('catalog_text_chunks')
      .update({ status: 'processing' })
      .eq('id', chunk.id)

    // Extract parts with Gemini
    const prompt = `Extract ALL parts from this LMC catalog text.
For each part: part_number, name, price, years.
Return JSON: {"parts": [{"part_number": "XX-XXXX", "name": "Part Name", "price": "19.95", "years": "73-87"}]}

Text:
${chunk.text_content}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0 }
      })
    })

    if (!response.ok) throw new Error(`Gemini error: ${response.status}`)

    const data = await response.json()
    const extracted = JSON.parse(data.candidates[0].content.parts[0].text)

    let partsStored = 0
    if (extracted.parts) {
      for (const part of extracted.parts) {
        if (!part.name || !part.part_number) continue // Skip invalid
        
        await supabase.from('catalog_parts').insert({
          catalog_id: chunk.catalog_id,
          part_number: part.part_number,
          name: part.name,
          description: part.description || part.name,
          price_current: part.price ? parseFloat(String(part.price).replace(/[^0-9.]/g, '')) : null,
          application_data: { years: part.years }
        })
        
        partsStored++
      }
    }

    // Mark as complete
    await supabase
      .from('catalog_text_chunks')
      .update({ 
        status: 'completed', 
        parts_extracted: partsStored,
        processed_at: new Date().toISOString()
      })
      .eq('id', chunk.id)

    console.log(`Extracted ${partsStored} parts from chunk ${chunk.chunk_index}`)

    return new Response(JSON.stringify({ 
      success: true, 
      chunk_index: chunk.chunk_index,
      parts_extracted: partsStored 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

