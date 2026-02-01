// BaT Image Extractor v1 - Micro-extractor (60 lines)
// ONE JOB: Extract canonical gallery images from BaT listing
// ALL data is mandatory - fails loudly if can't extract

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

interface Result {
  status: "success" | "failed";
  images?: string[];
  failure_code?: string;
  failure_reason?: string;
  method?: string;
  count?: number;
}

async function extractImages(url: string): Promise<Result> {
  // Fetch with Firecrawl (BaT requires JS rendering)
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${FIRECRAWL_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ["html"],
      onlyMainContent: false,
      waitFor: 8000,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    return { status: "failed", failure_code: "FETCH_FAILED", failure_reason: `HTTP ${res.status}` };
  }

  const json = await res.json();
  const html = json?.data?.html;
  if (!html) {
    return { status: "failed", failure_code: "NO_HTML", failure_reason: "Firecrawl returned empty" };
  }

  // Extract from data-gallery-items attribute
  const match = html.match(/data-gallery-items\s*=\s*["']([^"']+)["']/i);
  if (!match) {
    return { status: "failed", failure_code: "GALLERY_NOT_FOUND", failure_reason: "data-gallery-items attribute missing" };
  }

  // Decode and parse JSON
  const decoded = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&");

  const items = JSON.parse(decoded);
  if (!Array.isArray(items)) {
    return { status: "failed", failure_code: "BAD_JSON", failure_reason: "Gallery items not an array" };
  }

  // Extract URLs (prefer full > large > original)
  const images = items
    .map(it => it?.full?.url || it?.large?.url || it?.original?.url)
    .filter(u => u && typeof u === "string" && u.includes("/wp-content/uploads/"))
    .map(u => u.split("?")[0].split("#")[0].trim());

  const unique = [...new Set(images)];

  if (unique.length === 0) {
    return { status: "failed", failure_code: "NO_IMAGES", failure_reason: "Gallery parsed but no valid images" };
  }

  return { status: "success", images: unique, method: "data-gallery-items", count: unique.length };
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const { url } = await req.json();
  if (!url) return new Response(JSON.stringify({ status: "failed", failure_code: "NO_URL" }), { status: 400 });

  const result = await extractImages(url);
  return new Response(JSON.stringify(result), {
    status: result.status === "success" ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});

