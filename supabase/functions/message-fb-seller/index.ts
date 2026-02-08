import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FB_RELAY_URL = Deno.env.get('FB_RELAY_URL');
const FB_RELAY_TOKEN = Deno.env.get('FB_RELAY_TOKEN') || 'nuke-fb-relay-2026';

function buildMessage(listing: { parsed_year: number | null; parsed_make: string | null; parsed_model: string | null }): string {
  const vehicle = [listing.parsed_year, listing.parsed_make, listing.parsed_model]
    .filter(Boolean)
    .join(' ');

  return `Hi! I'm interested in your ${vehicle || 'vehicle'}. Could you share the VIN number and a few more photos (engine bay, interior, undercarriage)? Thanks!`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { listing_id, batch_size = 5, dry_run = false } = body;

    if (!FB_RELAY_URL) {
      return new Response(
        JSON.stringify({ error: 'FB_RELAY_URL not configured' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let listings: any[] = [];

    if (listing_id) {
      // Single listing mode
      const { data } = await supabase
        .from('marketplace_listings')
        .select('id, url, title, parsed_year, parsed_make, parsed_model, messaged_at, submission_count')
        .eq('id', listing_id)
        .maybeSingle();

      if (!data) {
        return new Response(
          JSON.stringify({ error: 'Listing not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (data.messaged_at && !body.force) {
        return new Response(
          JSON.stringify({ error: 'Already messaged', messaged_at: data.messaged_at }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      listings = [data];
    } else {
      // Batch mode: find unmessaged listings, prioritize by submission_count
      const { data } = await supabase
        .from('marketplace_listings')
        .select('id, url, title, parsed_year, parsed_make, parsed_model, submission_count')
        .is('messaged_at', null)
        .not('parsed_year', 'is', null)
        .not('url', 'is', null)
        .order('submission_count', { ascending: false, nullsFirst: false })
        .order('first_seen_at', { ascending: true })
        .limit(batch_size);

      listings = data || [];
    }

    if (listings.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No unmessaged listings found', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: { listing_id: string; status: string; error?: string }[] = [];

    for (const listing of listings) {
      const message = buildMessage(listing);

      if (dry_run) {
        results.push({ listing_id: listing.id, status: 'dry_run' });
        continue;
      }

      try {
        const resp = await fetch(`${FB_RELAY_URL}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${FB_RELAY_TOKEN}`,
          },
          body: JSON.stringify({
            url: listing.url,
            action: 'message',
            message,
          }),
          signal: AbortSignal.timeout(65000),
        });

        const result = await resp.json();

        if (result.success) {
          // Update listing
          await supabase
            .from('marketplace_listings')
            .update({ messaged_at: new Date().toISOString() })
            .eq('id', listing.id);

          // Log outreach
          await supabase
            .from('seller_outreach_log')
            .insert({
              listing_id: listing.id,
              channel: 'facebook_messenger',
              message_text: message,
              status: 'sent',
            });

          results.push({ listing_id: listing.id, status: 'sent' });
        } else {
          // Log failure
          await supabase
            .from('seller_outreach_log')
            .insert({
              listing_id: listing.id,
              channel: 'facebook_messenger',
              message_text: message,
              status: 'failed',
            });

          results.push({ listing_id: listing.id, status: 'failed', error: result.error });
        }
      } catch (err) {
        results.push({ listing_id: listing.id, status: 'error', error: err.message });
      }

      // Rate limit: wait between messages
      if (listings.length > 1) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed' || r.status === 'error').length;

    return new Response(
      JSON.stringify({
        success: true,
        sent,
        failed,
        total: results.length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('message-fb-seller error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
