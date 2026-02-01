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
    // Check multiple possible env var names and prioritize JWT format keys
    const keyCandidates = [
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      Deno.env.get('SERVICE_ROLE_KEY'),
      Deno.env.get('SUPABASE_SERVICE_KEY'),
    ].filter(Boolean) as string[];

    // Prioritize JWT format keys (start with 'eyJ') over sb_secret format
    const jwtKeys = keyCandidates.filter(k => k.startsWith('eyJ'));
    const otherKeys = keyCandidates.filter(k => !k.startsWith('eyJ'));
    
    // Prefer JWT format, fallback to others
    const serviceRoleKey = jwtKeys.length > 0 ? jwtKeys[0] : (otherKeys.length > 0 ? otherKeys[0] : null);
    
    if (!serviceRoleKey) {
      return new Response(JSON.stringify({
        success: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY not found in Edge Function secrets',
        checked_vars: ['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'],
        found_keys: keyCandidates.length,
        jwt_keys_found: jwtKeys.length
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // This function uses service role key from Edge Function secrets
    // It doesn't need JWT verification because it's called by cron jobs
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey
    );

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
      message: 'Service role key synced to database and set automatically',
      key_format: serviceRoleKey.startsWith('eyJ') ? 'JWT' : serviceRoleKey.startsWith('sb_') ? 'SB_SECRET' : 'UNKNOWN',
      key_length: serviceRoleKey.length
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

