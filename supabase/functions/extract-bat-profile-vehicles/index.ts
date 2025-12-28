import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { extractBatListingWithFirecrawl } from '../_shared/batFirecrawlMapper.ts';
import { normalizeListingLocation } from '../_shared/normalizeListingLocation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BaTProfileListing {
  url: string;
  title: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { profile_url, username, extract_vehicles = true } = await req.json();

    if (!profile_url && !username) {
      return new Response(
        JSON.stringify({ error: 'profile_url or username required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract username from URL if provided
    let batUsername = username;
    if (!batUsername && profile_url) {
      const urlMatch = profile_url.match(/\/member\/([^\/\?]+)/);
      if (!urlMatch) {
        return new Response(
          JSON.stringify({ error: 'Invalid BaT profile URL' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      batUsername = urlMatch[1];
    }

    const profileUrl = profile_url || `https://bringatrailer.com/member/${batUsername}/`;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Extracting vehicles from BaT profile: ${profileUrl}`);

    // Step 1: Scrape profile page using Firecrawl to render JavaScript
    // BaT pages are client-side rendered, so we need a browser to see the listings
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    let profileHtml: string;
    let listingUrlsArray: string[] = [];

    if (FIRECRAWL_API_KEY) {
      console.log('Using Firecrawl to render BaT profile page...');
      try {
        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: profileUrl,
            formats: ['html'],
            waitFor: 10000, // Wait for JavaScript to render
            mobile: false,
          }),
        });

        if (firecrawlResponse.ok) {
          const firecrawlData = await firecrawlResponse.json();
          profileHtml = firecrawlData.data?.html || '';
          console.log('Firecrawl successfully rendered page');
        } else {
          throw new Error(`Firecrawl failed: ${firecrawlResponse.status}`);
        }
      } catch (firecrawlError: any) {
        console.warn('Firecrawl failed, falling back to direct fetch:', firecrawlError.message);
        // Fallback to direct fetch (won't work for client-rendered content)
        const profileResponse = await fetch(profileUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          }
        });
        profileHtml = await profileResponse.text();
      }
    } else {
      console.warn('FIRECRAWL_API_KEY not set, using direct fetch (may not work for client-rendered pages)');
      const profileResponse = await fetch(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      profileHtml = await profileResponse.text();
    }

    // Extract listing URLs from rendered HTML
    const listingUrls = new Set<string>();
    
    // Pattern 1: Direct href links
    const listingUrlRegex = /href=["']([^"']*\/listing\/[^"']+)["']/g;
    let match;
    while ((match = listingUrlRegex.exec(profileHtml)) !== null) {
      let url = match[1];
      if (!url.startsWith('http')) {
        url = `https://bringatrailer.com${url}`;
      }
      listingUrls.add(url);
    }

    // Pattern 2: JSON data embedded in page (for client-rendered content)
    try {
      // Look for various JSON patterns BaT might use
      const jsonPatterns = [
        /window\.__INITIAL_STATE__\s*=\s*({.+?});/s,
        /window\.__NEXT_DATA__\s*=\s*({.+?})<\/script>/s,
        /__NEXT_DATA__["\s]*=\s*({.+?})<\/script>/s,
        /"listings":\s*\[([^\]]+)\]/g,
      ];

      for (const pattern of jsonPatterns) {
        const jsonMatch = profileHtml.match(pattern);
        if (jsonMatch) {
          try {
            const stateData = JSON.parse(jsonMatch[1]);
            // Recursively search for URLs in the JSON
            const findUrls = (obj: any): void => {
              if (typeof obj === 'string' && obj.includes('/listing/')) {
                const urlMatch = obj.match(/(https?:\/\/)?bringatrailer\.com\/listing\/[^\s"']+/);
                if (urlMatch) {
                  let url = urlMatch[0];
                  if (!url.startsWith('http')) {
                    url = `https://${url}`;
                  }
                  listingUrls.add(url);
                }
              } else if (Array.isArray(obj)) {
                obj.forEach(findUrls);
              } else if (typeof obj === 'object' && obj !== null) {
                Object.values(obj).forEach(findUrls);
              }
            };
            findUrls(stateData);
          } catch (e) {
            // Try to extract URLs from JSON string directly
            const urlMatches = jsonMatch[1].match(/\/listing\/[a-z0-9-]+/g);
            if (urlMatches) {
              urlMatches.forEach((path: string) => {
                listingUrls.add(`https://bringatrailer.com${path}`);
              });
            }
          }
        }
      }
    } catch (e) {
      console.log('Could not parse JSON state:', e);
    }

    listingUrlsArray = Array.from(listingUrls);
    console.log(`Found ${listingUrlsArray.length} unique listing URLs in profile (from scraping)`);

    // Also check existing bat_listings for this user (in case scraping missed them)
    const { data: existingListings } = await supabase
      .from('bat_listings')
      .select('bat_listing_url, vehicle_id, seller_username')
      .eq('seller_username', batUsername);

    const existingListingUrls = new Set(existingListings?.map(l => l.bat_listing_url) || []);
    
    // Add any existing listings that weren't found by scraping
    existingListings?.forEach(listing => {
      if (listing.bat_listing_url && !listingUrls.has(listing.bat_listing_url)) {
        listingUrlsArray.push(listing.bat_listing_url);
      }
    });

    console.log(`Total listings (scraped + existing): ${listingUrlsArray.length}`);

    // Step 2: Get or create external_identity for this BaT user
    const { data: existingIdentity, error: identityError } = await supabase
      .from('external_identities')
      .select('*')
      .eq('platform', 'bat')
      .eq('handle', batUsername)
      .single();

    let externalIdentityId: string;

    if (existingIdentity) {
      externalIdentityId = existingIdentity.id;
      console.log(`Using existing external_identity: ${externalIdentityId}`);
    } else {
      const { data: newIdentity, error: createError } = await supabase
        .from('external_identities')
        .insert({
          platform: 'bat',
          handle: batUsername,
          profile_url: profileUrl,
          display_name: batUsername,
        })
        .select()
        .single();

      if (createError) throw createError;
      externalIdentityId = newIdentity.id;
      console.log(`Created new external_identity: ${externalIdentityId}`);
    }

    // Step 3: Extract and import vehicles from each listing
    const results = {
      profile_url: profileUrl,
      username: batUsername,
      external_identity_id: externalIdentityId,
      listings_found: listingUrlsArray.length,
      vehicles_created: 0,
      vehicles_updated: 0,
      vehicles_skipped: 0,
      errors: [] as string[],
      vehicle_ids: [] as string[],
    };

    if (extract_vehicles && listingUrlsArray.length > 0) {
      // Process listings in parallel batches to restore throughput
      // Use concurrency limit of 5 to balance speed and timeout prevention
      const CONCURRENCY_LIMIT = 5;
      
      // Helper function to process a single listing
      const processListing = async (listingUrl: string) => {
        try {
          console.log(`Processing listing: ${listingUrl}`);
            
          // Extract listing data directly using Firecrawl (bypassing broken comprehensive-bat-extraction)
          const firecrawlResult = await extractBatListingWithFirecrawl(listingUrl, FIRECRAWL_API_KEY || '');
          
          if (!firecrawlResult.data) {
            throw new Error(`Firecrawl extraction failed: ${firecrawlResult.error || 'No data returned'}`);
          }

          const data = firecrawlResult.data;
          
          // Find or create vehicle
          let vehicleId: string | null = null;
          
          // Try to find by VIN first
          if (data.vin) {
            const { data: existingByVin } = await supabase
              .from('vehicles')
              .select('id')
              .eq('vin', data.vin.toUpperCase())
              .maybeSingle();
            if (existingByVin) vehicleId = existingByVin.id;
          }
          
          // Try to find by listing URL
          if (!vehicleId) {
            const { data: existingByUrl } = await supabase
              .from('vehicles')
              .select('id')
              .eq('bat_auction_url', listingUrl)
              .maybeSingle();
            if (existingByUrl) vehicleId = existingByUrl.id;
          }
          
          // Create or update vehicle
          const vehicleData: any = {
            year: data.year || null,
            make: data.make?.toLowerCase() || null,
            model: data.model?.toLowerCase() || null,
            trim: data.trim?.toLowerCase() || null,
            vin: data.vin?.toUpperCase() || null,
            mileage: data.mileage || null,
            sale_price: data.sale_price || null,
            sale_date: data.sale_date || null,
            auction_end_date: data.auction_end_date || null,
            auction_outcome: data.sale_price ? 'sold' : (data.reserve_not_met ? 'reserve_not_met' : null),
            description: data.description || null,
            bat_auction_url: listingUrl,
            listing_url: listingUrl,
            discovery_url: listingUrl,
            profile_origin: 'bat_import',
            discovery_source: 'bat_profile_extraction',
            origin_metadata: {
              source: 'bat_profile_extraction',
              bat_url: listingUrl,
              bat_seller_username: data.seller_username || data.seller || null,
              bat_buyer_username: data.buyer_username || data.buyer || null,
              lot_number: data.lot_number || null,
              imported_at: new Date().toISOString(),
            },
          };
          
          if (vehicleId) {
            await supabase
              .from('vehicles')
              .update(vehicleData)
              .eq('id', vehicleId);
          } else {
            const { data: newVehicle, error: vehicleError } = await supabase
              .from('vehicles')
              .insert(vehicleData)
              .select('id')
              .single();
            
            if (vehicleError) throw vehicleError;
            vehicleId = newVehicle.id;
          }

          if (vehicleId) {
            // Check if this vehicle was newly created or updated
            const { data: vehicle } = await supabase
              .from('vehicles')
              .select('created_at, updated_at')
              .eq('id', vehicleId)
              .single();

            const justCreated = vehicle && new Date(vehicle.created_at).getTime() > Date.now() - 60000;

            // Link the vehicle to the BaT user via bat_listings
            const { data: batListing } = await supabase
              .from('bat_listings')
              .select('id, seller_external_identity_id')
              .eq('bat_listing_url', listingUrl)
              .single();

            if (batListing && !batListing.seller_external_identity_id) {
              await supabase
                .from('bat_listings')
                .update({ seller_external_identity_id: externalIdentityId })
                .eq('id', batListing.id);
            }

            // If the external identity is claimed by a user, link vehicle to that user
            if (existingIdentity?.claimed_by_user_id) {
              await supabase
                .from('vehicles')
                .update({ uploaded_by: existingIdentity.claimed_by_user_id })
                .eq('id', vehicleId)
                .is('uploaded_by', null);

              // Update user profile stats
              await supabase.rpc('backfill_user_profile_stats', {
                p_user_id: existingIdentity.claimed_by_user_id,
              });
            }

            console.log(`✓ Imported vehicle: ${vehicleId}`);
            return { 
              success: true, 
              vehicleId, 
              justCreated,
              listingUrl 
            };
          } else {
            return { 
              success: false, 
              error: 'No vehicle created',
              listingUrl 
            };
          }
        } catch (err: any) {
          const errorMsg = `Failed to import ${listingUrl}: ${err.message}`;
          console.error(errorMsg);
          return { 
            success: false, 
            error: errorMsg,
            listingUrl 
          };
        }
      };

      // Process in parallel batches with concurrency limit
      for (let i = 0; i < listingUrlsArray.length; i += CONCURRENCY_LIMIT) {
        const batch = listingUrlsArray.slice(i, i + CONCURRENCY_LIMIT);
        const batchNum = Math.floor(i / CONCURRENCY_LIMIT) + 1;
        const totalBatches = Math.ceil(listingUrlsArray.length / CONCURRENCY_LIMIT);
        
        console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} listings)...`);
        
        // Process batch in parallel
        const batchResults = await Promise.allSettled(
          batch.map(listingUrl => processListing(listingUrl))
        );
        
        // Aggregate results
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value.success) {
            results.vehicle_ids.push(result.value.vehicleId);
            if (result.value.justCreated) {
              results.vehicles_created++;
            } else {
              results.vehicles_updated++;
            }
          } else {
            if (result.status === 'fulfilled' && result.value.error) {
              results.errors.push(result.value.error);
              if (result.value.error.includes('No vehicle created')) {
                results.vehicles_skipped++;
              }
            } else if (result.status === 'rejected') {
              results.errors.push(result.reason?.message || 'Unknown error');
            }
          }
        }
        
        // Small delay between batches to avoid rate limits
        if (i + CONCURRENCY_LIMIT < listingUrlsArray.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, ...results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

