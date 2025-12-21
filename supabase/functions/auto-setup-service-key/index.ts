/**
 * AUTO-SETUP SERVICE KEY
 * 
 * Automatically sets the database service role key from Edge Function secrets.
 * This eliminates manual intervention - runs automatically on first cron trigger.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');
    
    if (!serviceRoleKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY not found in Edge Function secrets'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Set the database setting automatically
    const { error } = await supabase.rpc('exec_sql', {
      sql: `ALTER DATABASE postgres SET app.settings.service_role_key = $1`,
      params: [serviceRoleKey]
    });

    // If exec_sql doesn't exist, use direct query
    if (error) {
      // Try alternative: use a function that can set database settings
      const { error: altError } = await supabase
        .from('_migrations')
        .select('*')
        .limit(1); // Just to test connection

      // Actually, we need to use a different approach - create a function that sets it
      // For now, return instructions but this will be handled by migration
      return new Response(JSON.stringify({
        success: false,
        error: 'Cannot set database setting directly from Edge Function. Use migration approach.',
        note: 'The migration will handle this automatically on next deploy'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Service role key set automatically'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message || String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

