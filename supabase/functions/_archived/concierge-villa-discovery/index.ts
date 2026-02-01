import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Villa rental agencies to scrape
const AGENCIES = [
  {
    slug: "sibarth",
    name: "Sibarth Villa Rentals",
    apiUrl: "https://sibarth.com/wp-json/villa/list",
    type: "json_api",
  },
  {
    slug: "elan",
    name: "Elan Villa Rental",
    baseUrl: "https://www.elanvillarental.com",
    listUrl: "https://www.elanvillarental.com/villas/",
    type: "html_scrape",
  },
  {
    slug: "stbarthproperties",
    name: "St Barth Properties",
    baseUrl: "https://www.stbarthproperties.com",
    listUrl: "https://www.stbarthproperties.com/vacation-villa-rentals/",
    type: "html_scrape",
  },
  {
    slug: "wimco",
    name: "WIMCO Villas",
    baseUrl: "https://www.wimco.com",
    listUrl: "https://www.wimco.com/villa-rentals/caribbean/st-barthelemy/",
    type: "html_scrape",
  },
  {
    slug: "villastbarth",
    name: "Villas of St Barth",
    baseUrl: "https://www.villaofstbarth.com",
    listUrl: "https://www.villaofstbarth.com/villas/",
    type: "html_scrape",
  },
  {
    slug: "stbarthvillarental",
    name: "St Barth Villa Rental",
    baseUrl: "https://stbarthvillarental.com",
    listUrl: "https://stbarthvillarental.com/",
    type: "html_scrape",
  },
  {
    slug: "eden-rock",
    name: "Eden Rock Villa Rental",
    baseUrl: "https://www.edenrockvillarental.com",
    listUrl: "https://www.edenrockvillarental.com/villas/",
    type: "html_scrape",
  },
];

interface Villa {
  name: string;
  slug: string;
  url: string;
  location?: string;
  bedrooms_min?: number;
  bedrooms_max?: number;
  price_low?: number;
  price_high?: number;
  price_currency: string;
  price_period: string;
  listing_type: string;
  images?: string[];
  tagline?: string;
  latitude?: number;
  longitude?: number;
  agency_slug: string;
  agency_name: string;
  external_id?: string;
}

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept": "text/html,application/json",
          "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
          ...options.headers,
        },
      });
      if (response.ok) return response;
      if (response.status === 404) throw new Error(`404 Not Found: ${url}`);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

// Parse price string to numbers
function parsePrice(priceStr: string): { low: number | null; high: number | null; currency: string } {
  if (!priceStr) return { low: null, high: null, currency: "USD" };
  const cleaned = priceStr.replace(/[,\s]/g, "");
  const currency = cleaned.includes("€") ? "EUR" : "USD";
  const numbers = cleaned.match(/[\d]+/g)?.map((n) => parseInt(n)).filter((n) => !isNaN(n) && n >= 100) || [];
  if (numbers.length === 0) return { low: null, high: null, currency };
  if (numbers.length === 1) return { low: numbers[0], high: numbers[0], currency };
  return { low: Math.min(...numbers), high: Math.max(...numbers), currency };
}

// Parse bedroom string
function parseBedrooms(str: string): { min: number | null; max: number | null } {
  if (!str) return { min: null, max: null };
  const numbers = str.match(/\d+/g)?.map((n) => parseInt(n)).filter((n) => !isNaN(n) && n < 20) || [];
  if (numbers.length === 0) return { min: null, max: null };
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0] };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

// Extract St Barth locations from text
function extractLocation(text: string): string | null {
  const locations = [
    "St. Jean", "St Jean", "Saint Jean",
    "Gustavia", "Colombier", "Flamands", "Lorient", "Marigot",
    "Pointe Milou", "Lurin", "Toiny", "Saline", "Gouverneur",
    "Grand Cul de Sac", "Petit Cul de Sac", "Grand Fond",
    "Corossol", "Vitet", "Anse des Cayes", "Deve", "Camaruche",
    "Public", "Mont Jean", "Anse des Lézards", "Lorient Beach",
    "Marigot Beach",
  ];
  for (const loc of locations) {
    if (text.toLowerCase().includes(loc.toLowerCase())) {
      return loc;
    }
  }
  return null;
}

// Scrape Sibarth via their JSON API
async function scrapeSibarth(): Promise<Villa[]> {
  console.log("Scraping Sibarth...");
  const response = await fetchWithRetry("https://sibarth.com/wp-json/villa/list");
  const data = await response.json();

  return data.villas.map((v: any) => ({
    name: v.name,
    slug: v.url.split("/").filter(Boolean).pop() || v.name.toLowerCase().replace(/\s+/g, "-"),
    url: v.url,
    location: v.region || null,
    bedrooms_min: parseBedrooms(v.rents_as || "").min,
    bedrooms_max: parseBedrooms(v.rents_as || "").max,
    price_low: parsePrice(v.price || "").low,
    price_high: parsePrice(v.price || "").high,
    price_currency: parsePrice(v.price || "").currency,
    price_period: v.is_for_sale === 1 ? "sale" : "week",
    listing_type: v.is_for_sale === 1 ? "sale" : "rental",
    images: v.images?.slice(0, 10) || [],
    tagline: v.tagline || null,
    latitude: v.lat ? parseFloat(v.lat) : null,
    longitude: v.lon ? parseFloat(v.lon) : null,
    agency_slug: "sibarth",
    agency_name: "Sibarth Villa Rentals",
    external_id: v.id?.toString(),
  }));
}

// Generic HTML scraper for villa listings
async function scrapeHtmlVillaPage(agency: typeof AGENCIES[0]): Promise<Villa[]> {
  console.log(`Scraping ${agency.name}...`);
  const villas: Villa[] = [];

  try {
    const response = await fetchWithRetry(agency.listUrl!);
    const html = await response.text();

    // Find villa links - common patterns
    const patterns = [
      /href="([^"]*\/villas?\/([^\/?"]+)\/?)"/gi,
      /href="([^"]*\/villa-([^\/?"]+)\/?)"/gi,
      /href="([^"]*\/property\/([^\/?"]+)\/?)"/gi,
      /href="([^"]*\/listing\/([^\/?"]+)\/?)"/gi,
      /href="([^"]*\/vacation-rental\/([^\/?"]+)\/?)"/gi,
    ];

    const seenSlugs = new Set<string>();

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        const slug = match[2];

        if (seenSlugs.has(slug) || !slug || slug.length < 2) continue;
        if (slug.includes("?") || slug.includes("#")) continue;
        seenSlugs.add(slug);

        const fullUrl = url.startsWith("http") ? url : `${agency.baseUrl}${url}`;

        // Get context around the link for metadata
        const linkPos = html.indexOf(match[0]);
        const context = html.substring(Math.max(0, linkPos - 300), Math.min(html.length, linkPos + 1000));

        // Extract name
        const nameMatch = context.match(/<(?:h[2-4]|strong|span[^>]*class="[^"]*title[^"]*")[^>]*>([^<]{2,60})<\//i);
        const name = nameMatch ? nameMatch[1].trim() : slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

        // Extract location
        const location = extractLocation(context);

        // Extract bedrooms
        const bedroomMatch = context.match(/(\d+)\s*(?:bedroom|br|chambre|bed)/i);
        const bedrooms = bedroomMatch ? parseBedrooms(bedroomMatch[0]) : { min: null, max: null };

        // Extract price
        const priceMatch = context.match(/(?:from\s*)?[\$€]([\d,]+)(?:\s*(?:-|to)\s*[\$€]?([\d,]+))?/i);
        const price = priceMatch ? parsePrice(priceMatch[0]) : { low: null, high: null, currency: "USD" };

        // Extract image
        const imgMatch = context.match(/src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
        const images = imgMatch ? [imgMatch[1].startsWith("http") ? imgMatch[1] : `${agency.baseUrl}${imgMatch[1]}`] : [];

        villas.push({
          name,
          slug,
          url: fullUrl,
          location,
          bedrooms_min: bedrooms.min,
          bedrooms_max: bedrooms.max,
          price_low: price.low,
          price_high: price.high,
          price_currency: price.currency,
          price_period: "week",
          listing_type: "rental",
          images,
          agency_slug: agency.slug,
          agency_name: agency.name,
        });
      }
    }
  } catch (e) {
    console.error(`Error scraping ${agency.name}:`, e);
  }

  return villas;
}

// Save villa to database
async function saveVilla(supabase: any, villa: Villa, villaTypeId: string): Promise<boolean> {
  const property = {
    name: villa.name,
    slug: `${villa.agency_slug}-${villa.slug}`.substring(0, 100),
    description: villa.tagline || null,
    tagline: villa.tagline || null,
    property_type_id: villaTypeId,
    property_type: "villa",
    region: villa.location,
    city: villa.location,
    country: "BL",
    latitude: villa.latitude,
    longitude: villa.longitude,
    specs: {
      bedrooms: villa.bedrooms_max || villa.bedrooms_min,
      bedrooms_min: villa.bedrooms_min,
      bedrooms_max: villa.bedrooms_max,
    },
    base_price: villa.price_low,
    price_currency: villa.price_currency,
    price_period: villa.price_period,
    listing_type: villa.listing_type,
    sale_price: villa.listing_type === "sale" ? villa.price_low : null,
    external_id: villa.external_id || `${villa.agency_slug}-${villa.slug}`,
    source_url: villa.url,
    discovered_via: villa.agency_slug,
    search_keywords: [
      villa.name.toLowerCase(),
      "villa",
      villa.agency_slug,
      villa.location?.toLowerCase(),
      "st barth",
      "luxury",
    ].filter(Boolean),
    metadata: {
      project: "lofficiel-concierge",
      agency: villa.agency_name,
      agency_slug: villa.agency_slug,
      scraped_at: new Date().toISOString(),
    },
  };

  // Check for existing
  const { data: existing } = await supabase
    .from("properties")
    .select("id")
    .eq("external_id", property.external_id)
    .single();

  if (existing) {
    // Update
    const { error } = await supabase.from("properties").update(property).eq("id", existing.id);
    return !error;
  } else {
    // Insert
    const { data: newProp, error } = await supabase.from("properties").insert(property).select().single();

    if (error) {
      // Try with modified slug if duplicate
      if (error.message.includes("duplicate")) {
        property.slug = `${property.slug}-${Date.now()}`.substring(0, 100);
        const { data: retry, error: retryError } = await supabase.from("properties").insert(property).select().single();
        if (retryError) return false;
        if (retry && villa.images?.length) {
          await saveImages(supabase, retry.id, villa.images);
        }
        return true;
      }
      return false;
    }

    // Save images
    if (newProp && villa.images?.length) {
      await saveImages(supabase, newProp.id, villa.images);
    }
    return true;
  }
}

async function saveImages(supabase: any, propertyId: string, images: string[]) {
  const imageRecords = images.slice(0, 10).map((url, i) => ({
    property_id: propertyId,
    url,
    sort_order: i,
    is_primary: i === 0,
    category: i === 0 ? "exterior" : "interior",
  }));

  await supabase.from("property_images").insert(imageRecords);
}

// Update progress in database
async function updateProgress(supabase: any, jobId: string, status: any) {
  await supabase.from("discovery_jobs").upsert({
    id: jobId,
    job_type: "villa_discovery",
    status: status.status,
    progress: status,
    updated_at: new Date().toISOString(),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "run";
    const targetAgency = body.agency || null;

    // Get villa type ID
    const { data: villaType } = await supabase
      .from("property_types")
      .select("id")
      .eq("slug", "villa")
      .single();

    if (!villaType) {
      return new Response(JSON.stringify({ error: "Villa type not found" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "status") {
      // Return current progress
      const { data: job } = await supabase
        .from("discovery_jobs")
        .select("*")
        .eq("job_type", "villa_discovery")
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      const { count: totalVillas } = await supabase
        .from("properties")
        .select("*", { count: "exact", head: true })
        .eq("property_type", "villa");

      return new Response(
        JSON.stringify({
          job: job || null,
          total_villas: totalVillas,
          agencies: AGENCIES.map((a) => a.name),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Run discovery
    const jobId = crypto.randomUUID();
    const startTime = Date.now();

    const progress = {
      status: "running",
      job_id: jobId,
      started_at: new Date().toISOString(),
      agencies_total: targetAgency ? 1 : AGENCIES.length,
      agencies_completed: 0,
      villas_found: 0,
      villas_saved: 0,
      villas_updated: 0,
      errors: [] as string[],
      agency_results: {} as Record<string, any>,
    };

    await updateProgress(supabase, jobId, progress);

    // Process each agency
    const agenciesToProcess = targetAgency
      ? AGENCIES.filter((a) => a.slug === targetAgency)
      : AGENCIES;

    for (const agency of agenciesToProcess) {
      try {
        console.log(`Processing ${agency.name}...`);

        let villas: Villa[] = [];

        if (agency.slug === "sibarth") {
          villas = await scrapeSibarth();
        } else if (agency.type === "html_scrape") {
          villas = await scrapeHtmlVillaPage(agency);
        }

        progress.villas_found += villas.length;
        progress.agency_results[agency.slug] = {
          name: agency.name,
          found: villas.length,
          saved: 0,
          errors: 0,
        };

        // Save villas
        for (const villa of villas) {
          const saved = await saveVilla(supabase, villa, villaType.id);
          if (saved) {
            progress.villas_saved++;
            progress.agency_results[agency.slug].saved++;
          } else {
            progress.agency_results[agency.slug].errors++;
          }
        }

        progress.agencies_completed++;
        await updateProgress(supabase, jobId, progress);

        // Rate limit between agencies
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e: any) {
        console.error(`Error with ${agency.name}:`, e);
        progress.errors.push(`${agency.name}: ${e.message}`);
        progress.agencies_completed++;
        await updateProgress(supabase, jobId, progress);
      }
    }

    // Complete
    progress.status = "completed";
    progress.completed_at = new Date().toISOString();
    progress.duration_seconds = Math.round((Date.now() - startTime) / 1000);

    await updateProgress(supabase, jobId, progress);

    // Get final count
    const { count: totalVillas } = await supabase
      .from("properties")
      .select("*", { count: "exact", head: true })
      .eq("property_type", "villa");

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        total_villas_in_db: totalVillas,
        ...progress,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
