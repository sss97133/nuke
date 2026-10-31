import { gatewayListing, parseGatewayListing, GATEWAY_PARSER } from "../_shared/gatewayParser.ts";
import { readGatewayBrowserCapture } from "../_shared/gatewayCapture.ts";
import { landClassifiedListing } from "./classifiedEvent.ts";

export interface GatewayCapture {
  snapshot_id: string; source_id: string; fetched_at: string; hash: string;
  snapshot_fetched_at: string; browser_run_id: string;
  fields: ReturnType<typeof parseGatewayListing>;
}

/** Browser acquisition is separate from intake. Never fetch, pay or infer when a capture is absent. */
export async function prepareGatewayCapture(db: any, url: string, read = readGatewayBrowserCapture): Promise<GatewayCapture> {
  const listing = gatewayListing(url);
  if (!listing) throw Error("gateway_listing_url_invalid");
  const source = await db.from("observation_sources").select("id,species,supported_observations")
    .eq("slug", "gateway-classic-cars").maybeSingle();
  if (source.error || source.data?.species !== "dealer" || !source.data.supported_observations?.includes("listing")) throw Error("gateway_source_not_registered");
  const capture = await read(db, listing.url);
  return { snapshot_id: capture.snapshot_id, source_id: source.data.id, fetched_at: capture.observed_at,
    snapshot_fetched_at: capture.snapshot_fetched_at, browser_run_id: capture.run_id, hash: capture.hash, fields: parseGatewayListing(capture.html, listing.url) };
}

/** Existing canonical observation and listing projection owners; no raw testimony writes. */
export async function landGatewayCapture(db: any, capture: GatewayCapture, vehicleId: string) {
  const f = capture.fields;
  const { price: _asking, ...fields } = f;
  const payload = { source_slug: "gateway-classic-cars", vehicle_id: vehicleId, kind: "listing",
    source_url: f.url, source_identifier: `${GATEWAY_PARSER}:${capture.browser_run_id}:${capture.snapshot_id}`, observed_at: capture.fetched_at,
    raw_source_ref: `listing_page_snapshots:${capture.snapshot_id}`, extraction_method: GATEWAY_PARSER, defer_analysis: true,
    content_text: f.description ?? `${f.year} ${f.make} ${f.model}`,
    structured_data: { ...fields, asking_price: f.price, source_claims_only: true, source_event_time_status: "unknown",
      factory_configuration_status: "unknown", current_configuration_status: "unknown" },
    extraction_metadata: { snapshot_id: capture.snapshot_id, source_capture_sha256: capture.hash, acquisition: "public_browser_rendered_dom", browser_run_id: capture.browser_run_id, original_snapshot_fetched_at: capture.snapshot_fetched_at },
  };
  const admitted = await db.functions.invoke("ingest-observation", { body: payload });
  if (admitted.error || admitted.data?.success !== true || !admitted.data.observation_id) throw Error("gateway_observation_admission_failed");
  const observation = await db.from("vehicle_observations").select("id,vehicle_id,source_id,source_url,raw_source_ref,observed_at")
    .eq("id", admitted.data.observation_id).eq("observed_at", capture.fetched_at).maybeSingle();
  const o = observation.data;
  if (observation.error || !o || o.vehicle_id !== vehicleId || o.source_id !== capture.source_id || o.source_url !== f.url
    || o.raw_source_ref !== payload.raw_source_ref) throw Error("gateway_observation_readback_failed");
  const listing = await landClassifiedListing(db, { vehicleId, platform: "gateway_classics", listingUrl: f.url,
    listingId: f.stock_id, price: f.price, postedAt: null, observedAt: capture.fetched_at });
  if (listing.event.action === "error" || !("id" in listing.event) || !listing.event.id || listing.for_sale === "error") throw Error("gateway_listing_projection_failed");
  return { observation_id: o.id, snapshot_id: capture.snapshot_id, listing_event_id: listing.event.id,
    duplicate: admitted.data.duplicate === true, observed_at: capture.fetched_at };
}
