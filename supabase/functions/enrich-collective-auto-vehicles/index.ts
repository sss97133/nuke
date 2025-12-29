/**
 * ENRICH COLLECTIVE AUTO VEHICLES
 * 
 * Scrapes individual vehicle pages via Firecrawl to extract:
 * - VIN
 * - Mileage
 * - All images
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ORG_ID = 'b8a962a3-1aeb-44a2-92be-e23a7728c277';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlKey) {
      throw new Error('FIRECRAWL_API_KEY not set');
    }

    const body = await req.json().catch(() => ({}));
    const { limit = 10 } = body;

    console.log('🔧 ENRICHING COLLECTIVE AUTO VEHICLES');
    console.log('='.repeat(70));

    // Get vehicles that need enrichment (no VIN or no images)
    // First get Collective Auto vehicles, then filter for ones needing enrichment
    const { data: allCollectiveVehicles, error: queryError } = await supabase
      .from('vehicles')
      .select('id, listing_url, vin, mileage, year, make, model')
      .or('discovery_source.eq.Collective Auto Group,listing_source.eq.Collective Auto Group,listing_url.like.%collectiveauto%')
      .limit(500);
    
    // Filter to vehicles needing enrichment
    const vehiclesNeedingEnrichment: typeof allCollectiveVehicles = [];
    for (const v of allCollectiveVehicles || []) {
      if (!v.vin) {
        vehiclesNeedingEnrichment.push(v);
      } else {
        // Check if has images
        const { count } = await supabase
          .from('vehicle_images')
          .select('*', { count: 'exact', head: true })
          .eq('vehicle_id', v.id);
        if (!count || count === 0) {
          vehiclesNeedingEnrichment.push(v);
        }
      }
      if (vehiclesNeedingEnrichment.length >= limit) break;
    }
    const vehicles = vehiclesNeedingEnrichment.slice(0, limit);

    if (queryError) {
      throw new Error(`Query error: ${queryError.message}`);
    }

    console.log(`📋 Found ${vehicles?.length || 0} vehicles to enrich\n`);

    let enriched = 0;
    let errors = 0;

    for (const vehicle of vehicles || []) {
      console.log(`\n🚗 [${enriched + errors + 1}/${vehicles.length}] ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      
      if (!vehicle.listing_url) {
        console.log('   ⚠️  No listing URL, skipping');
        errors++;
        continue;
      }

      try {
        // Scrape detail page via Firecrawl
        console.log(`   🔥 Scraping ${vehicle.listing_url}`);
        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${firecrawlKey}`,
          },
          body: JSON.stringify({
            url: vehicle.listing_url,
            waitFor: 3000,
            formats: ['html'],
          }),
        });

        if (!firecrawlResponse.ok) {
          console.log(`   ❌ Firecrawl HTTP ${firecrawlResponse.status}`);
          errors++;
          continue;
        }

        const firecrawlData = await firecrawlResponse.json();
        if (!firecrawlData.success || !firecrawlData.data?.html) {
          console.log('   ❌ Firecrawl returned no HTML');
          errors++;
          continue;
        }

        const html = firecrawlData.data.html;
        console.log(`   ✅ Got ${html.length} chars`);

        // Extract VIN (17-character alphanumeric)
        const vinMatch = html.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
        const vin = vinMatch ? vinMatch[1].toUpperCase() : null;
        if (vin) console.log(`   📝 VIN: ${vin}`);

        // Extract mileage
        const mileageMatch = html.match(/([\d,]+)\s*(?:Miles|miles|mi\.?)\b/i);
        const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;
        if (mileage) console.log(`   📝 Mileage: ${mileage.toLocaleString()}`);

        // Extract all image URLs from cdn.dealeraccelerate.com
        const imageUrls: string[] = [];
        const imgMatches = html.matchAll(/https:\/\/cdn\.dealeraccelerate\.com\/collective\/[^"'\s<>]+/g);
        const seen = new Set<string>();
        for (const m of imgMatches) {
          // Normalize to 1920x1440 resolution
          const imgUrl = m[0].replace(/\d+x\d+/g, '1920x1440');
          if (!seen.has(imgUrl) && imgUrl.includes('/1920x1440/')) {
            seen.add(imgUrl);
            imageUrls.push(imgUrl);
          }
        }
        console.log(`   📷 Found ${imageUrls.length} images`);

        // Update vehicle
        const updateData: Record<string, any> = {
          // Always set origin_organization_id for proper attribution
          origin_organization_id: ORG_ID,
          profile_origin: 'organization_import',
        };
        if (vin) {
          updateData.vin = vin;
          updateData.vin_source = 'Collective Auto Group';
        }
        if (mileage) {
          updateData.mileage = mileage;
          updateData.mileage_source = 'Collective Auto Group';
        }
        if (imageUrls.length > 0) {
          updateData.primary_image_url = imageUrls[0];
          updateData.image_url = imageUrls[0];
        }

        if (Object.keys(updateData).length > 0) {
          const { error: updateError } = await supabase
            .from('vehicles')
            .update(updateData)
            .eq('id', vehicle.id);

          if (updateError) {
            console.log(`   ❌ Update error: ${updateError.message}`);
            errors++;
            continue;
          }
        }

        // Insert images (skip if already has images)
        if (imageUrls.length > 0) {
          // Check if vehicle already has images
          const { count: existingImgCount } = await supabase
            .from('vehicle_images')
            .select('*', { count: 'exact', head: true })
            .eq('vehicle_id', vehicle.id);
          
          if (!existingImgCount || existingImgCount === 0) {
            const imageInserts = imageUrls.map((imgUrl, idx) => ({
              vehicle_id: vehicle.id,
              image_url: imgUrl,
              image_type: idx === 0 ? 'exterior' : 'gallery',
              category: idx === 0 ? 'hero' : 'gallery',
              position: idx + 1,
              is_primary: idx === 0,
              source: 'organization_import',
              source_url: vehicle.listing_url,
              is_external: true,
            }));

            const { error: imgError } = await supabase
              .from('vehicle_images')
              .insert(imageInserts);

            if (imgError) {
              console.log(`   ⚠️  Image insert error: ${imgError.message}`);
            } else {
              console.log(`   📸 Inserted ${imageUrls.length} images`);
            }
          } else {
            console.log(`   ℹ️  Vehicle already has ${existingImgCount} images`);
          }
        }

        // Link to organization if not already
        await supabase
          .from('organization_vehicles')
          .upsert({
            organization_id: ORG_ID,
            vehicle_id: vehicle.id,
            relationship_type: 'sold_by',
            status: 'sold',
            listing_status: 'sold',
            notes: `Vehicle sold by Collective Auto Group. Source: ${vehicle.listing_url}`,
          }, { onConflict: 'organization_id,vehicle_id' });

        enriched++;
        console.log(`   ✅ Enriched successfully`);

        // Rate limiting between requests
        await new Promise(resolve => setTimeout(resolve, 1500));

      } catch (error: any) {
        console.log(`   ❌ Error: ${error.message}`);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Enriched: ${enriched}`);
    console.log(`Errors: ${errors}`);
    console.log(`Remaining: ${(vehicles?.length || 0) - enriched - errors}`);

    return new Response(
      JSON.stringify({
        success: true,
        enriched,
        errors,
        total_processed: vehicles?.length || 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

