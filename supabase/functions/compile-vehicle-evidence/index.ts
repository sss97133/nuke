/**
 * compile-vehicle-evidence
 *
 * Clusters vehicle images into work sessions and synthesizes financial/vendor
 * knowledge from them using Claude Vision. This is the pipeline that turns
 * "17 photos of Ernie's shop" into a timeline event with vendor, cost, and
 * line items — without requiring manual receipt uploads.
 *
 * Pipeline per cluster:
 *   1. Group images by date+device (existing get_image_bundles_for_vehicle RPC)
 *   2. Within each bundle, find document-like images (invoices, work orders, labels)
 *   3. Send up to 10 representative images to Claude Sonnet Vision
 *   4. Extract: vendor, event_type, cost_amount, line_items[], parts[], confidence
 *   5. Create/update timeline_event with cost data
 *   6. Create receipts record if dollar amount extracted
 *   7. Link all images in cluster to the event
 *
 * Modes:
 *   analyze  — Vision-analyze a single bundle and return extraction (no DB write)
 *   compile  — Full pipeline: analyze + write timeline_events + receipts
 *   status   — Show what bundles exist and which have/lack cost data
 *
 * Input:  { vehicle_id, mode?, min_images?, dry_run?, force_reprocess? }
 * Output: { processed, created, updated, skipped, total_cost_extracted, events }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { callLLM, getLLMConfig } from '../_shared/llmProvider.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const VALID_EVENT_TYPES = [
  'maintenance', 'repair', 'modification', 'inspection',
  'purchase', 'service', 'work_completed', 'other',
]

// ─── VISION SYNTHESIS ──────────────────────────────────────────────────────

async function synthesizeCluster(
  supabase: ReturnType<typeof createClient>,
  vehicleLabel: string,
  bundleDate: string,
  images: any[],
  totalImageCount: number,
): Promise<{
  title: string
  event_type: string
  vendor_name: string | null
  vendor_type: string | null
  cost_amount: number | null
  line_items: Array<{ description: string; amount: number | null }>
  parts_mentioned: string[]
  confidence: number
  reasoning: string
  has_document: boolean
}> {
  // Prefer document/receipt images, then work_progress, then general
  const prioritized = [
    ...images.filter(i => i.category === 'documentation' || i.doc_flag),
    ...images.filter(i => i.category === 'work_progress'),
    ...images.filter(i => !['documentation', 'work_progress'].includes(i.category)),
  ]

  const sample = prioritized.slice(0, 10)

  const imageBlocks: any[] = sample.map(img => {
    const url = (img.variants as any)?.medium || img.medium_url || img.thumbnail_url || img.image_url
    return { type: 'image', source: { type: 'url', url } }
  })

  const hasDocImages = prioritized.some(i => i.category === 'documentation' || i.doc_flag)

  const prompt = `You are analyzing ${totalImageCount} photos from a single work session on a ${vehicleLabel} (date: ${bundleDate}).
I'm showing you ${sample.length} representative samples.${hasDocImages ? '\nSome images appear to be documents, invoices, or work orders — extract all financial data from them.' : ''}

Extract everything you can observe about this work session. Return ONLY valid JSON:

{
  "title": "Concise event title (e.g. 'Interior upholstery by Ernie's', 'Engine dyno at Desert Performance', 'Shipping pickup')",
  "event_type": "One of: ${VALID_EVENT_TYPES.join(', ')}",
  "vendor_name": "Business/shop name if visible, else null",
  "vendor_type": "shop | dealership | shipping | self | unknown",
  "cost_amount": 0.00,
  "line_items": [
    { "description": "Labor", "amount": 0.00 },
    { "description": "Parts", "amount": 0.00 }
  ],
  "parts_mentioned": ["part name 1", "part name 2"],
  "confidence": 0.0,
  "reasoning": "One sentence explaining what you see and how confident you are",
  "has_document": false
}

Rules:
- cost_amount: total dollar amount if ANY number is visible on invoices/receipts/screens. null if nothing visible.
- line_items: only include if individual line costs are visible. Empty array if not.
- parts_mentioned: any parts, materials, or components you can identify visually.
- confidence: 0.9 if you see an actual invoice; 0.6 if you infer from shop context; 0.3 if just car photos.
- has_document: true if any image contains a receipt, invoice, work order, or price list.`

  const llmConfig = await getLLMConfig(supabase, null, 'anthropic', 'claude-sonnet-4-6')

  const response = await callLLM(
    llmConfig,
    [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
    { maxTokens: 600, vision: true },
  )

  const raw = typeof response.content === 'string' ? response.content : ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)

  if (!jsonMatch) {
    return {
      title: `Work session — ${bundleDate}`,
      event_type: 'other',
      vendor_name: null,
      vendor_type: null,
      cost_amount: null,
      line_items: [],
      parts_mentioned: [],
      confidence: 0.2,
      reasoning: 'Could not parse AI response',
      has_document: false,
    }
  }

  const parsed = JSON.parse(jsonMatch[0])

  if (!VALID_EVENT_TYPES.includes(parsed.event_type)) {
    parsed.event_type = 'work_completed'
  }

  const VALID_VENDOR_TYPES = ['shop', 'dealership', 'shipping', 'self', null]
  const rawVendorType = parsed.vendor_type || null
  const vendorType = VALID_VENDOR_TYPES.includes(rawVendorType) ? rawVendorType : null

  return {
    title: parsed.title || `Work session — ${bundleDate}`,
    event_type: parsed.event_type || 'other',
    vendor_name: parsed.vendor_name || null,
    vendor_type: vendorType,
    cost_amount: typeof parsed.cost_amount === 'number' && parsed.cost_amount > 0
      ? parsed.cost_amount
      : null,
    line_items: Array.isArray(parsed.line_items) ? parsed.line_items : [],
    parts_mentioned: Array.isArray(parsed.parts_mentioned) ? parsed.parts_mentioned : [],
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.3)),
    reasoning: parsed.reasoning || '',
    has_document: Boolean(parsed.has_document),
  }
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    const {
      vehicle_id,
      mode = 'compile',
      min_images = 2,
      dry_run = false,
      force_reprocess = false,
      bundle_date_filter,  // optional: only process a specific date
    } = await req.json()

    if (!vehicle_id) {
      return new Response(
        JSON.stringify({ error: 'vehicle_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    // Get vehicle context
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model, trim, color')
      .eq('id', vehicle_id)
      .single()

    const vehicleLabel = vehicle
      ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ')
      : 'Unknown vehicle'

    // ── STATUS MODE ──────────────────────────────────────────────────────────
    if (mode === 'status') {
      const { data: bundles } = await supabase.rpc('get_image_bundles_for_vehicle', {
        p_vehicle_id: vehicle_id,
        p_min_images: min_images,
      })

      const { data: events } = await supabase
        .from('timeline_events')
        .select('id, event_date, title, cost_amount, service_provider_name, confidence_score, metadata')
        .eq('vehicle_id', vehicle_id)
        .not('metadata->bundle_auto_created', 'is', null)

      const eventsByDate = new Map(events?.map((e: any) => [e.event_date, e]) || [])

      return new Response(
        JSON.stringify({
          vehicle: vehicleLabel,
          total_bundles: bundles?.length || 0,
          bundles: bundles?.map((b: any) => ({
            date: b.bundle_date,
            images: b.image_count,
            duration_min: Math.round(b.duration_minutes || 0),
            has_event: eventsByDate.has(String(b.bundle_date)),
            event: eventsByDate.get(String(b.bundle_date)) || null,
          })) || [],
          mode: 'status',
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Get all image bundles ────────────────────────────────────────────────
    const { data: bundles, error: bundleError } = await supabase.rpc(
      'get_image_bundles_for_vehicle',
      { p_vehicle_id: vehicle_id, p_min_images: min_images },
    )

    if (bundleError) throw bundleError
    if (!bundles || bundles.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, created: 0, updated: 0, skipped: 0, total_cost_extracted: 0, events: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Filter by date if requested
    const targetBundles = bundle_date_filter
      ? bundles.filter((b: any) => String(b.bundle_date) === bundle_date_filter)
      : bundles

    // Get existing events with cost data
    const { data: existingEvents } = await supabase
      .from('timeline_events')
      .select('id, event_date, cost_amount, service_provider_name, metadata')
      .eq('vehicle_id', vehicle_id)

    const eventsByDate = new Map(existingEvents?.map((e: any) => [e.event_date, e]) || [])

    // Skip bundles that already have cost data, unless force_reprocess
    const bundlesToProcess = targetBundles.filter((bundle: any) => {
      const dateStr = String(bundle.bundle_date)
      const existing = eventsByDate.get(dateStr)
      if (!existing) return true
      if (force_reprocess) return true
      // Skip if already has cost_amount
      if (existing.cost_amount != null) return false
      // Skip if already has high-confidence synthesis
      if (existing.metadata?.synthesis_confidence >= 0.7) return false
      return true
    })

    if (bundlesToProcess.length === 0) {
      return new Response(
        JSON.stringify({
          processed: 0,
          created: 0,
          updated: 0,
          skipped: targetBundles.length,
          total_cost_extracted: 0,
          events: [],
          message: 'All bundles already have cost data. Use force_reprocess=true to re-analyze.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── ANALYZE MODE — return synthesis without writing ───────────────────────
    if (mode === 'analyze') {
      const analyses = await Promise.allSettled(
        bundlesToProcess.slice(0, 5).map(async (bundle: any) => {
          const imageIds: string[] = bundle.image_ids || []
          const { data: images } = await supabase
            .from('vehicle_images')
            .select('id, image_url, thumbnail_url, medium_url, variants, category, doc_flag, taken_at')
            .in('id', imageIds.slice(0, 10))

          const synthesis = await synthesizeCluster(
            supabase, vehicleLabel, String(bundle.bundle_date), images || [], bundle.image_count,
          )

          return { bundle_date: String(bundle.bundle_date), image_count: bundle.image_count, synthesis }
        }),
      )

      return new Response(
        JSON.stringify({
          vehicle: vehicleLabel,
          bundles_analyzed: analyses.length,
          results: analyses.map(r => r.status === 'fulfilled' ? r.value : { error: (r as any).reason?.message }),
          mode: 'analyze',
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── COMPILE MODE — full pipeline ──────────────────────────────────────────
    const results: any[] = []
    let totalCostExtracted = 0
    let created = 0
    let updated = 0
    let skipped = 0

    for (const bundle of bundlesToProcess) {
      const dateStr = String(bundle.bundle_date)
      const imageIds: string[] = bundle.image_ids || []

      try {
        // Fetch images with metadata
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('id, image_url, thumbnail_url, medium_url, variants, category, doc_flag, taken_at')
          .in('id', imageIds.slice(0, 20))

        if (!images || images.length === 0) {
          skipped++
          continue
        }

        const synthesis = await synthesizeCluster(
          supabase, vehicleLabel, dateStr, images, bundle.image_count,
        )

        if (dry_run) {
          results.push({ bundle_date: dateStr, image_count: bundle.image_count, synthesis, dry_run: true })
          if (synthesis.cost_amount) totalCostExtracted += synthesis.cost_amount
          continue
        }

        const existingEvent = eventsByDate.get(dateStr)

        let eventId: string

        if (existingEvent) {
          // Update existing event with synthesis data
          const { data: updatedEvent } = await supabase
            .from('timeline_events')
            .update({
              cost_amount: synthesis.cost_amount,
              cost_currency: 'USD',
              service_provider_name: synthesis.vendor_name,
              service_provider_type: synthesis.vendor_type,
              parts_mentioned: synthesis.parts_mentioned,
              confidence_score: Math.round(synthesis.confidence * 100),
              metadata: {
                ...existingEvent.metadata,
                synthesis_confidence: synthesis.confidence,
                synthesis_reasoning: synthesis.reasoning,
                has_document: synthesis.has_document,
                line_items: synthesis.line_items,
              },
            })
            .eq('id', existingEvent.id)
            .select('id')
            .single()

          eventId = existingEvent.id
          updated++
        } else {
          // Create new event
          const { data: newEvent, error: insertError } = await supabase
            .from('timeline_events')
            .insert({
              vehicle_id,
              event_type: synthesis.event_type,
              source: 'photo_upload',
              source_type: 'user_input',
              event_date: dateStr,
              title: synthesis.title,
              description: synthesis.reasoning,
              cost_amount: synthesis.cost_amount,
              cost_currency: 'USD',
              service_provider_name: synthesis.vendor_name,
              service_provider_type: synthesis.vendor_type,
              parts_mentioned: synthesis.parts_mentioned,
              confidence_score: Math.round(synthesis.confidence * 100),
              metadata: {
                bundle_auto_created: true,
                needs_input: synthesis.cost_amount == null || synthesis.confidence < 0.6,
                image_count: bundle.image_count,
                session_start: bundle.session_start,
                session_end: bundle.session_end,
                synthesis_confidence: synthesis.confidence,
                synthesis_reasoning: synthesis.reasoning,
                has_document: synthesis.has_document,
                line_items: synthesis.line_items,
                ai_suggestion: {
                  title: synthesis.title,
                  event_type: synthesis.event_type,
                  confidence: synthesis.confidence,
                  reasoning: synthesis.reasoning,
                },
              },
            })
            .select('id')
            .single()

          if (insertError) throw insertError
          eventId = newEvent!.id
          created++
        }

        // Link all images to this event
        if (imageIds.length > 0) {
          await supabase
            .from('vehicle_images')
            .update({ timeline_event_id: eventId })
            .in('id', imageIds)
            .is('timeline_event_id', null)
        }

        // Create receipt record if cost extracted with reasonable confidence
        if (synthesis.cost_amount && synthesis.confidence >= 0.4) {
          await supabase
            .from('receipts')
            .insert({
              vehicle_id,
              vendor_name: synthesis.vendor_name,
              total_amount: synthesis.cost_amount,
              currency: 'USD',
              receipt_date: dateStr,
              transaction_date: dateStr,
              status: 'processed',
              confidence_score: synthesis.confidence,
              timeline_event_id: eventId,
              processing_status: 'processed',
              raw_extraction: {
                line_items: synthesis.line_items,
                parts_mentioned: synthesis.parts_mentioned,
                vendor_type: synthesis.vendor_type,
                source: 'vision_synthesis',
                image_count: bundle.image_count,
              },
            })
            .select('id')
        }

        if (synthesis.cost_amount) totalCostExtracted += synthesis.cost_amount

        results.push({
          bundle_date: dateStr,
          image_count: bundle.image_count,
          event_id: eventId,
          action: existingEvent ? 'updated' : 'created',
          title: synthesis.title,
          vendor: synthesis.vendor_name,
          cost_amount: synthesis.cost_amount,
          confidence: synthesis.confidence,
          has_document: synthesis.has_document,
          parts_count: synthesis.parts_mentioned.length,
        })

      } catch (err: any) {
        console.error(`[compile-vehicle-evidence] Failed for bundle ${dateStr}:`, err.message)
        skipped++
        results.push({ bundle_date: dateStr, error: err.message })
      }
    }

    return new Response(
      JSON.stringify({
        vehicle: vehicleLabel,
        processed: bundlesToProcess.length,
        created,
        updated,
        skipped,
        total_cost_extracted: totalCostExtracted,
        events: results,
        dry_run,
        mode: 'compile',
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err: any) {
    console.error('[compile-vehicle-evidence]', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
