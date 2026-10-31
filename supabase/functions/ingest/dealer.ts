import { archiveFetch, readArchivedPage } from "../_shared/archiveFetch.ts";
import { dealerListing, parseDealerListing, DEALERS, DEALER_PARSER } from "../_shared/dealerParser.ts";
import { intakeThrottle } from "../poll-listing-feeds/ledger.ts";
import { landClassifiedListing } from "./classifiedEvent.ts";
import { normalizeVehicleFields } from "../_shared/normalizeVehicle.ts";

export function dealerIdentityConflict(input: { year?: number; make?: string; model?: string }, fields: { year: number; make: string; model: string }): boolean {
  const supplied: Record<string, any> = { ...input }, native: Record<string, any> = { ...fields };
  normalizeVehicleFields(supplied); normalizeVehicleFields(native);
  return (["year", "make", "model"] as const).some(key => input[key] != null &&
    String(supplied[key]).toLowerCase().trim() !== String(native[key]).toLowerCase().trim());
}

export interface DealerCapture {
  snapshot_id: string; source_id: string; observed_at: string; snapshot_fetched_at: string;
  hash: string; visit_run_id?: string | null; acquisition: "retained_direct" | "public_direct"; fields: ReturnType<typeof parseDealerListing>;
}
export async function prepareDealerCapture(db: any, url: string, fetchPage = archiveFetch, readPage = readArchivedPage): Promise<DealerCapture> {
  const listing = dealerListing(url);
  if (!listing) throw Error("dealer_listing_url_invalid");
  const [source, feed, config] = await Promise.all([
    db.from("observation_sources").select("id,species,supported_observations").eq("slug", DEALERS[listing.platform].slug).maybeSingle(),
    db.from("listing_feeds").select("enabled,poll_interval_minutes").eq("source_slug", listing.platform).single(),
    db.from("platform_config").select("config_value").eq("config_key", "source_intake").maybeSingle(),
  ]);
  if (source.error || source.data?.species !== "dealer" || !source.data.supported_observations?.includes("listing")) throw Error("dealer_source_not_registered");
  // Missing/ambiguous feed controls are a hold, including fresh installations.
  // This repair never creates or enables a collection target implicitly.
  if (feed.error || !feed.data || config.error) throw Error("dealer_controls_unavailable");
  const throttle = intakeThrottle(config.data?.config_value ?? {}), control = throttle.sources[listing.platform];
  if (!feed.data.enabled || !throttle.enabled || throttle.max_feeds === 0 || throttle.max_ingests === 0 || control?.enabled === false || control?.max_ingests === 0) throw Error("dealer_intake_held");
  const maxAgeSec = Number(feed.data.poll_interval_minutes) * 60;
  if (!Number.isFinite(maxAgeSec) || maxAgeSec <= 0) throw Error("dealer_controls_unavailable");
  // A service-only operational witness attests a new visit even if retention
  // reused an unchanged older body. Replays keep that visit clock and identity.
  const witnesses = await db.from("extraction_runs").select("id,started_at,completed_at,metadata")
    .eq("source", "dealer-direct").eq("status", "completed")
    .gte("started_at", new Date(Date.now() - maxAgeSec * 1000).toISOString())
    .contains("metadata", { profile: "public_dealer_direct_v1", url: listing.url, platform: listing.platform, source_id: source.data.id })
    .order("started_at", { ascending: false }).limit(1);
  if (witnesses.error) throw Error("dealer_visit_progress_unavailable");
  const witness = witnesses.data?.[0];
  let capture: Awaited<ReturnType<typeof archiveFetch>>;
  const fetchStarted = new Date().toISOString();
  if (witness) {
    const w = witness.metadata, clock = Date.parse(w?.observed_at);
    const started = Date.parse(witness.started_at), completed = Date.parse(witness.completed_at);
    if (!w || w.profile !== "public_dealer_direct_v1" || w.url !== listing.url || w.platform !== listing.platform || w.source_id !== source.data.id) throw Error("dealer_visit_identity_invalid");
    if (![clock, started, completed].every(Number.isFinite) || clock < started || clock > completed || completed > Date.now()
      || started < Date.now() - maxAgeSec * 1000) throw Error("dealer_visit_clock_invalid");
    const saved = await readPage(listing.url, { platform: listing.platform, snapshotId: w.snapshot_id, htmlOnly: true });
    capture = { html: saved.html, markdown: null, snapshotId: saved.snapshotId, cached: true, source: "cache",
      url: listing.url, platform: listing.platform, statusCode: null, error: null, costCents: 0 };
  } else {
    capture = await fetchPage(listing.url, { platform: listing.platform, maxAgeSec,
      useFirecrawl: false, firecrawlOnBlock: false, includeMarkdown: false, directFetchOptions: { publicOnly: true }, callerName: "ingest:dealer-native" });
  }
  const observedAt = new Date().toISOString();
  if (capture.error || capture.archiveError || !capture.html || !capture.snapshotId || (!capture.cached && capture.statusCode !== 200)) throw Error("dealer_capture_required");
  const row = await db.from("listing_page_snapshots").select("id,platform,listing_url,fetched_at,html_sha256,success,http_status")
    .eq("id", capture.snapshotId).maybeSingle();
  const s = row.data;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capture.html)))].map(v => v.toString(16).padStart(2, "0")).join("");
  if (row.error || !s || !s.success || s.http_status !== 200 || s.platform !== listing.platform || s.listing_url !== listing.url
    || s.html_sha256 !== hash || !Number.isFinite(Date.parse(s.fetched_at)) || Date.parse(s.fetched_at) > Date.parse(observedAt)) throw Error("dealer_capture_mismatch");
  const fields = parseDealerListing(capture.html, listing.url);
  let visitClock = s.fetched_at, visitRunId: string | null = witness?.id ?? null;
  if (witness) {
    if (witness.metadata.snapshot_id !== s.id || witness.metadata.html_sha256 !== hash
      || Date.parse(witness.metadata.original_snapshot_fetched_at) !== Date.parse(s.fetched_at)) throw Error("dealer_visit_capture_mismatch");
    visitClock = witness.metadata.observed_at;
  } else if (!capture.cached) {
    // A newly retained body already has the capture clock. Reused old bodies
    // need a distinct actual visit clock, never a fabricated new body timestamp.
    visitClock = Date.parse(s.fetched_at) >= Date.parse(fetchStarted) ? s.fetched_at : observedAt;
    const receipt = await db.from("extraction_runs").insert({ source: "dealer-direct", status: "completed", started_at: fetchStarted,
      completed_at: observedAt, metadata: { profile: "public_dealer_direct_v1", url: listing.url, platform: listing.platform,
        source_id: source.data.id, snapshot_id: s.id, html_sha256: hash, observed_at: visitClock, original_snapshot_fetched_at: s.fetched_at } }).select("id").single();
    if (receipt.error || !receipt.data?.id) throw Error("dealer_visit_not_acknowledged");
    visitRunId = receipt.data.id;
  }
  return { snapshot_id: s.id, source_id: source.data.id, observed_at: visitClock,
    snapshot_fetched_at: s.fetched_at, hash, visit_run_id: visitRunId, acquisition: witness || !capture.cached ? "public_direct" : "retained_direct", fields };
}

export async function landDealerCapture(db: any, capture: DealerCapture, vehicleId: string) {
  const f = capture.fields, { price: _asking, ...fields } = f;
  const payload = { source_slug: DEALERS[f.platform].slug, vehicle_id: vehicleId, kind: "listing", source_url: f.url,
    source_identifier: `${DEALER_PARSER}:${capture.snapshot_id}:${capture.observed_at}`, observed_at: capture.observed_at,
    raw_source_ref: `listing_page_snapshots:${capture.snapshot_id}`, extraction_method: DEALER_PARSER, defer_analysis: true,
    content_text: f.description ?? `${f.year} ${f.make} ${f.model}`,
    structured_data: { ...fields, asking_price: f.price, source_claims_only: true, source_event_time_status: "unknown",
      factory_configuration_status: "unknown", current_configuration_status: "unknown" },
    extraction_metadata: { snapshot_id: capture.snapshot_id, source_capture_sha256: capture.hash, acquisition: capture.acquisition,
      original_snapshot_fetched_at: capture.snapshot_fetched_at, visit_run_id: capture.visit_run_id ?? null,
      clock_basis: capture.visit_run_id ? "public_visit" : "retained_body_capture" },
  };
  const admitted = await db.functions.invoke("ingest-observation", { body: payload });
  if (admitted.error || admitted.data?.success !== true || !admitted.data.observation_id) throw Error("dealer_observation_admission_failed");
  const read = await db.from("vehicle_observations").select("id,vehicle_id,source_id,source_url,raw_source_ref")
    .eq("id", admitted.data.observation_id).eq("observed_at", capture.observed_at).eq("is_superseded", false).maybeSingle();
  const o = read.data;
  if (read.error || !o || o.vehicle_id !== vehicleId || o.source_id !== capture.source_id || o.source_url !== f.url || o.raw_source_ref !== payload.raw_source_ref) throw Error("dealer_observation_readback_failed");
  const listing = await landClassifiedListing(db, { vehicleId, platform: f.platform, listingUrl: f.url, listingId: f.stock_id,
    price: f.price, postedAt: null, observedAt: capture.observed_at });
  if (listing.event.action === "error" || !("id" in listing.event) || !listing.event.id || listing.for_sale === "error") throw Error("dealer_listing_projection_failed");
  return { observation_id: o.id, snapshot_id: capture.snapshot_id, listing_event_id: listing.event.id,
    duplicate: admitted.data.duplicate === true, observed_at: capture.observed_at };
}
