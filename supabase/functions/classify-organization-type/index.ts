import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callOpenAiChatCompletions } from "../_shared/openaiChat.ts";

const VALID_ENTITY_TYPES = [
  'collection', 'museum', 'private_foundation',
  'dealer', 'franchise_dealer', 'independent_dealer', 'wholesale_dealer',
  'broker', 'consignment_dealer', 'dealer_group',
  'auction_house', 'online_auction_platform',
  'restoration_shop', 'performance_shop', 'body_shop', 'detailing',
  'storage_facility', 'collection_manager', 'appraiser', 'transporter',
  'garage', 'mobile_service', 'specialty_shop', 'fabrication',
  'manufacturer', 'heritage_division', 'importer_distributor',
  'marque_club', 'club', 'registry', 'concours',
  'marketplace', 'data_platform', 'investment_platform',
  'investment_fund', 'series_llc', 'spv',
  'media', 'racing_team', 'builder', 'parts_supplier',
  'forum', 'developer', 'other', 'uncategorized',
] as const;

type EntityType = typeof VALID_ENTITY_TYPES[number];

/** Rule-based classification for obvious cases. Returns null if AI needed. */
function classifyByRules(org: {
  business_name: string;
  website?: string;
  description?: string;
  metadata?: Record<string, any>;
}): EntityType | null {
  const name = (org.business_name || "").toLowerCase();
  const website = (org.website || "").toLowerCase();
  const desc = (org.description || "").toLowerCase();
  const source = (org.metadata?.source || "").toLowerCase();

  // St. Barth directory entries — not automotive
  if (source === "directory-saintbarth.com") return "uncategorized";

  // SiBarth villas — not automotive
  if (website.includes("sibarth.com")) return "uncategorized";

  // Collection patterns
  if (name.includes("collection") && !name.includes("collision")) return "collection";

  // Auction houses
  if (name.includes("auction") || name.includes("sotheby") || name.includes("bonhams") ||
      name.includes("gooding") || name.includes("mecum") || name.includes("barrett-jackson")) {
    return "auction_house";
  }

  // Online auction platforms
  if (name.includes("bring a trailer") || name.includes("cars & bids") ||
      name.includes("pcarmarket") || name.includes("copart") || name.includes("iaai")) {
    return "online_auction_platform";
  }

  // Marketplaces
  if (name.includes("marketplace") || name.includes("hemmings") ||
      name.includes("autotrader") || name.includes("classiccars.com")) {
    return "marketplace";
  }

  // Dealers
  if (name.includes("motorcars") || name.includes("motor cars") ||
      name.includes("motors") || name.includes("auto sales") ||
      name.includes("car co") || name.includes("automotive group")) {
    return "dealer";
  }

  // Concours / events
  if (name.includes("concours") || name.includes("festival of speed") ||
      name.includes("goodwood") || name.includes("pebble beach") ||
      name.includes("amelia island")) {
    return "concours";
  }

  // Clubs
  if (name.includes("club") || name.includes("enthusiast") ||
      name.includes("owners group")) {
    return "club";
  }

  // Registries
  if (name.includes("registry")) return "registry";

  // Media
  if (name.includes("magazine") || name.includes("podcast") ||
      name.includes("youtube") || name.includes("media")) {
    return "media";
  }

  // Restoration
  if (name.includes("restoration") || name.includes("restorations")) {
    return "restoration_shop";
  }

  // Shops
  if (name.includes("garage") || name.includes("shop") || name.includes("works")) {
    if (desc.includes("restor")) return "restoration_shop";
    if (desc.includes("perform")) return "performance_shop";
    return "garage";
  }

  return null; // needs AI
}

const SYSTEM_PROMPT = `You are a classifier for automotive industry organizations. Given an organization's name, website, and description, classify it into exactly one entity_type.

Valid entity_types:
- collection: Private car collection
- museum: Automotive museum
- dealer: Car dealer/dealership
- auction_house: Traditional auction house (e.g. RM Sotheby's)
- online_auction_platform: Online auction (e.g. Bring a Trailer)
- restoration_shop: Restoration business
- performance_shop: Performance/tuning shop
- body_shop: Body/paint shop
- garage: General automotive shop
- marketplace: Online marketplace
- concours: Concours d'elegance or automotive event
- club: Car club or owners group
- marque_club: Brand-specific club (e.g. Ferrari Club of America)
- registry: Vehicle registry
- manufacturer: Car manufacturer or OEM
- heritage_division: OEM heritage/classic division
- media: Automotive media/publication
- racing_team: Racing team
- builder: Custom car builder
- parts_supplier: Parts supplier
- broker: Vehicle broker
- storage_facility: Vehicle storage
- collection_manager: Collection management service
- appraiser: Vehicle appraiser
- investment_fund: Car investment fund
- uncategorized: Not clearly automotive-related OR insufficient data to classify

Respond with ONLY the entity_type value, nothing else.`;

let _lastAiRaw: any = null;

async function classifyWithAI(
  orgs: Array<{ id: string; business_name: string; website?: string; description?: string }>,
  apiKey: string,
): Promise<Map<string, EntityType>> {
  const results = new Map<string, EntityType>();

  // Batch into groups of 10 for a single prompt
  const prompt = orgs.map((o, i) =>
    `${i + 1}. Name: "${o.business_name}"${o.website ? ` | Website: ${o.website}` : ""}${o.description ? ` | Desc: ${o.description.slice(0, 200)}` : ""}`
  ).join("\n");

  const userMsg = `Classify each organization below. Return one entity_type per line, numbered to match:\n\n${prompt}`;

  const res = await callOpenAiChatCompletions({
    apiKey,
    body: {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: 0,
      max_tokens: 500,
    },
    timeoutMs: 30000,
  });

  _lastAiRaw = { ok: res.ok, status: res.status, content_text: res.content_text?.slice(0, 500), raw_error: res.raw?.error };

  if (!res.ok || !res.content_text) {
    return results;
  }

  const lines = res.content_text.trim().split("\n");
  for (const line of lines) {
    // Match "1. dealer" or "1. dealer" or just "dealer" for single-item lists
    const match = line.match(/^(\d+)[\.\)]\s*(.+)/);
    if (!match) {
      // Try matching just a bare entity_type on its own line
      const bare = line.trim();
      if (orgs.length === 1 && (VALID_ENTITY_TYPES as readonly string[]).includes(bare)) {
        results.set(orgs[0].id, bare as EntityType);
      }
      continue;
    }
    const idx = parseInt(match[1]) - 1;
    const entityType = match[2].trim().replace(/[^a-z_]/g, '') as EntityType;
    if (idx >= 0 && idx < orgs.length && (VALID_ENTITY_TYPES as readonly string[]).includes(entityType)) {
      results.set(orgs[idx].id, entityType);
    }
  }

  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const limit = body.limit ?? 50;
    const dryRun = body.dry_run ?? false;
    const skipAi = body.skip_ai ?? false;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Fetch "other" records
    const { data: orgs, error: fetchErr } = await supabase
      .from("organizations")
      .select("id, business_name, website, description, metadata")
      .eq("entity_type", "other")
      .limit(limit);

    if (fetchErr) throw fetchErr;
    if (!orgs || orgs.length === 0) {
      return new Response(JSON.stringify({ message: "No 'other' records remaining", classified: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let ruleClassified = 0;
    let aiClassified = 0;
    let unchanged = 0;
    const needsAi: typeof orgs = [];
    const updates: Array<{ id: string; entity_type: EntityType }> = [];

    // Phase 1: Rule-based classification
    for (const org of orgs) {
      const result = classifyByRules(org);
      if (result) {
        updates.push({ id: org.id, entity_type: result });
        ruleClassified++;
      } else {
        needsAi.push(org);
      }
    }

    // Phase 2: AI classification for remaining
    let aiDebug: any = null;
    if (needsAi.length > 0 && !skipAi) {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (openaiKey) {
        // Process in chunks of 10
        for (let i = 0; i < needsAi.length; i += 10) {
          const chunk = needsAi.slice(i, i + 10);
          const aiResults = await classifyWithAI(chunk, openaiKey);
          if (i === 0) {
            // Capture debug info from first chunk
            aiDebug = { chunk_size: chunk.length, results_size: aiResults.size, first_names: chunk.map(c => c.business_name) };
          }
          for (const [id, entityType] of aiResults) {
            updates.push({ id, entity_type: entityType });
            aiClassified++;
          }
        }
      } else {
        aiDebug = { error: "OPENAI_API_KEY not found" };
      }
    }

    unchanged = orgs.length - updates.length;

    // Phase 3: Apply updates
    let applied = 0;
    const errors: string[] = [];

    if (!dryRun) {
      for (const upd of updates) {
        const { error: updErr } = await supabase
          .from("organizations")
          .update({ entity_type: upd.entity_type })
          .eq("id", upd.id);

        if (updErr) {
          errors.push(`${upd.id}: ${updErr.message}`);
        } else {
          applied++;
        }
      }
    }

    // Summary
    const summary = {
      total_processed: orgs.length,
      rule_classified: ruleClassified,
      ai_classified: aiClassified,
      unchanged,
      applied: dryRun ? 0 : applied,
      errors: errors.length,
      error_details: errors.slice(0, 5),
      dry_run: dryRun,
      ai_debug: aiDebug,
      ai_raw: _lastAiRaw,
      sample_classifications: updates.slice(0, 10).map(u => ({
        id: u.id,
        entity_type: u.entity_type,
        name: orgs.find(o => o.id === u.id)?.business_name,
      })),
    };

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
