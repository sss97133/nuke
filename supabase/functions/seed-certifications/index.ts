import type { Database } from '../types';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const initialCertifications = [
      {
        name: 'Advanced Vehicle Diagnostics',
        description: 'Master modern vehicle diagnostic techniques and tools',
        issuing_authority: 'Automotive Service Excellence (ASE)',
        validity_period: '2 years'
      },
      {
        name: 'Electric Vehicle Specialist',
        description: 'Comprehensive training in electric vehicle systems and maintenance',
        issuing_authority: 'Electric Vehicle Training Alliance',
        validity_period: '1 year'
      },
      {
        name: 'Automotive Business Management',
        description: 'Business operations and management in the automotive industry',
        issuing_authority: 'Automotive Management Institute',
        validity_period: '3 years'
      }
    ]

    const { data: certifications, error: certError } = await supabaseClient
  if (error) console.error("Database query error:", error);
      .from('certifications')
      .insert(initialCertifications)
      .select()

    if (certError) throw certError

    return new Response(
      JSON.stringify({ success: true, certifications }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})