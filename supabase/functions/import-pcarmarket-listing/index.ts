import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PCarMarketListing {
  url: string;
  title: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
  mileage?: number;
  salePrice?: number;
  saleDate?: string;
  auctionEndDate?: string;
  auctionOutcome?: 'sold' | 'reserve_not_met' | null;
  description?: string;
  seller?: string;
  sellerUsername?: string;
  buyer?: string;
  buyerUsername?: string;
  images?: string[];
  slug?: string;
  auctionId?: string;
  bidCount?: number;
  viewCount?: number;
  location?: string;
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch {
    return String(raw).split('#')[0].split('?')[0];
  }
}

function parsePCarMarketIdentityFromUrl(url: string): { year: number; make: string; model: string } | null {
  try {
    const u = new URL(url);
    // Pattern: /auction/2002-aston-martin-db7-v12-vantage-2
    const m = u.pathname.match(/\/auction\/(\d{4})-([a-z0-9-]+)-(\d+)\/?$/i);
    if (!m?.[1] || !m?.[2]) return null;
    
    const year = Number(m[1]);
    if (!Number.isFinite(year) || year < 1885 || year > new Date().getFullYear() + 1) return null;

    const parts = String(m[2]).split('-').filter(Boolean);
    if (parts.length < 2) return null;
    
    // Make is usually first 1-2 words
    const make = parts.slice(0, 2).join(' ').toLowerCase();
    const model = parts.slice(2).join(' ').toLowerCase();

    return { year, make, model: model || 'unknown' };
  } catch {
    return null;
  }
}

async function scrapePCarMarketListing(url: string): Promise<PCarMarketListing | null> {
  try {
    // Use Firecrawl if available, otherwise direct fetch
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

    let html: string;
    if (FIRECRAWL_API_KEY) {
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: url,
          formats: ['html'],
          waitFor: 5000,
          mobile: false,
        }),
      });

      if (firecrawlResponse.ok) {
        const firecrawlData = await firecrawlResponse.json();
        html = firecrawlData.data?.html || '';
      } else {
        throw new Error(`Firecrawl failed: ${firecrawlResponse.status}`);
      }
    } else {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });
      html = await response.text();
    }

    // Parse HTML using regex (basic extraction)
    // In production, you'd want to use a proper HTML parser or the scrape-vehicle function

    const listing: PCarMarketListing = {
      url: normalizeUrl(url),
      title: '',
      images: []
    };

    // Extract title
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                      html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      listing.title = titleMatch[1].trim();
    }

    // Extract from URL
    const urlIdentity = parsePCarMarketIdentityFromUrl(url);
    if (urlIdentity) {
      listing.year = urlIdentity.year;
      listing.make = urlIdentity.make;
      listing.model = urlIdentity.model;
    }

    // Extract images
    const imageMatches = html.matchAll(/src="(https:\/\/d2niwqq19lf86s\.cloudfront\.net[^"]+)"/g);
    for (const match of imageMatches) {
      listing.images?.push(match[1]);
    }

    // Extract VIN (17-character alphanumeric)
    const vinMatch = html.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
    if (vinMatch) {
      listing.vin = vinMatch[1];
    }

    // Extract sale price (look for "Final bid: $X" or "High bid: $X")
    const finalBidMatch = html.match(/Final bid:\s*\$?([\d,]+)/i);
    const highBidMatch = html.match(/High bid:\s*\$?([\d,]+)/i);
    const currentBidMatch = html.match(/Current bid:\s*\$?([\d,]+)/i);
    if (finalBidMatch) {
      listing.salePrice = parseInt(finalBidMatch[1].replace(/,/g, ''));
      listing.auctionOutcome = 'sold';
    } else if (highBidMatch) {
      listing.salePrice = parseInt(highBidMatch[1].replace(/,/g, ''));
      listing.auctionOutcome = null;
    } else if (currentBidMatch) {
      listing.salePrice = parseInt(currentBidMatch[1].replace(/,/g, ''));
      listing.auctionOutcome = null;
    }

    // Extract slug and auction ID from URL
    const slugMatch = url.match(/\/auction\/([^\/]+)/);
    if (slugMatch) {
      listing.slug = slugMatch[1];
      listing.auctionId = slugMatch[1].split('-').pop() || undefined;
    }

    // Extract bid count
    const bidCountMatch = html.match(/([\d,]+)\s+bids?/i) ||
                          html.match(/bid(?:s)?[:\s]*([\d,]+)/i);
    if (bidCountMatch) {
      listing.bidCount = parseInt(bidCountMatch[1].replace(/,/g, ''));
    }

    // Extract view count
    const viewCountMatch = html.match(/([\d,]+)\s+views?/i);
    if (viewCountMatch) {
      listing.viewCount = parseInt(viewCountMatch[1].replace(/,/g, ''));
    }

    // Extract auction end date - multiple patterns
    // Pattern 1: data-countdown or data-end attributes (Unix timestamp)
    const countdownMatch = html.match(/data-countdown\s*=\s*["'](\d+)["']/i) ||
                          html.match(/data-end-time\s*=\s*["'](\d+)["']/i) ||
                          html.match(/data-end\s*=\s*["'](\d+)["']/i);
    if (countdownMatch) {
      const ts = parseInt(countdownMatch[1], 10);
      // Check if seconds or milliseconds
      const timestamp = ts > 9999999999 ? ts : ts * 1000;
      listing.auctionEndDate = new Date(timestamp).toISOString();
    }

    // Pattern 2: ISO date string in JSON or attributes
    if (!listing.auctionEndDate) {
      const isoDateMatch = html.match(/"endDate"\s*:\s*"([^"]+)"/i) ||
                          html.match(/"end_date"\s*:\s*"([^"]+)"/i) ||
                          html.match(/data-end-date\s*=\s*["']([^"']+)["']/i) ||
                          html.match(/auction\s+ends?[:\s]+(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/i);
      if (isoDateMatch) {
        try {
          const parsed = new Date(isoDateMatch[1]);
          if (!isNaN(parsed.getTime())) {
            listing.auctionEndDate = parsed.toISOString();
          }
        } catch { /* ignore */ }
      }
    }

    // Pattern 3: "X days/hours remaining" text
    if (!listing.auctionEndDate) {
      const timeRemainingMatch = html.match(/(\d+)\s*(?:day|days)\s*(?:,?\s*(\d+)\s*(?:hour|hours))?(?:\s+remaining|\s+left)?/i) ||
                                html.match(/(\d+)\s*(?:hour|hours)(?:\s+remaining|\s+left)?/i);
      if (timeRemainingMatch) {
        const days = parseInt(timeRemainingMatch[1], 10) || 0;
        const hours = parseInt(timeRemainingMatch[2], 10) || 0;
        const now = new Date();
        // Check if it's hours-only match
        if (/hour|hours/i.test(timeRemainingMatch[0]) && !timeRemainingMatch[2]) {
          now.setHours(now.getHours() + days); // First capture is actually hours
        } else {
          now.setDate(now.getDate() + days);
          now.setHours(now.getHours() + hours);
        }
        listing.auctionEndDate = now.toISOString();
      }
    }

    // Extract seller username
    const sellerMatch = html.match(/seller[:\s]+([a-zA-Z0-9_-]+)/i) ||
                        html.match(/by\s+([a-zA-Z0-9_-]+)\s+on\s+pcarmarket/i) ||
                        html.match(/member\/([a-zA-Z0-9_-]+)/i);
    if (sellerMatch) {
      listing.sellerUsername = sellerMatch[1];
    }

    return listing;
  } catch (error) {
    console.error('Error scraping PCarMarket listing:', error);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { listing_url } = await req.json();

    if (!listing_url) {
      return new Response(
        JSON.stringify({ error: 'listing_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!listing_url.includes('pcarmarket.com')) {
      return new Response(
        JSON.stringify({ error: 'URL must be from pcarmarket.com' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get or create scrape source
    const { data: source } = await supabase
      .from('scrape_sources')
      .select('id')
      .eq('domain', 'pcarmarket.com')
      .maybeSingle();

    let sourceId = source?.id;

    if (!sourceId) {
      const { data: newSource } = await supabase
        .from('scrape_sources')
        .insert({
          domain: 'pcarmarket.com',
          source_name: 'PCarMarket',
          source_type: 'auction_house',
          base_url: 'https://www.pcarmarket.com',
          is_active: true,
        })
        .select('id')
        .single();

      if (newSource) {
        sourceId = newSource.id;
      }
    }

    console.log(`Importing PCarMarket listing: ${listing_url}`);

    // Step 1: Scrape listing
    const listing = await scrapePCarMarketListing(listing_url);
    if (!listing) {
      return new Response(
        JSON.stringify({ error: 'Failed to scrape listing' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!listing.year || !listing.make || !listing.model) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields (year, make, model)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Find or create organization
    let orgId: string | null = null;
    const { data: existingOrg } = await supabase
      .from('businesses')
      .select('id')
      .eq('website', 'https://www.pcarmarket.com')
      .maybeSingle();

    if (existingOrg) {
      orgId = existingOrg.id;
    } else {
      const { data: newOrg, error: orgError } = await supabase
        .from('businesses')
        .insert({
          business_name: 'PCarMarket',
          business_type: 'auction_house',
          website: 'https://www.pcarmarket.com',
          description: 'Premium car auction marketplace',
          is_verified: false,
          is_public: true
        })
        .select('id')
        .single();

      if (!orgError && newOrg) {
        orgId = newOrg.id;
      }
    }

    // Step 3: Find existing vehicle
    let vehicleId: string | null = null;
    
    if (listing.vin) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', listing.vin.toUpperCase())
        .maybeSingle();
      if (existing) vehicleId = existing.id;
    }

    if (!vehicleId) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', listing.url)
        .maybeSingle();
      if (existing) vehicleId = existing.id;
    }

    // Step 4: Create or update vehicle
    const vehicleData = {
      year: listing.year,
      make: listing.make!.toLowerCase(),
      model: listing.model!.toLowerCase(),
      trim: listing.trim?.toLowerCase() || null,
      vin: listing.vin ? listing.vin.toUpperCase() : null,
      mileage: listing.mileage || null,
      sale_price: listing.salePrice || null,
      sale_date: listing.saleDate || null,
      auction_end_date: listing.auctionEndDate || null,
      auction_outcome: listing.auctionOutcome || null,
      description: listing.description || listing.title || null,
      profile_origin: 'PCARMARKET_IMPORT',
      discovery_source: 'PCARMARKET',
      discovery_url: listing.url,
      listing_url: listing.url,
        origin_metadata: {
          source: 'PCARMARKET_IMPORT',
          pcarmarket_url: listing.url,
        pcarmarket_listing_title: listing.title,
        pcarmarket_seller_username: listing.sellerUsername || null,
        pcarmarket_buyer_username: listing.buyerUsername || null,
        pcarmarket_auction_id: listing.auctionId || null,
        pcarmarket_auction_slug: listing.slug || null,
        bid_count: listing.bidCount || null,
        view_count: listing.viewCount || null,
        sold_status: listing.auctionOutcome === 'sold' ? 'sold' : 'unsold',
        imported_at: new Date().toISOString()
      },
      is_public: true,
      status: 'active'
    };

    if (vehicleId) {
      await supabase
        .from('vehicles')
        .update(vehicleData)
        .eq('id', vehicleId);
      console.log(`Updated existing vehicle: ${vehicleId}`);
    } else {
      const { data: newVehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert(vehicleData)
        .select('id')
        .single();

      if (vehicleError) {
        throw vehicleError;
      }

      vehicleId = newVehicle.id;
      console.log(`Created new vehicle: ${vehicleId}`);
    }

    // Step 5: Link to organization (FIXED - removed listing_url, listing_status columns)
    if (orgId && vehicleId) {
      const relationshipType = listing.auctionOutcome === 'sold' ? 'sold_by' : 'consigner';
      await supabase
        .from('organization_vehicles')
        .upsert({
          organization_id: orgId,
          vehicle_id: vehicleId,
          relationship_type: relationshipType,
          status: 'active',
          auto_tagged: true,
          notes: `Imported from PCarMarket: ${listing.url}`
        }, {
          onConflict: 'organization_id,vehicle_id,relationship_type'
        });
    }

    // Step 6: Import ALL images from gallery
    if (listing.images && listing.images.length > 0 && vehicleId) {
      // Get user_id for images (required field)
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('user_id, uploaded_by')
        .eq('id', vehicleId)
        .single();
      
      const userId = vehicle?.user_id || vehicle?.uploaded_by || null;
      
      if (!userId) {
        console.error('Missing user_id for image import');
      } else {
        // Delete existing PCarMarket images first
        await supabase
          .from('vehicle_images')
          .delete()
          .eq('vehicle_id', vehicleId)
          .eq('source', 'pcarmarket_listing');
        
        // Import ALL images (not just 10)
        const imageInserts = listing.images.map((imageUrl, index) => ({
          vehicle_id: vehicleId,
          image_url: imageUrl,
          user_id: userId, // Required field
          category: 'general',
          image_category: 'exterior',
          source: 'pcarmarket_listing',
          is_primary: index === 0,
          filename: `pcarmarket_${index}.jpg`
        }));

        // Insert in batches to avoid timeouts
        const batchSize = 50;
        for (let i = 0; i < imageInserts.length; i += batchSize) {
          const batch = imageInserts.slice(i, i + batchSize);
          await supabase
            .from('vehicle_images')
            .insert(batch);
        }
        
        console.log(`Imported ${listing.images.length} images`);
      }
    }

    // Update source health tracking
    if (sourceId) {
      await supabase
        .from('scrape_sources')
        .update({
          last_scraped_at: new Date().toISOString(),
          last_successful_scrape: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', sourceId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id: vehicleId,
        organization_id: orgId,
        source_id: sourceId,
        listing: {
          title: listing.title,
          url: listing.url
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error importing PCarMarket listing:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

