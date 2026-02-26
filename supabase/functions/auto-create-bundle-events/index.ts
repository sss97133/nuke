/**
 * auto-create-bundle-events
 *
 * Finds image bundles with no linked timeline event and auto-creates one per bundle.
 * Events are created with needs_input: true so they appear in the owner's review queue.
 * AI suggestions are pre-fetched in parallel and stored in metadata.ai_suggestion so
 * the UI never needs to call suggest-bundle-label on page load.
 *
 * Input:  { vehicle_id, dry_run?: boolean }
 * Output: { created: number, skipped: number, events: [...] }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { vehicle_id, dry_run = false } = await req.json()

    if (!vehicle_id) {
      return new Response(
        JSON.stringify({ error: 'vehicle_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    // Get all bundles for this vehicle (min 1 image)
    const { data: bundles, error: bundleError } = await supabase
      .rpc('get_image_bundles_for_vehicle', {
        p_vehicle_id: vehicle_id,
        p_min_images: 1,
      })

    if (bundleError) throw bundleError
    if (!bundles || bundles.length === 0) {
      return new Response(
        JSON.stringify({ created: 0, skipped: 0, events: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get existing timeline events for this vehicle to avoid duplicates
    const { data: existingEvents } = await supabase
      .from('timeline_events')
      .select('id, event_date, metadata')
      .eq('vehicle_id', vehicle_id)

    // Build a set of dates that already have a bundle-origin event
    const coveredDates = new Set<string>()
    for (const ev of (existingEvents || [])) {
      if (ev.metadata?.bundle_auto_created || ev.metadata?.needs_input !== undefined) {
        coveredDates.add(ev.event_date)
      }
    }

    // Also check which images already have a timeline_event_id
    const { data: linkedImages } = await supabase
      .from('vehicle_images')
      .select('taken_at')
      .eq('vehicle_id', vehicle_id)
      .not('timeline_event_id', 'is', null)

    const linkedDates = new Set<string>()
    for (const img of (linkedImages || [])) {
      if (img.taken_at) {
        linkedDates.add(img.taken_at.split('T')[0])
      }
    }

    // Identify bundles that need new events
    const bundlesToCreate = bundles.filter((bundle: any) => {
      const dateStr = String(bundle.bundle_date)
      return !coveredDates.has(dateStr) && !linkedDates.has(dateStr)
    })

    if (bundlesToCreate.length === 0) {
      return new Response(
        JSON.stringify({ created: 0, skipped: bundles.length - bundlesToCreate.length, events: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (dry_run) {
      return new Response(
        JSON.stringify({
          created: bundlesToCreate.length,
          skipped: bundles.length - bundlesToCreate.length,
          events: bundlesToCreate.map((b: any) => ({
            bundle_date: String(b.bundle_date),
            image_count: b.image_count,
            dry_run: true,
          })),
          dry_run: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Pre-fetch AI suggestions for all bundles in parallel before inserting
    // This way the UI reads from metadata.ai_suggestion and never calls Vision on load
    const suggestionResults = await Promise.allSettled(
      bundlesToCreate.map(async (bundle: any) => {
        const imageIds: string[] = (bundle.image_ids || []).slice(0, 8)
        if (imageIds.length === 0) return null

        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/suggest-bundle-label`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              vehicle_id,
              bundle_date: String(bundle.bundle_date),
              image_ids: imageIds,
            }),
          })

          if (!res.ok) return null
          return await res.json()
        } catch {
          return null
        }
      })
    )

    const created: any[] = []
    let skipped = 0

    for (let i = 0; i < bundlesToCreate.length; i++) {
      const bundle = bundlesToCreate[i]
      const dateStr = String(bundle.bundle_date)

      const suggestionResult = suggestionResults[i]
      const suggestion = suggestionResult.status === 'fulfilled' ? suggestionResult.value : null

      const title = suggestion?.title
        || `Photo session — ${new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
      const event_type = suggestion?.event_type || 'other'
      const confidence = suggestion
        ? Math.max(40, Math.round((suggestion.confidence || 0.5) * 100))
        : 40

      // Create the timeline event with suggestion already baked into metadata
      const { data: newEvent, error: insertError } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id,
          event_type,
          source: 'photo_upload',
          source_type: 'photo_session',
          event_date: dateStr,
          title,
          description: `${bundle.image_count} photos captured. Add details about this session.`,
          confidence_score: confidence,
          metadata: {
            bundle_auto_created: true,
            needs_input: true,
            image_count: bundle.image_count,
            session_start: bundle.session_start,
            session_end: bundle.session_end,
            duration_minutes: bundle.duration_minutes,
            // Pre-baked suggestion — UI reads this, no Vision call on load
            ai_suggestion: suggestion ? {
              title: suggestion.title,
              event_type: suggestion.event_type,
              confidence: suggestion.confidence,
              reasoning: suggestion.reasoning,
            } : null,
          },
        })
        .select('id, event_date, title')
        .single()

      if (insertError) {
        console.error(`[auto-create-bundle-events] Insert failed for ${dateStr}:`, insertError.message)
        skipped++
        continue
      }

      // Link all images in this bundle to the new event
      const imageIds: string[] = bundle.image_ids || []
      if (imageIds.length > 0 && newEvent) {
        await supabase
          .from('vehicle_images')
          .update({ timeline_event_id: newEvent.id })
          .in('id', imageIds)
          .is('timeline_event_id', null)
      }

      created.push({
        event_id: newEvent?.id,
        bundle_date: dateStr,
        image_count: bundle.image_count,
        title: newEvent?.title,
        suggestion_confidence: suggestion?.confidence || null,
      })
    }

    skipped += bundles.length - bundlesToCreate.length

    return new Response(
      JSON.stringify({
        created: created.length,
        skipped,
        events: created,
        dry_run,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[auto-create-bundle-events]', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
