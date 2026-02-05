import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MarketplaceListing {
  id: string;
  facebook_id: string;
  title: string;
  price: number | null;
  location: string | null;
  url: string;
  image_url: string | null;
  description: string | null;
  seller_name: string | null;
  all_images: string[] | null;
  scraped_at: string;
  parsed_year: number | null;
  parsed_make: string | null;
  parsed_model: string | null;
  mileage: number | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  fuel_type: string | null;
  listed_days_ago: number | null;
}

/**
 * Parse year, make, model from FB Marketplace title
 * Examples: "1978 Ford F-150", "1987 Chevy C10", "$4,5001972 Chevrolet C10"
 */
function parseTitle(title: string): { year: number | null; make: string | null; model: string | null; cleanPrice: number | null } {
  // Extract price - look for year at END of price string (e.g., "$1,9502021" -> price=$1,950, year=2021)
  let cleanPrice: number | null = null;
  const priceMatch = title.match(/^\$?([\d,]+)/);
  if (priceMatch) {
    const priceStr = priceMatch[1].replace(/,/g, '');
    // Look for 4-digit year at the END of the price string
    const yearAtEnd = priceStr.match(/((?:19[2-9]\d|20[0-3]\d))$/);
    if (yearAtEnd && priceStr.length > 4) {
      // Year is at end - extract price from beginning
      const priceDigits = priceStr.slice(0, -4);
      cleanPrice = priceDigits.length > 0 ? parseInt(priceDigits, 10) : null;
    } else if (priceStr.length <= 7 && !priceStr.match(/^(19|20)\d{2}$/)) {
      // No year embedded, reasonable price length, not just a year
      cleanPrice = parseInt(priceStr, 10);
    }
  }

  // Clean up title - remove price prefixes like "$4,500" but keep year
  const cleaned = title.replace(/^\$[\d,]+(?=\d{4})/g, '').replace(/^\$[\d,]+\s*/g, '').trim();

  // Match year (1920-2030)
  const yearMatch = cleaned.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  if (!year) return { year: null, make: null, model: null };

  // Get text after year
  const afterYear = cleaned.split(String(year))[1]?.trim() || '';
  const words = afterYear.split(/\s+/).filter(w => w.length > 0);

  // Common make normalizations
  const makeMap: Record<string, string> = {
    'chevy': 'Chevrolet',
    'chevrolet': 'Chevrolet',
    'ford': 'Ford',
    'dodge': 'Dodge',
    'gmc': 'GMC',
    'toyota': 'Toyota',
    'jeep': 'Jeep',
    'plymouth': 'Plymouth',
    'pontiac': 'Pontiac',
    'buick': 'Buick',
    'oldsmobile': 'Oldsmobile',
    'cadillac': 'Cadillac',
    'lincoln': 'Lincoln',
    'mercury': 'Mercury',
    'amc': 'AMC',
    'international': 'International',
    'studebaker': 'Studebaker',
    'willys': 'Willys',
    'datsun': 'Datsun',
    'nissan': 'Nissan',
    'volkswagen': 'Volkswagen',
    'vw': 'Volkswagen',
    'porsche': 'Porsche',
    'mercedes': 'Mercedes-Benz',
    'mercedes-benz': 'Mercedes-Benz',
    'bmw': 'BMW',
    'jaguar': 'Jaguar',
    'triumph': 'Triumph',
    'mg': 'MG',
    'austin': 'Austin',
    'alfa': 'Alfa Romeo',
    'fiat': 'Fiat',
    'ferrari': 'Ferrari',
    'maserati': 'Maserati',
    'honda': 'Honda',
    'mazda': 'Mazda',
    'subaru': 'Subaru',
  };

  const rawMake = words[0]?.toLowerCase() || '';
  const make = makeMap[rawMake] || (words[0] ? words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase() : null);

  // Model is typically the next 1-3 words
  const modelWords = words.slice(1, 4);
  // Stop at common suffixes
  const stopWords = ['pickup', 'truck', 'sedan', 'coupe', 'wagon', 'van', 'suv', 'convertible', 'cab', 'bed', 'door'];
  const model = modelWords
    .filter(w => !stopWords.includes(w.toLowerCase()))
    .slice(0, 2)
    .join(' ') || null;

  return { year, make, model, cleanPrice };
}

/**
 * Extract location components
 */
function parseLocation(location: string | null): { city: string | null; state: string | null } {
  if (!location) return { city: null, state: null };

  // FB format: "City, ST" or just city name
  const parts = location.split(',').map(p => p.trim());
  const city = parts[0] || null;
  const state = parts[1]?.substring(0, 2).toUpperCase() || null;

  return { city, state };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size ?? 50;
    const dryRun = body.dry_run ?? false;

    // Get unlinked marketplace listings - ALL priorities
    const { data: listings, error: fetchError } = await supabase
      .from('marketplace_listings')
      .select('*')
      .is('vehicle_id', null)
      .order('scraped_at', { ascending: false })
      .limit(batchSize);

    if (fetchError) throw fetchError;
    if (!listings || listings.length === 0) {
      return new Response(JSON.stringify({
        message: "No unlinked listings to import",
        imported: 0
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const results = {
      processed: 0,
      created: 0,
      errors: [] as string[],
      vehicles: [] as any[],
    };

    for (const listing of listings as MarketplaceListing[]) {
      try {
        // Use DB values - they're already parsed by the monitor
        let year = listing.parsed_year;
        let price = listing.price;

        // Parse make/model from title if not stored
        const parsed = parseTitle(listing.title);
        let make = listing.parsed_make || parsed.make;
        let model = listing.parsed_model || parsed.model;

        // Use year from title parsing if not in DB
        if (!year && parsed.year) {
          year = parsed.year;
        }

        // Fix corrupted prices (when year got included in price)
        if (parsed.cleanPrice && (price === null || price > 500000)) {
          price = parsed.cleanPrice;
        }

        // Skip if still no year - this shouldn't happen for 'classic' priority
        if (!year) {
          results.errors.push(`Skip: ${listing.title.slice(0, 50)} - no year`);
          continue;
        }

        const { city, state } = parseLocation(listing.location);

        // Build vehicle record
        const vehicleData: Record<string, any> = {
          year,
          make,
          model,
          asking_price: price,
          sale_price: null, // Not sold yet
          sale_status: 'for_sale',
          is_for_sale: true,
          status: 'active', // Make visible in feed immediately
          discovery_url: listing.url,
          discovery_source: 'facebook_marketplace',
          profile_origin: 'facebook_marketplace',
          description: listing.description,
          primary_image_url: listing.image_url,
          origin_metadata: {
            facebook_id: listing.facebook_id,
            seller_name: listing.seller_name,
            location: listing.location,
            city,
            state,
            scraped_at: listing.scraped_at,
            image_count: listing.all_images?.length || 0,
            listed_days_ago: listing.listed_days_ago,
          },
        };

        // Add vehicle details if present
        if (listing.mileage) vehicleData.mileage = listing.mileage;
        if (listing.transmission) vehicleData.transmission = listing.transmission;
        if (listing.exterior_color) vehicleData.color = listing.exterior_color;
        if (listing.interior_color) vehicleData.interior_color = listing.interior_color;

        if (dryRun) {
          results.vehicles.push(vehicleData);
          results.processed++;
          continue;
        }

        // Create vehicle
        const { data: vehicle, error: insertError } = await supabase
          .from('vehicles')
          .insert(vehicleData)
          .select('id')
          .single();

        if (insertError) {
          results.errors.push(`Insert error: ${insertError.message}`);
          continue;
        }

        // Link marketplace listing to vehicle
        await supabase
          .from('marketplace_listings')
          .update({
            vehicle_id: vehicle.id,
            parsed_year: year,
            parsed_make: make,
            parsed_model: model,
          })
          .eq('id', listing.id);

        // Import images
        if (listing.all_images && listing.all_images.length > 0) {
          const imageRecords = listing.all_images.map((url, i) => ({
            vehicle_id: vehicle.id,
            url,
            is_primary: i === 0,
            source: 'facebook_marketplace',
          }));

          await supabase
            .from('vehicle_images')
            .insert(imageRecords);
        } else if (listing.image_url) {
          await supabase
            .from('vehicle_images')
            .insert({
              vehicle_id: vehicle.id,
              url: listing.image_url,
              is_primary: true,
              source: 'facebook_marketplace',
            });
        }

        results.created++;
        results.vehicles.push({ id: vehicle.id, ...vehicleData });
        results.processed++;

      } catch (e: any) {
        results.errors.push(`Error processing ${listing.id}: ${e.message}`);
      }
    }

    return new Response(JSON.stringify({
      message: dryRun ? "Dry run complete" : "Import complete",
      ...results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
