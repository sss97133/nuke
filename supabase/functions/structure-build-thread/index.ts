/**
 * STRUCTURE-BUILD-THREAD
 *
 * Extracts structured vehicle data from a forum build thread.
 * Creates vehicle profile and timeline from posts.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface StructureRequest {
  thread_id: string
  create_vehicle?: boolean
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { thread_id, create_vehicle = true }: StructureRequest = await req.json()

    if (!thread_id) {
      return new Response(
        JSON.stringify({ error: 'thread_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    // Get thread
    const { data: thread, error: threadError } = await supabase
      .from('build_threads')
      .select('id, thread_title, thread_url, vehicle_id, vehicle_hints, author_handle, forum_source_id')
      .eq('id', thread_id)
      .single()

    if (threadError || !thread) {
      return new Response(
        JSON.stringify({ error: 'Thread not found', details: threadError }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get forum info
    const { data: forum } = await supabase
      .from('forum_sources')
      .select('name, slug, base_url')
      .eq('id', thread.forum_source_id)
      .single()

    // Get posts (limit to first 60 for context window)
    const { data: posts } = await supabase
      .from('build_posts')
      .select('content_text, posted_at, post_number, author_handle')
      .eq('build_thread_id', thread_id)
      .order('post_number', { ascending: true })
      .limit(60)

    if (!posts?.length) {
      return new Response(
        JSON.stringify({ error: 'No posts found for thread' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Combine posts for AI analysis
    const postText = posts.map(p =>
      `[${p.posted_at?.split('T')[0] || 'unknown'}] @${p.author_handle || 'anon'}: ${p.content_text?.slice(0, 400) || ''}`
    ).join('\n\n')

    // Call OpenAI
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `You extract structured vehicle build data from forum threads. Return ONLY valid JSON.`
        }, {
          role: 'user',
          content: `Analyze this build thread and extract structured data.

FORUM: ${forum?.name || 'Unknown'} (${forum?.slug || ''})
THREAD TITLE: ${thread.thread_title}
AUTHOR: ${thread.author_handle || 'Unknown'}
URL: ${thread.thread_url}

POSTS:
${postText.slice(0, 15000)}

Extract JSON with these fields:
{
  "vehicle": {
    "year": number or "YYYY-YYYY" range if uncertain,
    "make": string,
    "model": string,
    "submodel": string or null (trim, variant),
    "body_style": string or null,
    "color": string or null,
    "vin_partial": string or null (if any VIN digits mentioned)
  },
  "build_type": "restoration" | "restomod" | "pro-touring" | "custom" | "maintenance" | "unknown",
  "timeline": [
    {"date": "YYYY-MM-DD", "event": "description", "parts": ["part1"], "cost": "$X" or null}
  ],
  "parts_installed": [
    {"category": "engine|trans|suspension|brakes|interior|exterior|electrical", "name": "part name", "brand": "brand or null", "source": "vendor or null", "cost": "$X or null"}
  ],
  "donors": [
    {"year": number, "make": "string", "model": "string", "parts_used": "what was taken"}
  ],
  "problems": ["problem 1", "problem 2"],
  "vendors": ["vendor1", "vendor2"],
  "owner_contact": {
    "forum_handle": "${thread.author_handle || ''}",
    "forum_profile_url": "construct if possible or null"
  },
  "confidence": 0.0-1.0
}

Be specific and extract real data. If uncertain about year, give a range. Return ONLY JSON.`
        }],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    })

    const aiData = await aiResponse.json()
    const content = aiData.choices?.[0]?.message?.content

    let structured
    try {
      // Clean potential markdown formatting
      const jsonStr = content?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      structured = JSON.parse(jsonStr)
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI response', raw: content }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let vehicleId = thread.vehicle_id
    let vehicleCreated = false

    // Create vehicle if requested and none exists
    if (create_vehicle && !vehicleId && structured.vehicle) {
      const v = structured.vehicle
      const yearVal = typeof v.year === 'string' && v.year.includes('-')
        ? parseInt(v.year.split('-')[0])
        : (typeof v.year === 'number' ? v.year : null)

      const { data: newVehicle, error: createError } = await supabase
        .from('vehicles')
        .insert({
          year: yearVal,
          make: v.make || 'Unknown',
          model: v.model || 'Unknown',
          trim: v.submodel,
          body_style: v.body_style,
          color: v.color,
          vin: v.vin_partial?.length >= 17 ? v.vin_partial : null,
          status: 'discovered',
          discovery_source: 'forum_build_extraction',
          notes: `Extracted from: ${thread.thread_url}`,
        })
        .select('id')
        .single()

      if (newVehicle) {
        vehicleId = newVehicle.id
        vehicleCreated = true

        // Link thread to vehicle
        await supabase
          .from('build_threads')
          .update({
            vehicle_id: vehicleId,
            vehicle_hints: structured.vehicle,
          })
          .eq('id', thread_id)
      } else if (createError) {
        // Return error info for debugging
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Vehicle creation failed',
            details: createError,
            attempted_vehicle: {
              year: yearVal,
              make: v.make,
              model: v.model,
            },
            structured,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Store structured data as observation (using 'comment' kind since build_timeline not in enum)
    if (vehicleId) {
      await supabase
        .from('vehicle_observations')
        .insert({
          vehicle_id: vehicleId,
          kind: 'comment',
          source_url: thread.thread_url,
          content_text: `Build thread: ${thread.thread_title}\n\nExtracted: ${structured.timeline?.length || 0} events, ${structured.parts_installed?.length || 0} parts`,
          structured_data: structured,
          observed_at: posts[0]?.posted_at || new Date().toISOString(),
        })
    }

    // Mark thread as processed
    await supabase
      .from('build_threads')
      .update({
        extraction_status: 'structured',
        vehicle_hints: structured.vehicle,
      })
      .eq('id', thread_id)

    return new Response(
      JSON.stringify({
        success: true,
        thread_id,
        vehicle_id: vehicleId,
        vehicle_created: vehicleCreated,
        vehicle_hints_updated: true,
        structured,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
