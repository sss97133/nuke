import { archiveFetch } from "../_shared/archiveFetch.ts";
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
  hash: string; acquisition: "retained_direct" | "public_direct"; fields: ReturnType<typeof parseDealerListing>;
}
export async function prepareDealerCapture(db: any, url: string, fetchPage = archiveFetch): Promise<DealerCapture> {
  const listing = dealerListing(url);
  if (!listing) throw Error("dealer_listing_url_invalid");
  const [source, feed, config] = await Promise.all([
    db.from("observation_sources").select("id,species,supported_observations").eq("slug", DEALERS[listing.platform].slug).maybeSingle(),
    db.from("listing_feeds").select("enabled,poll_interval_minutes").eq("source_slug", listing.platform).single(),
    db.from("platform_config").select("config_value").eq("config_key", "source_intake").maybeSingle(),
  ]);
  if (source.error || source.data?.species !== "dealer" || !source.data.supported_observations?.includes("listing")) throw Error("dealer_source_not_registered");
  if (feed.error || config.error) throw Error("dealer_controls_unavailable");
  const throttle = intakeThrottle(config.data?.config_value ?? {}), control = throttle.sources[listing.platform];
  if (!feed.data.enabled || !throttle.enabled || throttle.max_feeds === 0 || throttle.max_ingests === 0 || control?.enabled === false || control?.max_ingests === 0) throw Error("dealer_intake_held");
  const capture = await fetchPage(listing.url, { platform: listing.platform, maxAgeSec: feed.data.poll_interval_minutes * 60,
    useFirecrawl: false, firecrawlOnBlock: false, includeMarkdown: false, directFetchOptions: { publicOnly: true }, callerName: "ingest:dealer-native" });
  const observedAt = new Date().toISOString();
  if (capture.error || capture.archiveError || !capture.html || !capture.snapshotId || (!capture.cached && capture.statusCode !== 200)) throw Error("dealer_capture_required");
  const row = await db.from("listing_page_snapshots").select("id,platform,listing_url,fetched_at,html_sha256,success,http_status")
    .eq("id", capture.snapshotId).maybeSingle();
  const s = row.data;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capture.html)))].map(v => v.toString(16).padStart(2, "0")).join("");
  if (row.error || !s || !s.success || s.http_status !== 200 || s.platform !== listing.platform || s.listing_url !== listing.url
    || s.html_sha256 !== hash || !Number.isFinite(Date.parse(s.fetched_at)) || Date.parse(s.fetched_at) > Date.parse(observedAt)) throw Error("dealer_capture_mismatch");
  return { snapshot_id: s.id, source_id: source.data.id, observed_at: capture.cached ? s.fetched_at : observedAt,
    snapshot_fetched_at: s.fetched_at, hash, acquisition: capture.cached ? "retained_direct" : "public_direct", fields: parseDealerListing(capture.html, listing.url) };
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
      original_snapshot_fetched_at: capture.snapshot_fetched_at },
  };
  const admitted = await db.functions.invoke("ingest-observation", { body: payload });
  if (admitted.error || admitted.data?.success !== true || !admitted.data.observation_id) throw Error("dealer_observation_admission_failed");
  const read = await db.from("vehicle_observations").select("id,vehicle_id,source_id,source_url,raw_source_ref")
    .eq("id", admitted.data.observation_id).eq("observed_at", capture.observed_at).maybeSingle();
  const o = read.data;
  if (read.error || !o || o.vehicle_id !== vehicleId || o.source_id !== capture.source_id || o.source_url !== f.url || o.raw_source_ref !== payload.raw_source_ref) throw Error("dealer_observation_readback_failed");
  const listing = await landClassifiedListing(db, { vehicleId, platform: f.platform, listingUrl: f.url, listingId: f.stock_id,
    price: f.price, postedAt: null, observedAt: capture.observed_at });
  if (listing.event.action === "error" || !("id" in listing.event) || !listing.event.id || listing.for_sale === "error") throw Error("dealer_listing_projection_failed");
  return { observation_id: o.id, snapshot_id: capture.snapshot_id, listing_event_id: listing.event.id,
    duplicate: admitted.data.duplicate === true, observed_at: capture.observed_at };
}
