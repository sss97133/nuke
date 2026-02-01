import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Reset all BaT failures to pending
    const { error: updateError } = await supabase.rpc('execute_sql', {
      query: `
        UPDATE import_queue
        SET
          status = 'pending',
          attempts = 0,
          error_message = NULL,
          locked_by = NULL,
          locked_at = NULL,
          next_attempt_at = NULL,
          last_attempt_at = NULL
        WHERE
          status = 'failed'
          AND listing_url LIKE '%bringatrailer%'
      `
    });

    if (updateError) {
      // Fallback to direct update
      const { error } = await supabase
        .from('import_queue')
        .update({
          status: 'pending',
          attempts: 0,
          error_message: null,
          locked_by: null,
          locked_at: null,
          next_attempt_at: null,
          last_attempt_at: null
        })
        .eq('status', 'failed')
        .like('listing_url', '%bringatrailer%');

      if (error) throw error;
    }

    // Get counts
    const { data: counts } = await supabase
      .from('import_queue')
      .select('status')
      .like('listing_url', '%bringatrailer%');

    const statusCounts = counts?.reduce((acc: any, row: any) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    return new Response(JSON.stringify({
      success: true,
      message: 'BaT failures reset to pending',
      counts: statusCounts
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
