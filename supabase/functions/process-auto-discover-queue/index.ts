/**
 * Process Auto-Discover Queue
 * Background worker that processes queued vehicle reference document discovery requests
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

    // Get pending queue items (limit to 10 at a time)
    const { data: queueItems, error } = await supabase
      .from('auto_discover_docs_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10)

    if (error) throw error

    if (!queueItems || queueItems.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No items in queue' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let processed = 0
    let failed = 0

    // Process each item
    for (const item of queueItems) {
      try {
        // Mark as processing
        await supabase
          .from('auto_discover_docs_queue')
          .update({ status: 'processing' })
          .eq('id', item.id)

        // Call the auto-discover function
        const { data, error: funcError } = await supabase.functions.invoke('auto-discover-reference-docs', {
          body: {
            vehicle_id: item.vehicle_id,
            year: item.year,
            make: item.make,
            model: item.model,
            series: item.series,
            body_style: item.body_style,
          },
        })

        if (funcError) throw funcError

        // Mark as completed
        await supabase
          .from('auto_discover_docs_queue')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString(),
          })
          .eq('id', item.id)

        processed++
      } catch (e: any) {
        console.error(`Failed to process queue item ${item.id}:`, e)
        
        // Mark as failed
        await supabase
          .from('auto_discover_docs_queue')
          .update({
            status: 'failed',
            error_message: e.message,
            processed_at: new Date().toISOString(),
          })
          .eq('id', item.id)

        failed++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        failed,
        total: queueItems.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Queue processing error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

