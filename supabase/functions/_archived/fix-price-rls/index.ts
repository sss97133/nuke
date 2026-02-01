// Fix Price Save RLS Permissions
// Supabase Edge Function to execute SQL that fixes vehicle UPDATE policies

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Execute SQL to fix RLS policies
    const sql = `
      BEGIN;
      
      -- Drop all conflicting policies
      DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
      DROP POLICY IF EXISTS "Owners can update vehicles" ON vehicles;
      DROP POLICY IF EXISTS "Owners can update their vehicles" ON vehicles;
      DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;
      DROP POLICY IF EXISTS "Any authenticated user can edit vehicles" ON vehicles;
      DROP POLICY IF EXISTS "Authenticated users can update vehicles" ON vehicles;
      
      -- Create single simple policy
      CREATE POLICY "Authenticated users can update any vehicle"
        ON vehicles
        FOR UPDATE
        TO authenticated
        USING (true)
        WITH CHECK (true);
      
      -- Enable RLS
      ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
      
      COMMIT;
    `;

    // Execute via raw SQL query
    const { data, error } = await supabase.rpc('exec', { sql });

    if (error) {
      throw error;
    }

    // Verify the fix worked
    const { data: policies } = await supabase
      .from('pg_policies')
      .select('policyname, cmd')
      .eq('tablename', 'vehicles')
      .eq('cmd', 'UPDATE');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Price save permissions fixed!',
        policies: policies || []
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
        hint: 'Run FIX_PRICE_SAVE_NOW.sql manually in Supabase SQL Editor'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});

