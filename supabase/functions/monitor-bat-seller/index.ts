import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Monitor BAT Seller Profile for New Listings
 * 
 * Checks a specific BAT seller's profile page for new listings
 * and creates vehicle profiles + matches to watchlists
 * 
 * Example: Monitor Viva! Las Vegas Autos (seller: VivaLasVegasAutos)
 */

interface Deno {
  serve: (handler: (req: Request) => Promise<Response>) => void;
}

Deno.serve(async (req: Request) => {
  try {
    const { sellerUsername, organizationId } = await req.json();

    if (!sellerUsername || !organizationId) {
      return new Response(
        JSON.stringify({ error: 'sellerUsername and organizationId required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`Monitoring BaT seller: ${sellerUsername} for organization: ${organizationId}`);

    // Get or create monitor record
    const { data: monitor, error: monitorError } = await supabase
      .from('bat_seller_monitors')
      .upsert({
        organization_id: organizationId,
        seller_username: sellerUsername,
        seller_url: `https://bringatrailer.com/member/${sellerUsername}/`,
        is_active: true,
        last_checked_at: new Date().toISOString()
      }, {
        onConflict: 'organization_id,seller_username',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (monitorError) throw monitorError;

    // Fetch BAT seller profile page
    const sellerUrl = `https://bringatrailer.com/member/${sellerUsername}/`;
    console.log(`Fetching: ${sellerUrl}`);

    const response = await fetch(sellerUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; N-Zero/1.0)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch BAT seller page: ${response.status}`);
    }

    const html = await response.text();
    
    // Extract listing URLs from seller page
    // BAT seller pages show recent listings in various formats
    const listingUrlPattern = /href="(\/listing\/[^"]+)"/g;
    const listingUrls: string[] = [];
    let match;
    
    while ((match = listingUrlPattern.exec(html)) !== null) {
      const url = `https://bringatrailer.com${match[1]}`;
      if (!listingUrls.includes(url)) {
        listingUrls.push(url);
      }
    }

    console.log(`Found ${listingUrls.length} listings on seller page`);

    // Check which listings are new (not in external_listings table)
    const { data: existingListings } = await supabase
      .from('external_listings')
      .select('listing_url')
      .eq('organization_id', organizationId)
      .in('listing_url', listingUrls);

    const existingUrls = new Set(existingListings?.map(l => l.listing_url) || []);
    const newListings = listingUrls.filter(url => !existingUrls.has(url));

    console.log(`Found ${newListings.length} new listings`);

    let processed = 0;
    let matched = 0;

    // Process each new listing
    for (const listingUrl of newListings) {
      try {
        console.log(`Processing: ${listingUrl}`);

        // Fetch listing page
        const listingResponse = await fetch(listingUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; N-Zero/1.0)',
            'Accept': 'text/html,application/xhtml+xml'
          }
        });

        if (!listingResponse.ok) continue;

        const listingHtml = await listingResponse.text();

        // Extract vehicle data from BAT listing
        // This is a simplified parser - you may want to use the complete-bat-import function
        const titleMatch = listingHtml.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const title = titleMatch ? titleMatch[1].trim() : '';

        // Parse year, make, model from title (e.g., "1966 Chevrolet C10 Pickup")
        const yearMatch = title.match(/(\d{4})/);
        const year = yearMatch ? parseInt(yearMatch[1]) : null;

        const makeModelMatch = title.match(/\d{4}\s+([A-Za-z]+)\s+(.+?)(?:\s|$)/);
        const make = makeModelMatch ? makeModelMatch[1] : null;
        const model = makeModelMatch ? makeModelMatch[2].trim().split(' ')[0] : null;

        // Extract VIN if present
        const vinMatch = listingHtml.match(/VIN[:\s]+([A-Z0-9]{17})/i);
        const vin = vinMatch ? vinMatch[1] : null;

        // Extract current bid
        const bidMatch = listingHtml.match(/(?:Current Bid|High Bid)[:\s]*\$([\d,]+)/);
        const currentBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null;

        // Extract bid count
        const bidCountMatch = listingHtml.match(/(\d+)\s+Bids?/i);
        const bidCount = bidCountMatch ? parseInt(bidCountMatch[1]) : 0;

        // Check if auction ended
        const endedMatch = listingHtml.match(/Auction Ended/i);
        const listingStatus = endedMatch ? 'ended' : 'active';

        if (!year || !make || !model) {
          console.log(`Could not parse vehicle data from: ${listingUrl}`);
          continue;
        }

        console.log(`  Vehicle: ${year} ${make} ${model}${vin ? ` (VIN: ${vin})` : ''}`);

        // Find or create vehicle
        let vehicleId: string | null = null;

        if (vin) {
          // Try to find by VIN first
          const { data: existingVehicle } = await supabase
            .from('vehicles')
            .select('id')
            .eq('vin', vin)
            .single();

          if (existingVehicle) {
            vehicleId = existingVehicle.id;
            console.log(`  Found existing vehicle by VIN: ${vehicleId}`);
          }
        }

        if (!vehicleId) {
          // Create new vehicle
          const { data: newVehicle, error: vehicleError } = await supabase
            .from('vehicles')
            .insert({
              year,
              make: make.toLowerCase(),
              model: model.toLowerCase(),
              vin: vin || null,
              profile_origin: 'bat_import',
              discovery_source: 'bat_seller_monitor',
              discovery_url: listingUrl,
              bat_auction_url: listingUrl,
              origin_organization_id: organizationId,
              origin_metadata: {
                bat_seller: sellerUsername,
                bat_listing_title: title,
                discovered_via: 'seller_monitor',
                discovered_at: new Date().toISOString()
              },
              is_public: true,
              status: 'active'
            })
            .select('id')
            .single();

          if (vehicleError) {
            console.error(`  Error creating vehicle:`, vehicleError);
            continue;
          }

          vehicleId = newVehicle.id;
          console.log(`  Created vehicle: ${vehicleId}`);
        }

        // Link/update relationship to organization for *all* listings, even if the vehicle already existed.
        // This is a seller account, so relationship is "seller" (not consignment).
        const orgStatus = listingStatus === 'ended' ? 'sold' : 'active';
        await supabase
          .from('organization_vehicles')
          .upsert(
            {
              organization_id: organizationId,
              vehicle_id: vehicleId,
              relationship_type: 'seller',
              status: orgStatus,
              auto_tagged: true
            },
            { onConflict: 'organization_id,vehicle_id' }
          );

        // Create external listing record
        const { data: externalListing, error: listingError } = await supabase
          .from('external_listings')
          .upsert({
            vehicle_id: vehicleId,
            organization_id: organizationId,
            platform: 'bat',
            listing_url: listingUrl,
            listing_id: listingUrl.match(/listing\/([^\/]+)/)?.[1] || null,
            listing_status: listingStatus,
            current_bid: currentBid,
            bid_count: bidCount,
            metadata: {
              seller: sellerUsername,
              title,
              discovered_via: 'seller_monitor'
            }
          }, {
            onConflict: 'vehicle_id,platform,listing_id'
          })
          .select('id')
          .single();

        if (listingError) {
          console.error(`  Error creating external listing:`, listingError);
          continue;
        }

        // Match to watchlists
        const { data: matchResult } = await supabase.rpc('process_new_bat_listing', {
          p_vehicle_id: vehicleId,
          p_external_listing_id: externalListing.id
        });

        const matchesCreated = matchResult || 0;
        if (matchesCreated > 0) {
          console.log(`  Matched ${matchesCreated} watchlist(s)`);
          matched += matchesCreated;
        }

        processed++;
      } catch (error) {
        console.error(`  Error processing ${listingUrl}:`, error);
        continue;
      }
    }

    // Update monitor stats
    await supabase
      .from('bat_seller_monitors')
      .update({
        last_checked_at: new Date().toISOString(),
        last_listing_found_at: newListings.length > 0 ? new Date().toISOString() : monitor.last_listing_found_at,
        total_listings_found: (monitor.total_listings_found || 0) + newListings.length,
        listings_processed: (monitor.listings_processed || 0) + processed,
        updated_at: new Date().toISOString()
      })
      .eq('id', monitor.id);

    return new Response(
      JSON.stringify({
        success: true,
        seller: sellerUsername,
        listings_found: listingUrls.length,
        new_listings: newListings.length,
        processed,
        watchlist_matches: matched
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

