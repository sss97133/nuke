import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Fields to merge across document pages, in priority order by document type
const MERGE_PRIORITY: Record<string, string[]> = {
  vin: ['title', 'bill_of_sale', 'buyers_order', 'cost_sheet', 'odometer_disclosure', 'repair_order'],
  year: ['title', 'bill_of_sale', 'buyers_order', 'cost_sheet'],
  make: ['title', 'bill_of_sale', 'buyers_order', 'cost_sheet'],
  model: ['title', 'bill_of_sale', 'buyers_order', 'cost_sheet'],
  sale_price: ['buyers_order', 'bill_of_sale', 'cost_sheet'],
  buyer_name: ['buyers_order', 'bill_of_sale'],
  seller_name: ['bill_of_sale', 'buyers_order'],
  owner_names: ['title'],
  title_number: ['title'],
  stock_number: ['cost_sheet', 'buyers_order'],
  deal_date: ['buyers_order', 'bill_of_sale', 'cost_sheet'],
  odometer: ['odometer_disclosure', 'title', 'repair_order'],
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { deal_id } = await req.json()
    if (!deal_id) {
      return new Response(JSON.stringify({ error: 'Missing deal_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get all pages for this deal
    const { data: pages, error } = await supabase
      .from('ds_document_pages')
      .select('*')
      .eq('deal_id', deal_id)
      .order('page_number', { ascending: true })

    if (error) throw new Error(`Failed to fetch pages: ${error.message}`)
    if (!pages || pages.length === 0) {
      return new Response(JSON.stringify({ error: 'No pages found for deal' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Merge data across pages using priority rules
    const merged: Record<string, any> = {}
    const conflicts: Record<string, { values: any[]; sources: string[] }> = {}

    for (const [field, typePriority] of Object.entries(MERGE_PRIORITY)) {
      const candidates: { value: any; confidence: number; docType: string; pageId: string }[] = []

      for (const page of pages) {
        const data = page.user_edits?.[field] !== undefined
          ? { [field]: page.user_edits[field] }
          : (page.extracted_data || {})
        const conf = page.confidences?.[field] || 0
        const val = data[field]

        if (val !== null && val !== undefined) {
          candidates.push({
            value: val,
            confidence: page.user_edits?.[field] !== undefined ? 100 : conf,
            docType: page.document_type || 'other',
            pageId: page.id,
          })
        }
      }

      if (candidates.length === 0) continue

      // Sort by: user-edited first, then by document type priority, then by confidence
      candidates.sort((a, b) => {
        if (a.confidence === 100 && b.confidence !== 100) return -1
        if (b.confidence === 100 && a.confidence !== 100) return 1
        const aPriority = typePriority.indexOf(a.docType)
        const bPriority = typePriority.indexOf(b.docType)
        if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority
        if (aPriority !== -1) return -1
        if (bPriority !== -1) return 1
        return b.confidence - a.confidence
      })

      merged[field] = candidates[0].value

      // Check for conflicts
      const uniqueValues = [...new Set(candidates.map(c => JSON.stringify(c.value)))]
      if (uniqueValues.length > 1) {
        conflicts[field] = {
          values: candidates.map(c => c.value),
          sources: candidates.map(c => `${c.docType} (${c.confidence}%)`),
        }
      }
    }

    // Also merge any additional fields not in MERGE_PRIORITY
    for (const page of pages) {
      const data = { ...(page.extracted_data || {}), ...(page.user_edits || {}) }
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && v !== undefined && !merged[k] && !['confidences', 'raw_ocr_text'].includes(k)) {
          merged[k] = v
        }
      }
    }

    // Determine deal status
    const anyNeedsReview = pages.some((p: any) => p.needs_review && p.review_status === 'pending')
    const allExtracted = pages.every((p: any) => p.extracted_at)
    const hasConflicts = Object.keys(conflicts).length > 0

    let dealStatus = 'processing'
    if (allExtracted && !anyNeedsReview && !hasConflicts) dealStatus = 'completed'
    else if (allExtracted) dealStatus = 'review'

    // Update deal
    await supabase.from('ds_deals').update({
      merged_data: { ...merged, _conflicts: conflicts },
      vin: merged.vin || null,
      year: merged.year || null,
      make: merged.make || null,
      model: merged.model || null,
      owner_name: merged.owner_names?.[0] || merged.buyer_name || null,
      deal_date: merged.deal_date || merged.sale_date || null,
      sale_price: merged.sale_price || null,
      status: dealStatus,
      pages_extracted: pages.filter((p: any) => p.extracted_at).length,
      pages_needing_review: pages.filter((p: any) => p.needs_review && p.review_status === 'pending').length,
      updated_at: new Date().toISOString(),
    }).eq('id', deal_id)

    return new Response(JSON.stringify({
      merged_data: merged,
      conflicts,
      deal_status: dealStatus,
      total_pages: pages.length,
      pages_extracted: pages.filter((p: any) => p.extracted_at).length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Merge error:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
