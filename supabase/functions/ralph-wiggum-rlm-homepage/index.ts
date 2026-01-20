import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * RALPH WIGGUM RLM — HOMEPAGE CURATOR
 *
 * Purpose: Generate “AI presets” (filter chips + optional hero copy) that make
 * `CursorHomepage` feel smarter without adding heavy client-side logic.
 *
 * This uses a lightweight RLM (recursive chunk+merge summarization) to compress
 * a long vehicle feed into a compact context, then asks an LLM to output JSON
 * presets that map cleanly to `CursorHomepage`'s `FilterState`.
 *
 * Deploy:
 *   supabase functions deploy ralph-wiggum-rlm-homepage --no-verify-jwt
 *
 * Secrets required (at least one):
 *   OPENAI_API_KEY (recommended)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callOpenAiChatCompletions } from "../_shared/openaiChat.ts";
import { rlmSummarize } from "../_shared/rlm.ts";

type FilterStateSubset = Partial<{
  yearMin: number | null;
  yearMax: number | null;
  makes: string[];
  bodyStyles: string[];
  is4x4: boolean;
  priceMin: number | null;
  priceMax: number | null;
  hasImages: boolean;
  addedTodayOnly: boolean;
  forSale: boolean;
  hideSold: boolean;
  privateParty: boolean;
  dealer: boolean;
  hideDealerListings: boolean;
  hideCraigslist: boolean;
  hideDealerSites: boolean;
  hideKsl: boolean;
  hideBat: boolean;
  hideClassic: boolean;
  hiddenSources: string[];
  zipCode: string;
  radiusMiles: number;
  locations: Array<{ zipCode: string; radiusMiles: number; label?: string }>;
  showPending: boolean;
}>;

type HomepagePreset = {
  label: string;
  filters: FilterStateSubset;
  rationale?: string;
};

type HomepageRlmResponse = {
  presets: HomepagePreset[];
  hero?: { title: string; subtitle: string };
  notes?: string[];
};

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJson(text: string): any {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // LLMs sometimes wrap JSON in markdown; best-effort extraction.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sanitizeStringArray(value: any, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function clampNumber(n: any, min: number, max: number): number | null {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.min(max, Math.max(min, x));
}

function sanitizePresetFilters(filters: any): FilterStateSubset {
  const f: FilterStateSubset = {};
  const src = filters && typeof filters === "object" ? filters : {};

  const yearMin = clampNumber(src.yearMin, 1900, 2100);
  const yearMax = clampNumber(src.yearMax, 1900, 2100);
  if (yearMin != null) f.yearMin = Math.round(yearMin);
  if (yearMax != null) f.yearMax = Math.round(yearMax);

  const priceMin = clampNumber(src.priceMin, 0, 100_000_000);
  const priceMax = clampNumber(src.priceMax, 0, 100_000_000);
  if (priceMin != null) f.priceMin = Math.round(priceMin);
  if (priceMax != null) f.priceMax = Math.round(priceMax);

  const makes = sanitizeStringArray(src.makes, 12);
  if (makes.length) f.makes = makes;

  const bodyStyles = sanitizeStringArray(src.bodyStyles, 12);
  if (bodyStyles.length) f.bodyStyles = bodyStyles;

  const boolKeys: Array<keyof FilterStateSubset> = [
    "is4x4",
    "hasImages",
    "addedTodayOnly",
    "forSale",
    "hideSold",
    "privateParty",
    "dealer",
    "hideDealerListings",
    "hideCraigslist",
    "hideDealerSites",
    "hideKsl",
    "hideBat",
    "hideClassic",
    "showPending",
  ];
  for (const k of boolKeys) {
    if (typeof (src as any)[k] === "boolean") (f as any)[k] = (src as any)[k];
  }

  const hiddenSources = sanitizeStringArray(src.hiddenSources, 50);
  if (hiddenSources.length) f.hiddenSources = hiddenSources;

  if (typeof src.zipCode === "string") {
    const z = src.zipCode.trim();
    if (z && z.length <= 12) f.zipCode = z;
  }
  const radiusMiles = clampNumber(src.radiusMiles, 1, 500);
  if (radiusMiles != null) f.radiusMiles = Math.round(radiusMiles);

  if (Array.isArray(src.locations)) {
    const locs: Array<{ zipCode: string; radiusMiles: number; label?: string }> = [];
    for (const loc of src.locations.slice(0, 10)) {
      const zip = typeof loc?.zipCode === "string" ? loc.zipCode.trim() : "";
      const rad = clampNumber(loc?.radiusMiles, 1, 500);
      if (!zip || rad == null) continue;
      const label = typeof loc?.label === "string" ? loc.label.trim().slice(0, 40) : undefined;
      locs.push({ zipCode: zip, radiusMiles: Math.round(rad), ...(label ? { label } : {}) });
    }
    if (locs.length) f.locations = locs;
  }

  return f;
}

function sanitizePresets(value: any, maxPresets = 12): HomepagePreset[] {
  const arr = Array.isArray(value) ? value : [];
  const out: HomepagePreset[] = [];
  for (const item of arr) {
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    if (!label) continue;
    const filters = sanitizePresetFilters(item?.filters);
    out.push({
      label: label.slice(0, 40),
      filters,
      ...(typeof item?.rationale === "string" && item.rationale.trim()
        ? { rationale: item.rationale.trim().slice(0, 160) }
        : {}),
    });
    if (out.length >= maxPresets) break;
  }
  return out;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  const v = sorted[idx];
  return Number.isFinite(v) ? v : null;
}

function formatUsd(n: number | null): string {
  if (n == null) return "n/a";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString()}`;
  }
}

function getMissingColumn(err: any): string | null {
  const message = String(err?.message || "");
  const match =
    message.match(/column\s+[\w.]+\.(\w+)\s+does\s+not\s+exist/i) ||
    message.match(/column\s+(\w+)\s+does\s+not\s+exist/i);
  return match?.[1] || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return okJson({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const body = await req.json().catch(() => ({}));

    const action = String(body?.action || "generate_presets");
    const maxVehiclesRaw = Number(body?.max_vehicles ?? 260);
    const maxVehicles = Math.max(50, Math.min(600, Number.isFinite(maxVehiclesRaw) ? Math.floor(maxVehiclesRaw) : 260));
    const maxPresetsRaw = Number(body?.max_presets ?? 10);
    const maxPresets = Math.max(3, Math.min(20, Number.isFinite(maxPresetsRaw) ? Math.floor(maxPresetsRaw) : 10));
    const dryRun = Boolean(body?.dry_run);

    if (action !== "generate_presets" && action !== "dry_run") {
      return okJson({ success: false, error: `Unknown action: ${action}` }, 400);
    }

    const selectV2 = "id, year, make, model, canonical_body_style, canonical_vehicle_type, body_style, asking_price, current_value, sale_price, is_for_sale, created_at, discovery_url, discovery_source, profile_origin";
    const selectV1 = "id, year, make, model, body_style, asking_price, current_value, sale_price, is_for_sale, created_at, discovery_url, discovery_source, profile_origin";

    const runVehicleQuery = async (selectFields: string) => {
      try {
        return await supabase
          .from("vehicles")
          .select(selectFields)
          .eq("is_public", true)
          .order("created_at", { ascending: false })
          .limit(maxVehicles);
      } catch (e) {
        return { data: null, error: e };
      }
    };

    let vehicles: any[] | null = null;
    let error: any = null;

    let res = await runVehicleQuery(selectV2);
    vehicles = res.data as any[] | null;
    error = res.error;

    if (error && getMissingColumn(error)?.startsWith("canonical_")) {
      res = await runVehicleQuery(selectV1);
      vehicles = res.data as any[] | null;
      error = res.error;
    }

    if (error) {
      return okJson(
        {
          success: false,
          error: "Failed to load vehicles",
          details: { message: error?.message || String(error) },
        },
        500,
      );
    }

    const rows = (vehicles || []).filter((v) => v && typeof v === "object");
    const makesCount = new Map<string, number>();
    const bodyCount = new Map<string, number>();
    const prices: number[] = [];
    let forSaleCount = 0;
    let created24h = 0;
    const now = Date.now();
    const dayAgoIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    for (const v of rows) {
      const make = typeof v.make === "string" ? v.make.trim() : "";
      if (make) makesCount.set(make, (makesCount.get(make) || 0) + 1);

      const bodyStyle =
        (typeof v.canonical_body_style === "string" && v.canonical_body_style.trim()) ||
        (typeof v.body_style === "string" && v.body_style.trim()) ||
        "";
      if (bodyStyle) bodyCount.set(bodyStyle, (bodyCount.get(bodyStyle) || 0) + 1);

      const price = Number(v.asking_price ?? v.sale_price ?? v.current_value ?? NaN);
      if (Number.isFinite(price) && price > 0) prices.push(price);

      if (v.is_for_sale === true) forSaleCount += 1;
      if (typeof v.created_at === "string" && v.created_at >= dayAgoIso) created24h += 1;
    }

    prices.sort((a, b) => a - b);
    const p10 = percentile(prices, 0.1);
    const p50 = percentile(prices, 0.5);
    const p90 = percentile(prices, 0.9);

    const topMakes = Array.from(makesCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => ({ name, count }));

    const topBodyStyles = Array.from(bodyCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => ({ name, count }));

    const sample = rows.slice(0, Math.min(90, rows.length)).map((v) => {
      const title = `${v.year || "?"} ${v.make || "?"} ${v.model || "?"}`.replace(/\s+/g, " ").trim();
      const bodyStyle =
        (typeof v.canonical_body_style === "string" && v.canonical_body_style.trim()) ||
        (typeof v.body_style === "string" && v.body_style.trim()) ||
        null;
      const price = Number(v.asking_price ?? v.sale_price ?? v.current_value ?? NaN);
      const priceStr = Number.isFinite(price) && price > 0 ? formatUsd(price) : "n/a";
      return `- ${title} | body:${bodyStyle || "n/a"} | price:${priceStr} | for_sale:${v.is_for_sale ? "yes" : "no"} | id:${v.id}`;
    });

    const rawContext = [
      `TOTAL_VEHICLES: ${rows.length}`,
      `CREATED_LAST_24H: ${created24h}`,
      `FOR_SALE_TRUE: ${forSaleCount}`,
      `PRICE_P10_P50_P90: ${formatUsd(p10)} / ${formatUsd(p50)} / ${formatUsd(p90)}`,
      "",
      "TOP_MAKES:",
      ...topMakes.map((m) => `- ${m.name}: ${m.count}`),
      "",
      "TOP_BODY_STYLES:",
      ...topBodyStyles.map((b) => `- ${b.name}: ${b.count}`),
      "",
      "RECENT_SAMPLE:",
      ...sample,
    ].join("\n");

    if (dryRun || action === "dry_run") {
      return okJson({
        success: true,
        dry_run: true,
        max_vehicles: maxVehicles,
        stats: {
          total: rows.length,
          created_last_24h: created24h,
          for_sale_true: forSaleCount,
          price_p10: p10,
          price_p50: p50,
          price_p90: p90,
          top_makes: topMakes,
          top_body_styles: topBodyStyles,
        },
        context_chars: rawContext.length,
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return okJson(
        {
          success: false,
          error: "Missing OPENAI_API_KEY (set in Supabase Edge Function secrets)",
        },
        500,
      );
    }

    const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : "gpt-4o-mini";

    // RLM: If context is big, compress it to bullet context first.
    const needsRlm = rawContext.length > 24_000;
    const rlm = needsRlm
      ? await rlmSummarize({
          goal: "Summarize this vehicle feed so we can propose great homepage filter presets.",
          context: rawContext,
          llm: async ({ prompt, temperature, maxTokens }) => {
            const r = await callOpenAiChatCompletions({
              apiKey: openaiKey,
              body: {
                model,
                messages: [{ role: "user", content: prompt }],
                max_tokens: Math.max(256, Math.min(1200, Number(maxTokens || 900))),
                temperature: typeof temperature === "number" ? temperature : 0.2,
              },
              timeoutMs: 25_000,
            });
            if (!r.ok) throw new Error(`OpenAI error: ${r.status}`);
            return r.content_text || "";
          },
          options: { maxDepth: 2, maxCalls: 8, chunkSizeChars: 12_000, chunkOverlapChars: 800, maxTokens: 900, temperature: 0.2 },
        })
      : { summary: rawContext, calls_used: 0, truncated: false };

    const system = [
      "You are Ralph Wiggum RLM, an opinionated homepage curator for an enthusiast vehicle feed.",
      "Return ONLY valid JSON.",
      "Your job: propose filter presets that produce interesting, non-empty results for typical vehicle feeds.",
      "",
      "Output schema (JSON object):",
      "{",
      '  "presets": [',
      "    {",
      '      "label": "string (<=40 chars)",',
      '      "filters": {',
      "        // CursorHomepage FilterState keys (use only what you need)",
      '        "yearMin"?: number, "yearMax"?: number,',
      '        "priceMin"?: number, "priceMax"?: number,',
      '        "makes"?: string[], "bodyStyles"?: string[],',
      '        "is4x4"?: boolean, "hasImages"?: boolean,',
      '        "forSale"?: boolean, "addedTodayOnly"?: boolean',
      "      },",
      '      "rationale"?: "string (<=160 chars)"',
      "    }",
      "  ],",
      '  "hero"?: { "title": "string", "subtitle": "string" },',
      '  "notes"?: string[]',
      "}",
      "",
      "Constraints:",
      `- Return 6-${maxPresets} presets.`,
      "- Mix: budget, high-end, new today, for-sale, specific body styles, a few top makes, and at least one 4x4/truck-ish preset when plausible.",
      "- Prefer broad-enough presets; avoid being too narrow (no VIN-specific / single-car filters).",
      "- Use only makes/body styles that appear in the provided context.",
    ].join("\n");

    const user = [
      "Here is the (possibly RLM-compressed) feed context. Use it to pick good presets.",
      "",
      rlm.summary,
    ].join("\n");

    const gen = await callOpenAiChatCompletions({
      apiKey: openaiKey,
      body: {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 1400,
        temperature: 0.25,
        response_format: { type: "json_object" },
      },
      timeoutMs: 35_000,
    });

    if (!gen.ok) {
      return okJson(
        {
          success: false,
          error: "LLM generation failed",
          details: { status: gen.status, raw: gen.raw?.error || gen.raw },
        },
        500,
      );
    }

    const parsed = extractJson(gen.content_text || "");
    if (!parsed) {
      return okJson(
        { success: false, error: "LLM returned invalid JSON", details: { sample: (gen.content_text || "").slice(0, 500) } },
        500,
      );
    }

    const presets = sanitizePresets(parsed?.presets, maxPresets);
    const hero =
      parsed?.hero && typeof parsed.hero === "object"
        ? {
            title: typeof parsed.hero.title === "string" ? parsed.hero.title.trim().slice(0, 80) : "",
            subtitle: typeof parsed.hero.subtitle === "string" ? parsed.hero.subtitle.trim().slice(0, 140) : "",
          }
        : undefined;

    const notes = sanitizeStringArray(parsed?.notes, 12);

    const payload: HomepageRlmResponse = {
      presets,
      ...(hero?.title ? { hero } : {}),
      ...(notes.length ? { notes } : {}),
    };

    return okJson({
      success: true,
      model,
      rlm: { used: needsRlm, calls_used: rlm.calls_used, truncated: rlm.truncated, context_chars: rawContext.length },
      output: payload,
    });
  } catch (error: any) {
    console.error("ralph-wiggum-rlm-homepage error:", error);
    return okJson({ success: false, error: error?.message || String(error) }, 500);
  }
});

