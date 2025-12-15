import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Candidate = {
  value: string
  length: number
  reason: string
  snippet?: string
}

function normalizeVinCandidate(raw: string): string {
  return String(raw || '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, '')
}

function extractVinCandidatesFromText(text: string): Candidate[] {
  const t = String(text || '')
  const candidates: Candidate[] = []

  // 1) Strong signal: "VIN" label nearby
  // Capture a window of 30 chars after VIN:
  const vinLabelRegex = /\bVIN\b\s*[:#]?\s*([A-Za-z0-9\-\s]{8,30})/gi
  for (const m of t.matchAll(vinLabelRegex)) {
    const raw = m[1] || ''
    const v = normalizeVinCandidate(raw)
    if (v.length >= 8) {
      candidates.push({
        value: v,
        length: v.length,
        reason: 'vin_label',
        snippet: String(m[0]).slice(0, 80),
      })
    }
  }

  // 2) Generic: any long alphanumeric run (common when VIN is embedded in HTML/JSON)
  // We keep it conservative: 11..17, exclude I/O/Q for 17-char candidates.
  const runRegex = /[A-Za-z0-9][A-Za-z0-9\-\s]{10,40}[A-Za-z0-9]/g
  for (const m of t.matchAll(runRegex)) {
    const raw = m[0] || ''
    const v = normalizeVinCandidate(raw)
    if (v.length < 11 || v.length > 17) continue

    if (v.length === 17 && !/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) {
      // 17-char candidate but invalid VIN charset
      continue
    }

    candidates.push({
      value: v,
      length: v.length,
      reason: 'alnum_run',
      snippet: raw.slice(0, 80),
    })
  }

  // Deduplicate while preserving order (best-effort)
  const seen = new Set<string>()
  return candidates.filter((c) => {
    const k = `${c.value}|${c.reason}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function pickBestVinCandidate(cands: Candidate[]): Candidate | null {
  if (!cands.length) return null
  // Prefer valid 17-char VINs first
  const c17 = cands.find((c) => c.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(c.value))
  if (c17) return c17
  // Else prefer longest (legacy/partial VINs)
  return cands.slice().sort((a, b) => b.length - a.length)[0] ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { vehicle_id, extra_text, notify_if_missing = true } = await req.json()
    if (!vehicle_id) {
      return new Response(JSON.stringify({ success: false, error: 'Missing vehicle_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const serviceKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SERVICE_KEY') ||
      ''
    if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY / SERVICE_ROLE_KEY')

    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, {
      auth: { persistSession: false },
    })

    const { data: vehicle, error: vErr } = await supabase
      .from('vehicles')
      .select('id, vin, year, make, model, description, origin_metadata, imported_by, created_by_user_id, discovered_by, owner_id, selling_organization_id, origin_organization_id, discovery_url, platform_url, bat_auction_url')
      .eq('id', vehicle_id)
      .single()

    if (vErr || !vehicle) throw new Error(vErr?.message || 'Vehicle not found')

    const sources: Record<string, any> = {}
    const textParts: string[] = []

    const addText = (label: string, value: any) => {
      const s = typeof value === 'string' ? value : (value ? JSON.stringify(value) : '')
      if (!s || s.trim().length < 1) return
      sources[label] = { chars: s.length }
      textParts.push(`--- ${label} ---\n${s}`)
    }

    addText('vehicles.description', vehicle.description)
    addText('vehicles.origin_metadata', vehicle.origin_metadata)
    addText('vehicles.bat_auction_url', vehicle.bat_auction_url)
    addText('vehicles.platform_url', vehicle.platform_url)
    addText('vehicles.discovery_url', vehicle.discovery_url)
    addText('extra_text', extra_text)

    const corpus = textParts.join('\n\n')
    const candidates = extractVinCandidatesFromText(corpus)
    const best = pickBestVinCandidate(candidates)

    const found17 = Boolean(best && best.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(best.value))
    const foundAny = Boolean(best)

    // Record status into vehicles.origin_metadata (no schema change required)
    const vinExtractionStatus = {
      attempted_at: new Date().toISOString(),
      sources,
      candidate_count: candidates.length,
      best_candidate: best,
      found_17: found17,
      found_any: foundAny,
    }

    const mergedOrigin = {
      ...(vehicle.origin_metadata || {}),
      vin_extraction: vinExtractionStatus,
    }

    await supabase
      .from('vehicles')
      .update({ origin_metadata: mergedOrigin })
      .eq('id', vehicle_id)

    // If we found a plausible 17-char VIN and the vehicle has none, set it + provenance.
    let updatedVin = false
    if (found17 && !vehicle.vin) {
      const vin = best!.value

      await supabase
        .from('vehicles')
        .update({ vin, vin_source: 'Text Extract', vin_confidence: 75 })
        .eq('id', vehicle_id)

      // Provenance: record where we found it.
      await supabase
        .from('vehicle_field_sources')
        .insert({
          vehicle_id,
          field_name: 'vin',
          field_value: vin,
          source_type: 'ai_scraped',
          source_url: vehicle.bat_auction_url || vehicle.platform_url || vehicle.discovery_url || null,
          confidence_score: 75,
          user_id: vehicle.imported_by || vehicle.created_by_user_id || vehicle.discovered_by || vehicle.owner_id || null,
          extraction_method: 'text_regex',
          metadata: {
            extracted_via: 'vehicle_text_scan',
            best_candidate: best,
            candidate_count: candidates.length,
            sources,
          },
        })
        .catch(() => null)

      updatedVin = true
    }

    // If we could not find a VIN and user wants outreach automation, create notifications for "historians".
    if (!found17 && !vehicle.vin && notify_if_missing) {
      // Identify likely recipients:
      // - vehicle owner/importer (if present)
      // - org historians/managers if vehicle belongs to an org
      const recipientIds = new Set<string>()
      for (const uid of [vehicle.owner_id, vehicle.imported_by, vehicle.created_by_user_id, vehicle.discovered_by, vehicle.user_id]) {
        if (uid) recipientIds.add(String(uid))
      }

      const orgId = vehicle.selling_organization_id || vehicle.origin_organization_id
      if (orgId) {
        const { data: orgUsers } = await supabase
          .from('organization_contributors')
          .select('user_id, role, status')
          .eq('organization_id', orgId)
          .in('role', ['historian', 'manager', 'owner', 'moderator'])
          .eq('status', 'active')

        for (const row of orgUsers || []) {
          if (row?.user_id) recipientIds.add(String(row.user_id))
        }
      }

      const vehicleName = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle'
      const actionUrl = `/vehicle/${vehicle_id}`

      for (const user_id of recipientIds) {
        await supabase
          .from('user_notifications')
          .insert({
            user_id,
            type: 'vin_needed',
            notification_type: 'vin_needed',
            title: `VIN needed: ${vehicleName}`,
            message:
              'We do not have enough data to extract a VIN yet. If you can reach the seller, request a VIN photo or the VIN string and upload it. This will unlock decoding and verification.',
            vehicle_id,
            action_url: actionUrl,
            metadata: {
              vin_extraction: vinExtractionStatus,
              suggested_next_steps: [
                'Ask seller for VIN string',
                'Ask seller for VIN plate photo (door jamb / dash / title)',
                'Upload VIN photo into VIN validator',
              ],
            },
          })
          .catch(() => null)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id,
        found_any: foundAny,
        found_17: found17,
        best_candidate: best,
        candidate_count: candidates.length,
        updated_vin: updatedVin,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('extract-vin-from-vehicle error:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})


