import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getLLMConfig, callLLM } from "../_shared/llmProvider.ts";
import { firecrawlScrape, firecrawlMap } from "../_shared/firecrawl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Types ───────────────────────────────────────────────────────────
interface DiscoveredOrg {
  business_name: string;
  slug: string;
  entity_type: string;
  business_type: string;
  description: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  address: string | null;
  social_links: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface DiscoveredPerson {
  slug: string;
  full_name: string;
  primary_role: string | null;
  org_slug: string | null;
  location: string | null;
  email: string | null;
  phone: string | null;
  social_links: Record<string, unknown>;
  known_for: string[];
  expertise_areas: string[];
  bio: string | null;
}

interface DiscoveredRelationship {
  source_slug: string;
  target_slug: string;
  relationship_type: string;
  territory: string | null;
  is_exclusive: boolean;
  confidence: number;
}

interface DiscoveredBrand {
  org_slug: string;
  brand_name: string;
  authorization_level: string;
  operating_name: string | null;
}

interface DiscoveredRole {
  person_slug: string;
  org_slug: string;
  role_title: string;
  role_type: string;
}

interface EntityGraph {
  organizations: DiscoveredOrg[];
  persons: DiscoveredPerson[];
  relationships: DiscoveredRelationship[];
  brands: DiscoveredBrand[];
  roles: DiscoveredRole[];
}

// ─── Slug helper ─────────────────────────────────────────────────────
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── AI Classification Prompt ────────────────────────────────────────
const SYSTEM_PROMPT = `You are an automotive industry intelligence analyst. Given web content about a company or entity in the collector/luxury car world, extract a structured entity graph.

Return ONLY valid JSON matching this schema (no markdown, no explanation):

{
  "organizations": [{
    "business_name": "string",
    "entity_type": "manufacturer|dealer_group|franchise_dealer|independent_dealer|importer_distributor|auction_house|online_auction_platform|service_shop|restoration_shop|parts_supplier|club_registry|media_publication|racing_team|other",
    "business_type": "manufacturer|dealership|auction_house|marketplace|service_center|parts|media|other",
    "description": "1-2 sentence factual description",
    "website": "url or null",
    "phone": "string or null",
    "email": "string or null",
    "city": "string or null",
    "state": "string or null",
    "country": "2-letter ISO code or null",
    "address": "full street address or null",
    "social_links": {"instagram": "@handle", "facebook": "url", ...},
    "metadata": {"any": "relevant structured data"}
  }],
  "persons": [{
    "full_name": "string",
    "primary_role": "their main job title",
    "org_name": "which org they work for (must match an org in organizations array)",
    "location": "City, State or City, Country",
    "email": "string or null",
    "phone": "string or null",
    "social_links": {"linkedin": "url", "instagram": "@handle", ...},
    "known_for": ["notable facts about them"],
    "expertise_areas": ["domains of expertise"],
    "bio": "1-2 sentence factual bio or null"
  }],
  "relationships": [{
    "source_name": "org name (the one doing the action, e.g. the dealer)",
    "target_name": "org name (the one receiving, e.g. the manufacturer)",
    "relationship_type": "dealer_for|exclusive_dealer_for|service_partner|distributor_for|competes_with|shares_brand_with|collaborates_with|sponsors|consigns_through|sources_from|supplies_to|other",
    "territory": "geographic territory or null",
    "is_exclusive": false,
    "confidence": 0.5
  }],
  "brands": [{
    "org_name": "which dealer/org carries this brand",
    "brand_name": "the brand name",
    "authorization_level": "factory_authorized|exclusive|partner|pre_owned|service_only|aftermarket|consignment",
    "operating_name": "e.g. 'Lamborghini Miami' or null"
  }],
  "roles": [{
    "person_name": "full name (must match a person above)",
    "org_name": "org name (must match an org above)",
    "role_title": "their specific title",
    "role_type": "founder|owner|ceo|executive|staff|sales|service|marketing|advisor|investor|collector|other"
  }]
}

Rules:
- Only include factual data you can see in the content. Do not invent.
- The SEED entity (provided in the prompt) should always be in the organizations array.
- For relationships: source is the org performing the action (dealer sells FOR manufacturer, so dealer is source, manufacturer is target).
- Confidence: 0.9+ = explicitly stated, 0.7-0.89 = strongly implied, 0.5-0.69 = inferred.
- For competitor relationships, both directions should be listed.
- Include ALL people mentioned with roles, even if minimal info.
- Include ALL brands a dealer carries.`;

// ─── Direct fetch fallback (no Firecrawl) ────────────────────────────
async function directFetch(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    // Simple HTML → text: strip tags, decode entities, collapse whitespace
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return null;
  }
}

// ─── Crawl + Classify Pipeline ───────────────────────────────────────
async function crawlAndClassify(
  supabase: ReturnType<typeof createClient>,
  seedUrl: string,
  seedName: string,
  depth: number,
  providedContent?: string,
): Promise<{ graph: EntityGraph; pages_crawled: number; urls_visited: string[] }> {
  const urlsVisited: string[] = [];
  const allContent: string[] = [];

  // If content was provided directly, use it (skip scraping)
  if (providedContent) {
    allContent.push(
      `=== PROVIDED CONTENT about ${seedName} ===\n${providedContent.slice(0, 80000)}`
    );
    urlsVisited.push(seedUrl || "provided-content");
  } else {
    // Phase 1: Try Firecrawl first, fallback to direct fetch
    console.log(`[discover] Scraping seed: ${seedUrl}`);
    let markdown: string | null = null;

    try {
      const seedResult = await firecrawlScrape({
        url: seedUrl,
        formats: ["markdown"],
        onlyMainContent: false,
        waitFor: 3000,
        proxy: "stealth",
      });
      console.log(
        `[discover] Firecrawl result: ok=${seedResult.ok}, success=${seedResult.success}, error=${seedResult.error}, md_len=${seedResult.data?.markdown?.length || 0}`
      );
      markdown = seedResult?.data?.markdown || null;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[discover] Firecrawl failed: ${msg}`);
    }

    // Fallback to direct fetch
    if (!markdown) {
      console.log(`[discover] Firecrawl failed, trying direct fetch...`);
      const text = await directFetch(seedUrl);
      if (text && text.length > 200) {
        markdown = text;
        console.log(
          `[discover] Direct fetch got ${text.length} chars`
        );
      }
    }

    // Check archive for cached content
    if (!markdown) {
      console.log(`[discover] Checking archive for cached content...`);
      const { data: archived } = await supabase
        .from("listing_page_snapshots")
        .select("page_markdown, page_html")
        .eq("page_url", seedUrl)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .single();

      if (archived?.page_markdown) {
        markdown = archived.page_markdown;
        console.log(`[discover] Found archived content: ${markdown.length} chars`);
      }
    }

    if (markdown) {
      allContent.push(
        `=== PAGE: ${seedUrl} ===\n${markdown.slice(0, 15000)}`
      );
      urlsVisited.push(seedUrl);
    }

    // Phase 2: Try to scrape subpages (only if we got the seed page)
    if (markdown && depth > 0) {
      // Try firecrawl map first, fallback to link extraction from seed content
      let relevantLinks: string[] = [];

      try {
        const mapResult = await firecrawlMap(seedUrl, { limit: 100 });
        if (mapResult?.links?.length) {
          const relevantPatterns = [
            /dealer/i, /partner/i, /about/i, /team/i, /contact/i,
            /brand/i, /location/i, /store/i, /showroom/i, /service/i,
            /network/i, /where-to-buy/i, /stockist/i, /authorized/i,
          ];
          relevantLinks = mapResult.links
            .filter((link: string) =>
              relevantPatterns.some((p) => p.test(link)) &&
              !link.includes("#") &&
              !link.match(/\.(jpg|png|gif|pdf|css|js)$/i)
            )
            .slice(0, depth === 1 ? 5 : 12);
        }
      } catch {
        console.log(`[discover] Map failed, extracting links from content`);
      }

      // Fallback: extract URLs from seed markdown
      if (relevantLinks.length === 0) {
        const urlRegex = /https?:\/\/[^\s\)\"'<>]+/g;
        const foundUrls = markdown.match(urlRegex) || [];
        const baseHost = new URL(seedUrl).hostname;
        relevantLinks = foundUrls
          .filter(
            (u) => {
              try {
                return new URL(u).hostname === baseHost;
              } catch {
                return false;
              }
            }
          )
          .filter(
            (u) =>
              /dealer|partner|about|team|contact|brand|location|service/i.test(u)
          )
          .slice(0, 5);
      }

      console.log(`[discover] Scraping ${relevantLinks.length} subpages`);

      for (const link of relevantLinks) {
        await new Promise((r) => setTimeout(r, 800));
        try {
          const text = await directFetch(link);
          if (text && text.length > 200) {
            allContent.push(
              `=== PAGE: ${link} ===\n${text.slice(0, 8000)}`
            );
            urlsVisited.push(link);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[discover] Failed to scrape ${link}: ${msg}`);
        }
      }
    }
  }

  if (allContent.length === 0) {
    return {
      graph: { organizations: [], persons: [], relationships: [], brands: [], roles: [] },
      pages_crawled: 0,
      urls_visited: [],
    };
  }

  // Phase 3: AI classification
  console.log(
    `[discover] Classifying ${allContent.length} pages with AI...`
  );
  const combinedContent = allContent.join("\n\n").slice(0, 80000);

  const userPrompt = `Analyze the following web content about "${seedName}" and extract the complete entity graph.

The SEED entity is: ${seedName} (${seedUrl})

Find ALL:
- Organizations (the seed entity + dealers, partners, competitors, manufacturers, service shops)
- People (founders, executives, sales contacts, key personnel)
- Relationships between organizations (dealer_for, competes_with, service_partner, etc.)
- Brands carried by dealers
- Person-to-org roles

Content to analyze:
${combinedContent}`;

  // Try providers in order
  const providers: Array<["anthropic" | "google" | "openai", string]> = [
    ["anthropic", "claude-3-5-sonnet-20241022"],
    ["openai", "gpt-4o"],
    ["google", "gemini-1.5-flash"],
  ];

  let rawGraph: any = null;
  const providerErrors: string[] = [];
  for (const [provider, model] of providers) {
    try {
      console.log(`[discover] Trying ${provider}/${model}...`);
      const config = await getLLMConfig(supabase, null, provider, model);
      console.log(`[discover] Got config for ${provider}, key exists: ${!!config.apiKey}, key length: ${config.apiKey?.length || 0}`);
      const response = await callLLM(
        config,
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.1, maxTokens: 8000 }
      );

      console.log(`[discover] AI response received, content length: ${response.content?.length || 0}`);

      // Parse JSON from response
      let content = response.content.trim();
      // Strip markdown code fences if present
      if (content.startsWith("```")) {
        content = content.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      rawGraph = JSON.parse(content);
      console.log(
        `[discover] AI classified via ${provider}/${model}: ${rawGraph.organizations?.length || 0} orgs, ${rawGraph.persons?.length || 0} persons`
      );
      break;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      providerErrors.push(`${provider}/${model}: ${msg}`);
      console.warn(`[discover] ${provider}/${model} failed: ${msg}`);
    }
  }

  if (!rawGraph) {
    throw new Error(`All AI providers failed: ${providerErrors.join(" | ")}`);
  }

  // Phase 4: Normalize names → slugs
  const orgNameToSlug = new Map<string, string>();
  const personNameToSlug = new Map<string, string>();

  const orgs: DiscoveredOrg[] = (rawGraph.organizations || []).map(
    (o: any) => {
      const slug = slugify(o.business_name);
      orgNameToSlug.set(o.business_name, slug);
      return {
        business_name: o.business_name,
        slug,
        entity_type: o.entity_type || "other",
        business_type: o.business_type || "other",
        description: o.description || "",
        website: o.website || null,
        phone: o.phone || null,
        email: o.email || null,
        city: o.city || null,
        state: o.state || null,
        country: o.country || null,
        address: o.address || null,
        social_links: o.social_links || {},
        metadata: o.metadata || {},
      };
    }
  );

  const persons: DiscoveredPerson[] = (rawGraph.persons || []).map(
    (p: any) => {
      const slug = slugify(p.full_name);
      personNameToSlug.set(p.full_name, slug);
      const orgSlug = p.org_name ? orgNameToSlug.get(p.org_name) || slugify(p.org_name) : null;
      return {
        slug,
        full_name: p.full_name,
        primary_role: p.primary_role || null,
        org_slug: orgSlug,
        location: p.location || null,
        email: p.email || null,
        phone: p.phone || null,
        social_links: p.social_links || {},
        known_for: p.known_for || [],
        expertise_areas: p.expertise_areas || [],
        bio: p.bio || null,
      };
    }
  );

  const relationships: DiscoveredRelationship[] = (
    rawGraph.relationships || []
  ).map((r: any) => ({
    source_slug:
      orgNameToSlug.get(r.source_name) || slugify(r.source_name || ""),
    target_slug:
      orgNameToSlug.get(r.target_name) || slugify(r.target_name || ""),
    relationship_type: r.relationship_type || "other",
    territory: r.territory || null,
    is_exclusive: r.is_exclusive || false,
    confidence: r.confidence ?? 0.5,
  }));

  const brands: DiscoveredBrand[] = (rawGraph.brands || []).map((b: any) => ({
    org_slug: orgNameToSlug.get(b.org_name) || slugify(b.org_name || ""),
    brand_name: b.brand_name,
    authorization_level: b.authorization_level || "factory_authorized",
    operating_name: b.operating_name || null,
  }));

  const roles: DiscoveredRole[] = (rawGraph.roles || []).map((r: any) => ({
    person_slug:
      personNameToSlug.get(r.person_name) || slugify(r.person_name || ""),
    org_slug: orgNameToSlug.get(r.org_name) || slugify(r.org_name || ""),
    role_title: r.role_title,
    role_type: r.role_type || "staff",
  }));

  return {
    graph: { organizations: orgs, persons, relationships, brands, roles },
    pages_crawled: urlsVisited.length,
    urls_visited: urlsVisited,
  };
}

// ─── Persist to Database ─────────────────────────────────────────────
async function persistGraph(
  supabase: ReturnType<typeof createClient>,
  graph: EntityGraph,
  sourceUrls: string[],
): Promise<{
  orgs_upserted: number;
  persons_upserted: number;
  relationships_created: number;
  brands_created: number;
  roles_created: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let orgsUpserted = 0;
  let personsUpserted = 0;
  let relationshipsCreated = 0;
  let brandsCreated = 0;
  let rolesCreated = 0;

  // 1. Upsert organizations
  for (const org of graph.organizations) {
    const { error } = await supabase
      .from("organizations")
      .upsert(
        {
          business_name: org.business_name,
          slug: org.slug,
          entity_type: org.entity_type,
          business_type: org.business_type,
          description: org.description,
          website: org.website,
          phone: org.phone,
          email: org.email,
          city: org.city,
          state: org.state,
          country: org.country,
          address: org.address,
          social_links: org.social_links,
          metadata: org.metadata,
          enrichment_status: "partial",
          last_enriched_at: new Date().toISOString(),
          enrichment_sources: sourceUrls.slice(0, 5),
        },
        { onConflict: "slug" }
      );
    if (error) {
      errors.push(`org ${org.slug}: ${error.message}`);
    } else {
      orgsUpserted++;
    }
  }

  // Build slug→id map
  const allSlugs = [
    ...graph.organizations.map((o) => o.slug),
    ...graph.relationships.map((r) => r.source_slug),
    ...graph.relationships.map((r) => r.target_slug),
    ...graph.brands.map((b) => b.org_slug),
    ...graph.roles.map((r) => r.org_slug),
    ...graph.persons.filter((p) => p.org_slug).map((p) => p.org_slug!),
  ];
  const uniqueSlugs = [...new Set(allSlugs)];

  const { data: orgRows } = await supabase
    .from("organizations")
    .select("id, slug")
    .in("slug", uniqueSlugs);

  const slugToOrgId = new Map<string, string>();
  for (const row of orgRows || []) {
    slugToOrgId.set(row.slug, row.id);
  }

  // 2. Upsert persons
  for (const person of graph.persons) {
    const primaryOrgId = person.org_slug
      ? slugToOrgId.get(person.org_slug) || null
      : null;
    const { error } = await supabase
      .from("discovered_persons")
      .upsert(
        {
          slug: person.slug,
          full_name: person.full_name,
          primary_role: person.primary_role,
          primary_organization_id: primaryOrgId,
          location: person.location,
          email: person.email,
          phone: person.phone,
          social_links: person.social_links,
          known_for: person.known_for,
          expertise_areas: person.expertise_areas,
          bio: person.bio,
          enrichment_status: "partial",
          enrichment_sources: sourceUrls.slice(0, 3),
        },
        { onConflict: "slug" }
      );
    if (error) {
      errors.push(`person ${person.slug}: ${error.message}`);
    } else {
      personsUpserted++;
    }
  }

  // Build person slug→id map
  const personSlugs = graph.persons.map((p) => p.slug);
  const { data: personRows } = await supabase
    .from("discovered_persons")
    .select("id, slug")
    .in("slug", personSlugs);

  const slugToPersonId = new Map<string, string>();
  for (const row of personRows || []) {
    slugToPersonId.set(row.slug, row.id);
  }

  // 3. Create relationships
  for (const rel of graph.relationships) {
    const sourceId = slugToOrgId.get(rel.source_slug);
    const targetId = slugToOrgId.get(rel.target_slug);
    if (!sourceId || !targetId) {
      errors.push(
        `rel ${rel.source_slug}→${rel.target_slug}: missing org id`
      );
      continue;
    }
    const { error } = await supabase
      .from("organization_relationships")
      .upsert(
        {
          source_org_id: sourceId,
          target_org_id: targetId,
          relationship_type: rel.relationship_type,
          territory: rel.territory,
          is_exclusive: rel.is_exclusive,
          confidence_score: rel.confidence,
          source_url: sourceUrls[0] || null,
        },
        { onConflict: "source_org_id,target_org_id,relationship_type" }
      );
    if (error) {
      errors.push(
        `rel ${rel.source_slug}→${rel.target_slug}: ${error.message}`
      );
    } else {
      relationshipsCreated++;
    }
  }

  // 4. Create brand associations
  for (const brand of graph.brands) {
    const orgId = slugToOrgId.get(brand.org_slug);
    if (!orgId) {
      errors.push(`brand ${brand.org_slug}/${brand.brand_name}: missing org`);
      continue;
    }
    const { error } = await supabase
      .from("organization_brands")
      .upsert(
        {
          organization_id: orgId,
          brand_name: brand.brand_name,
          authorization_level: brand.authorization_level,
          operating_name: brand.operating_name,
          source_url: sourceUrls[0] || null,
        },
        { onConflict: "organization_id,brand_name,authorization_level" }
      );
    if (error) {
      errors.push(`brand ${brand.brand_name}: ${error.message}`);
    } else {
      brandsCreated++;
    }
  }

  // 5. Create person-org roles
  for (const role of graph.roles) {
    const personId = slugToPersonId.get(role.person_slug);
    const orgId = slugToOrgId.get(role.org_slug);
    if (!personId || !orgId) {
      errors.push(
        `role ${role.person_slug}@${role.org_slug}: missing id`
      );
      continue;
    }
    const { error } = await supabase
      .from("person_organization_roles")
      .upsert(
        {
          person_id: personId,
          organization_id: orgId,
          role_title: role.role_title,
          role_type: role.role_type,
          source_url: sourceUrls[0] || null,
        },
        { onConflict: "person_id,organization_id,role_title" }
      );
    if (error) {
      errors.push(`role ${role.person_slug}: ${error.message}`);
    } else {
      rolesCreated++;
    }
  }

  // 6. Log enrichment
  const seedOrg = graph.organizations[0];
  if (seedOrg) {
    const seedOrgId = slugToOrgId.get(seedOrg.slug);
    if (seedOrgId) {
      await supabase.from("entity_enrichment_log").insert({
        entity_type: "organization",
        entity_id: seedOrgId,
        enrichment_source: "discover-entity-graph",
        source_url: sourceUrls[0] || null,
        fields_updated: [
          "organizations",
          "relationships",
          "brands",
          "persons",
          "roles",
        ],
        new_values: {
          orgs_upserted: orgsUpserted,
          persons_upserted: personsUpserted,
          relationships_created: relationshipsCreated,
          brands_created: brandsCreated,
          roles_created: rolesCreated,
        },
        confidence_score: 0.75,
      });
    }
  }

  return {
    orgs_upserted: orgsUpserted,
    persons_upserted: personsUpserted,
    relationships_created: relationshipsCreated,
    brands_created: brandsCreated,
    roles_created: rolesCreated,
    errors,
  };
}

// ─── Main Handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "discover";

    // ── STATUS ──────────────────────────────────────────────────
    if (action === "status") {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("enrichment_status", { count: "exact", head: false })
        .not("enrichment_status", "is", null);

      const { count: relCount } = await supabase
        .from("organization_relationships")
        .select("*", { count: "exact", head: true });

      const { count: brandCount } = await supabase
        .from("organization_brands")
        .select("*", { count: "exact", head: true });

      const { count: personCount } = await supabase
        .from("discovered_persons")
        .select("*", { count: "exact", head: true });

      const { count: roleCount } = await supabase
        .from("person_organization_roles")
        .select("*", { count: "exact", head: true });

      const enrichmentCounts: Record<string, number> = {};
      for (const row of orgs || []) {
        const s = row.enrichment_status || "unknown";
        enrichmentCounts[s] = (enrichmentCounts[s] || 0) + 1;
      }

      return okJson({
        success: true,
        entity_graph: {
          organizations: {
            total: orgs?.length || 0,
            by_status: enrichmentCounts,
          },
          relationships: relCount || 0,
          brands: brandCount || 0,
          persons: personCount || 0,
          roles: roleCount || 0,
        },
      });
    }

    // ── DISCOVER ────────────────────────────────────────────────
    if (action === "discover") {
      const { url, slug, name, depth, content } = body;

      let seedUrl = url;
      let seedName = name;
      const crawlDepth = Math.min(depth ?? 1, 3);

      // Resolve from slug if no URL given
      if (!seedUrl && slug) {
        const { data: org } = await supabase
          .from("organizations")
          .select("business_name, website, slug")
          .eq("slug", slug)
          .single();

        if (!org?.website) {
          return okJson(
            { success: false, error: `No website found for slug: ${slug}` },
            400
          );
        }
        seedUrl = org.website;
        seedName = seedName || org.business_name;
      }

      if (!seedUrl && !content) {
        return okJson(
          {
            success: false,
            error:
              "Provide url, slug, content, or name. Example: {action: 'discover', url: 'https://guntherwerks.com', name: 'Gunther Werks'}",
          },
          400
        );
      }

      seedName = seedName || (seedUrl ? new URL(seedUrl).hostname.replace("www.", "") : "Unknown Entity");

      console.log(
        `[discover] Starting entity graph discovery for ${seedName} (${seedUrl || "content-provided"}), depth=${crawlDepth}`
      );

      const { graph, pages_crawled, urls_visited } = await crawlAndClassify(
        supabase,
        seedUrl || "",
        seedName,
        crawlDepth,
        content
      );

      if (graph.organizations.length === 0) {
        return okJson({
          success: true,
          message: "No entities found in crawled content",
          pages_crawled,
        });
      }

      // Persist unless dry_run
      if (body.dry_run) {
        return okJson({
          success: true,
          dry_run: true,
          graph,
          pages_crawled,
          urls_visited,
        });
      }

      const result = await persistGraph(supabase, graph, urls_visited);

      return okJson({
        success: true,
        discovered: {
          organizations: graph.organizations.length,
          persons: graph.persons.length,
          relationships: graph.relationships.length,
          brands: graph.brands.length,
          roles: graph.roles.length,
        },
        persisted: result,
        pages_crawled,
        seed: { name: seedName, url: seedUrl },
      });
    }

    // ── ENRICH (re-discover for existing org) ───────────────────
    if (action === "enrich") {
      const { slug } = body;
      if (!slug) {
        return okJson({ success: false, error: "Provide slug to enrich" }, 400);
      }

      const { data: org } = await supabase
        .from("organizations")
        .select("id, business_name, website, slug, enrichment_status")
        .eq("slug", slug)
        .single();

      if (!org) {
        return okJson({ success: false, error: `Org not found: ${slug}` }, 404);
      }

      if (!org.website) {
        return okJson(
          {
            success: false,
            error: `No website for ${slug}. Set website first.`,
          },
          400
        );
      }

      const { graph, pages_crawled, urls_visited } = await crawlAndClassify(
        supabase,
        org.website,
        org.business_name,
        2
      );

      const result = await persistGraph(supabase, graph, urls_visited);

      // Update enrichment status
      await supabase
        .from("organizations")
        .update({
          enrichment_status: "enriched",
          last_enriched_at: new Date().toISOString(),
        })
        .eq("id", org.id);

      return okJson({
        success: true,
        enriched: slug,
        previous_status: org.enrichment_status,
        new_status: "enriched",
        discovered: {
          organizations: graph.organizations.length,
          persons: graph.persons.length,
          relationships: graph.relationships.length,
          brands: graph.brands.length,
          roles: graph.roles.length,
        },
        persisted: result,
        pages_crawled,
      });
    }

    return okJson({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[discover-entity-graph] Error: ${msg}`);
    return okJson({ success: false, error: msg }, 500);
  }
});
