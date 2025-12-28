/**
 * Batch Enrich All Organizations
 * 
 * Enriches all organizations that are missing descriptions or have generic business types.
 * Can be run as a scheduled job or manually triggered.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { limit = 50, dryRun = false } = await req.json().catch(() => ({}));

    // Find organizations that need enrichment
    const { data: orgs, error } = await supabase
      .from('businesses')
      .select('id, business_name, description, business_type, website')
      .eq('is_public', true)
      .or(`description.is.null,business_type.eq.other`)
      .limit(limit);

    if (error) throw error;

    if (!orgs || orgs.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No organizations need enrichment', enriched: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    const results = [];
    let enriched = 0;
    let errors = 0;

    for (const org of orgs) {
      if (!org.website) {
        results.push({
          id: org.id,
          name: org.business_name,
          status: 'skipped',
          reason: 'no_website'
        });
        continue;
      }

      if (dryRun) {
        results.push({
          id: org.id,
          name: org.business_name,
          status: 'would_enrich',
          website: org.website,
          needs_description: !org.description,
          needs_type: org.business_type === 'other'
        });
        continue;
      }

      try {
        // First, generate comprehensive due diligence report
        const { data: ddReport, error: ddError } = await supabase.functions.invoke('generate-org-due-diligence', {
          body: {
            organizationId: org.id,
            websiteUrl: org.website,
            forceRegenerate: false
          }
        });

        if (ddError) {
          // Fallback to basic enrichment if due diligence fails
          const { data, error: enrichError } = await supabase.functions.invoke('update-org-from-website', {
            body: {
              organizationId: org.id,
              websiteUrl: org.website
            }
          });

          if (enrichError) {
            results.push({
              id: org.id,
              name: org.business_name,
              status: 'error',
              error: `Due diligence failed: ${ddError.message}, Basic enrichment failed: ${enrichError.message}`
            });
            errors++;
          } else {
            results.push({
              id: org.id,
              name: org.business_name,
              status: 'enriched_basic',
              website: org.website,
              note: 'Due diligence failed, used basic enrichment'
            });
            enriched++;
          }
        } else {
          results.push({
            id: org.id,
            name: org.business_name,
            status: 'enriched_due_diligence',
            website: org.website,
            confidence: ddReport?.report?.confidence_score
          });
          enriched++;
        }

        // Rate limiting - wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err: any) {
        results.push({
          id: org.id,
          name: org.business_name,
          status: 'error',
          error: err.message
        });
        errors++;
      }
    }

    return new Response(
      JSON.stringify({
        total: orgs.length,
        enriched,
        errors,
        dryRun,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

