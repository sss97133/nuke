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

// ─── NON-CAR MAKE BLOCKLIST ───────────────────────────────────────────
// These makes are NEVER passenger cars/trucks we care about
const BLOCKED_MAKES = new Set([
  'harley-davidson', 'harley', 'indian', 'ducati', 'kawasaki', 'suzuki',
  'yamaha', 'ktm', 'triumph', 'aprilia', 'husqvarna', 'moto guzzi',
  'can-am', 'polaris', 'arctic cat', 'sea-doo', 'ski-doo',
  'fleetwood', 'winnebago', 'coachmen', 'jayco', 'thor', 'tiffin',
  'newmar', 'holiday rambler', 'airstream', 'forest river',
  'utility', 'wabash', 'great dane', 'hyundai translead', 'stoughton',
  'mack', 'kenworth', 'peterbilt', 'freightliner', 'western star',
  'john deere', 'caterpillar', 'case', 'kubota', 'bobcat',
  'traeger', 'craftsman', 'toro', 'husqvarna',
]);

// Model names that indicate non-cars
const BLOCKED_MODEL_PATTERNS = [
  /\bsoftail\b/i, /\bsportster\b/i, /\bdyna\b/i, /\btouring\b/i,
  /\bsouthwind\b/i, /\bbounder\b/i, /\bmotorhome\b/i, /\bcamper\b/i,
  /\btrailer\b/i, /\batv\b/i, /\bquad\b/i, /\bdirt\s*bike\b/i,
  /\bscooter\b/i, /\bjet\s*ski\b/i, /\bsnowmobile\b/i, /\bboat\b/i,
  /\bpwc\b/i, /\bside.by.side\b/i, /\butv\b/i, /\brv\b/i,
  /\b(xr|cr|crf|yz|kx|rm|klx)\d{2,3}\b/i, // dirt bike model codes
];

// ─── IMAGE VALIDATION ─────────────────────────────────────────────────
// Pollution patterns - these are NOT vehicle photos
const IMAGE_POLLUTION_PATTERNS = [
  /profile/i, /avatar/i, /emoji/i, /static/i, /icon/i,
  /badge/i, /logo/i, /messenger/i, /rsrc\.php/i,
  /pixel/i, /tracking/i, /beacon/i, /blank\./i,
  /_s\.\w+$/, /_t\.\w+$/, /_q\.\w+$/, // tiny FB thumbnails
];

function isValidVehicleImage(url: string): boolean {
  if (!url) return false;
  // Must be from FB CDN
  if (!url.includes('scontent') && !url.includes('fbcdn')) return false;
  // Must not be pollution
  for (const pattern of IMAGE_POLLUTION_PATTERNS) {
    if (pattern.test(url)) return false;
  }
  return true;
}

// ─── PRICE VALIDATION ─────────────────────────────────────────────────
function isSuspiciousPrice(price: number | null): boolean {
  if (price === null) return false;
  // Obvious placeholder prices
  if (price === 123456 || price === 1234567 || price === 12345) return true;
  // Repeating digit patterns like 111111, 999999
  const s = String(price);
  if (s.length >= 5 && new Set(s.split('')).size === 1) return true;
  // Too cheap to be real ($0, $1, $2)
  if (price <= 2) return true;
  // Absurdly expensive for what we're looking at
  if (price > 500000) return true;
  return false;
}

// ─── MODEL NAME CLEANUP ──────────────────────────────────────────────
function cleanModelName(model: string | null): string | null {
  if (!model) return null;
  let cleaned = model
    // Remove trailing special chars FB leaves behind: "gs ·", "F-150 ·"
    .replace(/\s*[·•▪]\s*$/g, '')
    // Remove location data jammed into model: "camryAurora, IL146K"
    .replace(/[A-Z][a-z]+,\s*[A-Z]{2}\d*[Kk]?\s*$/g, '')
    // Remove trailing commas and junk
    .replace(/[,\s]+$/, '')
    // Remove mileage appended to model: "WRXAlbuquerque, NM63K"
    .replace(/\d+[Kk]\s*$/, '')
    // Remove city names stuck to model (camelCase boundary: "civicLX" is fine, "camryAurora" is not)
    // Only remove if it looks like CityName (capital letter mid-word after lowercase)
    .replace(/([a-z])([A-Z][a-z]{3,}(?:,\s*[A-Z]{2})?)/, '$1')
    .trim();

  // Reject garbage models
  if (!cleaned) return null;
  if (cleaned.length <= 1) return null; // Single char like ":"
  if (/^[^a-zA-Z0-9]+$/.test(cleaned)) return null; // Only special chars
  if (cleaned.toLowerCase() === 'small') return null;
  if (cleaned.toLowerCase() === 'regular cab') return null;

  return cleaned;
}

/**
 * Parse year, make, model from FB Marketplace title
 * Examples: "1978 Ford F-150", "1987 Chevy C10", "$4,5001972 Chevrolet C10"
 */
function parseTitle(title: string | null | undefined): { year: number | null; make: string | null; model: string | null; cleanPrice: number | null } {
  if (!title) return { year: null, make: null, model: null, cleanPrice: null };

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

  if (!year) return { year: null, make: null, model: null, cleanPrice };

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
    'mg': 'MG',
    'austin': 'Austin',
    'alfa': 'Alfa Romeo',
    'fiat': 'Fiat',
    'ferrari': 'Ferrari',
    'maserati': 'Maserati',
    'honda': 'Honda',
    'mazda': 'Mazda',
    'subaru': 'Subaru',
    'lexus': 'Lexus',
    'acura': 'Acura',
    'infiniti': 'Infiniti',
    'mitsubishi': 'Mitsubishi',
    'isuzu': 'Isuzu',
    'saturn': 'Saturn',
    'saab': 'Saab',
    'volvo': 'Volvo',
    'land rover': 'Land Rover',
    'rover': 'Rover',
    'lotus': 'Lotus',
    'aston martin': 'Aston Martin',
    'aston': 'Aston Martin',
    'delorean': 'DeLorean',
    'shelby': 'Shelby',
  };

  const rawMake = words[0]?.toLowerCase() || '';
  const make = makeMap[rawMake] || (words[0] ? words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase() : null);

  // Model is typically the next 1-3 words
  const modelWords = words.slice(1, 4);
  // Stop at common suffixes
  const stopWords = ['pickup', 'truck', 'sedan', 'coupe', 'wagon', 'van', 'suv', 'convertible', 'cab', 'bed', 'door'];
  const rawModel = modelWords
    .filter(w => !stopWords.includes(w.toLowerCase()))
    .slice(0, 2)
    .join(' ') || null;

  const model = cleanModelName(rawModel);

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

/**
 * Check if a listing is a non-car vehicle type we don't want
 */
function isBlockedVehicleType(make: string | null, model: string | null, title: string): boolean {
  const makeLower = (make || '').toLowerCase().trim();
  if (BLOCKED_MAKES.has(makeLower)) return true;

  const fullText = `${make || ''} ${model || ''} ${title}`.toLowerCase();
  for (const pattern of BLOCKED_MODEL_PATTERNS) {
    if (pattern.test(fullText)) return true;
  }

  return false;
}

/**
 * Check for duplicate vehicles already in the DB
 */
async function isDuplicate(supabase: any, url: string, year: number, make: string | null, model: string | null): Promise<boolean> {
  // Check by discovery_url first (exact match)
  const { data: urlMatch } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', url)
    .limit(1)
    .maybeSingle();
  if (urlMatch) return true;

  // Check by year+make+model (fuzzy - could be re-scraped listing)
  if (make && model) {
    const { data: ymmMatch } = await supabase
      .from('vehicles')
      .select('id')
      .eq('year', year)
      .ilike('make', make)
      .ilike('model', model)
      .eq('discovery_source', 'facebook_marketplace')
      .limit(1)
      .maybeSingle();
    if (ymmMatch) return true;
  }

  return false;
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

    // Get unlinked marketplace listings
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
      skipped_no_year: 0,
      skipped_no_make_model: 0,
      skipped_no_image: 0,
      skipped_blocked_type: 0,
      skipped_duplicate: 0,
      skipped_garbage_model: 0,
      errors: [] as string[],
      vehicles: [] as any[],
    };

    for (const listing of listings as MarketplaceListing[]) {
      try {
        results.processed++;

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

        // ─── QUALITY GATE 1: Must have year ───────────────────────
        if (!year) {
          results.skipped_no_year++;
          continue;
        }

        // ─── QUALITY GATE 2: Must have make AND valid model ───────
        if (!make) {
          results.skipped_no_make_model++;
          continue;
        }

        // Clean model name (remove garbage chars, location data, etc.)
        model = cleanModelName(model);
        if (!model) {
          results.skipped_garbage_model++;
          continue;
        }

        // ─── QUALITY GATE 3: Block non-car vehicle types ──────────
        if (isBlockedVehicleType(make, model, listing.title)) {
          results.skipped_blocked_type++;
          continue;
        }

        // ─── QUALITY GATE 4: Must have at least one valid image ───
        const validImages = (listing.all_images || []).filter(isValidVehicleImage);
        const primaryImage = listing.image_url && isValidVehicleImage(listing.image_url)
          ? listing.image_url
          : validImages[0] || null;

        if (!primaryImage && validImages.length === 0) {
          results.skipped_no_image++;
          continue;
        }

        // ─── QUALITY GATE 5: Duplicate detection ──────────────────
        if (!dryRun && await isDuplicate(supabase, listing.url, year, make, model)) {
          results.skipped_duplicate++;
          // Still link the listing to prevent re-processing
          // Find the existing vehicle to link
          const { data: existing } = await supabase
            .from('vehicles')
            .select('id')
            .eq('discovery_url', listing.url)
            .limit(1)
            .maybeSingle();
          if (existing) {
            await supabase
              .from('marketplace_listings')
              .update({ vehicle_id: existing.id })
              .eq('id', listing.id);
          }
          continue;
        }

        // ─── PRICE HANDLING ───────────────────────────────────────
        // If price looks suspicious, null it out (frontend can show "OBO")
        let askingPrice = price;
        let priceNote: string | null = null;
        if (isSuspiciousPrice(price)) {
          askingPrice = null;
          priceNote = 'Price appears suspicious, listed as OBO';
        }

        const { city, state } = parseLocation(listing.location);

        // Build vehicle record - only quality data goes in
        const vehicleData: Record<string, any> = {
          year,
          make,
          model,
          asking_price: askingPrice,
          sale_price: null,
          sale_status: 'for_sale',
          is_for_sale: true,
          status: 'active',
          is_public: true,
          discovery_url: listing.url,
          discovery_source: 'facebook_marketplace',
          profile_origin: 'facebook_marketplace',
          description: listing.description,
          primary_image_url: primaryImage,
          city,
          state,
          origin_metadata: {
            facebook_id: listing.facebook_id,
            seller_name: listing.seller_name,
            location: listing.location,
            city,
            state,
            scraped_at: listing.scraped_at,
            image_count: validImages.length,
            listed_days_ago: listing.listed_days_ago,
            price_note: priceNote,
            original_price: price,
          },
        };

        // Add vehicle details if present
        if (listing.mileage) vehicleData.mileage = listing.mileage;
        if (listing.transmission) vehicleData.transmission = listing.transmission;
        if (listing.exterior_color) vehicleData.color = listing.exterior_color;
        if (listing.interior_color) vehicleData.interior_color = listing.interior_color;

        if (dryRun) {
          results.vehicles.push(vehicleData);
          continue;
        }

        // Create vehicle
        const { data: vehicle, error: insertError } = await supabase
          .from('vehicles')
          .insert(vehicleData)
          .select('id')
          .maybeSingle();

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

        // Import only valid images (no pollution)
        if (validImages.length > 0) {
          const imageRecords = validImages.slice(0, 10).map((url, i) => ({
            vehicle_id: vehicle.id,
            url,
            is_primary: i === 0,
            source: 'facebook_marketplace',
          }));

          await supabase
            .from('vehicle_images')
            .insert(imageRecords);
        }

        results.created++;
        results.vehicles.push({ id: vehicle.id, ...vehicleData });

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
