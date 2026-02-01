/**
 * Scrape Scott Drake Mustang parts catalog (Edge Function)
 *
 * This is a generic "scrape a page that contains products" function.
 * It can be used on category pages (multiple products) or product pages (single product).
 *
 * Storage:
 * - catalog_sources (provider = 'Scott Drake')
 * - catalog_parts (manufacturer = 'Scott Drake')
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ScrapeRequest = {
  url: string;
  category_name?: string;
  subcategory_name?: string;
  year_start?: number;
  year_end?: number;
  fits_models?: string[];
};

type ExtractedProduct = {
  part_number?: string;
  name?: string;
  price?: number | null;
  description?: string | null;
  image_url?: string | null;
  supplier_url?: string | null;
  category?: string | null;
  subcategory?: string | null;
  in_stock?: boolean | null;
  fits_models?: string[] | null;
  year_start?: number | null;
  year_end?: number | null;
};

function safeString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function safeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeUrl(baseUrl: string, maybeUrl: string | null): string | null {
  const s = safeString(maybeUrl);
  if (!s) return null;
  try {
    return new URL(s, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizePartNumber(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  // Common Mustang/Ford and aftermarket part number formats:
  // - C5ZZ-6523200-A
  // - C9ZZ-16005-A
  // - 12345A, SD-123, etc.
  const cleaned = s
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  // Remove common prefixes
  const withoutPrefix = cleaned.replace(/^(PART\s*#|PART\s*NO\.?|SKU|ITEM)\s*[:#-]?\s*/i, "");
  // Hard length sanity
  if (withoutPrefix.length < 2 || withoutPrefix.length > 40) return null;
  return withoutPrefix;
}

function inferYearRange(text: string): { year_start: number | null; year_end: number | null } {
  const t = text;

  // 1965-1966 or 65-66
  const rangeMatch = t.match(/\b((?:19|20)\d{2}|\d{2})\s*[-–]\s*((?:19|20)\d{2}|\d{2})\b/);
  if (rangeMatch) {
    const a = rangeMatch[1];
    const b = rangeMatch[2];
    const ya = a.length === 2 ? (Number(a) > 30 ? 1900 + Number(a) : 2000 + Number(a)) : Number(a);
    const yb = b.length === 2 ? (Number(b) > 30 ? 1900 + Number(b) : 2000 + Number(b)) : Number(b);
    if (Number.isFinite(ya) && Number.isFinite(yb) && ya >= 1900 && yb >= 1900 && ya <= yb) {
      return { year_start: ya, year_end: yb };
    }
  }

  // Single year like "1965"
  const single = t.match(/\b(19\d{2}|20\d{2})\b/);
  if (single) {
    const y = Number(single[1]);
    if (Number.isFinite(y) && y >= 1900 && y <= 2100) return { year_start: y, year_end: y };
  }

  return { year_start: null, year_end: null };
}

function normalizeStringArray(raw: unknown, max = 20): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw.slice(0, max)) {
    const s = safeString(item);
    if (!s) continue;
    out.push(s.replace(/\s+/g, " ").trim());
  }
  const unique = Array.from(new Set(out));
  return unique.length ? unique : null;
}

function coerceBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (["true", "yes", "in stock", "available"].includes(s)) return true;
    if (["false", "no", "out of stock", "unavailable"].includes(s)) return false;
  }
  return null;
}

function parseProductsFromHTML(
  html: string,
  markdown: string,
  baseUrl: string,
  categoryFallback: string | null,
  subcategoryFallback: string | null,
): ExtractedProduct[] {
  const products: ExtractedProduct[] = [];
  const seen = new Set<string>();

  // Ford service part number format (very common on Mustang restoration parts)
  const fordPartPattern = /\b([A-Z][0-9][A-Z]{2}-\d{4,7}-[A-Z0-9]{1,2})\b/g;
  // Generic SKU patterns
  const skuPattern = /\b(?:SKU|PART\s*#|PART\s*NO\.?|ITEM)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,30})\b/gi;

  const allMatches: Array<{ part: string; index: number }> = [];
  for (const m of html.matchAll(fordPartPattern)) {
    allMatches.push({ part: m[1], index: m.index ?? 0 });
  }
  for (const m of html.matchAll(skuPattern)) {
    allMatches.push({ part: m[1], index: m.index ?? 0 });
  }

  // If no part numbers found, try to extract a single product from JSON-LD snippets in markdown.
  if (allMatches.length === 0) {
    const title = safeString((markdown.match(/^#\s+(.+)$/m) || [])[1]) || null;
    const price = safeNumber((markdown.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/) || [])[1]) ?? null;
    if (title) {
      const inferred = inferYearRange(`${title} ${markdown}`);
      products.push({
        part_number: null,
        name: title,
        price,
        description: markdown ? markdown.substring(0, 800) : null,
        image_url: null,
        supplier_url: baseUrl,
        category: categoryFallback,
        subcategory: subcategoryFallback,
        in_stock: null,
        fits_models: ["Mustang"],
        year_start: inferred.year_start,
        year_end: inferred.year_end,
      });
    }
    return products;
  }

  // Build products from part number contexts
  for (const match of allMatches.slice(0, 400)) {
    const partNumber = normalizePartNumber(match.part);
    if (!partNumber) continue;
    if (seen.has(partNumber)) continue;
    seen.add(partNumber);

    const start = Math.max(0, match.index - 500);
    const end = Math.min(html.length, match.index + 1200);
    const context = html.slice(start, end);

    const nameMatch =
      context.match(/<h[1-4][^>]*>(.*?)<\/h[1-4]>/i) ||
      context.match(/<[^>]*class="[^"]*(?:product[^"]*title|product[^"]*name|title|name)[^"]*"[^>]*>(.*?)<\/[^>]+>/i) ||
      context.match(/<strong[^>]*>(.*?)<\/strong>/i);
    const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, "").trim() : partNumber;

    const priceMatch = context.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/);
    const price = priceMatch ? safeNumber(priceMatch[1]) : null;

    const imgMatch = context.match(/<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|webp))"[^>]*>/i);
    const imageUrl = imgMatch ? normalizeUrl(baseUrl, imgMatch[1]) : null;

    const inferredYears = inferYearRange(`${name} ${markdown}`);

    products.push({
      part_number: partNumber,
      name,
      price,
      description: null,
      image_url: imageUrl,
      supplier_url: baseUrl,
      category: categoryFallback,
      subcategory: subcategoryFallback,
      in_stock: null,
      fits_models: ["Mustang"],
      year_start: inferredYears.year_start,
      year_end: inferredYears.year_end,
    });
  }

  return products;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlApiKey) throw new Error("FIRECRAWL_API_KEY not configured");

    const body: ScrapeRequest = await req.json();
    if (!body?.url) throw new Error("Missing url");

    const url = body.url;
    const baseOrigin = new URL(url).origin;
    const categoryFallback = safeString(body.category_name) || "mustang";
    const subcategoryFallback = safeString(body.subcategory_name) || null;

    // Firecrawl scrape with schema extraction
    const extractionSchema = {
      type: "object",
      properties: {
        products: {
          type: "array",
          items: {
            type: "object",
            properties: {
              part_number: { type: "string", description: "Product part number / SKU" },
              name: { type: "string", description: "Product name/title" },
              price: { type: "number", description: "Price in USD" },
              description: { type: "string", description: "Product description" },
              image_url: { type: "string", description: "Primary product image URL" },
              supplier_url: { type: "string", description: "Product URL" },
              category: { type: "string", description: "Category (Interior, Exterior, etc.)" },
              subcategory: { type: "string", description: "Subcategory" },
              in_stock: { type: "boolean", description: "Stock status" },
              fits_models: { type: "array", items: { type: "string" } },
              year_start: { type: "number" },
              year_end: { type: "number" },
            },
          },
        },
        product: {
          type: "object",
          properties: {
            part_number: { type: "string" },
            name: { type: "string" },
            price: { type: "number" },
            description: { type: "string" },
            image_url: { type: "string" },
            supplier_url: { type: "string" },
            category: { type: "string" },
            subcategory: { type: "string" },
            in_stock: { type: "boolean" },
            fits_models: { type: "array", items: { type: "string" } },
            year_start: { type: "number" },
            year_end: { type: "number" },
          },
        },
      },
    };

    const firecrawlResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["html", "markdown", "extract"],
        extract: { schema: extractionSchema },
        onlyMainContent: false,
        waitFor: 3500,
      }),
    });

    if (!firecrawlResp.ok) {
      const txt = await firecrawlResp.text().catch(() => "");
      throw new Error(`Firecrawl error: ${firecrawlResp.status} ${txt}`.trim());
    }

    const firecrawlData = await firecrawlResp.json();
    if (!firecrawlData?.success) {
      throw new Error(`Firecrawl failed: ${JSON.stringify(firecrawlData)}`);
    }

    const html: string = firecrawlData.data?.html || "";
    const markdown: string = firecrawlData.data?.markdown || "";

    // Normalize products
    let products: ExtractedProduct[] = [];
    const extracted = firecrawlData.data?.extract || {};
    if (Array.isArray(extracted.products)) {
      products = extracted.products as ExtractedProduct[];
    } else if (extracted.product && typeof extracted.product === "object") {
      products = [extracted.product as ExtractedProduct];
    } else {
      products = parseProductsFromHTML(html, markdown, baseOrigin, categoryFallback, subcategoryFallback);
    }

    // Ensure catalog source exists
    const baseUrlForSource = baseOrigin;
    let { data: catalogSource } = await supabase
      .from("catalog_sources")
      .select("id")
      .eq("provider", "Scott Drake")
      .eq("base_url", baseUrlForSource)
      .maybeSingle();

    if (!catalogSource) {
      const { data: created } = await supabase
        .from("catalog_sources")
        .insert({
          name: "Scott Drake Mustang Parts",
          provider: "Scott Drake",
          base_url: baseUrlForSource,
        })
        .select("id")
        .single();
      catalogSource = created;
    }

    let stored = 0;
    let updated = 0;
    const preview: any[] = [];

    for (const raw of products.slice(0, 500)) {
      const partNumber = normalizePartNumber(raw.part_number);
      const name = safeString(raw.name);

      // Skip items without identity
      if (!partNumber || !name) continue;

      const supplierUrl = normalizeUrl(url, safeString(raw.supplier_url)) || url;
      const imageUrl = normalizeUrl(url, safeString(raw.image_url));

      const price = safeNumber(raw.price);
      const description = safeString(raw.description);
      const inStock = coerceBoolean(raw.in_stock);

      const fitsModels =
        normalizeStringArray(raw.fits_models) ||
        normalizeStringArray(body.fits_models) ||
        ["Mustang"];

      const inferred = inferYearRange(`${name} ${description || ""} ${markdown}`);
      const yearStart = (typeof raw.year_start === "number" ? raw.year_start : null) ?? body.year_start ?? inferred.year_start;
      const yearEnd = (typeof raw.year_end === "number" ? raw.year_end : null) ?? body.year_end ?? inferred.year_end;

      const category = safeString(raw.category) || categoryFallback;
      const subcategory = safeString(raw.subcategory) || subcategoryFallback;

      const { data: existing } = await supabase
        .from("catalog_parts")
        .select("id")
        .eq("catalog_id", catalogSource.id)
        .eq("part_number", partNumber)
        .maybeSingle();

      const commonWrite = {
        name,
        description,
        price_current: price,
        product_image_url: imageUrl,
        category,
        subcategory,
        manufacturer: "Scott Drake",
        in_stock: inStock ?? true,
        supplier_url: supplierUrl,
        fits_models: fitsModels,
        year_start: yearStart,
        year_end: yearEnd,
        application_data: {
          supplier: "Scott Drake",
          vehicle_make: "Ford",
          vehicle_model: "Mustang",
          source_url: url,
          category_name: categoryFallback,
          subcategory_name: subcategoryFallback,
        },
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { error } = await supabase
          .from("catalog_parts")
          .update(commonWrite)
          .eq("id", existing.id);
        if (!error) {
          updated++;
        }
      } else {
        const { error } = await supabase
          .from("catalog_parts")
          .insert({
            catalog_id: catalogSource.id,
            part_number: partNumber,
            ...commonWrite,
          });
        if (!error) {
          stored++;
        }
      }

      if (preview.length < 10) {
        preview.push({
          part_number: partNumber,
          name,
          price,
          supplier_url: supplierUrl,
          category,
          subcategory,
          year_start: yearStart,
          year_end: yearEnd,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        catalog_provider: "Scott Drake",
        catalog_base_url: baseUrlForSource,
        scraped_url: url,
        products_found: products.length,
        stored,
        updated,
        preview,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("scrape-scott-drake-catalog error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


