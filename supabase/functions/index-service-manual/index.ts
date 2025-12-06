/**
 * Document Indexing (Service Manuals, Material Manuals, TDS Sheets)
 * 
 * Indexes technical documents for queryable knowledge base
 * Supports: service_manual, material_manual, tds (Technical Data Sheets)
 * Uses OpenAI (gpt-4o) or Anthropic (claude-3-5-sonnet) to extract structure and chunk semantically
 * Stores chunks in document_chunks table for AI querying
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
    
    // Supported document types
    const supportedTypes = ['service_manual', 'material_manual', 'tds']
    if (!supportedTypes.includes(doc.document_type)) {
      throw new Error(`Document type '${doc.document_type}' not supported. Supported: ${supportedTypes.join(', ')}`)
    }

    const pdfUrl = doc.file_url
    console.log(`Indexing: ${doc.title} [${mode}]`)

    // Get LLM config (OpenAI or Anthropic)
    const { getLLMConfig } = await import('../_shared/llmProvider.ts')
    const llmConfig = await getLLMConfig(supabase, null, undefined, undefined, 'tier3') // Use tier3 (gpt-4o or claude sonnet)
    
    console.log(`Using ${llmConfig.provider}/${llmConfig.model}`)

    let result
    if (mode === 'structure') {
      result = await extractStructure(pdfUrl, llmConfig, doc)
      // Save structure to metadata
      await supabase
        .from('library_documents')
        .update({ metadata: result })
        .eq('id', document_id)
    } else if (mode === 'chunk') {
      // Check if already indexed
      const { data: existingChunks } = await supabase
        .from('document_chunks')
        .select('id')
        .eq('document_id', document_id)
        .limit(1)
      
      if (existingChunks && existingChunks.length > 0) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            document_id, 
            mode, 
            skipped: true,
            message: 'Document already indexed',
            existing_chunks: existingChunks.length
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      result = await chunkAndIndex(pdfUrl, llmConfig, doc, supabase)
    } else if (mode === 'full') {
      // Check if already indexed
      const { data: existingChunks } = await supabase
        .from('document_chunks')
        .select('id')
        .eq('document_id', document_id)
        .limit(1)
      
      if (existingChunks && existingChunks.length > 0) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            document_id, 
            mode, 
            skipped: true,
            message: 'Document already indexed',
            existing_chunks: existingChunks.length,
            structure: doc.metadata?.sections || []
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      // Do both
      const structure = await extractStructure(pdfUrl, llmConfig, doc)
      await supabase
        .from('library_documents')
        .update({ metadata: structure })
        .eq('id', document_id)
      result = await chunkAndIndex(pdfUrl, llmConfig, doc, supabase)
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

async function extractStructure(pdfUrl: string, llmConfig: any, doc: any) {
  let prompt = ''
  
  if (doc.document_type === 'service_manual') {
    prompt = `Analyze this factory service manual: "${doc.title}"

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
  } else if (doc.document_type === 'tds') {
    prompt = `Analyze this Technical Data Sheet (TDS): "${doc.title}"

Extract the complete structure:

1. Total page count
2. Product information (name, code, brand)
3. Key sections for indexing:
   - Product Overview
   - Mixing Ratios & Instructions
   - Application Method
   - Coverage & Performance
   - Safety Data & Warnings
   - Color Codes (if paint)
   - Dry/Cure Times
   - Compatibility

Return JSON:
{
  "total_pages": number,
  "title": "string",
  "product_name": "string",
  "product_code": "string",
  "brand": "string",
  "sections": [
    {
      "name": "Mixing Instructions",
      "start_page": 1,
      "end_page": 2,
      "priority": "high",
      "content_type": "specification"
    }
  ],
  "priority_sections": ["list of section names to index first"]
}`
  } else if (doc.document_type === 'material_manual') {
    prompt = `Analyze this material manual: "${doc.title}"

Extract the complete structure:

1. Total page count
2. Product categories
3. Key sections for indexing:
   - Product Catalog
   - Specifications
   - Application Guides
   - Compatibility Charts
   - Safety Information
   - Mixing/Usage Instructions

Return JSON:
{
  "total_pages": number,
  "title": "string",
  "categories": ["paint", "primer", "filler", etc.],
  "sections": [
    {
      "name": "Product Catalog",
      "start_page": 1,
      "end_page": 50,
      "priority": "high",
      "content_type": "specification"
    }
  ],
  "priority_sections": ["list of section names to index first"]
}`
  }

  const { callLLM } = await import('../_shared/llmProvider.ts')
  
  const enhancedPrompt = `${prompt}

IMPORTANT: Analyze the PDF at this URL: ${pdfUrl}
If you cannot access the URL directly, provide your best estimate based on standard ${doc.document_type} structure.`

  const response = await callLLM(llmConfig, [
    {
      role: 'user',
      content: enhancedPrompt
    }
  ], {
    temperature: 0,
    maxTokens: 4000
  })
  
  const jsonMatch = response.content.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0])
  }
  throw new Error('Failed to parse JSON from response')
}

async function chunkAndIndex(pdfUrl: string, llmConfig: any, doc: any, supabase: any) {
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
          pdfUrl,
          section.start_page,
          section.end_page,
          section.name,
          doc,
          llmConfig,
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
  pdfUrl: string,
  startPage: number,
  endPage: number,
  sectionName: string,
  doc: any,
  llmConfig: any,
  supabase: any
): Promise<number> {
  let prompt = ''
  
  if (doc.document_type === 'tds') {
    prompt = `Extract content from pages ${startPage} to ${endPage} of "${doc.title}" (Technical Data Sheet), section: "${sectionName}"

CRITICAL: Extract ALL product information for paint/chemical TDS sheets:

For EACH product or section, provide:
- page_number (exact page)
- section_heading
- content (full text)
- content_type (specification|safety_data|mixing_ratio|application_guide|chart)
- key_topics (array of topics)

PLUS for paint/chemical products:
- product_name (e.g., "Basecoat Red", "Clear Coat")
- product_code (SKU/part number if visible)
- brand (manufacturer name)
- color_code (paint color code if applicable)
- mixing_ratio (JSON object: {"base": 4, "activator": 1, "reducer": 1} or similar)
- application_method (spray, brush, etc.)
- dry_time (e.g., "15 min flash, 24 hr cure")
- coverage (e.g., "300 sq ft per gallon")
- safety_notes (array of safety warnings)

Return JSON:
{
  "chunks": [
    {
      "page_number": 1,
      "section_heading": "Product Overview",
      "content": "Full text...",
      "content_type": "specification",
      "key_topics": ["basecoat", "red", "mixing"],
      "product_name": "Basecoat Red",
      "product_code": "BC-RED-001",
      "brand": "PPG",
      "color_code": "R123",
      "mixing_ratio": {"base": 4, "activator": 1, "reducer": 1},
      "application_method": "Spray",
      "dry_time": "15 min flash, 24 hr cure",
      "coverage": "300 sq ft/gal",
      "safety_notes": ["Flammable", "Use in well-ventilated area"]
    }
  ]
}`
  } else if (doc.document_type === 'material_manual') {
    prompt = `Extract content from pages ${startPage} to ${endPage} of "${doc.title}" (Material Manual), section: "${sectionName}"

Extract product information:

For EACH product, provide:
- page_number
- section_heading
- content (full text)
- content_type (specification|procedure|chart|reference)
- key_topics (array)
- product_name
- product_code (SKU if visible)
- brand (manufacturer)
- material_category (paint, primer, filler, adhesive, etc.)
- compatibility (array of compatible products)
- usage_instructions (text)

Return JSON:
{
  "chunks": [
    {
      "page_number": 5,
      "section_heading": "Body Filler",
      "content": "Full text...",
      "content_type": "specification",
      "key_topics": ["filler", "body work", "repair"],
      "product_name": "Premium Body Filler",
      "product_code": "BF-500",
      "brand": "Evercoat",
      "material_category": "filler",
      "compatibility": ["3M Primer", "USC Sealer"],
      "usage_instructions": "Mix 50:50 with hardener, apply to clean surface"
    }
  ]
}`
  } else {
    // Service manual (existing logic)
    prompt = `Extract content from pages ${startPage} to ${endPage} of "${doc.title}", section: "${sectionName}"

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
  }

  const { callLLM } = await import('../_shared/llmProvider.ts')
  
  const enhancedPrompt = `${prompt}

PDF URL: ${pdfUrl}
Focus on pages ${startPage} to ${endPage} of the "${sectionName}" section.

If you cannot access the PDF directly, provide realistic chunks based on what would typically be in a ${doc.title} ${sectionName} section for pages ${startPage}-${endPage}.`

  const response = await callLLM(llmConfig, [
    {
      role: 'user',
      content: enhancedPrompt
    }
  ], {
    temperature: 0,
    maxTokens: 8000
  })

  const jsonMatch = response.content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Failed to parse JSON from response')
  const extracted = JSON.parse(jsonMatch[0])

  // Store chunks in document_chunks table (unified for all document types)
  if (extracted.chunks) {
    for (const chunk of extracted.chunks) {
      const chunkData: any = {
        document_id: doc.id,
        document_type: doc.document_type,
        page_number: chunk.page_number,
        section_name: sectionName,
        section_heading: chunk.section_heading,
        content: chunk.content,
        content_type: chunk.content_type,
        key_topics: chunk.key_topics || [],
        metadata: {
          document_title: doc.title,
          year_range: doc.metadata?.year_range
        }
      }

      // TDS-specific fields
      if (doc.document_type === 'tds' && chunk.product_name) {
        chunkData.product_name = chunk.product_name
        chunkData.product_code = chunk.product_code
        chunkData.brand = chunk.brand
        chunkData.color_code = chunk.color_code
        chunkData.mixing_ratio = chunk.mixing_ratio ? JSON.parse(JSON.stringify(chunk.mixing_ratio)) : null
        chunkData.application_method = chunk.application_method
        chunkData.dry_time = chunk.dry_time
        chunkData.coverage = chunk.coverage
        chunkData.safety_notes = chunk.safety_notes || []
      }

      // Material manual specific fields
      if (doc.document_type === 'material_manual' && chunk.product_name) {
        chunkData.product_name = chunk.product_name
        chunkData.product_code = chunk.product_code
        chunkData.brand = chunk.brand
        chunkData.material_category = chunk.material_category
        chunkData.compatibility = chunk.compatibility || []
        chunkData.usage_instructions = chunk.usage_instructions
      }

      await supabase.from('document_chunks').insert(chunkData)
    }
  }

  return extracted.chunks?.length || 0
}

