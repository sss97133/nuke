/**
 * Auto-Discover Reference Documents
 * 
 * Automatically searches the internet and finds reference documentation
 * (manuals, service guides, parts catalogs, brochures) for vehicles.
 * Triggered automatically when new vehicles are created.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface VehicleInfo {
  vehicle_id: string
  year: number | null
  make: string | null
  model: string | null
  series?: string | null
  body_style?: string | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const { vehicle_id, year, make, model, series, body_style } = await req.json() as VehicleInfo

    if (!vehicle_id || !year || !make || !model) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: vehicle_id, year, make, model' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`🔍 Auto-discovering docs for: ${year} ${make} ${model} ${series || ''}`)

    // Check if we already searched for this vehicle combination
    const { data: existingLib } = await supabase
      .from('reference_libraries')
      .select('id')
      .eq('year', year)
      .eq('make', make)
      .eq('series', series || null)
      .limit(1)

    // Also check if vehicle already has linked docs
    const { data: existingLinks } = await supabase
      .from('vehicle_reference_documents')
      .select('id')
      .eq('vehicle_id', vehicle_id)
      .limit(1)

    if (existingLinks && existingLinks.length > 0 && existingLib && existingLib.length > 0) {
      console.log(`⏭️  Already has reference docs, skipping`)
      return new Response(
        JSON.stringify({ success: true, skipped: true, message: 'Vehicle already has reference docs' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Search for documentation using web search
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!firecrawlKey) {
      console.warn('⚠️  No FIRECRAWL_API_KEY, skipping auto-discovery')
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build search queries
    const searchQueries = [
      `${year} ${make} ${model} service manual PDF`,
      `${year} ${make} ${model} ${series || ''} owner manual PDF`.trim(),
      `${year} ${make} ${model} parts catalog PDF`,
      `${year} ${make} ${model} repair manual site:73-87chevytrucks.com`,
      `${year} ${make} ${model} factory service manual site:gmserviceinfo.com`,
    ]

    const discoveredDocs: Array<{
      title: string
      url: string
      document_type: string
      description?: string
    }> = []

    // Search each query and find document URLs
    for (const query of searchQueries) {
      try {
        // Use Firecrawl to search (or use a search API if available)
        // For now, try known manual sites
        const knownManualSites = [
          `https://www.73-87chevytrucks.com/technicalinfo.htm`,
          `https://www.gmserviceinfo.com/`,
        ]

        for (const site of knownManualSites) {
          try {
            const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${firecrawlKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url: site,
                formats: ['markdown', 'html'],
                onlyMainContent: true,
              }),
            })

            if (response.ok) {
              const data = await response.json()
              const markdown = data.data?.markdown || ''
              const html = data.data?.html || ''

              // Extract PDF/document links from the page
              const pdfPattern = /href=["']([^"']*\.pdf[^"']*)["']/gi
              const links = new Set<string>()
              
              let match
              while ((match = pdfPattern.exec(html)) !== null) {
                const url = match[1]
                const fullUrl = url.startsWith('http') ? url : new URL(url, site).href
                links.add(fullUrl)
              }

              // Also check markdown for links
              const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+\.pdf[^)]*)\)/gi
              while ((match = markdownLinkPattern.exec(markdown)) !== null) {
                const url = match[2]
                const fullUrl = url.startsWith('http') ? url : new URL(url, site).href
                links.add(fullUrl)
              }

              // Filter links that match our vehicle
              const vehicleTerms = [
                year?.toString(),
                make?.toLowerCase(),
                model?.toLowerCase(),
                series?.toLowerCase(),
              ].filter(Boolean)

              for (const link of links) {
                const linkLower = link.toLowerCase()
                const matchesVehicle = vehicleTerms.some(term => 
                  term && linkLower.includes(term.toLowerCase())
                )

                if (matchesVehicle) {
                  // Determine document type from URL/title
                  let docType = 'service_manual'
                  if (linkLower.includes('owner') || linkLower.includes('owners')) {
                    docType = 'owners_manual'
                  } else if (linkLower.includes('parts') || linkLower.includes('catalog')) {
                    docType = 'parts_catalog'
                  } else if (linkLower.includes('brochure')) {
                    docType = 'brochure'
                  }

                  discoveredDocs.push({
                    title: `${year} ${make} ${model} ${docType.replace('_', ' ')}`,
                    url: link,
                    document_type: docType,
                    description: `Auto-discovered from ${site}`,
                  })
                }
              }
            }
          } catch (e) {
            console.warn(`Failed to scrape ${site}:`, e)
          }
        }
      } catch (e) {
        console.warn(`Search failed for query "${query}":`, e)
      }
    }

    // Remove duplicates
    const uniqueDocs = Array.from(
      new Map(discoveredDocs.map(doc => [doc.url, doc])).values()
    ).slice(0, 5) // Limit to 5 docs

    console.log(`📚 Found ${uniqueDocs.length} potential documents`)

    // For each discovered document, use LLM to extract metadata and create reference
    const llmConfig = await import('../_shared/llmProvider.ts').then(m => 
      m.getLLMConfig(supabase, null, undefined, undefined, 'tier2')
    ).catch(() => null)

    let createdCount = 0
    for (const doc of uniqueDocs) {
      try {
        // Download and analyze the document with LLM
        const analysis = await analyzeDocumentWithLLM(doc.url, doc, vehicle_id, llmConfig)
        
        if (analysis && analysis.valid) {
          // Create reference library entry
          const { data: library } = await supabase
            .from('reference_libraries')
            .select('id')
            .eq('year', year)
            .eq('make', make)
            .eq('series', series || null)
            .maybeSingle()

          let libraryId = library?.id
          if (!libraryId) {
            const { data: newLibrary } = await supabase
              .from('reference_libraries')
              .insert({
                year,
                make,
                series: series || null,
                model: model || null,
                body_style: body_style || null,
                description: `Auto-discovered library for ${year} ${make} ${model}`,
              })
              .select('id')
              .single()

            libraryId = newLibrary?.id
          }

          if (libraryId) {
            // Create library_document record
            const { data: document } = await supabase
              .from('library_documents')
              .insert({
                library_id: libraryId,
                document_type: analysis.document_type || doc.document_type,
                title: analysis.title || doc.title,
                file_url: doc.url,
                mime_type: 'application/pdf',
                uploaded_by: null, // System-created
                year_published: year,
                is_factory_original: analysis.is_factory || false,
              })
              .select('id')
              .single()

            if (document) {
              createdCount++
              console.log(`✅ Created document: ${analysis.title || doc.title}`)

              // Trigger extraction in background
              supabase.functions.invoke('parse-reference-document', {
                body: { documentId: document.id },
              }).catch(() => {}) // Non-blocking
            }
          }
        }
      } catch (e) {
        console.warn(`Failed to process document ${doc.url}:`, e)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        discovered: uniqueDocs.length,
        created: createdCount,
        vehicle_id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Auto-discovery error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function analyzeDocumentWithLLM(
  url: string,
  doc: { title: string; document_type: string; description?: string },
  vehicleId: string,
  llmConfig: any
): Promise<{
  valid: boolean
  title?: string
  document_type?: string
  is_factory?: boolean
  description?: string
} | null> {
  if (!llmConfig) {
    // Fallback: basic validation
    return {
      valid: url.includes('.pdf'),
      title: doc.title,
      document_type: doc.document_type,
      is_factory: url.includes('gm') || url.includes('factory'),
    }
  }

  try {
    const prompt = `Analyze this vehicle document URL and extract metadata:

URL: ${url}
Proposed Title: ${doc.title}
Proposed Type: ${doc.document_type}

Extract:
1. Is this a valid vehicle manual/document? (yes/no)
2. Document title (if different from proposed)
3. Document type: service_manual, owners_manual, parts_catalog, brochure, or spec_sheet
4. Is this a factory original? (yes/no)
5. Brief description

Respond in JSON format:
{
  "valid": true/false,
  "title": "...",
  "document_type": "...",
  "is_factory": true/false,
  "description": "..."
}`

    const response = await fetch(llmConfig.apiUrl || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${llmConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llmConfig.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    })

    if (response.ok) {
      const data = await response.json()
      const content = data.choices?.[0]?.message?.content || '{}'
      return JSON.parse(content)
    }
  } catch (e) {
    console.warn('LLM analysis failed:', e)
  }

  // Fallback
  return {
    valid: url.includes('.pdf'),
    title: doc.title,
    document_type: doc.document_type,
    is_factory: false,
  }
}

