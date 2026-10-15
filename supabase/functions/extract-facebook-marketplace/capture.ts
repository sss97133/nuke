/** Browser testimony lands in the existing sweep ledger; sightings point to that immutable pass. */
export interface BrowserCapture {
  capture_id: string;
  observed_at: string;
  target_url: string;
  actual_url: string;
  retrieval_surface: string;
  actual_region: string;
  complete: boolean;
  access_state: "available";
  source_listed_at?: string | null;
}

export function captureReference(capture: BrowserCapture) {
  return { capture_id: capture.capture_id, observed_at: capture.observed_at };
}

export function isSavedCapture(capture?: BrowserCapture) {
  return capture?.retrieval_surface === "chrome_mv3_rendered_saved_cards";
}

async function digest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("");
}

export async function captureSightingId(captureId: string, listingId: string): Promise<string> {
  const h = await digest(["fb-browser-sighting-v1", captureId, listingId]);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

export function validateCapture(capture: BrowserCapture, batch: any[]) {
  if (!capture || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(capture.capture_id ?? "")) {
    throw new Error("valid capture_id UUID required");
  }
  const at = Date.parse(capture.observed_at);
  if (!Number.isFinite(at) || at > Date.now() + 300_000) throw new Error("valid, non-future observed_at required");
  const saved = isSavedCapture(capture);
  for (const key of ["target_url", "actual_url"] as const) {
    const url = new URL(capture[key]);
    if (url.protocol !== "https:" || !["www.facebook.com", "facebook.com"].includes(url.hostname) ||
        !(saved ? url.pathname === "/saved/" : url.pathname.startsWith("/marketplace/")) || url.username || url.password || url.port) {
      throw new Error("Facebook Marketplace browser surface required");
    }
  }
  if (capture.access_state !== "available" || !capture.retrieval_surface || !capture.actual_region ||
      typeof capture.complete !== "boolean") throw new Error("source access, surface, region and completeness required");
  if (!Array.isArray(batch) || batch.length < 1 || batch.length > 50) throw new Error("capture batch must contain 1–50 cards");
  const ids = new Set();
  for (const item of batch) {
    if (!/^\d+$/.test(item.facebook_id ?? "") || ids.has(item.facebook_id) || !item.content_text) {
      throw new Error("unique facebook_id and original content_text required per card");
    }
    if (saved && (item.url !== `https://www.facebook.com/marketplace/item/${item.facebook_id}/` || item.status !== "unknown")) {
      throw new Error("Saved capture requires exact Marketplace item URLs and unknown availability");
    }
    ids.add(item.facebook_id);
  }
  if (JSON.stringify({ capture, batch }).length > 200_000) throw new Error("capture exceeds bounded payload size");
}

/** A retry must use the same capture ID AND original payload. It never refreshes the source clock. */
export async function handleBrowserCapture(
  supabase: any,
  body: { capture: BrowserCapture; batch: any[] },
  handleDirect: (body: any) => Promise<Response>,
) {
  const { capture, batch } = body;
  validateCapture(capture, batch);
  const contentHash = await digest({ capture, batch });
  const readRun = () => supabase.from("fb_sweep_jobs").select("id, status, metadata")
    .eq("id", capture.capture_id).maybeSingle();
  let { data: run, error } = await readRun();
  if (error) throw error;
  if (!run) {
    const inserted = await supabase.from("fb_sweep_jobs").insert({
      id: capture.capture_id, started_at: new Date().toISOString(), status: "running",
      locations_total: 1, listings_found: batch.length,
      // Original material stays here on retries and revisits. No disappearance/sale inference.
      metadata: { writer: "extract-facebook-marketplace", capture_version: 1, capture, batch, content_hash: contentHash },
    });
    if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    ({ data: run, error } = await readRun());
    if (error || !run) throw error ?? new Error("capture ledger insert not acknowledged");
  }
  if (run.metadata?.content_hash !== contentHash) throw new Error("capture_id already holds different original testimony");

  const results = [];
  for (const item of batch) {
    try {
      const response = await handleDirect({ ...item, mode: "direct", capture });
      const result = await response.json();
      results.push({ facebook_id: item.facebook_id, ...result, success: response.ok && result.success === true });
    } catch (e) {
      results.push({ facebook_id: item.facebook_id, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const counts = {
    fetched: batch.length,
    raw_landed: batch.length,
    listings_landed: results.filter(r => r.listing_landed).length,
    sightings_landed: results.filter(r => r.sighting_landed).length,
    new_listings: results.filter(r => r.is_new).length,
    duplicate_sightings: results.filter(r => r.duplicate_capture).length,
    linked_observations: results.filter(r => r.observation_landing?.observation_id).length,
    unlinked: results.filter(r => r.observation_landing?.status === "unlinked").length,
    private_source: results.filter(r => r.observation_landing?.status === "private_source").length,
    errors: results.filter(r => !r.success).length,
  };
  // Keep the first successful completion receipt when an identical pass is replayed.
  if (run.status !== "completed") {
    const finished = await supabase.from("fb_sweep_jobs").update({
      status: counts.errors ? "failed" : "completed", completed_at: new Date().toISOString(),
      locations_processed: 1, new_listings: counts.new_listings, errors: counts.errors,
      error_details: results.filter(r => !r.success).map(r => ({ facebook_id: r.facebook_id, error: r.error ?? r.errors })),
      metadata: { ...run.metadata, landing: counts, results },
    }).eq("id", capture.capture_id).select("id").maybeSingle();
    if (finished.error || !finished.data) throw finished.error ?? new Error("capture completion not acknowledged");
  }
  return { success: counts.errors === 0, capture_id: capture.capture_id, observed_at: capture.observed_at, counts, results };
}
