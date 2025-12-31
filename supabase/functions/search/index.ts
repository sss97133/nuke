import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SearchResultType =
  | "vehicle"
  | "organization"
  | "user"
  | "image"
  | "source"
  | "document"
  | "timeline_event"
  | "reference"
  | "shop"
  | "part"
  | "auction"
  | "status";

type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  description: string;
  metadata: Record<string, unknown> | null;
  relevance_score: number;
  location?: { lat: number; lng: number; address?: string };
  image_url?: string;
  created_at: string;
};

type SearchResponse = {
  results: SearchResult[];
  sections: {
    vehicles: SearchResult[];
    organizations: SearchResult[];
    users: SearchResult[];
    images: SearchResult[];
    sources: SearchResult[];
  };
  search_summary: string;
  answer?: {
    text: string;
    citations: Array<{ type: SearchResultType; id: string }>;
  };
  debug?: Record<string, unknown>;
};

function escapeILike(s: string): string {
  return String(s || "").replace(/([%_\\])/g, "\\$1");
}

function normalizeQuery(q: string): string {
  return (q || "").trim();
}

function tokenize(q: string): string[] {
  return (q || "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function looksLikeImageQuery(q: string): boolean {
  const t = (q || "").toLowerCase();
  return /\b(images?|photos?|pictures?)\b/.test(t);
}

function sortOldestFirst(q: string): boolean {
  const t = (q || "").toLowerCase();
  return /\b(oldest|earliest|first)\b/.test(t) && !/\bnewest|latest\b/.test(t);
}

function sortNewestFirst(q: string): boolean {
  const t = (q || "").toLowerCase();
  return /\b(newest|latest|most\s+recent)\b/.test(t) && !/\boldest|earliest\b/.test(t);
}

const MAKE_EXPANSIONS: Record<string, string[]> = {
  porsche: [
    "911",
    "carrera",
    "gt3",
    "turbo",
    "rs",
    "cayman",
    "boxster",
    "taycan",
    "macan",
    "cayenne",
    "panamera",
    "964",
    "993",
    "997",
    "991",
    "992",
    "aircooled",
    "air-cooled",
  ],
};

function expandTerms(terms: string[]): string[] {
  const out = new Set<string>(terms);
  for (const term of terms) {
    const expansions = MAKE_EXPANSIONS[term];
    if (expansions) {
      expansions.forEach((e) => out.add(e.toLowerCase()));
    }
  }
  return Array.from(out);
}

function scoreText(terms: string[], hay: string): number {
  const h = (hay || "").toLowerCase();
  if (!h) return 0;
  let hits = 0;
  for (const t of terms) {
    if (!t) continue;
    if (h.includes(t)) hits += 1;
  }
  if (terms.length === 0) return 0;
  return hits / terms.length;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      authHeader
        ? {
            global: { headers: { Authorization: authHeader } },
          }
        : undefined,
    );

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const queryRaw = normalizeQuery((body as any)?.query ?? (body as any)?.q ?? "");
    const limit = Math.max(1, Math.min(100, Number((body as any)?.limit ?? 50)));

    if (!queryRaw) {
      const empty: SearchResponse = {
        results: [],
        sections: { vehicles: [], organizations: [], users: [], images: [], sources: [] },
        search_summary: "Enter a search query to find vehicles, organizations, users, and images",
      };
      return new Response(JSON.stringify(empty), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const terms = expandTerms(tokenize(queryRaw));
    const safe = escapeILike(queryRaw);

    const wantsImages = looksLikeImageQuery(queryRaw);
    const wantsOldest = sortOldestFirst(queryRaw);
    const wantsNewest = sortNewestFirst(queryRaw);

    const vehicleOrPartsTerms = terms.filter((t) => !["images", "image", "photos", "photo", "pictures", "picture"].includes(t));

    const vehicleOr = vehicleOrPartsTerms
      .slice(0, 10)
      .map((t) => {
        const s = escapeILike(t);
        return `make.ilike.%${s}%,model.ilike.%${s}%,description.ilike.%${s}%`;
      })
      .join(",");

    const vehiclesPromise = supabase
      .from("vehicles")
      .select("id, year, make, model, color, description, created_at, updated_at, is_for_sale, city, state")
      .eq("is_public", true)
      .or(vehicleOr || `make.ilike.%${safe}%,model.ilike.%${safe}%,description.ilike.%${safe}%`)
      .limit(Math.min(60, limit));

    const orgsPromise = supabase
      .from("businesses")
      .select("id, business_name, legal_name, description, city, state, created_at, logo_url")
      .eq("is_public", true)
      .or(`business_name.ilike.%${safe}%,legal_name.ilike.%${safe}%,description.ilike.%${safe}%`)
      .limit(Math.min(40, limit));

    const sourcesPromise = supabase
      .from("source_favicons")
      .select("id, domain, favicon_url, source_type, source_name, created_at")
      .or(`domain.ilike.%${safe}%,source_name.ilike.%${safe}%,source_type.ilike.%${safe}%`)
      .limit(Math.min(20, limit));

    const usersPromise = supabase
      .from("profiles")
      .select("id, username, full_name, bio, avatar_url, created_at")
      .or(`username.ilike.%${safe}%,full_name.ilike.%${safe}%,bio.ilike.%${safe}%`)
      .limit(Math.min(30, limit));

    const imagesPromise = wantsImages
      ? supabase
          .from("vehicle_images")
          .select("id, vehicle_id, image_url, caption, category, taken_at, created_at")
          .or(`caption.ilike.%${safe}%`)
          .limit(Math.min(80, limit))
      : Promise.resolve({ data: [] as any[], error: null as any });

    const [vehiclesRes, orgsRes, usersRes, imagesRes, sourcesRes] = await Promise.all([
      vehiclesPromise,
      orgsPromise,
      usersPromise,
      imagesPromise,
      sourcesPromise,
    ]);

    const vehiclesData = (vehiclesRes.data || []) as any[];
    const orgsData = (orgsRes.data || []) as any[];
    const usersData = (usersRes.data || []) as any[];
    const imagesData = (imagesRes.data || []) as any[];
    const sourcesData = (sourcesRes.data || []) as any[];

    const vehicleIdsForImages = new Set<string>();
    for (const img of imagesData) {
      if (img?.vehicle_id) vehicleIdsForImages.add(String(img.vehicle_id));
    }

    const vehicleLookup: Record<string, any> = {};
    if (vehicleIdsForImages.size > 0) {
      const ids = Array.from(vehicleIdsForImages).slice(0, 100);
      const { data: v2 } = await supabase
        .from("vehicles")
        .select("id, year, make, model")
        .in("id", ids);
      (v2 || []).forEach((v: any) => {
        vehicleLookup[String(v.id)] = v;
      });
    }

    const vehicleResults: SearchResult[] = vehiclesData.map((v: any) => {
      const title = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || "Vehicle";
      const description = v.description || `${v.color ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || "";
      const base = scoreText(terms, `${title} ${description}`);
      const makeBoost = terms.includes(String(v.make || "").toLowerCase()) ? 0.15 : 0;
      const modelBoost = vehicleOrPartsTerms.some((t) => String(v.model || "").toLowerCase().includes(t)) ? 0.1 : 0;
      return {
        id: String(v.id),
        type: "vehicle",
        title,
        description,
        metadata: {
          year: v.year,
          make: v.make,
          model: v.model,
          color: v.color,
          for_sale: v.is_for_sale,
        },
        relevance_score: clamp01(base + makeBoost + modelBoost),
        created_at: v.updated_at || v.created_at,
      };
    });

    const sourceResults: SearchResult[] = sourcesData.map((s: any) => {
      const domain = String(s.domain || "").trim();
      const title = s.source_name || domain || "Source";
      const description = s.source_type || domain || "Source";
      const base = scoreText(terms, `${title} ${description} ${domain}`);
      const exactBoost = terms.includes(domain.toLowerCase()) ? 0.2 : 0;
      return {
        id: String(s.id),
        type: "source",
        title,
        description,
        metadata: {
          domain,
          url: domain ? `https://${domain}` : null,
          source_type: s.source_type,
          source_name: s.source_name,
        },
        relevance_score: clamp01(base + 0.1 + exactBoost),
        image_url: s.favicon_url || undefined,
        created_at: s.created_at || new Date().toISOString(),
      };
    });

    const orgResults: SearchResult[] = orgsData.map((o: any) => {
      const title = o.business_name || o.legal_name || "Organization";
      const description = o.description || `${o.city ?? ""}${o.state ? `, ${o.state}` : ""}`.trim();
      const base = scoreText(terms, `${title} ${description}`);
      return {
        id: String(o.id),
        type: "organization",
        title,
        description,
        metadata: {
          business_name: o.business_name,
          legal_name: o.legal_name,
          city: o.city,
          state: o.state,
        },
        relevance_score: clamp01(base + 0.05),
        image_url: o.logo_url || undefined,
        created_at: o.created_at,
      };
    });

    const userResults: SearchResult[] = usersData.map((u: any) => {
      const title = u.full_name || u.username || "User";
      const description = u.bio || (u.username ? `@${u.username}` : "");
      const base = scoreText(terms, `${title} ${description}`);
      return {
        id: String(u.id),
        type: "user",
        title,
        description,
        metadata: {
          username: u.username,
          full_name: u.full_name,
        },
        relevance_score: clamp01(base + 0.05),
        image_url: u.avatar_url || undefined,
        created_at: u.created_at,
      };
    });

    const imageResults: SearchResult[] = imagesData.map((img: any) => {
      const v = vehicleLookup[String(img.vehicle_id)] || null;
      const vehicleTitle = v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() : "Vehicle";
      const title = `${vehicleTitle} Image`;
      const description = img.caption || img.category || "Image";
      const base = scoreText(terms, `${title} ${description}`);
      const createdAt = img.taken_at || img.created_at;
      return {
        id: String(img.id),
        type: "image",
        title,
        description,
        metadata: {
          vehicle_id: img.vehicle_id,
          caption: img.caption,
          category: img.category,
          taken_at: img.taken_at,
        },
        relevance_score: clamp01(base + 0.05),
        image_url: img.image_url || undefined,
        created_at: createdAt,
      };
    });

    vehicleResults.sort((a, b) => b.relevance_score - a.relevance_score);
    orgResults.sort((a, b) => b.relevance_score - a.relevance_score);
    userResults.sort((a, b) => b.relevance_score - a.relevance_score);
    sourceResults.sort((a, b) => b.relevance_score - a.relevance_score);

    if (wantsOldest) {
      imageResults.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else if (wantsNewest) {
      imageResults.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else {
      imageResults.sort((a, b) => b.relevance_score - a.relevance_score);
    }

    const sections = {
      vehicles: vehicleResults.slice(0, Math.min(25, limit)),
      organizations: orgResults.slice(0, Math.min(15, limit)),
      users: userResults.slice(0, Math.min(12, limit)),
      images: imageResults.slice(0, Math.min(30, limit)),
      sources: sourceResults.slice(0, Math.min(10, limit)),
    };

    const results: SearchResult[] = [];
    if (wantsImages) {
      results.push(...sections.images);
      results.push(...sections.vehicles.slice(0, 10));
      results.push(...sections.organizations.slice(0, 6));
      results.push(...sections.users.slice(0, 6));
      results.push(...sections.sources.slice(0, 6));
    } else {
      results.push(...sections.vehicles);
      results.push(...sections.organizations);
      results.push(...sections.users);
      results.push(...sections.sources);
      results.push(...sections.images.slice(0, 10));
    }

    const topCitations = results.slice(0, 6).map((r) => ({ type: r.type, id: r.id }));

    const summary = wantsImages
      ? `Found ${results.length} results for "${queryRaw}" (images-first).`
      : `Found ${results.length} results for "${queryRaw}".`;

    const answerText = wantsImages
      ? `Showing images related to your query. Use the results to jump into the vehicle profiles, and refine by adding a part keyword (e.g. "front fender") or a date constraint ("oldest").`
      : `Showing the most relevant vehicles, organizations, and users for your query. Refine by adding a model/trim, year, or location.`;

    const response: SearchResponse = {
      results,
      sections,
      search_summary: summary,
      answer: {
        text: answerText,
        citations: topCitations,
      },
      debug: {
        wantsImages,
        wantsOldest,
        wantsNewest,
        terms,
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("search edge function error", error);
    return new Response(
      JSON.stringify({
        error: error?.message || "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
