/**
 * REPAIR BaT COMMENTS
 * Fixes broken comments from bat-simple-extract:
 * - Adds content_hash for deduplication
 * - Links to auction_events
 * - Updates comment counts
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const { vehicle_id, batch_size = 10 } = await req.json().catch(() => ({}))
    
    if (vehicle_id) {
      // Repair single vehicle
      return await repairVehicle(supabase, vehicle_id)
    } else {
      // Repair batch of vehicles with broken comments
      return await repairBatch(supabase, batch_size)
    }
  } catch (error: any) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function repairVehicle(supabase: any, vehicleId: string) {
  console.log(`Repairing comments for vehicle: ${vehicleId}`)
  
  // Get vehicle with BaT URL
  const { data: vehicle, error: vError } = await supabase
    .from('vehicles')
    .select('id, bat_auction_url, discovery_url')
    .eq('id', vehicleId)
    .single()
  
  if (vError || !vehicle) {
    throw new Error(`Vehicle not found: ${vehicleId}`)
  }
  
  const batUrl = vehicle.bat_auction_url || vehicle.discovery_url
  if (!batUrl || !batUrl.includes('bringatrailer.com')) {
    throw new Error(`Vehicle ${vehicleId} is not a BaT vehicle`)
  }
  
  // Get or create auction_event
  let { data: auctionEvent } = await supabase
    .from('auction_events')
    .select('id')
    .eq('source', 'bat')
    .eq('source_url', batUrl)
    .maybeSingle()
  
  if (!auctionEvent) {
    const { data: newEvent, error: eError } = await supabase
      .from('auction_events')
      .insert({
        vehicle_id: vehicleId,
        source: 'bat',
        source_url: batUrl,
        outcome: 'sold', // Default, will be updated by comprehensive extraction
      })
      .select('id')
      .single()
    
    if (eError) {
      throw new Error(`Failed to create auction_event: ${eError.message}`)
    }
    auctionEvent = newEvent
  }
  
  const eventId = auctionEvent.id
  
  // Get comments without content_hash or auction_event_id
  const { data: brokenComments, error: cError } = await supabase
    .from('auction_comments')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .or('content_hash.is.null,auction_event_id.is.null')
  
  if (cError) {
    throw new Error(`Failed to fetch comments: ${cError.message}`)
  }
  
  if (!brokenComments || brokenComments.length === 0) {
    return new Response(JSON.stringify({
      success: true,
      message: 'No broken comments to repair',
      vehicle_id: vehicleId
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  
  console.log(`Found ${brokenComments.length} broken comments to repair`)
  
  // Repair each comment
  let repaired = 0
  let errors = 0
  
  for (const comment of brokenComments) {
    try {
      // Generate content_hash if missing
      let contentHash = comment.content_hash
      if (!contentHash) {
        contentHash = await sha256Hex([
          'bat',
          batUrl,
          String(comment.sequence_number || 0),
          comment.posted_at || '',
          comment.author_username || '',
          comment.comment_text || '',
        ].join('|'))
      }
      
      // Update comment with content_hash and auction_event_id
      const { error: updateError } = await supabase
        .from('auction_comments')
        .update({
          content_hash: contentHash,
          auction_event_id: eventId,
        })
        .eq('id', comment.id)
      
      if (updateError) {
        console.error(`Failed to repair comment ${comment.id}:`, updateError)
        errors++
      } else {
        repaired++
      }
    } catch (e) {
      console.error(`Error repairing comment ${comment.id}:`, e)
      errors++
    }
  }
  
  // Update comment count on vehicle
  const { count: actualCount } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId)
  
  await supabase
    .from('vehicles')
    .update({ bat_comments: actualCount || 0 })
    .eq('id', vehicleId)
  
  return new Response(JSON.stringify({
    success: true,
    vehicle_id: vehicleId,
    repaired,
    errors,
    total_comments: actualCount || 0
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function repairBatch(supabase: any, batchSize: number) {
  // Find vehicles with broken comments
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, bat_auction_url, discovery_url')
    .or('bat_auction_url.not.is.null,discovery_url.ilike.%bringatrailer.com%')
    .limit(batchSize)
  
  if (error) {
    throw new Error(`Failed to fetch vehicles: ${error.message}`)
  }
  
  const results = []
  
  for (const vehicle of vehicles || []) {
    try {
      const result = await repairVehicle(supabase, vehicle.id)
      const data = await result.json()
      results.push(data)
    } catch (e: any) {
      results.push({
        vehicle_id: vehicle.id,
        success: false,
        error: e.message
      })
    }
  }
  
  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  
  return new Response(JSON.stringify({
    success: true,
    processed: results.length,
    successful,
    failed,
    results
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}


