import { parseMcCormickLot, mccormickTarget, MCCORMICK_PARSER } from "../_shared/mccormickParser.ts";
import { normalizeListingUrl } from "../_shared/urlNormalization.ts";
import { normalizeMake } from "../_shared/normalizeVehicle.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { insertMissingVehicleImages } from "../_shared/vehicleImageWrite.ts";
import type { ArchiveFetchOptions, ArchiveFetchResult } from "../_shared/archiveFetch.ts";

interface Dependencies {
  supabase: any;
  archiveFetch: (url: string, options: ArchiveFetchOptions) => Promise<ArchiveFetchResult>;
  matchVehicle: (data: any) => Promise<{ vehicleId: string; isNew: boolean }>;
}

/** One publisher record, separately retained archive result and public detail witnesses. */
export async function ingestMcCormick(url: string, deps: Dependencies) {
  const target = mccormickTarget(url);
  if (!target) throw new Error("invalid_mccormicks_listing_url");
  const { id, url: canonical } = target;
  const source = await deps.supabase.from("observation_sources").select("id,species,supported_observations")
    .eq("slug", "mccormicks").maybeSingle();
  if (source.error || !source.data || source.data.species !== "block_house"
    || !source.data.supported_observations?.includes("listing")) throw new Error("mccormicks_source_not_registered");
  const capture = async (sourceUrl: string) => {
    const page = await deps.archiveFetch(sourceUrl, {
      platform: "mccormicks", callerName: "ingest:mccormicks", useFirecrawl: false, firecrawlOnBlock: false,
      directFetchOptions: { publicOnly: true, timeout: 20_000 },
    });
    if (page.error || page.archiveError || !page.html || !page.snapshotId) throw new Error("mccormicks_capture_not_retained");
    const read = await deps.supabase.from("listing_page_snapshots")
      .select("id,platform,listing_url,fetched_at,html_sha256,success").eq("id", page.snapshotId).maybeSingle();
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(page.html)))]
      .map(b => b.toString(16).padStart(2, "0")).join("");
    const snapshot = read.data;
    if (read.error || !snapshot || snapshot.success !== true || snapshot.platform !== "mccormicks"
      || mccormickTarget(snapshot.listing_url)?.url !== sourceUrl || snapshot.html_sha256 !== hash
      || !Number.isFinite(Date.parse(snapshot.fetched_at)) || Date.parse(snapshot.fetched_at) > Date.now()) {
      throw new Error("mccormicks_capture_readback_failed");
    }
    return { lot: parseMcCormickLot(page.html, sourceUrl), snapshot, hash, url: sourceUrl };
  };
  const primary = await capture(canonical);
  const documents = [primary];
  const gaps: string[] = [];
  if (target.archive) {
    // The archive template omits VINs and extra photos. The same *observed* native ID
    // also has a public detail route; never enumerate IDs or carry its decorative auction header as lot evidence.
    try {
      const detail = await capture(`https://www.classic-carauction.com/auction-cars?auctionid=${id}`);
      if (detail.lot.title !== primary.lot.title || detail.lot.lot_number !== primary.lot.lot_number
        || detail.lot.year !== primary.lot.year || detail.lot.make !== primary.lot.make) {
        throw new Error("mccormicks_detail_identity_disagreement");
      }
      documents.push(detail);
    } catch (e) {
      // Keep the result witness and an explicit capture gap. A failed alternate path is not proof of absent VIN/photos.
      gaps.push(e instanceof Error ? e.message : "mccormicks_detail_capture_failed");
    }
  }
  const identity = documents.at(-1)!;
  const lot = identity.lot;
  const mileageText = lot.raw_fields.Mileage?.replace(/,/g, "");
  const known = (v?: string) => v && !/^(?:N\/?A|TBA|TMU)$/i.test(v) ? v : null;
  const candidate = {
    year: lot.year, make: lot.make ? normalizeMake(lot.make) : null, model: lot.model,
    description: lot.description, mileage: /^\d+$/.test(mileageText ?? "") ? Number(mileageText) : null,
    // Short chassis numbers stay source claims; the existing resolver's modern-VIN path is not proof for them.
    vin: lot.vin?.length === 17 ? lot.vin : null,
    transmission: known(lot.raw_fields.Transmission), color: known(lot.raw_fields["Body Color"]),
    body_style: known(lot.raw_fields["Body Style"]),
  };
  const gate = qualityGate(candidate, { source: "mccormicks", sourceType: "auction" });
  let vehicleId: string | null = null;
  if (gate.pass && gate.cleaned.year && gate.cleaned.make && gate.cleaned.model) {
    const prior = await deps.supabase.from("vehicles").select("id").eq("listing_url", normalizeListingUrl(canonical)!.normalized).limit(2);
    if (prior.error) throw new Error("mccormicks_identity_lookup_unavailable");
    let resolutionIssue = prior.data?.length > 1 ? "mccormicks_ambiguous_listing_identity" : null;
    if (gate.cleaned.vin) {
      const exact = await deps.supabase.from("vehicles").select("id,year,make").eq("vin", gate.cleaned.vin).limit(2);
      if (exact.error) throw new Error("mccormicks_vin_lookup_unavailable");
      if (exact.data?.length > 1) resolutionIssue = "mccormicks_ambiguous_vin_identity";
      const existing = exact.data?.[0];
      if (existing && ((existing.year && Number(existing.year) !== Number(gate.cleaned.year))
        || (existing.make && normalizeMake(existing.make) !== gate.cleaned.make))) resolutionIssue = "mccormicks_vin_identity_conflict";
    }
    if (resolutionIssue) gate.issues.push(resolutionIssue);
    else {
      const match = await deps.matchVehicle({ ...gate.cleaned, url: identity.url,
        imageUrl: lot.image_urls[0] ?? null, imageUrls: lot.image_urls, bodyStyle: gate.cleaned.body_style });
      vehicleId = match.vehicleId;
    }
  }
  const observations: Array<{ observation_id: string; snapshot_id: string; source_url: string; duplicate: boolean }> = [];
  for (const doc of documents) {
    const payload = {
      source_slug: "mccormicks", kind: "listing", observed_at: doc.snapshot.fetched_at,
      source_url: doc.url, source_identifier: `auctionid:${id}:${doc.hash}`,
      ...(vehicleId ? { vehicle_id: vehicleId } : {}),
      content_text: [doc.lot.title, doc.lot.description].filter(Boolean).join("\n\n"),
      structured_data: { ...doc.lot, kind_detail: "auction_listing", parser: MCCORMICK_PARSER,
        source_claims_only: true, observed_at_basis: "page_capture", observation_time_basis: "source_capture",
        source_captured_at: doc.snapshot.fetched_at, source_event_at: null },
      extraction_method: MCCORMICK_PARSER, raw_source_ref: `listing_page_snapshots:${doc.snapshot.id}`,
      extraction_metadata: { snapshot_id: doc.snapshot.id, html_sha256: doc.hash, parser: MCCORMICK_PARSER,
        quality_issues: gate.issues, source_capture_gaps: gaps },
      defer_analysis: true,
    };
    const admitted = await deps.supabase.functions.invoke("ingest-observation", { body: payload });
    if (admitted.error || admitted.data?.success !== true || !admitted.data?.observation_id) throw new Error("mccormicks_observation_admission_failed");
    const row = await deps.supabase.from("vehicle_observations").select("id,vehicle_id,source_id,source_url,raw_source_ref,observed_at")
      .eq("id", admitted.data.observation_id).maybeSingle();
    if (row.error || !row.data || row.data.vehicle_id !== vehicleId || row.data.source_id !== source.data.id
      || row.data.source_url !== doc.url || row.data.raw_source_ref !== payload.raw_source_ref
      || Date.parse(row.data.observed_at) !== Date.parse(doc.snapshot.fetched_at)) throw new Error("mccormicks_observation_readback_failed");
    observations.push({ observation_id: row.data.id, snapshot_id: doc.snapshot.id, source_url: doc.url, duplicate: admitted.data.duplicate === true });
    if (vehicleId && doc !== identity && doc.lot.image_urls.length) {
      // Existing image writer, with the page that actually exposes each photo as its source.
      const write = await insertMissingVehicleImages(deps.supabase, vehicleId, doc.lot.image_urls.map((image_url, i) => ({
        vehicle_id: vehicleId, image_url, position: i, display_order: i, is_primary: false,
        source: "mccormicks", is_external: true, ai_processing_status: "skipped", source_url: doc.url,
      })));
      if (write.error) throw new Error("mccormicks_images_write_failed");
    }
  }
  const imageUrls = [...new Set(documents.flatMap(doc => doc.lot.image_urls))];
  let imageCount = 0;
  if (vehicleId && imageUrls.length) {
    const images = await deps.supabase.from("vehicle_images").select("image_url").eq("vehicle_id", vehicleId).in("image_url", imageUrls);
    imageCount = new Set((images.data ?? []).map((v: { image_url: string }) => v.image_url)).size;
    if (images.error || imageCount !== imageUrls.length) throw new Error("mccormicks_images_readback_failed");
  }
  return {
    ...gate.cleaned, vehicle_id: vehicleId, listing_url: canonical,
    image_url: lot.image_urls[0] ?? null, image_urls: imageUrls,
    mccormick_receipt: { ...observations[0], observations, source_id: id, images: imageCount,
      unresolved: !vehicleId, presentation: primary.lot.presentation, source_capture_gaps: gaps },
  };
}
