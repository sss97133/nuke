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
      // Import vehicles in batches to avoid overwhelming the system
      const batchSize = 5;
      for (let i = 0; i < listingUrlsArray.length; i += batchSize) {
        const batch = listingUrlsArray.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (listingUrl) => {
          try {
            console.log(`Processing listing: ${listingUrl}`);
            
            // Call comprehensive-bat-extraction to import the listing
            const extractResponse = await fetch(`${supabaseUrl}/functions/v1/comprehensive-bat-extraction`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({ url: listingUrl }),
            });

            if (!extractResponse.ok) {
              const errorText = await extractResponse.text();
              throw new Error(`Extraction failed: ${extractResponse.status} - ${errorText}`);
            }

            const extractData = await extractResponse.json();

            if (extractData.success && extractData.vehicle_id) {
              const vehicleId = extractData.vehicle_id;
              results.vehicle_ids.push(vehicleId);

              // Check if this vehicle was newly created or updated
              const { data: vehicle } = await supabase
                .from('vehicles')
                .select('created_at, updated_at')
                .eq('id', vehicleId)
                .single();

              if (vehicle) {
                const justCreated = new Date(vehicle.created_at).getTime() > Date.now() - 60000;
                if (justCreated) {
                  results.vehicles_created++;
                } else {
                  results.vehicles_updated++;
                }
              }

              // Link the vehicle to the BaT user via bat_listings
              // The comprehensive-bat-extraction should have already created bat_listings
              // We just need to ensure seller_external_identity_id is set
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
            } else {
              results.vehicles_skipped++;
              console.log(`Skipped listing (no vehicle created): ${listingUrl}`);
            }
          } catch (err: any) {
            const errorMsg = `Failed to import ${listingUrl}: ${err.message}`;
            results.errors.push(errorMsg);
            console.error(errorMsg);
          }
        }));

        // Small delay between batches
        if (i + batchSize < listingUrlsArray.length) {
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

