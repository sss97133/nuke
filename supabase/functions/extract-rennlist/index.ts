// Rennlist Marketplace Vehicle Extractor
// Extracts Porsche classifieds from rennlist.com/forums/market
// Uses embedded JSON-LD schema.org data for reliable extraction

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface RennlistListing {
  url: string;
  listing_id: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  mileage: number | null;
  price: number | null;
  price_obo: boolean;
  location: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  seller_username: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  exterior_color: string | null;
  body_style: string | null;
  condition: string | null;
  description: string | null;
  image_urls: string[];
  listing_status: string;
  created_at: string | null;
}

interface RennlistPageListing {
  listing_id: string;
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  location: string | null;
  thumbnail: string | null;
}

// Parse JSON-LD schema from HTML - find the Car type specifically
function parseJsonLd(html: string): any | null {
  // Find ALL JSON-LD blocks
  const matches = html.matchAll(/<script type="application\/ld\+json">(\{[\s\S]*?\})<\/script>/g);

  for (const match of matches) {
    try {
      const data = JSON.parse(match[1]);
      // Look for the Car type (vehicle listing)
      if (data['@type'] === 'Car' || data['@type'] === 'Vehicle') {
        console.log('Found Car JSON-LD:', JSON.stringify(data).substring(0, 200));
        return data;
      }
    } catch (e) {
      // Skip malformed JSON
      continue;
    }
  }

  console.log('No Car JSON-LD found in page');
  return null;
}

// Extract listing details from a single listing page
function extractListingDetails(html: string, url: string): RennlistListing {
  const listingId = url.split('/').pop() || '';
  const jsonLd = parseJsonLd(html);

  // Initialize with defaults
  const listing: RennlistListing = {
    url,
    listing_id: listingId,
    title: null,
    year: null,
    make: null,
    model: null,
    trim: null,
    vin: null,
    mileage: null,
    price: null,
    price_obo: false,
    location: null,
    city: null,
    state: null,
    zip: null,
    country: null,
    seller_username: null,
    transmission: null,
    drivetrain: null,
    engine: null,
    exterior_color: null,
    body_style: null,
    condition: null,
    description: null,
    image_urls: [],
    listing_status: 'active',
    created_at: null,
  };

  if (jsonLd) {
    // Extract from JSON-LD schema (schema.org/Car format)
    listing.title = jsonLd.name || null;
    listing.vin = jsonLd.vehicleIdentificationNumber || jsonLd.productID || null;
    listing.model = jsonLd.model || null;
    listing.year = jsonLd.modelDate ? parseInt(jsonLd.modelDate) : null;
    listing.transmission = jsonLd.vehicleTransmission || null;
    listing.description = jsonLd.description || null;

    // Brand info
    if (jsonLd.brand?.name) {
      listing.make = jsonLd.brand.name;
    }

    // Engine info
    if (jsonLd.vehicleEngine?.name) {
      listing.engine = jsonLd.vehicleEngine.name;
    }

    // Condition
    if (jsonLd.itemCondition) {
      listing.condition = jsonLd.itemCondition.includes('Used') ? 'Used' :
                          jsonLd.itemCondition.includes('New') ? 'New' : null;
    }

    // Offers (price and seller)
    if (jsonLd.offers && jsonLd.offers.length > 0) {
      const offer = jsonLd.offers[0];
      listing.price = offer.price ? parseFloat(offer.price) : null;

      if (offer.seller?.name) {
        listing.seller_username = offer.seller.name;
      }

      if (offer.seller?.address) {
        const addr = offer.seller.address;
        listing.city = addr.addressLocality || null;
        listing.state = addr.addressRegion || null;
        listing.zip = addr.postalCode || null;
        listing.country = addr.addressCountry || null;
        listing.location = [addr.addressLocality, addr.addressRegion, addr.postalCode, addr.addressCountry]
          .filter(Boolean)
          .join(', ');
      }
    }
  }

  // Extract mileage from HTML (not in JSON-LD)
  const mileageMatch = html.match(/Mileage<\/span>\s*<span[^>]*>([0-9,]+)/i) ||
                       html.match(/(\d{1,3}(?:,\d{3})*)\s*Miles/i);
  if (mileageMatch) {
    listing.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
  }

  // Check for OBO in price
  if (html.includes('OBO') || html.includes('obo') || html.includes('Or Best Offer')) {
    listing.price_obo = true;
  }

  // Extract drivetrain from HTML
  const driveMatch = html.match(/\b(4WD|AWD|RWD|FWD|4x4)\b/i);
  if (driveMatch) {
    listing.drivetrain = driveMatch[1].toUpperCase();
  }

  // Extract body style
  const bodyMatch = html.match(/\b(SUV|Sedan|Coupe|Convertible|Cabriolet|Targa|Roadster|Wagon|Hatchback)\b/i);
  if (bodyMatch) {
    listing.body_style = bodyMatch[1];
  }

  // Extract exterior color from description or alt text
  const colorMatch = html.match(/(?:exterior|color)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i) ||
                     html.match(/\b(Black|White|Silver|Gray|Grey|Red|Blue|Green|Yellow|Orange|Brown|Beige|Gold|Burgundy|Navy|Midnight|Guards Red|Speed Yellow|Carrara White|Jet Black|Arctic Silver|GT Silver|Chalk|Crayon|Miami Blue|Riviera Blue|Racing Yellow)\b/i);
  if (colorMatch && !listing.exterior_color) {
    listing.exterior_color = colorMatch[1];
  }

  // Extract images from HTML - only vehicle photos, not icons/emoticons
  const imageMatches = html.matchAll(/src="(https:\/\/cimg\d\.ibsrv\.net\/gimg\/rennlist\.com-vbulletin\/[^"]+)"/g);
  const seenUrls = new Set<string>();
  for (const match of imageMatches) {
    const imgUrl = match[1];
    // Skip tiny images (emoticons, icons) - only keep vehicle photos
    if (imgUrl.includes('/16x16/') || imgUrl.includes('/32x32/') || imgUrl.includes('emoticon') || imgUrl.includes('thumb_up')) {
      continue;
    }
    // Get full-size version (remove thumb sizing)
    const fullUrl = imgUrl.replace(/\/160x120\//, '/1280x720/').replace(/\/320x\d+\//, '/1280x720/');
    if (!seenUrls.has(fullUrl) && listing.image_urls.length < 50) {
      seenUrls.add(fullUrl);
      listing.image_urls.push(fullUrl);
    }
  }

  // Parse title for trim if not found
  if (listing.title && !listing.trim) {
    // Common Porsche trims: Turbo, Carrera, GT3, GT2, S, 4S, GTS, Targa, etc.
    const trimPatterns = [
      /\b(GT3 RS|GT2 RS|Turbo S|Carrera 4S|Carrera S|Carrera 4|GTS|Targa 4S|Targa 4|Targa|GT3|GT2|Turbo)\b/i,
      /\b(S E-Hybrid|E-Hybrid|Platinum Edition|Sport Design|Sport Chrono)\b/i,
    ];
    for (const pattern of trimPatterns) {
      const match = listing.title.match(pattern);
      if (match) {
        listing.trim = match[1];
        break;
      }
    }
  }

  // Check listing status
  if (html.includes('listing-status-sold') || html.includes('>Sold<')) {
    listing.listing_status = 'sold';
  } else if (html.includes('listing-status-expired') || html.includes('>Expired<')) {
    listing.listing_status = 'expired';
  } else if (html.includes('listing-status-closed') || html.includes('>Closed<')) {
    listing.listing_status = 'closed';
  }

  return listing;
}

// Extract listing URLs from a marketplace page
function extractListingsFromPage(html: string): RennlistPageListing[] {
  const listings: RennlistPageListing[] = [];

  // Match listing links pattern: /forums/market/{id}
  const linkMatches = html.matchAll(/href="(https:\/\/rennlist\.com\/forums\/market\/(\d+))"/g);
  const seenIds = new Set<string>();

  for (const match of linkMatches) {
    const url = match[1];
    const listingId = match[2];

    if (seenIds.has(listingId)) continue;
    seenIds.add(listingId);

    listings.push({
      listing_id: listingId,
      url,
      title: null,
      year: null,
      make: 'Porsche', // Rennlist is Porsche-only
      model: null,
      price: null,
      location: null,
      thumbnail: null,
    });
  }

  return listings;
}

// Fetch a URL with retry
async function fetchWithRetry(url: string, retries = 3): Promise<string> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (e) {
      lastError = e as Error;
      console.warn(`Fetch attempt ${i + 1} failed for ${url}: ${lastError.message}`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
    }
  }

  throw lastError || new Error('Failed to fetch');
}

// Save listing to database
async function saveListing(supabase: any, listing: RennlistListing): Promise<{ vehicle_id: string | null; action: string }> {
  // Skip non-Porsche or invalid listings
  if (!listing.year || !listing.model) {
    console.log(`Skipping listing ${listing.listing_id}: missing year or model`);
    return { vehicle_id: null, action: 'skipped' };
  }

  // Check for existing vehicle by VIN
  if (listing.vin && listing.vin.length >= 11) {
    const { data: vinMatch } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', listing.vin)
      .limit(1)
      .single();

    if (vinMatch) {
      // Update existing vehicle with Rennlist data
      await supabase
        .from('vehicles')
        .update({
          rennlist_url: listing.url,
          rennlist_listing_id: listing.listing_id,
          mileage: listing.mileage || undefined,
          color: listing.exterior_color || undefined,
          transmission: listing.transmission || undefined,
          drivetrain: listing.drivetrain || undefined,
          engine_type: listing.engine || undefined,
          body_style: listing.body_style || undefined,
          sale_price: listing.price || undefined,
          description: listing.description || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', vinMatch.id);

      console.log(`Updated existing vehicle ${vinMatch.id} via VIN match`);
      return { vehicle_id: vinMatch.id, action: 'updated' };
    }
  }

  // Check for existing by Rennlist URL
  const { data: urlMatch } = await supabase
    .from('vehicles')
    .select('id')
    .eq('rennlist_url', listing.url)
    .limit(1)
    .single();

  if (urlMatch) {
    // Update existing
    await supabase
      .from('vehicles')
      .update({
        sale_price: listing.price || undefined,
        mileage: listing.mileage || undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', urlMatch.id);

    console.log(`Updated existing vehicle ${urlMatch.id} via URL match`);
    return { vehicle_id: urlMatch.id, action: 'updated' };
  }

  // Insert new vehicle
  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      year: listing.year,
      make: listing.make || 'Porsche',
      model: listing.model,
      trim: listing.trim,
      vin: listing.vin,
      mileage: listing.mileage,
      sale_price: listing.price,
      color: listing.exterior_color,
      transmission: listing.transmission,
      drivetrain: listing.drivetrain,
      engine_type: listing.engine,
      body_style: listing.body_style,
      description: listing.description,
      rennlist_url: listing.url,
      rennlist_listing_id: listing.listing_id,
      listing_source: 'rennlist',
      profile_origin: 'rennlist_import',
      discovery_url: listing.url,
      discovery_source: 'rennlist',
      is_public: true,
      sale_status: listing.listing_status === 'sold' ? 'sold' : 'for_sale',
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    console.error(`Failed to insert vehicle: ${error.message}`);
    return { vehicle_id: null, action: 'error' };
  }

  console.log(`Created new vehicle: ${data.id}`);

  // Save images
  if (listing.image_urls.length > 0 && data.id) {
    const imageRecords = listing.image_urls.map((img_url, i) => ({
      vehicle_id: data.id,
      image_url: img_url,
      position: i,
      source: 'rennlist',
      is_external: true,
    }));

    const { error: imgError } = await supabase
      .from('vehicle_images')
      .insert(imageRecords);

    if (imgError) {
      console.error('Image save error:', imgError);
    } else {
      console.log(`Saved ${imageRecords.length} images`);
    }
  }

  // Create external_listings record
  if (data.id) {
    await supabase
      .from('external_listings')
      .upsert({
        vehicle_id: data.id,
        platform: 'rennlist',
        listing_url: listing.url,
        listing_url_key: listing.listing_id,
        listing_id: listing.listing_id,
        listing_status: listing.listing_status,
        final_price: listing.price,
        metadata: {
          seller_username: listing.seller_username,
          location: listing.location,
          price_obo: listing.price_obo,
        },
      }, {
        onConflict: 'platform,listing_url_key'
      });
  }

  return { vehicle_id: data.id, action: 'created' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      url,           // Single listing URL to extract
      crawl,         // Crawl marketplace pages
      page = 1,      // Start page for crawl
      max_pages = 5, // Max pages to crawl
      batch_size = 10, // Listings per batch
    } = body;

    // Mode 1: Extract single listing
    if (url) {
      if (!url.includes('rennlist.com/forums/market/')) {
        return new Response(
          JSON.stringify({ error: 'Invalid Rennlist marketplace URL' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Extracting single listing: ${url}`);
      const html = await fetchWithRetry(url);
      const listing = extractListingDetails(html, url);

      console.log(`Extracted: ${listing.year} ${listing.make} ${listing.model} - $${listing.price}`);

      const { vehicle_id, action } = await saveListing(supabase, listing);

      return new Response(
        JSON.stringify({
          success: true,
          listing,
          vehicle_id,
          action,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mode 2: Crawl marketplace
    if (crawl) {
      console.log(`Starting Rennlist crawl: pages ${page} to ${page + max_pages - 1}`);

      const results = {
        pages_crawled: 0,
        listings_found: 0,
        listings_extracted: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        vehicles: [] as { id: string; year: number; model: string; price: number }[],
      };

      for (let p = page; p < page + max_pages; p++) {
        const marketplaceUrl = `https://rennlist.com/forums/market/vehicles?type[0]=1&status[0]=0&sortby=lastpost_desc&countryid=5&page=${p}`;
        console.log(`Fetching page ${p}: ${marketplaceUrl}`);

        try {
          const pageHtml = await fetchWithRetry(marketplaceUrl);
          const pageListings = extractListingsFromPage(pageHtml);

          results.pages_crawled++;
          results.listings_found += pageListings.length;

          if (pageListings.length === 0) {
            console.log(`No listings found on page ${p}, stopping crawl`);
            break;
          }

          // Extract details for each listing (limited by batch_size)
          const toProcess = pageListings.slice(0, batch_size);

          for (const pageListing of toProcess) {
            try {
              console.log(`Extracting: ${pageListing.url}`);
              const listingHtml = await fetchWithRetry(pageListing.url);
              const listing = extractListingDetails(listingHtml, pageListing.url);

              results.listings_extracted++;

              const { vehicle_id, action } = await saveListing(supabase, listing);

              if (action === 'created') {
                results.created++;
                if (vehicle_id) {
                  results.vehicles.push({
                    id: vehicle_id,
                    year: listing.year || 0,
                    model: listing.model || '',
                    price: listing.price || 0,
                  });
                }
              } else if (action === 'updated') {
                results.updated++;
              } else if (action === 'skipped') {
                results.skipped++;
              } else {
                results.errors++;
              }

              // Small delay to be respectful
              await new Promise(r => setTimeout(r, 500));

            } catch (e) {
              console.error(`Error extracting ${pageListing.url}:`, e);
              results.errors++;
            }
          }

          // Delay between pages
          await new Promise(r => setTimeout(r, 1000));

        } catch (e) {
          console.error(`Error fetching page ${p}:`, e);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          results,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No valid mode specified
    return new Response(
      JSON.stringify({
        error: 'Specify either "url" for single listing or "crawl: true" for marketplace crawl',
        usage: {
          single: { url: 'https://rennlist.com/forums/market/1501318' },
          crawl: { crawl: true, page: 1, max_pages: 5, batch_size: 10 },
        }
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
