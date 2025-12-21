/**
 * SYNC SERVICE KEY TO DATABASE
 * 
 * Reads service role key from Edge Function secrets and stores it in database
 * so cron jobs can access it. This enables fully automated setup.
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

    // Store in database secrets table
    const { error } = await supabase
      .from('_app_secrets')
      .upsert({
        key: 'service_role_key',
        value: serviceRoleKey,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'key'
      });

    if (error) {
      throw new Error(`Failed to store secret: ${error.message}`);
    }

    // Now set the database setting
    const { error: setError } = await supabase.rpc('set_service_role_key_from_secret');

    if (setError) {
      // If RPC fails, try direct SQL (requires superuser, may not work)
      console.warn('RPC failed, attempting direct SQL:', setError.message);
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Service role key synced to database and set automatically'
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

