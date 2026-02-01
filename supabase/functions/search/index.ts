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

function sanitizeForFts(q: string): string {
  // Keep this conservative to avoid tsquery syntax issues caused by punctuation.
  return String(q || "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(q: string): string[] {
  return (q || "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function looksLikeUuid(q: string): boolean {
  const t = (q || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
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

// Model names by make - used to detect when user specifies a model
// Also used to identify vehicle-related searches vs organization searches
const MAKE_MODELS: Record<string, string[]> = {
  porsche: [
    "911", "carrera", "gt3", "turbo", "rs", "cayman", "boxster",
    "taycan", "macan", "cayenne", "panamera", "964", "993", "997", "991", "992",
  ],
  chevrolet: ["c10", "camaro", "corvette", "impala", "chevelle", "nova", "bel air", "silverado", "blazer"],
  chevy: ["c10", "camaro", "corvette", "impala", "chevelle", "nova", "bel air", "silverado", "blazer"],
  ford: ["mustang", "bronco", "f100", "f150", "gt", "thunderbird", "falcon", "f250", "ranger"],
  bmw: ["m3", "m5", "2002", "e30", "e36", "e46", "e90", "z3", "z4", "m4", "m2"],
  mercedes: ["sl", "amg", "s-class", "g-wagon", "c-class", "e-class", "190e", "300sl"],
  ferrari: ["testarossa", "308", "328", "348", "355", "360", "430", "458", "488", "f40", "f50"],
  lamborghini: ["countach", "diablo", "murcielago", "gallardo", "huracan", "aventador"],
  audi: ["r8", "rs", "quattro", "tt", "s4", "s5", "s6"],
  toyota: ["supra", "land cruiser", "4runner", "tacoma", "celica", "mr2"],
  nissan: ["240z", "280z", "300zx", "skyline", "gtr", "370z"],
  dodge: ["challenger", "charger", "viper", "cuda", "demon", "hellcat"],
  plymouth: ["cuda", "barracuda", "roadrunner", "gtx", "satellite"],
  pontiac: ["gto", "firebird", "trans am", "tempest", "lemans"],
  jaguar: ["e-type", "xke", "xj", "xjs", "f-type"],
  aston: ["db5", "db9", "vantage", "vanquish"],
  maserati: ["ghibli", "quattroporte", "granturismo"],
  cadillac: ["eldorado", "deville", "escalade", "ct5", "cts"],
  lincoln: ["continental", "navigator", "mkz"],
  buick: ["riviera", "grand national", "skylark", "regal"],
  oldsmobile: ["442", "cutlass", "toronado"],
  datsun: ["240z", "280z", "510", "fairlady"],
  honda: ["s2000", "nsx", "civic", "accord", "prelude"],
  mazda: ["rx7", "rx8", "miata", "mx5"],
};

// Check if any model from a make is already in the query
function queryHasModelForMake(terms: string[], make: string): boolean {
  const models = MAKE_MODELS[make];
  if (!models) return false;
  return terms.some(t => models.includes(t));
}

function expandTerms(terms: string[]): string[] {
  // Don't expand if user already specified a model - respect their intent
  // e.g., "porsche 911" should NOT expand to include boxster, cayenne, etc.
  const out = new Set<string>(terms);

  for (const term of terms) {
    const models = MAKE_MODELS[term];
    if (models && !queryHasModelForMake(terms, term)) {
      // Only expand make to models if user didn't specify a model
      // This helps single-term searches like "porsche" find more results
      models.forEach((m) => out.add(m.toLowerCase()));
    }
  }
  return Array.from(out);
}

function scoreText(terms: string[], hay: string): number {
  const h = (hay || "").toLowerCase();
  if (!h || terms.length === 0) return 0;

  let hits = 0;
  let misses = 0;
  for (const t of terms) {
    if (!t) continue;
    if (h.includes(t)) {
      hits += 1;
    } else {
      misses += 1;
    }
  }

  if (terms.length === 0) return 0;

  // Penalize missing terms more heavily
  // All terms match: 1.0, missing 1 of 2: 0.25, missing 1 of 3: 0.44
  // This ensures "porsche 911" ranks 911s much higher than Boxsters
  const matchRatio = hits / terms.length;
  const penalty = misses > 0 ? Math.pow(0.5, misses) : 1;
  return matchRatio * penalty;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function normalizeRelevance(rows: Array<{ relevance?: number | null }>): number {
  let max = 0;
  for (const r of rows) {
    const v = Number(r?.relevance ?? 0);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max > 0 ? max : 1;
}

function dedupeMergeById(primary: any[], secondary: any[]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  for (const r of primary || []) {
    const id = r?.id ? String(r.id) : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  for (const r of secondary || []) {
    const id = r?.id ? String(r.id) : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || null;
    const isAnonRequest = !authHeader;

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

    // Fast-path: if query is a UUID, treat it as an entity ID lookup (most commonly vehicle IDs).
    // This makes URLs like `/search?q=<vehicle_uuid>` "just work" without relying on text matching.
    if (looksLikeUuid(queryRaw)) {
      try {
        let vq = supabase
          .from("vehicles")
          .select("id, year, make, model, color, description, created_at, updated_at, is_for_sale, city, state")
          .eq("id", queryRaw)
          .limit(1);

        // Be conservative for anon calls; RLS should enforce this anyway, but this avoids surprises.
        if (isAnonRequest) {
          vq = vq.eq("is_public", true);
        }

        const { data: v, error: vErr } = await vq.maybeSingle();
        if (!vErr && v?.id) {
          // Grab a primary/first image if available (best-effort).
          let imageUrl: string | null = null;
          try {
            const { data: img } = await supabase
              .from("vehicle_images")
              .select("image_url, variants, thumbnail_url, medium_url, is_primary, position, created_at")
              .eq("vehicle_id", v.id)
              .order("is_primary", { ascending: false })
              .order("position", { ascending: true })
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle();

            const variants = (img as any)?.variants as any;
            imageUrl =
              (variants?.thumbnail as string | undefined) ||
              ((img as any)?.thumbnail_url as string | undefined) ||
              (variants?.medium as string | undefined) ||
              ((img as any)?.medium_url as string | undefined) ||
              ((img as any)?.image_url as string | undefined) ||
              null;
          } catch {
            // ignore
          }

          const title = `${(v as any).year ?? ""} ${(v as any).make ?? ""} ${(v as any).model ?? ""}`.trim() || "Vehicle";
          const description =
            (v as any).description ||
            `${(v as any).color ?? ""} ${(v as any).make ?? ""} ${(v as any).model ?? ""}`.trim() ||
            "";

          const vehicleResult: SearchResult = {
            id: String(v.id),
            type: "vehicle",
            title,
            description,
            metadata: {
              year: (v as any).year ?? null,
              make: (v as any).make ?? null,
              model: (v as any).model ?? null,
              color: (v as any).color ?? null,
              for_sale: (v as any).is_for_sale ?? null,
              city: (v as any).city ?? undefined,
              state: (v as any).state ?? undefined,
              match_reason: "id",
              matched_query: queryRaw,
            },
            relevance_score: 1,
            image_url: imageUrl || undefined,
            created_at: (v as any).updated_at || (v as any).created_at || new Date().toISOString(),
          };

          const response: SearchResponse = {
            results: [vehicleResult],
            sections: { vehicles: [vehicleResult], organizations: [], users: [], images: [], sources: [] },
            search_summary: `Found 1 result for "${queryRaw}".`,
            answer: {
              text: "Found a vehicle profile matching that ID.",
              citations: [{ type: "vehicle", id: String(v.id) }],
            },
            debug: { fast_path: "uuid_vehicle_id" },
          };

          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {
        // ignore and fall through to normal search
      }
    }

    const terms = expandTerms(tokenize(queryRaw));
    const safe = escapeILike(queryRaw);

    const isSingleTokenQuery = tokenize(queryRaw).length === 1;
    const isMakeOnlyQuery = isSingleTokenQuery && !looksLikeImageQuery(queryRaw);
    const vehicleFetchLimit = isMakeOnlyQuery ? 60 : Math.min(60, limit);

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

    // Always fetch sources; these are small + public.
    const sourcesPromise = supabase
      .from("source_favicons")
      .select("id, domain, favicon_url, source_type, source_name, created_at")
      .or(`domain.ilike.%${safe}%,source_name.ilike.%${safe}%,source_type.ilike.%${safe}%`)
      .limit(Math.min(20, limit));

    const imagesPromise = wantsImages
      ? supabase
          .from("vehicle_images")
          .select("id, vehicle_id, image_url, caption, category, taken_at, created_at")
          .not("vehicle_id", "is", null)
          .or(`caption.ilike.%${safe}%`)
          .limit(Math.min(80, limit))
      : Promise.resolve({ data: [] as any[], error: null as any });

    let vehiclesData: any[] = [];
    let orgsData: any[] = [];
    let usersData: any[] = [];

    // Prefer full-text search if available.
    let usedFts = false;
    let usedFuzzyVehicles = false;
    let usedFuzzyBusinesses = false;
    let usedFuzzyProfiles = false;
    try {
      const { data: tsq, error: tsqError } = await supabase.rpc("convert_to_tsquery", {
        input_text: sanitizeForFts(queryRaw),
      });

      const tsquery = String(tsq || "").trim();
      if (!tsqError && tsquery) {
        const [vFts, bFts, pFts] = await Promise.all([
          supabase.rpc("search_vehicles_fulltext", {
            query_text: tsquery,
            limit_count: vehicleFetchLimit,
          }),
          supabase.rpc("search_businesses_fulltext", {
            query_text: tsquery,
            limit_count: Math.min(40, limit),
          }),
          isAnonRequest
            ? Promise.resolve({ data: [] as any[], error: null as any })
            : supabase.rpc("search_profiles_fulltext", {
                query_text: tsquery,
                limit_count: Math.min(30, limit),
              }),
        ]);

        if (!vFts.error && !bFts.error && !pFts.error) {
          vehiclesData = (vFts.data || []) as any[];
          orgsData = (bFts.data || []) as any[];
          usersData = (pFts.data || []) as any[];
          usedFts = true;
        }
      }
    } catch {
      // ignore
    }

    // Fallback to ilike search if FTS isn't available.
    if (!usedFts) {
      const vehiclesPromise = supabase
        .from("vehicles")
        .select("id, year, make, model, color, description, created_at, updated_at, is_for_sale, city, state")
        .eq("is_public", true)
        .or(vehicleOr || `make.ilike.%${safe}%,model.ilike.%${safe}%,description.ilike.%${safe}%`)
        .limit(vehicleFetchLimit);

      const orgsPromise = supabase
        .from("businesses")
        .select("id, business_name, legal_name, description, city, state, created_at, logo_url")
        .eq("is_public", true)
        .or(`business_name.ilike.%${safe}%,legal_name.ilike.%${safe}%,description.ilike.%${safe}%`)
        .limit(Math.min(40, limit));

      const usersPromise = isAnonRequest
        ? Promise.resolve({ data: [] as any[], error: null as any })
        : supabase
            .from("profiles")
            .select("id, username, full_name, bio, avatar_url, created_at")
            .or(`username.ilike.%${safe}%,full_name.ilike.%${safe}%,bio.ilike.%${safe}%`)
            .limit(Math.min(30, limit));

      const [vehiclesRes, orgsRes, usersRes] = await Promise.all([
        vehiclesPromise,
        orgsPromise,
        usersPromise,
      ]);

      vehiclesData = (vehiclesRes.data || []) as any[];
      orgsData = (orgsRes.data || []) as any[];
      usersData = (usersRes.data || []) as any[];
    }

    // Fuzzy fallback (pg_trgm): after baseline retrieval (FTS or ilike), widen if sparse.
    // This is intentionally conservative to keep latency low.
    try {
      const minVehicles = 8;
      const minBusinesses = 6;
      const minProfiles = 5;

      const needsVehicles = vehiclesData.length < minVehicles;
      const needsBusinesses = orgsData.length < minBusinesses;
      const needsProfiles = !isAnonRequest && usersData.length < minProfiles;

      if (needsVehicles || needsBusinesses || needsProfiles) {
        const [vFuzzy, bFuzzy, pFuzzy] = await Promise.all([
          needsVehicles
            ? supabase.rpc("search_vehicles_fuzzy", {
                query_text: queryRaw,
                limit_count: vehicleFetchLimit,
              })
            : Promise.resolve({ data: [] as any[], error: null as any }),
          needsBusinesses
            ? supabase.rpc("search_businesses_fuzzy", {
                query_text: queryRaw,
                limit_count: Math.min(40, limit),
              })
            : Promise.resolve({ data: [] as any[], error: null as any }),
          needsProfiles
            ? supabase.rpc("search_profiles_fuzzy", {
                query_text: queryRaw,
                limit_count: Math.min(30, limit),
              })
            : Promise.resolve({ data: [] as any[], error: null as any }),
        ]);

        if (needsVehicles && !vFuzzy.error && (vFuzzy.data || []).length > 0) {
          vehiclesData = dedupeMergeById(vehiclesData, vFuzzy.data as any[]);
          usedFuzzyVehicles = true;
        }
        if (needsBusinesses && !bFuzzy.error && (bFuzzy.data || []).length > 0) {
          orgsData = dedupeMergeById(orgsData, bFuzzy.data as any[]);
          usedFuzzyBusinesses = true;
        }
        if (needsProfiles && !pFuzzy.error && (pFuzzy.data || []).length > 0) {
          usersData = dedupeMergeById(usersData, pFuzzy.data as any[]);
          usedFuzzyProfiles = true;
        }
      }
    } catch {
      // ignore
    }

    const [imagesRes, sourcesRes] = await Promise.all([
      imagesPromise,
      sourcesPromise,
    ]);

    const imagesData = (imagesRes.data || []) as any[];
    const sourcesData = (sourcesRes.data || []) as any[];

    const vehicleIds = Array.from(
      new Set((vehiclesData || []).map((v: any) => (v?.id ? String(v.id) : "")).filter(Boolean)),
    ).slice(0, 120);

    const vehicleMetaById: Record<string, any> = {};
    if (vehicleIds.length > 0) {
      const { data: vMeta } = await supabase
        .from("vehicles")
        .select("id, city, state, is_for_sale")
        .in("id", vehicleIds);
      (vMeta || []).forEach((v: any) => {
        vehicleMetaById[String(v.id)] = v;
      });
    }

    const vehicleImageById: Record<string, string> = {};
    if (vehicleIds.length > 0) {
      const { data: vImgs } = await supabase
        .from("vehicle_images")
        .select("vehicle_id, image_url, variants, thumbnail_url, medium_url, is_primary, position, created_at")
        .in("vehicle_id", vehicleIds)
        .order("is_primary", { ascending: false })
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });

      for (const img of vImgs || []) {
        const vid = img?.vehicle_id ? String(img.vehicle_id) : "";
        if (!vid || vehicleImageById[vid]) continue;

        const variants = (img as any)?.variants as any;
        const candidate =
          (variants?.thumbnail as string | undefined) ||
          ((img as any)?.thumbnail_url as string | undefined) ||
          (variants?.medium as string | undefined) ||
          ((img as any)?.medium_url as string | undefined) ||
          ((img as any)?.image_url as string | undefined);

        if (candidate) vehicleImageById[vid] = candidate;
      }
    }

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

    const vehiclesMaxRel = normalizeRelevance(vehiclesData);
    const vehicleResults: SearchResult[] = vehiclesData.map((v: any) => {
      const vMeta = vehicleMetaById[String(v.id)] || null;
      const title = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || "Vehicle";
      const description = v.description || `${v.color ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || "";
      const baseText = scoreText(terms, `${title} ${description}`);
      const baseFts = usedFts ? clamp01(Number(v.relevance ?? 0) / vehiclesMaxRel) : 0;
      const makeBoost = terms.includes(String(v.make || "").toLowerCase()) ? 0.15 : 0;
      const modelBoost = vehicleOrPartsTerms.some((t) => String(v.model || "").toLowerCase().includes(t)) ? 0.1 : 0;
      // Penalize if search terms only appear in description (not title)
      // e.g. "mecum" should rank "Mecum Auctions" org above a car that merely "was sold at Mecum"
      const titleScore = scoreText(terms, title);
      const descOnlyPenalty = titleScore === 0 && baseText > 0 ? 0.6 : 1; // 40% penalty for desc-only matches
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
          for_sale: vMeta?.is_for_sale ?? v.is_for_sale,
          city: vMeta?.city ?? undefined,
          state: vMeta?.state ?? undefined,
          fts_relevance: usedFts ? v.relevance : undefined,
        },
        relevance_score: clamp01(((usedFts ? baseFts : baseText) + (usedFts ? 0.15 * baseText : 0) + makeBoost + modelBoost) * descOnlyPenalty),
        image_url: vehicleImageById[String(v.id)] || undefined,
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

    const orgsMaxRel = normalizeRelevance(orgsData);
    const orgResults: SearchResult[] = orgsData.map((o: any) => {
      const title = o.business_name || o.legal_name || "Organization";
      const description = o.description || `${o.city ?? ""}${o.state ? `, ${o.state}` : ""}`.trim();
      const baseText = scoreText(terms, `${title} ${description}`);
      const baseFts = usedFts ? clamp01(Number(o.relevance ?? 0) / orgsMaxRel) : 0;
      // Boost when search terms match the org name (not just description)
      const titleScore = scoreText(terms, title);
      const titleMatchBoost = titleScore > 0 ? 0.25 : 0;
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
          fts_relevance: usedFts ? o.relevance : undefined,
        },
        relevance_score: clamp01((usedFts ? baseFts : baseText) + (usedFts ? 0.15 * baseText : 0) + 0.05 + titleMatchBoost),
        image_url: o.logo_url || undefined,
        created_at: o.created_at,
      };
    });

    const usersMaxRel = normalizeRelevance(usersData);
    const userResults: SearchResult[] = usersData.map((u: any) => {
      const title = u.full_name || u.username || "User";
      const description = u.bio || (u.username ? `@${u.username}` : "");
      const baseText = scoreText(terms, `${title} ${description}`);
      const baseFts = usedFts ? clamp01(Number(u.relevance ?? 0) / usersMaxRel) : 0;
      return {
        id: String(u.id),
        type: "user",
        title,
        description,
        metadata: {
          username: u.username,
          full_name: u.full_name,
          fts_relevance: usedFts ? u.relevance : undefined,
        },
        relevance_score: clamp01((usedFts ? baseFts : baseText) + (usedFts ? 0.15 * baseText : 0) + 0.05),
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
      vehicles: vehicleResults.slice(0, isMakeOnlyQuery ? 60 : Math.min(25, limit)),
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

    // Final sort by relevance so high-scoring results appear first
    // When scores tie, context matters:
    // - For make/model searches (e.g. "mustang", "bmw"), prefer vehicles
    // - For other searches (e.g. "mecum", company names), prefer organizations
    const knownMakes = Object.keys(MAKE_MODELS);
    const allModels = Object.values(MAKE_MODELS).flat();
    const isVehicleSearch = terms.some(t =>
      knownMakes.includes(t) ||
      allModels.includes(t) ||
      /^\d{4}$/.test(t) // Year
    );

    const typeOrderVehicleFirst: Record<string, number> = { vehicle: 0, organization: 1, user: 2, source: 3, image: 4 };
    const typeOrderOrgFirst: Record<string, number> = { organization: 0, user: 1, source: 2, vehicle: 3, image: 4 };
    const typeOrder = isVehicleSearch ? typeOrderVehicleFirst : typeOrderOrgFirst;

    results.sort((a, b) => {
      const scoreDiff = b.relevance_score - a.relevance_score;
      if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
      return (typeOrder[a.type] ?? 5) - (typeOrder[b.type] ?? 5);
    });

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
        usedFts,
        usedFuzzyVehicles,
        usedFuzzyBusinesses,
        usedFuzzyProfiles,
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
