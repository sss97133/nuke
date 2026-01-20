import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * RALPH WIGGUM RLM — EXTRACTION COORDINATOR
 *
 * Purpose: Provide a single JSON “coordination brief” for extraction ops:
 * - queue health snapshot
 * - top failing domains + error patterns
 * - source mapping/scrape staleness
 * - recommended next actions (human-readable)
 *
 * Deploy:
 *   supabase functions deploy ralph-wiggum-rlm-extraction-coordinator --no-verify-jwt
 *
 * Secrets required (at least one):
 *   OPENAI_API_KEY (recommended)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { callOpenAiChatCompletions } from "../_shared/openaiChat.ts";
import { rlmSummarize } from "../_shared/rlm.ts";

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
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeHost(url: string | null | undefined): string {
  try {
    if (!url) return "";
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    const s = String(url || "").trim().toLowerCase();
    const m = s.match(/^(?:https?:\/\/)?([^/]+)/i);
    return (m?.[1] || "").replace(/^www\./, "").toLowerCase();
  }
}

function topCounts(map: Map<string, number>, limit: number): Array<{ key: string; count: number }> {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function safeStringArray(value: any, max = 30): string[] {
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return okJson({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const body = await req.json().catch(() => ({}));

    const action = String(body?.action || "brief");
    const dryRun = Boolean(body?.dry_run) || action === "dry_run";
    const maxFailedSamplesRaw = Number(body?.max_failed_samples ?? 250);
    const maxFailedSamples = Math.max(50, Math.min(1000, Number.isFinite(maxFailedSamplesRaw) ? Math.floor(maxFailedSamplesRaw) : 250));

    if (action !== "brief" && action !== "dry_run") {
      return okJson({ success: false, error: `Unknown action: ${action}` }, 400);
    }

    const now = Date.now();
    const iso24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const iso7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const countStatus = async (status: string): Promise<number> => {
      const { count } = await supabase.from("import_queue").select("*", { count: "exact", head: true }).eq("status", status);
      return count || 0;
    };

    const [pending, processing, complete, failed, skipped] = await Promise.all([
      countStatus("pending"),
      countStatus("processing"),
      countStatus("complete"),
      countStatus("failed"),
      countStatus("skipped"),
    ]);

    const { count: totalVehicles } = await supabase.from("vehicles").select("*", { count: "exact", head: true });
    const { count: vehicles24h } = await supabase
      .from("vehicles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", iso24h);

    const { count: activeSources } = await supabase.from("scrape_sources").select("*", { count: "exact", head: true }).eq("is_active", true);

    // Active sources + site_maps coverage overview (best-effort; tolerate missing table/columns).
    let mappedSources = 0;
    let lowCoverageSources = 0;
    let staleSources = 0;
    let staleExamples: Array<{ domain: string; last_successful_scrape: string | null }> = [];
    try {
      const { data: sources } = await supabase
        .from("scrape_sources")
        .select("id, domain, last_successful_scrape")
        .eq("is_active", true)
        .limit(800);

      const ids = Array.from(new Set((sources || []).map((s: any) => String(s?.id || "")).filter(Boolean)));

      for (const s of (sources || []) as any[]) {
        const last = typeof s?.last_successful_scrape === "string" ? s.last_successful_scrape : null;
        if (!last || last < iso7d) {
          staleSources += 1;
          if (staleExamples.length < 10) staleExamples.push({ domain: String(s?.domain || ""), last_successful_scrape: last });
        }
      }

      if (ids.length > 0) {
        const { data: maps } = await supabase
          .from("site_maps")
          .select("source_id, coverage_percentage, status")
          .in("source_id", ids.slice(0, 800));

        const bySource = new Map<string, number>();
        for (const m of (maps || []) as any[]) {
          const sid = String(m?.source_id || "");
          if (!sid) continue;
          const cov = Number(m?.coverage_percentage || 0);
          if (!Number.isFinite(cov)) continue;
          bySource.set(sid, cov);
        }

        mappedSources = bySource.size;
        lowCoverageSources = Array.from(bySource.values()).filter((c) => c < 95).length;
      }
    } catch {
      // ignore
    }

    // Recent failed queue items → top domains + top error strings
    const domainFailures = new Map<string, number>();
    const errorPatterns = new Map<string, number>();
    let failedSampleCount = 0;
    try {
      const { data: failedRows } = await supabase
        .from("import_queue")
        .select("listing_url, error_message, attempts, updated_at, source_id")
        .eq("status", "failed")
        .order("updated_at", { ascending: false })
        .limit(maxFailedSamples);

      failedSampleCount = Array.isArray(failedRows) ? failedRows.length : 0;

      for (const row of (failedRows || []) as any[]) {
        const host = normalizeHost(row?.listing_url);
        if (host) domainFailures.set(host, (domainFailures.get(host) || 0) + 1);

        const err = typeof row?.error_message === "string" ? row.error_message.trim() : "";
        if (err) {
          // bucket by first ~120 chars (keeps patterns stable)
          const key = err.replace(/\s+/g, " ").slice(0, 120);
          errorPatterns.set(key, (errorPatterns.get(key) || 0) + 1);
        }
      }
    } catch {
      // ignore
    }

    const topFailDomains = topCounts(domainFailures, 15);
    const topErrors = topCounts(errorPatterns, 15);

    // Recent unified scraper cycles (best-effort)
    let recentCycles: any[] = [];
    try {
      const { data } = await supabase
        .from("scraper_runs")
        .select("cycle_id, started_at, completed_at, sources_checked, sources_scraped, queue_processed, vehicles_added, issues, status")
        .order("started_at", { ascending: false })
        .limit(5);
      if (Array.isArray(data)) recentCycles = data;
    } catch {
      // ignore
    }

    const snapshot = {
      queue: { pending, processing, complete, failed, skipped },
      vehicles: { total: totalVehicles || 0, created_last_24h: vehicles24h || 0 },
      sources: {
        active: activeSources || 0,
        mapped_estimate: mappedSources,
        low_coverage_estimate: lowCoverageSources,
        stale_7d_estimate: staleSources,
        stale_examples: staleExamples,
      },
      triage: {
        failed_sample_size: failedSampleCount,
        top_failed_domains: topFailDomains,
        top_error_patterns: topErrors,
      },
      recent_cycles: recentCycles,
    };

    const context = [
      "SYSTEM_SNAPSHOT (JSON):",
      JSON.stringify(snapshot),
      "",
      "Notes:",
      "- Provide a short coordination plan for a human team to act on.",
      "- Prefer low-risk actions first (unblock queue, reduce repeats, isolate blockers).",
      "- If you suggest SQL, keep it safe, scoped, and include a WHERE clause.",
    ].join("\n");

    if (dryRun) {
      return okJson({ success: true, dry_run: true, snapshot, context_chars: context.length });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return okJson(
        { success: false, error: "Missing OPENAI_API_KEY (set in Supabase Edge Function secrets)" },
        500,
      );
    }

    const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : "gpt-4o-mini";

    // RLM compress if needed (mostly defensive).
    const needsRlm = context.length > 24_000;
    const rlm = needsRlm
      ? await rlmSummarize({
          goal: "Summarize the pipeline snapshot into the most actionable coordination points.",
          context,
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
      : { summary: context, calls_used: 0, truncated: false };

    const system = [
      "You are Ralph Wiggum RLM, a pragmatic extraction-coordination lead.",
      "Return ONLY valid JSON.",
      "",
      "Output schema (JSON object):",
      "{",
      '  "headlines": string[],',
      '  "priorities_now": Array<{ title: string, why: string, steps: string[], estimated_impact?: string }>,',
      '  "priorities_next": Array<{ title: string, why: string, steps: string[], estimated_impact?: string }>,',
      '  "watchlist": string[],',
      '  "suggested_sql": string[],',
      '  "suggested_commands": string[]',
      "}",
      "",
      "Rules:",
      "- Keep it short and executable.",
      "- Prefer actions aligned with the snapshot (top failing domains/errors, queue shape, stale sources).",
      "- If suggesting SQL, keep it safe: always include WHERE, avoid destructive operations, suggest SELECT first when possible.",
      "- If suggesting commands, prefer curl to existing edge functions (e.g. unified-scraper-orchestrator, pipeline-orchestrator) and include only placeholders for keys.",
    ].join("\n");

    const user = [
      "Here is the (possibly RLM-compressed) snapshot/context. Produce the coordination brief.",
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
        max_tokens: 1600,
        temperature: 0.25,
        response_format: { type: "json_object" },
      },
      timeoutMs: 40_000,
    });

    if (!gen.ok) {
      return okJson(
        { success: false, error: "LLM generation failed", details: { status: gen.status, raw: gen.raw?.error || gen.raw } },
        500,
      );
    }

    const parsed = extractJson(gen.content_text || "");
    if (!parsed) {
      return okJson(
        { success: false, error: "LLM returned invalid JSON", details: { sample: (gen.content_text || "").slice(0, 600) } },
        500,
      );
    }

    const output = {
      headlines: safeStringArray(parsed?.headlines, 12),
      priorities_now: Array.isArray(parsed?.priorities_now) ? parsed.priorities_now.slice(0, 8) : [],
      priorities_next: Array.isArray(parsed?.priorities_next) ? parsed.priorities_next.slice(0, 8) : [],
      watchlist: safeStringArray(parsed?.watchlist, 12),
      suggested_sql: safeStringArray(parsed?.suggested_sql, 8),
      suggested_commands: safeStringArray(parsed?.suggested_commands, 8),
    };

    return okJson({
      success: true,
      model,
      rlm: { used: needsRlm, calls_used: rlm.calls_used, truncated: rlm.truncated, context_chars: context.length },
      snapshot,
      output,
    });
  } catch (error: any) {
    console.error("ralph-wiggum-rlm-extraction-coordinator error:", error);
    return okJson({ success: false, error: error?.message || String(error) }, 500);
  }
});

