import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// One agency per invocation to avoid timeouts
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
    listUrl: "https://www.stbarthproperties.com/st-barthelemy-villa-rentals/",
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
    slug: "eden-rock",
    name: "Eden Rock Villa Rental",
    baseUrl: "https://www.edenrockvillarental.com",
    listUrl: "https://www.edenrockvillarental.com/search/",
    type: "html_scrape",
  },
  {
    slug: "villadenise",
    name: "Villa Denise",
    baseUrl: "https://www.villadenise.com",
    listUrl: "https://www.villadenise.com/st-barth-villas/",
    type: "html_scrape",
  },
  {
    slug: "isabelle",
    name: "Peg Walsh/Isabelle",
    baseUrl: "https://www.stbarth.com",
    listUrl: "https://www.stbarth.com/villas/",
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

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept": "text/html,application/json,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
        },
      });
      if (response.ok || response.status === 404) return response;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Failed: ${url}`);
}

function parsePrice(priceStr: string): { low: number | null; high: number | null; currency: string } {
  if (!priceStr) return { low: null, high: null, currency: "USD" };
  const cleaned = priceStr.replace(/[,\s]/g, "");
  const currency = cleaned.includes("€") ? "EUR" : "USD";
  const numbers = cleaned.match(/[\d]+/g)?.map((n) => parseInt(n)).filter((n) => !isNaN(n) && n >= 100) || [];
  if (numbers.length === 0) return { low: null, high: null, currency };
  return { low: Math.min(...numbers), high: Math.max(...numbers), currency };
}

function parseBedrooms(str: string): { min: number | null; max: number | null } {
  if (!str) return { min: null, max: null };
  const numbers = str.match(/\d+/g)?.map((n) => parseInt(n)).filter((n) => !isNaN(n) && n < 20) || [];
  if (numbers.length === 0) return { min: null, max: null };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

function extractLocation(text: string): string | null {
  const locations = [
    "St. Jean", "St Jean", "Gustavia", "Colombier", "Flamands", "Lorient",
    "Marigot", "Pointe Milou", "Lurin", "Toiny", "Saline", "Gouverneur",
    "Grand Cul de Sac", "Petit Cul de Sac", "Grand Fond", "Corossol",
    "Vitet", "Anse des Cayes", "Deve", "Mont Jean", "Marigot Bay",
  ];
  for (const loc of locations) {
    if (text.toLowerCase().includes(loc.toLowerCase())) return loc;
  }
  return null;
}

async function scrapeSibarth(): Promise<Villa[]> {
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

async function scrapeHtml(agency: typeof AGENCIES[0]): Promise<Villa[]> {
  const villas: Villa[] = [];
  try {
    const response = await fetchWithRetry(agency.listUrl!);
    if (!response.ok) return villas;
    const html = await response.text();

    const patterns = [
      /href="([^"]*\/villas?\/([^\/?"#]+)\/?)"/gi,
      /href="([^"]*\/villa[-_]([^\/?"#]+)\/?)"/gi,
      /href="([^"]*\/property\/([^\/?"#]+)\/?)"/gi,
      /href="([^"]*\/rental\/([^\/?"#]+)\/?)"/gi,
      /href="([^"]*sbp_villa=([^\/?"#&]+))/gi,
    ];

    const seenSlugs = new Set<string>();
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const url = match[1];
        let slug = match[2];
        if (!slug || slug.length < 2 || seenSlugs.has(slug)) continue;
        slug = slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
        seenSlugs.add(slug);

        const fullUrl = url.startsWith("http") ? url : `${agency.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
        const linkPos = html.indexOf(match[0]);
        const context = html.substring(Math.max(0, linkPos - 300), Math.min(html.length, linkPos + 1000));

        const nameMatch = context.match(/<(?:h[2-4]|strong)[^>]*>([A-Za-z][^<]{2,50})<\//i);
        const name = nameMatch ? nameMatch[1].trim() : slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

        const imgMatch = context.match(/(?:src|data-src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
        const images = imgMatch ? [imgMatch[1].startsWith("http") ? imgMatch[1] : `${agency.baseUrl}${imgMatch[1]}`] : [];

        villas.push({
          name,
          slug,
          url: fullUrl,
          location: extractLocation(context),
          bedrooms_min: parseBedrooms(context).min,
          bedrooms_max: parseBedrooms(context).max,
          price_low: parsePrice(context).low,
          price_high: parsePrice(context).high,
          price_currency: "USD",
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

async function saveVilla(supabase: any, villa: Villa, villaTypeId: string): Promise<{ inserted: boolean; updated: boolean }> {
  const externalId = villa.external_id || `${villa.agency_slug}-${villa.slug}`;

  const property = {
    name: villa.name,
    slug: `${villa.agency_slug}-${villa.slug}`.substring(0, 100).replace(/[^a-z0-9-]/g, "-"),
    tagline: villa.tagline,
    property_type_id: villaTypeId,
    property_type: "villa",
    region: villa.location,
    city: villa.location,
    country: "BL",
    latitude: villa.latitude,
    longitude: villa.longitude,
    specs: { bedrooms_min: villa.bedrooms_min, bedrooms_max: villa.bedrooms_max },
    base_price: villa.price_low,
    price_currency: villa.price_currency,
    price_period: villa.price_period,
    listing_type: villa.listing_type,
    external_id: externalId,
    source_url: villa.url,
    discovered_via: villa.agency_slug,
    search_keywords: [villa.name.toLowerCase(), "villa", villa.agency_slug, villa.location?.toLowerCase(), "st barth"].filter(Boolean),
    metadata: { project: "lofficiel-concierge", agency: villa.agency_name, scraped_at: new Date().toISOString() },
  };

  const { data: existing } = await supabase.from("properties").select("id").eq("external_id", externalId).single();

  if (existing) {
    await supabase.from("properties").update({ ...property, updated_at: new Date().toISOString() }).eq("id", existing.id);
    return { inserted: false, updated: true };
  }

  const { data: newProp, error } = await supabase.from("properties").insert(property).select().single();
  if (error) {
    if (error.message.includes("duplicate")) {
      property.slug = `${property.slug}-${Date.now() % 10000}`;
      const { data: retry } = await supabase.from("properties").insert(property).select().single();
      if (retry && villa.images?.length) {
        await supabase.from("property_images").insert(villa.images.slice(0, 5).map((url, i) => ({
          property_id: retry.id, url, sort_order: i, is_primary: i === 0,
        })));
      }
      return { inserted: !!retry, updated: false };
    }
    return { inserted: false, updated: false };
  }

  if (newProp && villa.images?.length) {
    await supabase.from("property_images").insert(villa.images.slice(0, 5).map((url, i) => ({
      property_id: newProp.id, url, sort_order: i, is_primary: i === 0,
    })));
  }
  return { inserted: true, updated: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const agencySlug = body.agency;

    const { data: villaType } = await supabase.from("property_types").select("id").eq("slug", "villa").single();
    if (!villaType) throw new Error("Villa type not found");

    // If no agency specified, return list
    if (!agencySlug) {
      const { count } = await supabase.from("properties").select("*", { count: "exact", head: true }).eq("property_type", "villa");

      // Get last scrape times
      const { data: jobs } = await supabase
        .from("discovery_jobs")
        .select("*")
        .eq("job_type", "villa_agency_scrape")
        .order("updated_at", { ascending: false })
        .limit(20);

      const lastScrapes: Record<string, string> = {};
      jobs?.forEach((j: any) => {
        if (j.progress?.agency_slug && !lastScrapes[j.progress.agency_slug]) {
          lastScrapes[j.progress.agency_slug] = j.updated_at;
        }
      });

      return new Response(JSON.stringify({
        total_villas: count,
        agencies: AGENCIES.map((a) => ({
          slug: a.slug,
          name: a.name,
          last_scraped: lastScrapes[a.slug] || null,
        })),
        usage: "POST with {\"agency\": \"sibarth\"} to scrape specific agency",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Scrape specific agency
    const agency = AGENCIES.find((a) => a.slug === agencySlug);
    if (!agency) {
      return new Response(JSON.stringify({ error: `Unknown agency: ${agencySlug}`, available: AGENCIES.map((a) => a.slug) }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Scraping ${agency.name}...`);
    const startTime = Date.now();

    let villas: Villa[] = [];
    if (agency.slug === "sibarth") {
      villas = await scrapeSibarth();
    } else {
      villas = await scrapeHtml(agency);
    }

    let inserted = 0, updated = 0;
    for (const villa of villas) {
      const result = await saveVilla(supabase, villa, villaType.id);
      if (result.inserted) inserted++;
      if (result.updated) updated++;
    }

    const jobRecord = {
      id: crypto.randomUUID(),
      job_type: "villa_agency_scrape",
      status: "completed",
      progress: {
        agency_slug: agency.slug,
        agency_name: agency.name,
        villas_found: villas.length,
        inserted,
        updated,
        duration_ms: Date.now() - startTime,
      },
    };
    await supabase.from("discovery_jobs").insert(jobRecord);

    const { count: totalVillas } = await supabase.from("properties").select("*", { count: "exact", head: true }).eq("property_type", "villa");

    return new Response(JSON.stringify({
      success: true,
      agency: agency.name,
      villas_found: villas.length,
      inserted,
      updated,
      total_villas_in_db: totalVillas,
      duration_ms: Date.now() - startTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
