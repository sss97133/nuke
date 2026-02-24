import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { firecrawlScrape } from "../_shared/firecrawl.ts";

const ECR_BASE = "https://exclusivecarregistry.com";

interface CardData {
  slug: string;
  name: string;
  location: string | null;
  country: string | null;
  car_count: number | null;
  preview_image: string | null;
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Split HTML into card_item blocks and extract slug + metadata from each */
function parseAllCards(html: string): CardData[] {
  const results: CardData[] = [];
  const seen = new Set<string>();

  // Split by card_item boundaries
  const parts = html.split('<div class="card_item">');

  for (let i = 1; i < parts.length; i++) {
    const card = parts[i];

    // Extract slug from collection link
    const slugMatch = card.match(/\/collection\/([a-z0-9][a-z0-9\-_]+[a-z0-9])/i);
    if (!slugMatch) continue;
    const slug = slugMatch[1].toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);

    // Name
    const titleMatch = card.match(/<p[^>]*class="title"[^>]*>([^<]+)<\/p>/i);
    const name = titleMatch ? titleMatch[1].trim() : titleCase(slug);

    // Location + car count from info paragraphs
    const infoRegex = /<p[^>]*class="info"[^>]*>([\s\S]*?)<\/p>/gi;
    let location: string | null = null;
    let car_count: number | null = null;
    let infoMatch;
    while ((infoMatch = infoRegex.exec(card)) !== null) {
      // Strip HTML tags from content (handles inline <img>)
      const text = infoMatch[1].replace(/<[^>]+>/g, "").trim();
      if (text.match(/^Cars?:\s*\d+/i)) {
        car_count = parseInt(text.match(/\d+/)![0]);
      } else if (text.length > 3 && !text.startsWith("Cars")) {
        location = text;
      }
    }

    // Country from flag image within this card
    const flagMatch = card.match(/flags\/([a-z]{2})\.png/i);
    const country = flagMatch ? flagMatch[1].toUpperCase() : null;

    // Preview image
    const imgMatch = card.match(/images\/collections\/preview\/coll_(\d+)/);
    const preview_image = imgMatch
      ? `${ECR_BASE}/images/collections/preview/coll_${imgMatch[1]}.jpg`
      : null;

    results.push({ slug, name, location, country, car_count, preview_image });
  }

  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run ?? false;
    const startPage = body.start_page ?? 1;
    const maxPages = body.max_pages ?? 10; // Process 10 pages per call (~240 collections)

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Get existing slugs (paginate to handle >1000 rows)
    const existingSlugs = new Set<string>();
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data: batch } = await supabase
        .from("organizations")
        .select("slug")
        .eq("entity_type", "collection")
        .not("slug", "is", null)
        .range(from, from + pageSize - 1);
      if (!batch || batch.length === 0) break;
      for (const o of batch) {
        if (o.slug) existingSlugs.add(o.slug.toLowerCase());
      }
      if (batch.length < pageSize) break;
      from += pageSize;
    }

    let totalDiscovered = 0;
    let totalNew = 0;
    let upserted = 0;
    let pagesScraped = 0;
    let emptyPages = 0;
    const errors: string[] = [];
    const allNewSlugs: Array<{ slug: string; name: string; location: string | null; country: string | null; car_count: number | null }> = [];

    for (let page = startPage; page < startPage + maxPages; page++) {
      const url = page === 1
        ? `${ECR_BASE}/collection`
        : `${ECR_BASE}/collection?page=${page}`;

      console.log(`Scraping page ${page}: ${url}`);

      const result = await firecrawlScrape({
        url,
        formats: ["html"],
        waitFor: 2000,
        onlyMainContent: false,
        timeout: 30000,
      }, { timeoutMs: 35000 });

      if (!result.data.html) {
        console.log(`Page ${page}: no HTML returned`);
        errors.push(`Page ${page}: ${result.error || "no HTML"}`);
        emptyPages++;
        if (emptyPages >= 3) break; // 3 consecutive empty pages = done
        continue;
      }

      emptyPages = 0; // Reset consecutive empty counter
      pagesScraped++;

      const cards = parseAllCards(result.data.html);
      console.log(`Page ${page}: found ${cards.length} collections`);

      if (cards.length === 0) {
        emptyPages++;
        if (emptyPages >= 3) break;
        continue;
      }

      totalDiscovered += cards.length;

      // Find new collections
      for (const card of cards) {
        if (!existingSlugs.has(card.slug)) {
          allNewSlugs.push({
            slug: card.slug,
            name: card.name,
            location: card.location,
            country: card.country,
            car_count: card.car_count,
          });
          existingSlugs.add(card.slug);
          totalNew++;
        }
      }
    }

    // Upsert new collections
    if (!dryRun && allNewSlugs.length > 0) {
      const toUpsert = allNewSlugs.map((item) => ({
        slug: item.slug,
        business_name: item.name,
        business_type: "collection",
        entity_type: "collection",
        website: `${ECR_BASE}/collection/${item.slug}`,
        city: item.location,
        country: item.country,
        is_public: true,
        status: "active",
        total_inventory: item.car_count,
        entity_attributes: item.car_count ? { collection_size: item.car_count } : {},
        metadata: {
          ecr_slug: item.slug,
          ecr_url: `${ECR_BASE}/collection/${item.slug}`,
          source: "ecr_paginated_discovery",
          discovered_at: new Date().toISOString(),
        },
      }));

      for (let i = 0; i < toUpsert.length; i += 50) {
        const batch = toUpsert.slice(i, i + 50);
        const { error: upsertErr, data: upsertData } = await supabase
          .from("organizations")
          .upsert(batch, { onConflict: "slug", ignoreDuplicates: true })
          .select("id, slug");

        if (upsertErr) {
          errors.push(`Upsert batch ${i}: ${upsertErr.message}`);
        } else {
          upserted += (upsertData?.length || 0);
        }
      }
    }

    const nextPage = startPage + pagesScraped;
    const hasMore = emptyPages < 3 && pagesScraped === maxPages;

    const result = {
      pages: {
        start_page: startPage,
        pages_scraped: pagesScraped,
        next_page: hasMore ? nextPage : null,
        has_more: hasMore,
      },
      discovery: {
        total_discovered_this_batch: totalDiscovered,
        new_collections: totalNew,
        already_imported: existingSlugs.size,
      },
      actions: {
        upserted,
        dry_run: dryRun,
        errors: errors.length,
        error_details: errors.slice(0, 10),
      },
      sample_new: allNewSlugs.slice(0, 10).map((s) => ({
        slug: s.slug,
        name: s.name,
        location: s.location,
        country: s.country,
        car_count: s.car_count,
      })),
      next_call: hasMore
        ? `POST { "start_page": ${nextPage}, "max_pages": 10 }`
        : "Discovery complete — no more pages",
    };

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
