import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type LiveAuctionTrackerRequest = {
  batch_size?: number;
  cooldown_seconds?: number;
  include_active?: boolean;
  platforms?: string[];
  max_duration_ms?: number;
  per_listing_timeout_ms?: number;
};

type ListingRow = {
  id: string;
  platform: string | null;
  listing_url: string | null;
  listing_status: string | null;
  end_date: string | null;
  last_synced_at: string | null;
  updated_at: string | null;
  metadata?: Record<string, unknown> | null;
};

type SyncMode = "externalListingId" | "listing_id" | "batch";

type FunctionSpec = {
  name: string;
  mode: SyncMode;
};

const jsonHeaders = { "Content-Type": "application/json" };
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_COOLDOWN_SECONDS = 15;
const DEFAULT_MAX_DURATION_MS = 25_000;
const DEFAULT_PER_LISTING_TIMEOUT_MS = 15_000;

const PLATFORM_FUNCTIONS: Record<string, FunctionSpec> = {
  bat: { name: "sync-bat-listing", mode: "externalListingId" },
  bring_a_trailer: { name: "sync-bat-listing", mode: "externalListingId" },
  bringatrailer: { name: "sync-bat-listing", mode: "externalListingId" },
  cars_and_bids: { name: "sync-cars-and-bids-listing", mode: "externalListingId" },
  carsandbids: { name: "sync-cars-and-bids-listing", mode: "externalListingId" },
  carsandbids_com: { name: "sync-cars-and-bids-listing", mode: "externalListingId" },
  collecting_cars: { name: "monitor-collecting-cars-listings", mode: "listing_id" },
  broad_arrow: { name: "monitor-broad-arrow-listings", mode: "listing_id" },
  pcarmarket: { name: "monitor-pcarmarket-listings", mode: "listing_id" },
  hagerty: { name: "hagerty-bid-tracker", mode: "batch" },
  sbx: { name: "monitor-sbxcars-listings", mode: "batch" },
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    let payload = parts[1];
    payload = payload.replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4 !== 0) payload += "=";
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isServiceRoleAuth(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length);
  const payload = decodeJwtPayload(token);
  return payload?.role === "service_role";
}

function normalizePlatform(platform: string | null): string {
  return String(platform || "").trim().toLowerCase();
}

function safeMetaText(metadata: ListingRow["metadata"]): string {
  if (!metadata || typeof metadata !== "object") return "";
  try {
    return JSON.stringify(metadata).toLowerCase();
  } catch {
    return "";
  }
}

function isLikelyLive(listing: ListingRow, includeActive: boolean): boolean {
  const status = String(listing.listing_status || "").toLowerCase();
  if (status === "live") return true;
  if (!includeActive) return false;

  const meta = listing.metadata || {};
  const metaText = safeMetaText(meta);
  const url = String(listing.listing_url || "").toLowerCase();
  const type = String((meta as any).auction_type || (meta as any).sale_type || "").toLowerCase();
  const statusHint = String((meta as any).auction_status || (meta as any).status || "").toLowerCase();
  const isLiveFlag =
    (meta as any).is_live_auction === true ||
    (meta as any).live === true ||
    statusHint === "live" ||
    type.includes("live");

  if (isLiveFlag) return true;
  if (url.includes("live-auction") || url.includes("/live/") || url.includes("livestream")) return true;
  if (!listing.end_date && metaText.includes("live")) return true;

  return false;
}

function isPastCooldown(listing: ListingRow, cutoffMs: number): boolean {
  const last = listing.last_synced_at || listing.updated_at;
  if (!last) return true;
  const ts = Date.parse(last);
  if (!Number.isFinite(ts)) return true;
  return ts <= cutoffMs;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function callEdgeFunction(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  name: string;
  body: Record<string, unknown>;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const response = await fetch(`${args.supabaseUrl}/functions/v1/${args.name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.serviceRoleKey}`,
      },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error: any) {
    return { ok: false, status: 0, data: { error: error?.message || String(error) } };
  } finally {
    clearTimeout(timeout);
  }
}

async function markSynced(supabase: any, ids: string[], nowIso: string) {
  const chunks = chunkArray(ids, 100);
  for (const chunk of chunks) {
    await supabase
      .from("external_listings")
      .update({ last_synced_at: nowIso })
      .in("id", chunk);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, ...jsonHeaders },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!isServiceRoleAuth(authHeader)) {
    return new Response(JSON.stringify({ success: false, error: "Not authorized" }), {
      status: 403,
      headers: { ...corsHeaders, ...jsonHeaders },
    });
  }

  const body = (await req.json().catch(() => ({}))) as LiveAuctionTrackerRequest;
  const batchSize = Math.max(1, Math.min(200, Number(body.batch_size || DEFAULT_BATCH_SIZE)));
  const cooldownSeconds = Math.max(1, Math.min(300, Number(body.cooldown_seconds || DEFAULT_COOLDOWN_SECONDS)));
  const includeActive = body.include_active !== false;
  const maxDurationMs = Math.max(5_000, Math.min(55_000, Number(body.max_duration_ms || DEFAULT_MAX_DURATION_MS)));
  const perListingTimeoutMs = Math.max(
    2_000,
    Math.min(30_000, Number(body.per_listing_timeout_ms || DEFAULT_PER_LISTING_TIMEOUT_MS))
  );
  const platformFilter = Array.isArray(body.platforms)
    ? body.platforms.map((p) => normalizePlatform(p)).filter(Boolean)
    : [];

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ success: false, error: "Missing Supabase configuration" }), {
      status: 500,
      headers: { ...corsHeaders, ...jsonHeaders },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startTime = Date.now();
  const nowIso = new Date().toISOString();
  const cutoffMs = Date.now() - cooldownSeconds * 1000;

  let query = supabase
    .from("external_listings")
    .select(
      "id, platform, listing_url, listing_status, end_date, last_synced_at, updated_at, metadata, sync_enabled"
    )
    .eq("sync_enabled", true)
    .in("listing_status", includeActive ? ["live", "active"] : ["live"])
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(batchSize * 4);

  if (platformFilter.length > 0) {
    query = query.in("platform", platformFilter);
  }

  const { data: listings, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, ...jsonHeaders },
    });
  }

  const skipped = {
    cooldown: 0,
    not_live: 0,
    unknown_platform: 0,
    timeout: 0,
  };

  const liveCandidates: ListingRow[] = [];
  for (const listing of (listings as ListingRow[]) || []) {
    if (!isLikelyLive(listing, includeActive)) {
      skipped.not_live += 1;
      continue;
    }
    if (!isPastCooldown(listing, cutoffMs)) {
      skipped.cooldown += 1;
      continue;
    }
    liveCandidates.push(listing);
    if (liveCandidates.length >= batchSize) break;
  }

  if (liveCandidates.length === 0) {
    return new Response(
      JSON.stringify({
        success: true,
        message: "No live auctions due for tracking",
        checked: listings?.length || 0,
        tracked: 0,
        skipped,
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, ...jsonHeaders } }
    );
  }

  const batchPlatforms = new Map<string, ListingRow[]>();
  const perListingTasks: Array<{ listing: ListingRow; spec: FunctionSpec }> = [];

  for (const listing of liveCandidates) {
    const platform = normalizePlatform(listing.platform);
    const spec = PLATFORM_FUNCTIONS[platform];
    if (!spec) {
      skipped.unknown_platform += 1;
      continue;
    }
    if (spec.mode === "batch") {
      const existing = batchPlatforms.get(platform) || [];
      existing.push(listing);
      batchPlatforms.set(platform, existing);
    } else {
      perListingTasks.push({ listing, spec });
    }
  }

  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  let tracked = 0;

  for (const [platform, platformListings] of batchPlatforms.entries()) {
    const spec = PLATFORM_FUNCTIONS[platform];
    const remainingMs = maxDurationMs - (Date.now() - startTime);
    if (remainingMs <= 0) {
      skipped.timeout += platformListings.length;
      continue;
    }
    const response = await callEdgeFunction({
      supabaseUrl,
      serviceRoleKey,
      name: spec.name,
      body: { batch_size: Math.min(platformListings.length, batchSize) },
      timeoutMs: Math.min(perListingTimeoutMs, remainingMs),
    });
    results.push({
      platform,
      mode: "batch",
      function: spec.name,
      ok: response.ok,
      status: response.status,
    });
    if (!response.ok) {
      errors.push(`${platform}: ${spec.name} failed (${response.status})`);
      continue;
    }
    await markSynced(supabase, platformListings.map((l) => l.id), nowIso);
    tracked += platformListings.length;
  }

  for (const task of perListingTasks) {
    const remainingMs = maxDurationMs - (Date.now() - startTime);
    if (remainingMs <= 0) {
      skipped.timeout += 1;
      continue;
    }
    const body =
      task.spec.mode === "externalListingId"
        ? { externalListingId: task.listing.id }
        : { listing_id: task.listing.id };
    const response = await callEdgeFunction({
      supabaseUrl,
      serviceRoleKey,
      name: task.spec.name,
      body,
      timeoutMs: Math.min(perListingTimeoutMs, remainingMs),
    });
    results.push({
      listing_id: task.listing.id,
      platform: normalizePlatform(task.listing.platform),
      mode: task.spec.mode,
      function: task.spec.name,
      ok: response.ok,
      status: response.status,
    });
    if (!response.ok) {
      errors.push(`${task.listing.id}: ${task.spec.name} failed (${response.status})`);
      continue;
    }
    await markSynced(supabase, [task.listing.id], nowIso);
    tracked += 1;
  }

  return new Response(
    JSON.stringify({
      success: true,
      checked: listings?.length || 0,
      candidates: liveCandidates.length,
      tracked,
      skipped,
      errors,
      duration_ms: Date.now() - startTime,
      results,
    }),
    { headers: { ...corsHeaders, ...jsonHeaders } }
  );
});
