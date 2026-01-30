/**
 * Track Affiliate Click
 *
 * Records affiliate link clicks for attribution and conversion tracking:
 * - Logs click to affiliate_clicks table
 * - Increments sponsored_placements.clicks if applicable
 * - Hashes IP for privacy
 * - Returns click_id for conversion tracking
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TrackClickRequest {
  source_name: string
  destination_url: string
  affiliate_url: string
  user_id?: string
  vehicle_id?: string
  part_id?: string
  issue_pattern?: string
  sponsored_placement_id?: string
  referrer_url?: string
  session_id?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: TrackClickRequest = await req.json()
    const {
      source_name,
      destination_url,
      affiliate_url,
      user_id,
      vehicle_id,
      part_id,
      issue_pattern,
      sponsored_placement_id,
      referrer_url,
      session_id
    } = payload

    if (!source_name || !destination_url) {
      return new Response(JSON.stringify({ error: 'source_name and destination_url are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get client info
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     req.headers.get('x-real-ip') ||
                     'unknown'
    const userAgent = req.headers.get('user-agent') || 'unknown'
    const deviceType = detectDeviceType(userAgent)

    // Hash IP for privacy
    const ipHash = await hashIP(clientIP)

    // Generate unique click ID
    const clickId = generateClickId()

    // Look up source_id from affiliate_programs
    const { data: program } = await supabase
      .from('affiliate_programs')
      .select('id')
      .eq('source_name', source_name)
      .single()

    // Insert click record
    const { data: clickData, error: insertError } = await supabase
      .from('affiliate_clicks')
      .insert({
        user_id: user_id || null,
        vehicle_id: vehicle_id || null,
        part_id: part_id || null,
        source_id: program?.id || null,
        issue_pattern: issue_pattern || null,
        sponsored_placement_id: sponsored_placement_id || null,
        destination_url,
        affiliate_url,
        referrer_url: referrer_url || null,
        session_id: session_id || null,
        ip_hash: ipHash,
        user_agent: userAgent.substring(0, 500), // Truncate long user agents
        device_type: deviceType,
        click_id: clickId,
        created_at: new Date().toISOString()
      })
      .select('id, click_id')
      .single()

    if (insertError) {
      console.error('Error inserting click:', insertError)
      throw new Error('Failed to record click')
    }

    // Increment sponsored placement clicks if applicable
    if (sponsored_placement_id) {
      await incrementSponsoredClicks(sponsored_placement_id)
    }

    console.log(`Click tracked: ${clickId} -> ${source_name}`)

    return new Response(JSON.stringify({
      success: true,
      click_id: clickId,
      id: clickData.id
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Track click error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

/**
 * Hash IP address for privacy-compliant tracking
 */
async function hashIP(ip: string): Promise<string> {
  // Add a salt for additional privacy
  const salt = Deno.env.get('IP_HASH_SALT') || 'viva-parts-tracking'
  const data = new TextEncoder().encode(ip + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate unique click ID for conversion tracking
 */
function generateClickId(): string {
  const timestamp = Date.now().toString(36)
  const randomPart = crypto.randomUUID().replace(/-/g, '').substring(0, 8)
  return `vc_${timestamp}_${randomPart}`
}

/**
 * Detect device type from user agent
 */
function detectDeviceType(userAgent: string): 'desktop' | 'mobile' | 'tablet' | 'unknown' {
  const ua = userAgent.toLowerCase()

  // Check for tablets first (before mobile, since some tablets include "mobile")
  if (/(ipad|tablet|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet'
  }

  // Check for mobile
  if (/(android|webos|iphone|ipod|blackberry|iemobile|opera mini|mobile)/i.test(ua)) {
    return 'mobile'
  }

  // Check for desktop indicators
  if (/(windows|macintosh|linux|cros)/i.test(ua)) {
    return 'desktop'
  }

  return 'unknown'
}

/**
 * Increment clicks counter for sponsored placement
 */
async function incrementSponsoredClicks(placementId: string): Promise<void> {
  // Use raw SQL to atomically increment
  const { error } = await supabase.rpc('increment_sponsored_clicks', {
    placement_id: placementId
  })

  if (error) {
    // Fallback: direct update (less safe for concurrency)
    console.warn('RPC increment failed, using direct update:', error)

    const { data: current } = await supabase
      .from('sponsored_placements')
      .select('clicks')
      .eq('id', placementId)
      .single()

    if (current) {
      await supabase
        .from('sponsored_placements')
        .update({ clicks: (current.clicks || 0) + 1 })
        .eq('id', placementId)
    }
  }
}
