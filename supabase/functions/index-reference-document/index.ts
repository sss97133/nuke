/**
 * REFERENCE DOCUMENT INDEXING PIPELINE
 * Powered by Gemini 1.5 Pro (2M Context Window)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserApiKey } from '../_shared/getUserApiKey.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      // Support both env var names (some functions use SUPABASE_SERVICE_ROLE_KEY)
      Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { document_id, pdf_url, user_id, mode, page_start, page_end } = await req.json()
    if (!pdf_url) throw new Error('Missing pdf_url')

    const processingMode = mode || 'structure' // 'structure' | 'extract_parts'
    console.log(`Indexing: ${pdf_url} [${processingMode}] Pages: ${page_start || 'all'}-${page_end || 'all'}`)

    // Get API Key
    // Support both secret names. Some environments store this as GOOGLE_AI_API_KEY.
    let geminiKeyResult = await getUserApiKey(supabase, user_id || null, 'google', 'GOOGLE_AI_API_KEY')
    if (!geminiKeyResult.apiKey) {
      geminiKeyResult = await getUserApiKey(supabase, user_id || null, 'google', 'GEMINI_API_KEY')
    }
    if (!geminiKeyResult.apiKey) throw new Error('GOOGLE_AI_API_KEY or GEMINI_API_KEY required')

    function inferProvider(pdfUrl: string): string {
      const u = pdfUrl.toLowerCase()
      if (u.includes('lmctruck') || u.includes('/lmc') || u.includes('cccomplete.pdf')) return 'LMC'
      if (u.includes('scottdrake') || u.includes('scott drake') || u.includes('scottdrakecatalog') || u.includes('scottdrakecatalog_mustang') || u.includes('scottdrakecatalog_mustang.pdf') || u.includes('scottdrakecatalog_mustang')) return 'Scott Drake'
      if (u.includes('mustang') && u.includes('drake')) return 'Scott Drake'
      return 'Unknown'
    }

    // Get or create catalog source
    let catalogId = document_id
    if (document_id) {
      // If document_id provided, get or create catalog_sources entry linked to reference_documents
      const { data: existing } = await supabase
        .from('catalog_sources')
        .select('id')
        .eq('pdf_document_id', document_id)
        .single()
      
      if (existing) {
        catalogId = existing.id
      } else {
        // Create catalog source linked to reference_document
        const { data: newCatalog } = await supabase
          .from('catalog_sources')
          .insert({
            name: pdf_url.split('/').pop()?.replace(/%20/g, ' ') || 'Catalog',
            provider: inferProvider(pdf_url),
            base_url: pdf_url,
            pdf_document_id: document_id
          })
          .select()
          .single()
        
        catalogId = newCatalog?.id || document_id
      }
    } else {
      // Legacy: create catalog source without document link
      const { data: existing } = await supabase
        .from('catalog_sources')
        .select('id')
        .eq('base_url', pdf_url)
        .single()
      
      if (existing) {
        catalogId = existing.id
      } else {
        const { data: newCatalog } = await supabase
          .from('catalog_sources')
          .insert({
            name: pdf_url.split('/').pop()?.replace(/%20/g, ' ') || 'Catalog',
            provider: inferProvider(pdf_url),
            base_url: pdf_url
          })
          .select()
          .single()
        
        catalogId = newCatalog?.id
      }
    }

    // Upload PDF to Gemini
    console.log('Uploading to Gemini...')
    const pdfResp = await fetch(pdf_url)
    const pdfBytes = await pdfResp.arrayBuffer()
    const fileUri = await uploadToGeminiFileAPI(pdfBytes, 'application/pdf', geminiKeyResult.apiKey)
    console.log('Uploaded:', fileUri)

    let result
    if (processingMode === 'structure') {
      result = await analyzeStructure(fileUri, geminiKeyResult.apiKey)
      console.log(`Structure: ${result.total_pages} pages, ${result.sections?.length || 0} sections`)
    } else if (processingMode === 'extract_parts') {
      const start = page_start || 1
      const end = page_end || 50
      result = await extractParts(fileUri, start, end, geminiKeyResult.apiKey, supabase, catalogId)
      console.log(`Extracted ${result.parts?.length || 0} parts from pages ${start}-${end}`)
    }

    return new Response(
      JSON.stringify({ success: true, catalogId, mode: processingMode, result }),
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

async function uploadToGeminiFileAPI(data: ArrayBuffer, mimeType: string, apiKey: string) {
  const initResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': data.byteLength.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: 'catalog' } })
  })
  
  const uploadUrl = initResp.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('No upload URL from Gemini')

  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': data.byteLength.toString()
    },
    body: data
  })

  if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`)
  
  const fileData = await uploadResp.json()
  return fileData.file.uri
}

async function analyzeStructure(fileUri: string, apiKey: string) {
  const prompt = `Analyze this automotive parts catalog.
  
Extract:
1. Total page count
2. Table of contents (sections with page ranges)
3. Vehicle coverage (years/models)
4. Document type (parts catalog, service manual, etc.)

Return JSON:
{
  "total_pages": number,
  "title": "string",
  "vehicle_coverage": ["1973-1987 Chevy/GMC Trucks"],
  "sections": [
    {"name": "Exterior Trim", "start_page": 45, "end_page": 120}
  ]
}`

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { file_data: { file_uri: fileUri, mime_type: "application/pdf" } },
          { text: prompt }
        ]
      }],
      generationConfig: { response_mime_type: "application/json" }
    })
  })

  if (!response.ok) throw new Error(`Gemini error: ${response.status}`)
  const data = await response.json()
  return JSON.parse(data.candidates[0].content.parts[0].text)
}

async function extractParts(fileUri: string, pageStart: number, pageEnd: number, apiKey: string, supabase: any, catalogId: string) {
  const prompt = `Extract ALL parts from pages ${pageStart} to ${pageEnd} of this catalog.

For EACH part, extract:
- Part Number (SKU)
- Name/Description
- Price (if visible)
- Compatible Years
- Compatible Models
- Page Number
- Diagram Reference (if any)

Return JSON array:
{
  "parts": [
    {
      "part_number": "38-9630",
      "name": "Bumper Bolt Kit",
      "description": "Chrome bumper mounting bolt kit",
      "price": "24.95",
      "years": "1973-1987",
      "models": ["C10", "K10", "Blazer"],
      "page": 45,
      "diagram_ref": "Fig 3-A"
    }
  ]
}`

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { file_data: { file_uri: fileUri, mime_type: "application/pdf" } },
          { text: prompt }
        ]
      }],
      generationConfig: { response_mime_type: "application/json", temperature: 0 }
    })
  })

  if (!response.ok) throw new Error(`Gemini error: ${response.status}`)
  const data = await response.json()
  const extracted = JSON.parse(data.candidates[0].content.parts[0].text)

  // Store parts
  if (extracted.parts) {
    for (const part of extracted.parts) {
      await supabase.from('catalog_parts').insert({
        catalog_id: catalogId,
        part_number: part.part_number,
        name: part.name,
        description: part.description,
        price_current: part.price ? parseFloat(part.price.replace(/[^0-9.]/g, '')) : null,
        application_data: {
          years: part.years,
          models: part.models,
          page: part.page,
          diagram_ref: part.diagram_ref
        }
      })
    }
  }

  return extracted
}
