import { parseVicariListing, vicariListingId, vicariUrl, VICARI_PARSER } from "../_shared/vicariParser.ts";
import { normalizeMake } from "../_shared/normalizeVehicle.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import type { ArchiveFetchOptions, ArchiveFetchResult } from "../_shared/archiveFetch.ts";

interface Dependencies {
  // Existing ingest owns vehicle resolution and image writes; this adapter adds no parallel writer.
  supabase: any;
  archiveFetch: (url: string, options: ArchiveFetchOptions) => Promise<ArchiveFetchResult>;
  matchVehicle: (data: any) => Promise<{ vehicleId: string; isNew: boolean }>;
}

/** Retain -> parse -> existing vehicle resolver -> sanctioned observation writer -> read back. */
export async function ingestVicari(url: string, deps: Dependencies) {
  const id = vicariListingId(url);
  if (!id) throw new Error("invalid_vicari_listing_url");
  const canonical = vicariUrl(id);
  const source = await deps.supabase.from("observation_sources").select("id,species,supported_observations")
    .eq("slug", "vicari").maybeSingle();
  if (source.error || !source.data || source.data.species !== "block_house"
    || !source.data.supported_observations?.includes("listing")) throw new Error("vicari_source_not_registered");
  const page = await deps.archiveFetch(canonical, {
    platform: "vicari", callerName: "ingest:vicari", useFirecrawl: false, firecrawlOnBlock: false,
    directFetchOptions: { publicOnly: true, timeout: 20_000 },
  });
  if (page.error || page.archiveError || !page.html || !page.snapshotId) throw new Error("vicari_capture_not_retained");
  const snapshot = await deps.supabase.from("listing_page_snapshots")
    .select("id,platform,listing_url,fetched_at,html_sha256,success").eq("id", page.snapshotId).maybeSingle();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(page.html)))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
  const s = snapshot.data;
  if (snapshot.error || !s || s.success !== true || s.platform !== "vicari" || vicariListingId(s.listing_url) !== id
    || s.html_sha256 !== hash || !Number.isFinite(Date.parse(s.fetched_at)) || Date.parse(s.fetched_at) > Date.now()) {
    throw new Error("vicari_capture_readback_failed");
  }
  const lot = parseVicariListing(page.html, canonical);
  const mileageText = lot.raw_fields.Mileage?.replace(/,/g, "");
  const mileage = /^\d+$/.test(mileageText ?? "") ? Number(mileageText) : null;
  const known = (v?: string) => v && !/^N\/?A$/i.test(v) ? v : null;
  const candidate = {
    year: lot.year, make: lot.make ? normalizeMake(lot.make) : null, model: lot.model,
    description: lot.description, mileage, engine: known(lot.raw_fields.Cylinder),
    transmission: known(lot.raw_fields.Transmission), color: known(lot.raw_fields.Exterior),
    body_style: known(lot.raw_fields.Body),
  };
  const gate = qualityGate(candidate, { source: "vicari", sourceType: "auction" });
  let vehicleId: string | null = null;
  if (gate.pass && gate.cleaned.year && gate.cleaned.make && gate.cleaned.model) {
    // A failed or ambiguous exact lookup must never be interpreted as a new vehicle.
    const prior = await deps.supabase.from("vehicles").select("id").eq("listing_url", canonical).limit(2);
    if (prior.error || prior.data?.length > 1) throw new Error("vicari_identity_lookup_unavailable");
    const match = await deps.matchVehicle({ ...gate.cleaned, url: canonical,
      imageUrl: lot.image_urls[0] ?? null, imageUrls: lot.image_urls, bodyStyle: gate.cleaned.body_style });
    vehicleId = match.vehicleId;
  }
  const payload = {
    source_slug: "vicari", kind: "listing", observed_at: s.fetched_at,
    source_url: canonical, source_identifier: `ahid:${id}:${hash}`,
    ...(vehicleId ? { vehicle_id: vehicleId } : {}),
    // No fuzzy year/make hints: incomplete source identity stays an unresolved blip.
    content_text: [lot.title, lot.auction_name, lot.description].filter(Boolean).join("\n\n"),
    structured_data: { ...lot, kind_detail: "auction_listing", parser: VICARI_PARSER,
      source_claims_only: true, observed_at_basis: "page_capture", source_event_at: null },
    extraction_method: VICARI_PARSER, raw_source_ref: `listing_page_snapshots:${s.id}`,
    extraction_metadata: { snapshot_id: s.id, html_sha256: hash, parser: VICARI_PARSER, quality_issues: gate.issues },
    defer_analysis: true,
  };
  const admitted = await deps.supabase.functions.invoke("ingest-observation", { body: payload });
  if (admitted.error || admitted.data?.success !== true || !admitted.data?.observation_id) throw new Error("vicari_observation_admission_failed");
  const row = await deps.supabase.from("vehicle_observations").select("id,vehicle_id,source_id,source_url,raw_source_ref,observed_at")
    .eq("id", admitted.data.observation_id).maybeSingle();
  if (row.error || !row.data || row.data.vehicle_id !== vehicleId || row.data.source_id !== source.data.id
    || row.data.source_url !== canonical || row.data.raw_source_ref !== payload.raw_source_ref
    || Date.parse(row.data.observed_at) !== Date.parse(s.fetched_at)) throw new Error("vicari_observation_readback_failed");
  let imageCount = 0;
  if (vehicleId && lot.image_urls.length) {
    const images = await deps.supabase.from("vehicle_images").select("image_url").eq("vehicle_id", vehicleId).in("image_url", lot.image_urls);
    imageCount = new Set((images.data ?? []).map((v: { image_url: string }) => v.image_url)).size;
    if (images.error || imageCount !== lot.image_urls.length) throw new Error("vicari_images_readback_failed");
  }
  return {
    ...gate.cleaned, vehicle_id: vehicleId, listing_url: canonical,
    image_url: lot.image_urls[0] ?? null, image_urls: lot.image_urls,
    vicari_receipt: { observation_id: row.data.id, snapshot_id: s.id, source_id: id, images: imageCount,
      duplicate: admitted.data.duplicate === true, unresolved: !vehicleId, presentation: lot.presentation },
  };
}
