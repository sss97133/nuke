import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get bat_listings stats
    const { data: batStats } = await supabase
      .from('bat_listings')
      .select('id, vehicle_id, comment_count, comments_extracted_at, url')
      .is('comments_extracted_at', null)
      .limit(10);

    const { count: totalBatListings } = await supabase
      .from('bat_listings')
      .select('*', { count: 'exact', head: true });

    const { count: withComments } = await supabase
      .from('bat_listings')
      .select('*', { count: 'exact', head: true })
      .not('comments_extracted_at', 'is', null);

    const { count: needsExtraction } = await supabase
      .from('bat_listings')
      .select('*', { count: 'exact', head: true })
      .is('comments_extracted_at', null)
      .gt('comment_count', 0);

    // Get import queue stats for BaT
    const { data: queueStats } = await supabase
      .from('import_queue')
      .select('status')
      .like('listing_url', '%bringatrailer%');

    const queueCounts = queueStats?.reduce((acc: any, row: any) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    return new Response(JSON.stringify({
      success: true,
      bat_listings: {
        total: totalBatListings,
        with_comments_extracted: withComments,
        needs_comment_extraction: needsExtraction,
        sample_needing_extraction: batStats
      },
      import_queue: queueCounts || {}
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
