/**
 * geocode-organization-locations
 *
 * Backfills latitude/longitude on organization_locations rows that have
 * city/state but no coordinates.
 *
 * Geocoding strategy (no external API keys required):
 * 1. Parse city + state
 * 2. Lookup in fb_marketplace_locations table (500+ US metros, instant)
 * 3. Fallback to Nominatim (OpenStreetMap) — free, no key, 1 req/sec
 *
 * Usage:
 *   POST /geocode-organization-locations
 *   { "batch_size": 200, "dry_run": false, "nominatim_delay_ms": 1100 }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_USER_AGENT = "nuke-org-geocoder/1.0 (contact@nuke.com)";

interface GeoResult {
  latitude: number;
  longitude: number;
  source: "lookup_table" | "nominatim";
  confidence: number;
}

async function geocodeFromLookupTable(
  supabase: ReturnType<typeof createClient>,
  city: string,
  state: string
): Promise<GeoResult | null> {
  const { data, error } = await supabase
    .from("fb_marketplace_locations")
    .select("latitude, longitude, name")
    .eq("state_code", state.toUpperCase())
    .ilike("name", `${city}%`)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const lat =
    typeof data.latitude === "string"
      ? parseFloat(data.latitude)
      : Number(data.latitude);
  const lng =
    typeof data.longitude === "string"
      ? parseFloat(data.longitude)
      : Number(data.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;

  return { latitude: lat, longitude: lng, source: "lookup_table", confidence: 0.75 };
}

// Country name → ISO 3166-1 alpha-2 code mapping
const COUNTRY_CODE: Record<string, string> = {
  "us": "us", "usa": "us", "united states": "us", "united states of america": "us",
  "gb": "gb", "uk": "gb", "united kingdom": "gb", "england": "gb", "great britain": "gb",
  "de": "de", "germany": "de", "deutschland": "de",
  "fr": "fr", "france": "fr",
  "it": "it", "italy": "it", "italia": "it",
  "es": "es", "spain": "es", "españa": "es",
  "ca": "ca", "canada": "ca",
  "au": "au", "australia": "au",
  "jp": "jp", "japan": "jp",
  "ae": "ae", "united arab emirates": "ae", "uae": "ae",
  "ch": "ch", "switzerland": "ch",
  "nl": "nl", "netherlands": "nl",
  "be": "be", "belgium": "be",
  "at": "at", "austria": "at",
  "se": "se", "sweden": "se",
  "dk": "dk", "denmark": "dk",
  "no": "no", "norway": "no",
  "nz": "nz", "new zealand": "nz",
  "mx": "mx", "mexico": "mx",
  "br": "br", "brazil": "br",
  "bl": "bl", "saint barthélemy": "bl", "saint barthelemy": "bl", "st barts": "bl",
  "mc": "mc", "monaco": "mc",
  "sg": "sg", "singapore": "sg",
  "hk": "hk", "hong kong": "hk",
  "za": "za", "south africa": "za",
  "ie": "ie", "ireland": "ie",
  "pt": "pt", "portugal": "pt",
  "bm": "bm", "bermuda": "bm",
  "ky": "ky", "cayman islands": "ky",
  "bs": "bs", "bahamas": "bs",
  "vi": "vi", "us virgin islands": "vi", "usvi": "vi",
};

function normalizeCountryCode(country: string | null): string {
  if (!country) return "us";
  const lower = country.toLowerCase().trim();
  return COUNTRY_CODE[lower] || lower;
}

// Junk city names to skip
const JUNK_CITIES = new Set([
  "unknown", "n/a", "na", "not provided", "none", "test", "tbd",
  "null", "undefined", ".", "-", "---", "no city", "no address",
]);

function isJunkCity(city: string | null): boolean {
  if (!city) return true;
  return JUNK_CITIES.has(city.toLowerCase().trim());
}

// Country codes where Nominatim's countrycodes param doesn't work —
// use country name in query string instead
const COUNTRY_NAME_FALLBACK: Record<string, string> = {
  "bl": "Saint Barthélemy",
  "bm": "Bermuda",
  "ky": "Cayman Islands",
  "vi": "US Virgin Islands",
  "gu": "Guam",
  "as": "American Samoa",
  "mp": "Northern Mariana Islands",
  "mc": "Monaco",
};

async function geocodeFromNominatim(
  city: string,
  stateOrCountry: string,
  country?: string
): Promise<GeoResult | null> {
  const cc = normalizeCountryCode(country || null);
  const countryFallbackName = COUNTRY_NAME_FALLBACK[cc];

  // Build query: city, state/region, and optionally country name for small territories
  const parts = [city, stateOrCountry].filter(Boolean);
  if (countryFallbackName) parts.push(countryFallbackName);
  const q = encodeURIComponent(parts.join(", "));

  // Use countrycodes param for major countries, skip for small territories
  const ccParam = countryFallbackName ? "" : `&countrycodes=${cc}`;
  const url = `${NOMINATIM_URL}?q=${q}&format=json${ccParam}&limit=1&addressdetails=0`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    const lat = parseFloat(results[0].lat);
    const lon = parseFloat(results[0].lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;

    return { latitude: lat, longitude: lon, source: "nominatim", confidence: 0.65 };
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};

function normalizeStateCode(state: string | null): string | null {
  if (!state) return null;
  if (state.length === 2) return state.toUpperCase();
  return STATE_ABBR[state.toLowerCase()] || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(Number(body.batch_size) || 200, 1000);
  const dryRun = Boolean(body.dry_run);
  const nominatimDelayMs = Number(body.nominatim_delay_ms) || 1100;
  const method: string = body.method || "all";

  // Fetch locations needing geocoding
  const { data: locations, error: fetchError } = await supabase
    .from("organization_locations")
    .select("id, organization_id, city, state, zip_code, country, street_address")
    .is("latitude", null)
    .not("city", "is", null)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!locations || locations.length === 0) {
    // Count remaining
    const { count } = await supabase
      .from("organization_locations")
      .select("id", { count: "exact", head: true })
      .is("latitude", null)
      .not("city", "is", null);

    return new Response(
      JSON.stringify({
        processed: 0,
        remaining: count || 0,
        message: "No locations to geocode",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const stats = {
    processed: 0,
    geocoded_from_lookup: 0,
    geocoded_from_nominatim: 0,
    skipped_no_city_state: 0,
    skipped_junk_city: 0,
    failed: 0,
  };

  const nominatimQueue: Array<{
    id: string;
    city: string;
    state: string;
    country: string;
  }> = [];

  // Pass 1: lookup table (fast, US only)
  for (const loc of locations) {
    if (!loc.city) {
      stats.skipped_no_city_state++;
      continue;
    }

    if (isJunkCity(loc.city)) {
      stats.skipped_junk_city++;
      // Null out junk city so it doesn't keep appearing in the queue
      if (!dryRun) {
        await supabase
          .from("organization_locations")
          .update({ city: null, geocode_source: "manual", geocoded_at: new Date().toISOString() })
          .eq("id", loc.id);
      }
      continue;
    }

    // Normalize country and state
    const stateCode = normalizeStateCode(loc.state);
    const cc = normalizeCountryCode(loc.country);
    const isUS = cc === "us";

    // Only try lookup table for US locations with 2-letter state codes
    if (isUS && stateCode && method !== "nominatim_only") {
      const geo = await geocodeFromLookupTable(supabase, loc.city, stateCode);

      if (geo) {
        if (!dryRun) {
          await supabase
            .from("organization_locations")
            .update({
              latitude: geo.latitude,
              longitude: geo.longitude,
              geocode_source: "lookup_table",
              geocode_confidence: geo.confidence,
              geocoded_at: new Date().toISOString(),
            })
            .eq("id", loc.id);
        }
        stats.geocoded_from_lookup++;
        stats.processed++;
        continue;
      }
    }

    // Queue for Nominatim — pass state name (Nominatim handles full names)
    // and normalized country code
    nominatimQueue.push({
      id: loc.id,
      city: loc.city,
      state: stateCode || loc.state || "",
      country: cc,
    });
    stats.processed++;
  }

  // Pass 2: Nominatim fallback (rate-limited)
  if (method !== "lookup_only") {
    for (const item of nominatimQueue) {
      if (dryRun) {
        stats.geocoded_from_nominatim++;
        continue;
      }

      const geo = await geocodeFromNominatim(item.city, item.state, item.country);

      if (geo) {
        await supabase
          .from("organization_locations")
          .update({
            latitude: geo.latitude,
            longitude: geo.longitude,
            geocode_source: "nominatim",
            geocode_confidence: geo.confidence,
            geocoded_at: new Date().toISOString(),
          })
          .eq("id", item.id);

        stats.geocoded_from_nominatim++;
      } else {
        stats.failed++;
      }

      await sleep(nominatimDelayMs);
    }
  }

  // Count remaining
  const { count: remaining } = await supabase
    .from("organization_locations")
    .select("id", { count: "exact", head: true })
    .is("latitude", null)
    .not("city", "is", null);

  return new Response(
    JSON.stringify({ ...stats, remaining: remaining || 0, dry_run: dryRun }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
