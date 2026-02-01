import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'identify'; // 'identify' or 'cleanup'
    const dryRun = url.searchParams.get('dry_run') !== 'false'; // Default to dry run

    // Identify fake organizations from import_queue
    const identifyFakeOrgs = async () => {
      const { data, error } = await supabase.rpc('exec_sql', {
        query: `
          SELECT
            b.id,
            b.business_name,
            b.website,
            b.discovered_via,
            b.source_url,
            b.created_at,
            CASE 
              WHEN b.business_name IS NULL THEN 'null_name'
              WHEN length(trim(b.business_name)) < 3 THEN 'too_short_name'
              WHEN b.business_name ~* 'https?://' THEN 'name_contains_url'
              WHEN b.website IS NOT NULL AND b.website !~* '^https?://[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}' THEN 'invalid_website'
              ELSE 'other'
            END as issue_type
          FROM businesses b
          WHERE b.discovered_via = 'import_queue'
            AND (
              b.business_name IS NULL
              OR length(trim(b.business_name)) < 3
              OR b.business_name ~* 'https?://'
              OR (b.website IS NOT NULL AND b.website !~* '^https?://[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}')
            )
          ORDER BY b.created_at DESC
          LIMIT 100;
        `
      });

      if (error) throw error;

      // Get counts by issue type
      const { data: counts } = await supabase.rpc('exec_sql', {
        query: `
          SELECT
            CASE 
              WHEN business_name IS NULL THEN 'null_name'
              WHEN length(trim(business_name)) < 3 THEN 'too_short_name'
              WHEN business_name ~* 'https?://' THEN 'name_contains_url'
              WHEN website IS NOT NULL AND website !~* '^https?://[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}' THEN 'invalid_website'
              ELSE 'other'
            END as issue_type,
            count(*) as count
          FROM businesses
          WHERE discovered_via = 'import_queue'
            AND (
              business_name IS NULL
              OR length(trim(business_name)) < 3
              OR business_name ~* 'https?://'
              OR (website IS NOT NULL AND website !~* '^https?://[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}')
            )
          GROUP BY issue_type;
        `
      });

      return { fakeOrgs: data, counts };
    };

    // Cleanup fake organizations
    const cleanupFakeOrgs = async (dryRun: boolean) => {
      // First, find safe-to-delete organizations
      const { data: safeToDelete, error: findError } = await supabase
        .from('businesses')
        .select('id, business_name, website')
        .eq('discovered_via', 'import_queue')
        .or('business_name.is.null,business_name.lt.3,business_name.ilike.%http%')
        .limit(1000);

      if (findError) throw findError;

      // Filter to only those with no dependencies
      const safeIds: string[] = [];
      for (const org of safeToDelete || []) {
        // Check dependencies
        const [contributors, vehicles, images, team, ownership, roles] = await Promise.all([
          supabase.from('organization_contributors').select('id').eq('organization_id', org.id).limit(1),
          supabase.from('organization_vehicles').select('id').eq('organization_id', org.id).eq('status', 'active').limit(1),
          supabase.from('organization_images').select('id').eq('organization_id', org.id).limit(1),
          supabase.from('business_team_data').select('id').eq('business_id', org.id).limit(1),
          supabase.from('business_ownership').select('id').eq('business_id', org.id).limit(1),
          supabase.from('business_user_roles').select('id').eq('business_id', org.id).limit(1),
        ]);

        const hasDependencies = 
          (contributors.data?.length || 0) > 0 ||
          (vehicles.data?.length || 0) > 0 ||
          (images.data?.length || 0) > 0 ||
          (team.data?.length || 0) > 0 ||
          (ownership.data?.length || 0) > 0 ||
          (roles.data?.length || 0) > 0;

        if (!hasDependencies) {
          safeIds.push(org.id);
        }
      }

      if (dryRun) {
        return {
          dryRun: true,
          safeToDeleteCount: safeIds.length,
          safeToDeleteIds: safeIds,
          message: 'DRY RUN: Would delete these organizations. Set dry_run=false to actually delete.'
        };
      }

      // Actually delete
      if (safeIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('businesses')
          .delete()
          .in('id', safeIds);

        if (deleteError) throw deleteError;
      }

      return {
        dryRun: false,
        deletedCount: safeIds.length,
        deletedIds: safeIds
      };
    };

    if (action === 'cleanup') {
      const result = await cleanupFakeOrgs(dryRun);
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      const result = await identifyFakeOrgs();
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: any) {
    console.error('Cleanup error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

