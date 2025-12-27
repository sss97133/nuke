import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Extract All Organizations Inventory
 * 
 * Systematically extracts vehicles from all organizations with websites.
 * Uses discover-organization-full for each org to ensure proper pattern learning.
 * 
 * Strategy:
 * - Process one org at a time (full extraction)
 * - Learns patterns as it goes
 * - Gets smarter with each extraction
 * - Processes in order of priority (orgs with no vehicles first)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractRequest {
  limit?: number;
  offset?: number;
  min_vehicle_threshold?: number; // Only process orgs with fewer vehicles than this
  business_type?: string; // Filter by business type
  dry_run?: boolean;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      limit = 10, 
      offset = 0,
      min_vehicle_threshold = 10, // Default: process orgs with < 10 vehicles
      business_type,
      dry_run = false
    }: ExtractRequest = await req.json().catch(() => ({}));

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    console.log(`\n🚀 EXTRACT ALL ORGANIZATIONS INVENTORY`);
    console.log('='.repeat(70));
    console.log(`Limit: ${limit}`);
    console.log(`Offset: ${offset}`);
    console.log(`Min Vehicle Threshold: ${min_vehicle_threshold}`);
    console.log(`Business Type: ${business_type || 'all'}`);
    console.log(`Dry Run: ${dry_run}\n`);

    // Step 1: Find organizations that need extraction
    let query = supabase
      .from('businesses')
      .select(`
        id,
        business_name,
        website,
        business_type,
        (
          SELECT COUNT(*)
          FROM organization_vehicles
          WHERE organization_id = businesses.id
          AND status = 'active'
        ) as vehicle_count
      `)
      .eq('is_public', true)
      .not('website', 'is', null)
      .neq('website', '')
      .order('vehicle_count', { ascending: true }) // Process orgs with no/few vehicles first
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (business_type) {
      query = query.eq('business_type', business_type);
    }

    const { data: orgs, error: orgError } = await query;

    if (orgError) {
      throw new Error(`Failed to fetch organizations: ${orgError.message}`);
    }

    if (!orgs || orgs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No organizations found matching criteria',
          processed: 0,
          results: [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Found ${orgs.length} organizations to process\n`);

    // Step 2: Process each organization
    const results = [];
    
    for (const org of orgs) {
      const vehicleCount = (org as any).vehicle_count || 0;
      
      // Skip if already has enough vehicles
      if (vehicleCount >= min_vehicle_threshold) {
        console.log(`⏭️  Skipping ${org.business_name} (${vehicleCount} vehicles, threshold: ${min_vehicle_threshold})`);
        continue;
      }

      console.log(`\n🔍 Processing: ${org.business_name}`);
      console.log(`   Website: ${org.website}`);
      console.log(`   Current vehicles: ${vehicleCount}`);

      if (dry_run) {
        console.log(`   [DRY RUN] Would run discover-organization-full for ${org.id}`);
        results.push({
          organization_id: org.id,
          business_name: org.business_name,
          website: org.website,
          status: 'dry_run',
          vehicles_before: vehicleCount,
        });
        continue;
      }

      try {
        // Call discover-organization-full for this org
        const discoverUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/discover-organization-full`;
        const discoverResponse = await fetch(discoverUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            organization_id: org.id,
            website: org.website,
          }),
        });

        if (discoverResponse.ok) {
          const discoverData = await discoverResponse.json();
          const result = discoverData.result || {};
          
          console.log(`   ✅ Success:`);
          console.log(`      - Vehicles found: ${result.vehicles_found || 0}`);
          console.log(`      - Vehicles created: ${result.vehicles_created || 0}`);
          console.log(`      - Patterns stored: ${result.learned_patterns_stored ? 'YES' : 'NO'}`);

          results.push({
            organization_id: org.id,
            business_name: org.business_name,
            website: org.website,
            status: 'success',
            vehicles_before: vehicleCount,
            vehicles_found: result.vehicles_found || 0,
            vehicles_created: result.vehicles_created || 0,
            patterns_stored: result.learned_patterns_stored || false,
          });
        } else {
          const errorText = await discoverResponse.text();
          console.log(`   ❌ Failed: ${discoverResponse.status} - ${errorText.substring(0, 200)}`);
          
          results.push({
            organization_id: org.id,
            business_name: org.business_name,
            website: org.website,
            status: 'failed',
            vehicles_before: vehicleCount,
            error: errorText.substring(0, 500),
          });
        }
      } catch (error: any) {
        console.log(`   ❌ Error: ${error.message}`);
        
        results.push({
          organization_id: org.id,
          business_name: org.business_name,
          website: org.website,
          status: 'error',
          vehicles_before: vehicleCount,
          error: error.message,
        });
      }

      // Small delay between orgs to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Step 3: Summary statistics
    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'failed' || r.status === 'error');
    const totalVehiclesCreated = successful.reduce((sum, r) => sum + (r.vehicles_created || 0), 0);

    console.log(`\n📊 Summary:`);
    console.log(`   - Processed: ${results.length}`);
    console.log(`   - Successful: ${successful.length}`);
    console.log(`   - Failed: ${failed.length}`);
    console.log(`   - Total vehicles created: ${totalVehiclesCreated}\n`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        successful: successful.length,
        failed: failed.length,
        total_vehicles_created: totalVehiclesCreated,
        results: results,
        next_offset: offset + limit,
        has_more: orgs.length === limit,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Extraction error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

