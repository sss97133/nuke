/**
 * Service Manual Indexing
 * 
 * Indexes factory service manuals for queryable knowledge base
 * Uses Gemini 1.5 Pro to extract structure, chunk semantically, and generate embeddings
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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const { document_id, mode = 'structure' } = await req.json()
    
    if (!document_id) throw new Error('Missing document_id')

    // Get document
    const { data: doc, error: docError } = await supabase
      .from('library_documents')
      .select('*')
      .eq('id', document_id)
      .single()

    if (docError || !doc) throw new Error(`Document not found: ${document_id}`)
    if (doc.document_type !== 'service_manual') throw new Error('Only service manuals can be indexed')

    const pdfUrl = doc.file_url
    console.log(`Indexing: ${doc.title} [${mode}]`)

    // Get Gemini API key
    const { getUserApiKey } = await import('../_shared/getUserApiKey.ts')
    const geminiKeyResult = await getUserApiKey(supabase, null, 'google', 'GEMINI_API_KEY')
    if (!geminiKeyResult.apiKey) throw new Error('GEMINI_API_KEY required')

    // Upload PDF to Gemini
    console.log('Uploading PDF to Gemini...')
    const pdfResp = await fetch(pdfUrl)
    if (!pdfResp.ok) throw new Error(`Failed to fetch PDF: ${pdfResp.status}`)
    const pdfBytes = await pdfResp.arrayBuffer()
    const fileUri = await uploadToGemini(pdfBytes, 'application/pdf', geminiKeyResult.apiKey)
    console.log('Uploaded:', fileUri)

    let result
    if (mode === 'structure') {
      result = await extractStructure(fileUri, geminiKeyResult.apiKey, doc)
      // Save structure to metadata
      await supabase
        .from('library_documents')
        .update({ metadata: result })
        .eq('id', document_id)
    } else if (mode === 'chunk') {
      result = await chunkAndIndex(fileUri, geminiKeyResult.apiKey, doc, supabase)
    } else if (mode === 'full') {
      // Do both
      const structure = await extractStructure(fileUri, geminiKeyResult.apiKey, doc)
      await supabase
        .from('library_documents')
        .update({ metadata: structure })
        .eq('id', document_id)
      result = await chunkAndIndex(fileUri, geminiKeyResult.apiKey, doc, supabase)
      result.structure = structure
    }

    return new Response(
      JSON.stringify({ success: true, document_id, mode, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function uploadToGemini(data: ArrayBuffer, mimeType: string, apiKey: string) {
  const initResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': data.byteLength.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: 'service_manual.pdf' } })
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

async function extractStructure(fileUri: string, apiKey: string, doc: any) {
  const prompt = `Analyze this factory service manual: "${doc.title}"

Extract the complete structure:

1. Total page count
2. Table of Contents with page ranges
3. Priority sections for indexing:
   - Body & Frame (panel identification, date codes)
   - Specifications (dimensions, weights, codes)
   - Paint & Color (paint code charts)
   - Trim & Accessories (package content)
   - Engine specifications
   - Transmission specifications

Return JSON:
{
  "total_pages": number,
  "title": "string",
  "year_range": {"start": number, "end": number},
  "sections": [
    {
      "name": "Body & Frame",
      "start_page": 245,
      "end_page": 320,
      "priority": "high|medium|low",
      "content_type": "specifications|procedures|charts|diagrams"
    }
  ],
  "priority_sections": ["list of section names to index first"]
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

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini error: ${response.status} - ${error}`)
  }
  
  const data = await response.json()
  return JSON.parse(data.candidates[0].content.parts[0].text)
}

async function chunkAndIndex(fileUri: string, apiKey: string, doc: any, supabase: any) {
  // Get structure from metadata
  const structure = doc.metadata?.sections || []
  const prioritySections = doc.metadata?.priority_sections || []
  
  if (structure.length === 0) {
    throw new Error('Document structure not extracted. Run with mode=structure first')
  }

  let totalChunks = 0
  const errors: string[] = []

  // Process priority sections first
  for (const section of structure) {
    if (prioritySections.includes(section.name) || section.priority === 'high') {
      try {
        const chunks = await extractSectionChunks(
          fileUri,
          section.start_page,
          section.end_page,
          section.name,
          doc,
          apiKey,
          supabase
        )
        totalChunks += chunks
        console.log(`Indexed ${section.name}: ${chunks} chunks`)
      } catch (err: any) {
        errors.push(`${section.name}: ${err.message}`)
      }
    }
  }

  return {
    chunks_created: totalChunks,
    sections_indexed: structure.filter(s => prioritySections.includes(s.name) || s.priority === 'high').length,
    errors: errors.length > 0 ? errors : undefined
  }
}

async function extractSectionChunks(
  fileUri: string,
  startPage: number,
  endPage: number,
  sectionName: string,
  doc: any,
  apiKey: string,
  supabase: any
): Promise<number> {
  const prompt = `Extract content from pages ${startPage} to ${endPage} of "${doc.title}", section: "${sectionName}"

Chunk by semantic units:
- One procedure = one chunk
- One spec table = one chunk  
- One subsection = one chunk

For EACH chunk, provide:
- page_number (exact page)
- section_heading
- content (full text)
- content_type (procedure|specification|chart|diagram|reference)
- key_topics (array of topics covered)

Return JSON array:
{
  "chunks": [
    {
      "page_number": 247,
      "section_heading": "Body Panel Date Codes",
      "content": "Full text of this chunk...",
      "content_type": "specification",
      "key_topics": ["date codes", "panel identification", "stamping"]
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

  // Store chunks in catalog_text_chunks (reuse existing table)
  if (extracted.chunks) {
    for (const chunk of extracted.chunks) {
      await supabase.from('catalog_text_chunks').insert({
        catalog_id: doc.id,
        page_number: chunk.page_number,
        section: sectionName,
        heading: chunk.section_heading,
        content: chunk.content,
        content_type: chunk.content_type,
        metadata: {
          key_topics: chunk.key_topics,
          document_title: doc.title,
          document_type: 'service_manual'
        }
      })
    }
  }

  return extracted.chunks?.length || 0
}

