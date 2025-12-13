/**
 * Scrape Holley product/category pages and upsert products into catalog_parts.
 *
 * Design goals:
 * - Prefer structured extraction via Firecrawl schema
 * - Strong fallback: JSON-LD Product parsing (Holley typically exposes it)
 * - Final fallback: light HTML heuristics
 *
 * Storage:
 * - catalog_sources: provider = 'Holley', base_url = 'https://www.holley.com'
 * - catalog_parts: part_number = sku/mpn, manufacturer = brand when available
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ScrapeRequest = {
  url: string;
  brand_hint?: string; // e.g. "Scott Drake"
  category_hint?: string;
  subcategory_hint?: string;
};

type Product = {
  part_number: string | null;
  name: string | null;
  price: number | null;
  description: string | null;
  image_url: string | null;
  supplier_url: string | null;
  brand: string | null;
  breadcrumbs: string[] | null;
  in_stock: boolean | null;
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

function normalizeUrl(base: string, maybe: unknown): string | null {
  const s = safeString(maybe);
  if (!s) return null;
  try {
    return new URL(s, base).toString();
  } catch {
    return null;
  }
}

function normalizePartNumber(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const cleaned = s.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const withoutPrefix = cleaned.replace(/^(PART\s*#|PART\s*NO\.?|SKU|ITEM|MPN)\s*[:#-]?\s*/i, "");
  if (withoutPrefix.length < 2 || withoutPrefix.length > 64) return null;
  return withoutPrefix;
}

function coerceBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "yes", "in stock", "available"].includes(s)) return true;
    if (["false", "no", "out of stock", "unavailable"].includes(s)) return false;
  }
  return null;
}

function uniqStrings(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function extractInternalLinks(html: string, pageUrl: string): string[] {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }

  const out: string[] = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href) continue;
    const lower = href.toLowerCase();
    if (lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("javascript:")) continue;
    if (lower.startsWith("#")) continue;
    try {
      const abs = new URL(href, pageUrl);
      if (abs.origin !== origin) continue;
      abs.hash = "";
      out.push(abs.toString());
    } catch {
      // ignore
    }
    if (out.length >= 3000) break;
  }

  return Array.from(new Set(out)).filter((u) => {
    const low = u.toLowerCase();
    if (low.includes("/account/")) return false;
    if (low.includes("/cart/")) return false;
    if (low.includes("/checkout")) return false;
    if (low.includes("logout")) return false;
    return true;
  });
}

function extractJsonLd(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      out.push(parsed);
    } catch {
      // Some sites embed multiple JSON objects without strict JSON; ignore.
    }
  }
  return out;
}

function flattenJsonLdNodes(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(flattenJsonLdNodes);
  if (typeof node === "object") {
    if (node["@graph"] && Array.isArray(node["@graph"])) return node["@graph"].flatMap(flattenJsonLdNodes);
    return [node];
  }
  return [];
}

function productFromJsonLdNodes(nodes: any[], pageUrl: string): Product[] {
  const products: Product[] = [];
  const flat = nodes.flatMap(flattenJsonLdNodes);
  for (const n of flat) {
    const type = n["@type"];
    const isProduct = (Array.isArray(type) ? type : [type]).filter(Boolean).some((t: string) => String(t).toLowerCase() === "product");
    if (!isProduct) continue;

    const name = safeString(n.name);
    const sku = normalizePartNumber(n.sku);
    const mpn = normalizePartNumber(n.mpn);
    const partNumber = mpn || sku || null;

    // Images: can be string or array
    let imageUrl: string | null = null;
    if (typeof n.image === "string") imageUrl = normalizeUrl(pageUrl, n.image);
    if (!imageUrl && Array.isArray(n.image) && n.image.length > 0) imageUrl = normalizeUrl(pageUrl, n.image[0]);

    // Brand
    let brand: string | null = null;
    if (typeof n.brand === "string") brand = safeString(n.brand);
    if (!brand && n.brand && typeof n.brand === "object") brand = safeString(n.brand.name);

    // Price: can be offers.price or offers[0].price
    let price: number | null = null;
    const offers = n.offers;
    if (offers && typeof offers === "object") {
      const offerObj = Array.isArray(offers) ? offers[0] : offers;
      price = safeNumber(offerObj?.price) ?? safeNumber(offerObj?.priceSpecification?.price);
    }

    // Availability
    let inStock: boolean | null = null;
    if (offers && typeof offers === "object") {
      const offerObj = Array.isArray(offers) ? offers[0] : offers;
      const availability = safeString(offerObj?.availability);
      if (availability) {
        const low = availability.toLowerCase();
        if (low.includes("instock")) inStock = true;
        else if (low.includes("outofstock")) inStock = false;
      }
    }

    const description = safeString(n.description);

    products.push({
      part_number: partNumber,
      name,
      price,
      description,
      image_url: imageUrl,
      supplier_url: pageUrl,
      brand,
      breadcrumbs: null,
      in_stock: inStock,
    });
  }
  return products;
}

function parseBreadcrumbs(html: string): string[] | null {
  // Very light heuristics: look for breadcrumb schema in JSON-LD first.
  const nodes = extractJsonLd(html).flatMap(flattenJsonLdNodes);
  for (const n of nodes) {
    const type = n["@type"];
    const isBreadcrumb = (Array.isArray(type) ? type : [type]).filter(Boolean).some((t: string) => String(t).toLowerCase() === "breadcrumblist");
    if (!isBreadcrumb) continue;
    const items = Array.isArray(n.itemListElement) ? n.itemListElement : [];
    const crumbs: string[] = [];
    for (const el of items) {
      const name = safeString(el?.name) || safeString(el?.item?.name);
      if (name) crumbs.push(name);
    }
    const unique = uniqStrings(crumbs);
    if (unique.length) return unique;
  }
  return null;
}

function fallbackProductFromHtml(html: string, markdown: string, pageUrl: string): Product[] {
  // Last-resort: find a plausible SKU/part and title.
  const title =
    safeString((markdown.match(/^#\s+(.+)$/m) || [])[1]) ||
    safeString((html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]) ||
    null;

  const skuMatch =
    html.match(/\b(?:SKU|Part\s*#|Part\s*No\.?|MPN)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,40})\b/i) ||
    null;
  const partNumber = skuMatch ? normalizePartNumber(skuMatch[1]) : null;

  const priceMatch = html.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/);
  const price = priceMatch ? safeNumber(priceMatch[1]) : null;

  const imageMatch = html.match(/<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|webp))"[^>]*>/i);
  const imageUrl = imageMatch ? normalizeUrl(pageUrl, imageMatch[1]) : null;

  if (!title && !partNumber) return [];

  return [
    {
      part_number: partNumber,
      name: title || partNumber,
      price,
      description: null,
      image_url: imageUrl,
      supplier_url: pageUrl,
      brand: null,
      breadcrumbs: null,
      in_stock: null,
    },
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body: ScrapeRequest = await req.json();
    if (!body?.url) throw new Error("Missing url");

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlApiKey) throw new Error("FIRECRAWL_API_KEY not configured");

    const pageUrl = body.url;
    const baseOrigin = new URL(pageUrl).origin;

    const extractionSchema = {
      type: "object",
      properties: {
        products: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              sku: { type: "string" },
              mpn: { type: "string" },
              part_number: { type: "string" },
              price: { type: "number" },
              description: { type: "string" },
              image_url: { type: "string" },
              brand: { type: "string" },
              breadcrumbs: { type: "array", items: { type: "string" } },
              in_stock: { type: "boolean" },
              supplier_url: { type: "string" },
            },
          },
        },
        product: {
          type: "object",
          properties: {
            name: { type: "string" },
            sku: { type: "string" },
            mpn: { type: "string" },
            part_number: { type: "string" },
            price: { type: "number" },
            description: { type: "string" },
            image_url: { type: "string" },
            brand: { type: "string" },
            breadcrumbs: { type: "array", items: { type: "string" } },
            in_stock: { type: "boolean" },
            supplier_url: { type: "string" },
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
        url: pageUrl,
        formats: ["html", "markdown", "extract"],
        extract: { schema: extractionSchema },
        onlyMainContent: false,
        waitFor: 4000,
      }),
    });

    const firecrawlData = await firecrawlResp.json().catch(() => ({}));
    if (!firecrawlResp.ok) {
      throw new Error(`Firecrawl error: ${firecrawlResp.status} ${JSON.stringify(firecrawlData)}`);
    }
    if (!firecrawlData?.success) {
      throw new Error(`Firecrawl failed: ${JSON.stringify(firecrawlData)}`);
    }

    const html: string = firecrawlData.data?.html || "";
    const markdown: string = firecrawlData.data?.markdown || "";
    const extract = firecrawlData.data?.extract || {};

    const discoveredLinks = extractInternalLinks(html, pageUrl);

    let products: Product[] = [];

    // 1) Firecrawl schema extraction
    if (Array.isArray(extract.products) && extract.products.length) {
      products = extract.products.map((p: any) => ({
        part_number: normalizePartNumber(p.part_number || p.mpn || p.sku),
        name: safeString(p.name),
        price: safeNumber(p.price),
        description: safeString(p.description),
        image_url: normalizeUrl(pageUrl, p.image_url),
        supplier_url: normalizeUrl(pageUrl, p.supplier_url) || pageUrl,
        brand: safeString(p.brand) || safeString(body.brand_hint),
        breadcrumbs: Array.isArray(p.breadcrumbs) ? uniqStrings(p.breadcrumbs.map(String)) : null,
        in_stock: coerceBoolean(p.in_stock),
      }));
    } else if (extract.product && typeof extract.product === "object") {
      const p: any = extract.product;
      products = [
        {
          part_number: normalizePartNumber(p.part_number || p.mpn || p.sku),
          name: safeString(p.name),
          price: safeNumber(p.price),
          description: safeString(p.description),
          image_url: normalizeUrl(pageUrl, p.image_url),
          supplier_url: normalizeUrl(pageUrl, p.supplier_url) || pageUrl,
          brand: safeString(p.brand) || safeString(body.brand_hint),
          breadcrumbs: Array.isArray(p.breadcrumbs) ? uniqStrings(p.breadcrumbs.map(String)) : null,
          in_stock: coerceBoolean(p.in_stock),
        },
      ];
    }

    // 2) JSON-LD parsing (preferred fallback for Holley)
    if (products.length === 0) {
      const nodes = extractJsonLd(html);
      const fromLd = productFromJsonLdNodes(nodes, pageUrl);
      if (fromLd.length) {
        const crumbs = parseBreadcrumbs(html);
        products = fromLd.map((p) => ({
          ...p,
          brand: p.brand || safeString(body.brand_hint),
          breadcrumbs: crumbs,
        }));
      }
    }

    // 3) HTML heuristic fallback
    if (products.length === 0) {
      products = fallbackProductFromHtml(html, markdown, pageUrl);
      const crumbs = parseBreadcrumbs(html);
      products = products.map((p) => ({
        ...p,
        brand: p.brand || safeString(body.brand_hint),
        breadcrumbs: crumbs,
      }));
    }

    // Normalize category/subcategory from breadcrumbs or hints
    const stored: string[] = [];
    const updated: string[] = [];

    // Ensure Holley catalog source exists
    const holleyBase = "https://www.holley.com";
    let { data: catalogSource } = await supabase
      .from("catalog_sources")
      .select("id")
      .eq("provider", "Holley")
      .eq("base_url", holleyBase)
      .maybeSingle();

    if (!catalogSource) {
      const { data: created } = await supabase
        .from("catalog_sources")
        .insert({ name: "Holley", provider: "Holley", base_url: holleyBase })
        .select("id")
        .single();
      catalogSource = created;
    }

    for (const p of products.slice(0, 200)) {
      const partNumber = normalizePartNumber(p.part_number);
      const name = safeString(p.name);
      if (!partNumber || !name) continue;

      const crumbs = p.breadcrumbs || [];
      const category = safeString(body.category_hint) || (crumbs.length >= 1 ? crumbs[0] : null) || "holley";
      const subcategory = safeString(body.subcategory_hint) || (crumbs.length >= 2 ? crumbs[1] : null);

      const manufacturer = safeString(p.brand) || safeString(body.brand_hint) || "Holley";

      const supplierUrl = normalizeUrl(pageUrl, p.supplier_url) || pageUrl;
      const imageUrl = normalizeUrl(pageUrl, p.image_url);

      const { data: existing } = await supabase
        .from("catalog_parts")
        .select("id")
        .eq("catalog_id", catalogSource.id)
        .eq("part_number", partNumber)
        .maybeSingle();

      const write = {
        name,
        description: safeString(p.description),
        price_current: safeNumber(p.price),
        product_image_url: imageUrl,
        category,
        subcategory,
        manufacturer,
        in_stock: p.in_stock ?? true,
        supplier_url: supplierUrl,
        application_data: {
          supplier: "Holley",
          brand: manufacturer,
          source_url: pageUrl,
          breadcrumbs: crumbs,
        },
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { error } = await supabase.from("catalog_parts").update(write).eq("id", existing.id);
        if (!error) updated.push(partNumber);
      } else {
        const { error } = await supabase.from("catalog_parts").insert({
          catalog_id: catalogSource.id,
          part_number: partNumber,
          ...write,
        });
        if (!error) stored.push(partNumber);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        url: pageUrl,
        extracted_products: products.length,
        stored: stored.length,
        updated: updated.length,
        discovered_links_count: discoveredLinks.length,
        discovered_links: discoveredLinks.slice(0, 200),
        preview: products.slice(0, 5),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("scrape-holley-product error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});



