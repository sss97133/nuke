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
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('ANON_KEY') || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function secrets');
}

// For function-to-function calls, apikey header typically uses anon key, Authorization uses service role
const API_KEY = ANON_KEY || SERVICE_KEY;

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
    // First get all orgs, then we'll count vehicles separately
    let query = supabase
      .from('businesses')
      .select('id, business_name, website, business_type, created_at')
      .eq('is_public', true)
      .not('website', 'is', null)
      .neq('website', '')
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

    // Get vehicle counts for each organization
    const orgIds = orgs.map((o: any) => o.id);
    const { data: vehicleCounts } = await supabase
      .from('organization_vehicles')
      .select('organization_id')
      .in('organization_id', orgIds)
      .eq('status', 'active');
    
    const countMap = new Map<string, number>();
    for (const vc of vehicleCounts || []) {
      const orgId = (vc as any).organization_id;
      countMap.set(orgId, (countMap.get(orgId) || 0) + 1);
    }

    // Sort orgs by vehicle count (ascending - process empty ones first)
    orgs.sort((a: any, b: any) => {
      const countA = countMap.get(a.id) || 0;
      const countB = countMap.get(b.id) || 0;
      return countA - countB;
    });

    // Step 2: Process each organization
    const results = [];
    
    for (const org of orgs) {
      const vehicleCount = countMap.get(org.id) || 0;
      
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
        // Get service key fresh each time (in case it wasn't set at module load)
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || SERVICE_KEY;
        
        if (!serviceKey) {
          console.log(`   ⚠️  SERVICE_KEY is empty - check Edge Function secrets`);
          throw new Error('SERVICE_KEY is empty - check Edge Function secrets');
        }
        
        // Verify key format (should be JWT starting with eyJ)
        if (!serviceKey.startsWith('eyJ')) {
          console.log(`   ⚠️  SERVICE_KEY doesn't appear to be a JWT (should start with 'eyJ')`);
        }
        
        // Call discover-organization-full for this org
        // Use anon key for apikey header (Supabase convention), service role for Authorization
        const anonKey = ANON_KEY || serviceKey; // Fallback to service key if anon not available
        const discoverUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/discover-organization-full`;
        console.log(`   📡 Calling discover-organization-full for ${org.id}...`);
        const discoverResponse = await fetch(discoverUrl, {
          method: 'POST',
          headers: {
            'apikey': anonKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            organization_id: org.id,
            website: org.website,
          }),
        });
        
        console.log(`   📥 Response status: ${discoverResponse.status}`);

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
          let errorMessage = errorText.substring(0, 500);
          console.log(`   ❌ Failed: ${discoverResponse.status} - ${errorMessage}`);
          
          // Log more details for 401 errors to help debug
          if (discoverResponse.status === 401) {
            console.log(`   ⚠️  401 Error Details:`);
            console.log(`      - Service key length: ${serviceKey.length}`);
            console.log(`      - Service key starts with: ${serviceKey.substring(0, 10)}...`);
            console.log(`      - Full error: ${errorText}`);
          }
          
          results.push({
            organization_id: org.id,
            business_name: org.business_name,
            website: org.website,
            status: 'failed',
            vehicles_before: vehicleCount,
            error: errorMessage,
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

