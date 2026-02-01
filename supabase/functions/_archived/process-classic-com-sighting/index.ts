/**
 * process-classic-com-sighting
 *
 * Classic.com is an AGGREGATOR - we don't create vehicle profiles from them.
 * Instead we:
 * 1. Extract VIN (mandatory - classic.com always has VINs in URLs)
 * 2. Record the "sighting" with full DATA LINEAGE (dealer -> classic.com -> us)
 * 3. Get the source dealer/organization
 * 4. Queue the ORIGINAL source for deep extraction
 * 5. Queue VIN for Wayback Machine search (find historical data)
 *
 * Philosophy: "We don't care WHERE data comes from, but we need to UNDERSTAND the PATH"
 * This tracks the provenance chain and routes to the true original source.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Classic.com observation source ID (from observation_sources seed)
const CLASSIC_COM_SOURCE_SLUG = 'classic-com';

interface ClassicComData {
  url: string;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  price: number | null;
  mileage: number | null;
  location: string | null;
  organization_id: string | null;
  image_urls: string[];
  listing_status: string | null;
}

// Extract VIN from classic.com URL
// Format: /veh/YEAR-MAKE-MODEL-VIN-HASH/
function extractVinFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // Pattern: /veh/1929-ford-model-a-woodie-wagon-hot-rod-a2329228-nlxLMXn/
    const match = u.pathname.match(/\/veh\/[^/]+-([a-zA-Z0-9]{6,17})-[a-zA-Z0-9]+\/?$/i);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
    return null;
  } catch {
    return null;
  }
}

// Validate VIN format (basic check)
function isValidVin(vin: string): boolean {
  if (!vin || vin.length < 6) return false;
  // Reject obvious placeholders
  if (/^(.)\1+$/.test(vin)) return false; // All same char
  if (/^(test|none|na|unknown|n\/a)/i.test(vin)) return false;
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { url, raw_data } = body;

    if (!url || !url.includes('classic.com')) {
      return new Response(
        JSON.stringify({ error: 'URL must be from classic.com' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[classic.com] Processing sighting: ${url}`);

    // Parse the data
    const data: ClassicComData = {
      url,
      vin: raw_data?.vin || extractVinFromUrl(url),
      year: raw_data?.year || null,
      make: raw_data?.make || null,
      model: raw_data?.model || null,
      trim: raw_data?.trim || null,
      price: raw_data?.price || null,
      mileage: raw_data?.mileage || null,
      location: raw_data?.location || null,
      organization_id: raw_data?.organization_id || null,
      image_urls: raw_data?.image_urls || [],
      listing_status: raw_data?.listing_status || null,
    };

    // VIN is mandatory for classic.com
    if (!data.vin || !isValidVin(data.vin)) {
      console.warn(`[classic.com] No valid VIN found in: ${url}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No valid VIN found',
          url,
          extracted_vin: data.vin,
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[classic.com] VIN: ${data.vin}, Source Org: ${data.organization_id}`);

    // Get the source dealer info
    let sourceDealer: { name: string; website: string } | null = null;
    if (data.organization_id) {
      const { data: dealer } = await supabase
        .from('businesses')
        .select('business_name, website')
        .eq('id', data.organization_id)
        .maybeSingle();

      if (dealer) {
        sourceDealer = { name: dealer.business_name, website: dealer.website };
        console.log(`[classic.com] Source dealer: ${sourceDealer.name} (${sourceDealer.website})`);
      }
    }

    // Get Classic.com source ID from observation_sources
    const { data: classicSource } = await supabase
      .from('observation_sources')
      .select('id, base_trust_score')
      .eq('slug', CLASSIC_COM_SOURCE_SLUG)
      .maybeSingle();

    const classicSourceId = classicSource?.id || null;

    // Record the sighting in vehicle_observations with FULL LINEAGE
    // The chain: Original Dealer (if known) -> Classic.com -> Our System
    const observationData = {
      // Bitemporal timestamps
      observed_at: new Date().toISOString(),
      ingested_at: new Date().toISOString(),

      // Source provenance - Classic.com is the aggregator we got this from
      source_id: classicSourceId,
      source_url: url,

      // Observation type
      kind: 'sighting',
      content_text: `Vehicle spotted on Classic.com: ${data.year} ${data.make} ${data.model}`,

      // Structured data with VIN and details
      structured_data: {
        vin: data.vin.toUpperCase(),
        year: data.year,
        make: data.make,
        model: data.model,
        trim: data.trim,
        price: data.price,
        mileage: data.mileage,
        location: data.location,
        listing_status: data.listing_status,
        image_urls: data.image_urls,
      },

      // Lineage - track the data path
      original_source_id: data.organization_id, // The actual dealer
      original_source_url: sourceDealer?.website || null,
      discovered_via_id: classicSourceId, // Found via Classic.com aggregator

      // Confidence - aggregator data is medium confidence
      confidence: 'medium',
      confidence_score: 0.65,
      confidence_factors: {
        aggregator_source: -0.1,
        has_vin: 0.15,
        has_images: data.image_urls.length > 0 ? 0.05 : 0,
      },

      // Not processed yet - will be linked to vehicle later
      is_processed: false,

      // Extraction metadata
      extraction_metadata: {
        extractor: 'process-classic-com-sighting',
        source_dealer_id: data.organization_id,
        source_dealer_name: sourceDealer?.name,
        source_dealer_website: sourceDealer?.website,
        classic_com_url: url,
      },
    };

    // Try to insert into vehicle_observations
    let observationId: string | null = null;
    const { data: obsResult, error: obsError } = await supabase
      .from('vehicle_observations')
      .insert(observationData)
      .select('id')
      .maybeSingle();

    if (obsError) {
      console.warn(`[classic.com] Could not save observation: ${obsError.message}`);
    } else {
      observationId = obsResult?.id || null;
      console.log(`[classic.com] Recorded sighting ${observationId} for VIN ${data.vin}`);

      // Record the lineage chain if we have the table
      if (observationId) {
        const lineageChain = [];

        // Position 0: Original source (the dealer)
        if (data.organization_id) {
          lineageChain.push({
            observation_id: observationId,
            chain_position: 0,
            organization_id: data.organization_id,
            role: 'original_source',
            source_url: sourceDealer?.website,
          });
        }

        // Position 1: Classic.com (aggregator)
        lineageChain.push({
          observation_id: observationId,
          chain_position: data.organization_id ? 1 : 0,
          source_id: classicSourceId,
          role: 'aggregator',
          source_url: url,
          observed_at_source: new Date().toISOString(),
        });

        // Insert lineage records
        if (lineageChain.length > 0) {
          const { error: lineageError } = await supabase
            .from('observation_lineage')
            .insert(lineageChain);

          if (lineageError) {
            console.warn(`[classic.com] Could not save lineage: ${lineageError.message}`);
          } else {
            console.log(`[classic.com] Recorded ${lineageChain.length}-hop lineage chain`);
          }
        }
      }
    }

    // Queue VIN for Wayback Machine search (find historical listings)
    if (data.vin && isValidVin(data.vin)) {
      const { error: waybackError } = await supabase
        .from('wayback_vin_queue')
        .upsert({
          vin: data.vin.toUpperCase(),
          status: 'pending',
          priority: 50, // Normal priority
        }, {
          onConflict: 'vin',
          ignoreDuplicates: true,
        });

      if (!waybackError) {
        console.log(`[classic.com] Queued VIN ${data.vin} for Wayback search`);
      }
    }

    // Check if we already have this vehicle by VIN
    let existingVehicle = null;
    const { data: vehicleByVin } = await supabase
      .from('vehicles')
      .select('id, discovery_source, listing_source')
      .eq('vin', data.vin.toUpperCase())
      .maybeSingle();

    if (vehicleByVin) {
      existingVehicle = vehicleByVin;
      console.log(`[classic.com] Vehicle already exists: ${vehicleByVin.id} (source: ${vehicleByVin.discovery_source})`);
    }

    // If we have a source dealer with a website, try to queue the original listing
    let queuedOriginalSource = false;
    if (sourceDealer?.website && !existingVehicle) {
      // Try to construct a search URL or inventory page for this dealer
      // Most dealers have inventory pages we can search
      const dealerSearchUrl = `${sourceDealer.website.replace(/\/$/, '')}/inventory`;

      // Queue for discovery (not direct extraction - we'd need to search their site)
      const { error: queueError } = await supabase
        .from('import_queue')
        .insert({
          listing_url: dealerSearchUrl,
          listing_title: `${data.year} ${data.make} ${data.model} - Search on ${sourceDealer.name}`,
          source_id: data.organization_id,
          raw_data: {
            search_for_vin: data.vin,
            year: data.year,
            make: data.make,
            model: data.model,
            from_classic_com: url,
            dealer_name: sourceDealer.name,
          },
          status: 'pending',
          priority: 1, // Higher priority for dealer-direct
        });

      if (!queueError) {
        queuedOriginalSource = true;
        console.log(`[classic.com] Queued dealer search: ${dealerSearchUrl}`);
      }
    }

    // Update the vehicle's origin_metadata if it exists
    if (existingVehicle) {
      await supabase
        .from('vehicles')
        .update({
          origin_metadata: supabase.sql`
            COALESCE(origin_metadata, '{}'::jsonb) ||
            jsonb_build_object(
              'classic_com_sighting', ${url},
              'classic_com_seen_at', ${new Date().toISOString()},
              'classic_com_price', ${data.price},
              'source_dealer_name', ${sourceDealer?.name || null}
            )
          `,
        })
        .eq('id', existingVehicle.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        action: 'sighting_recorded',

        // Vehicle identification
        vin: data.vin,
        year: data.year,
        make: data.make,
        model: data.model,

        // Lineage tracking
        data_path: {
          original_source: sourceDealer ? {
            type: 'dealer',
            name: sourceDealer.name,
            website: sourceDealer.website,
            org_id: data.organization_id,
          } : null,
          aggregator: {
            type: 'listing_aggregator',
            name: 'Classic.com',
            url: url,
          },
        },

        // What we did
        observation_id: observationId,
        existing_vehicle_id: existingVehicle?.id || null,
        queued_original_source: queuedOriginalSource,
        queued_wayback_search: data.vin ? true : false,

        message: existingVehicle
          ? 'Vehicle exists - sighting recorded, lineage tracked'
          : sourceDealer
            ? 'Sighting recorded with lineage - queued dealer for deep extraction'
            : 'Sighting recorded - no dealer source found, queued for Wayback search',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[classic.com] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
