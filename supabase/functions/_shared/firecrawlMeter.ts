/**
 * firecrawlMeter: the allowance check and the spend record behind every paid Firecrawl scrape (owner-lead rule, 2026-10-15).
 * The database maps a URL's host to a source (firecrawl_source_params.hosts); this module only asks and records.
 * Fail closed: an allowance that cannot be read is a no.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { projectSecretKey } from "./supabaseKeys.ts";

export type MeterClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message: string } | null }>;
};

let cached: MeterClient | null = null;

function defaultClient(): MeterClient | null {
  if (cached) return cached;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = projectSecretKey() ?? "";
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } }) as unknown as MeterClient;
  return cached;
}

/** True when at least one credit may be spent today on a scrape of this URL. */
export async function meterAllowance(url: string, client?: MeterClient): Promise<{ allowed: boolean; allowance: number; reason?: string }> {
  const c = client ?? defaultClient();
  if (!c) return { allowed: false, allowance: 0, reason: "no database client" };
  try {
    const r = await c.rpc("firecrawl_allowance_for_url", { p_url: url });
    if (r.error) return { allowed: false, allowance: 0, reason: r.error.message };
    const n = Number(r.data);
    return { allowed: Number.isFinite(n) && n >= 1, allowance: Number.isFinite(n) ? n : 0 };
  } catch (e) {
    return { allowed: false, allowance: 0, reason: String((e as Error)?.message ?? e) };
  }
}

/** One row in firecrawl_spend_log for a scrape that was sent. Never throws: a failed record is logged, not lost silently. */
export async function meterRecord(url: string, credits: number, lane: string, note: string, client?: MeterClient): Promise<void> {
  const c = client ?? defaultClient();
  if (!c) { console.error(`[firecrawlMeter] no client: ${credits} credit(s) for ${url} not recorded`); return; }
  try {
    const r = await c.rpc("firecrawl_record_url_spend", { p_url: url, p_credits: credits, p_lane: lane, p_note: note });
    if (r.error) console.error(`[firecrawlMeter] could not record ${credits} credit(s) for ${url}: ${r.error.message}`);
  } catch (e) {
    console.error(`[firecrawlMeter] could not record ${credits} credit(s) for ${url}: ${String((e as Error)?.message ?? e)}`);
  }
}
