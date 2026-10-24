/**
 * ingest/craigslistCapture.ts — what ingest does with a Craigslist post's attribute block once the vehicle exists.
 *
 * The block (VIN, odometer, title status, condition, transmission, drive, fuel, cylinders, paint color, type, the two
 * odometer disclosures, the post's id and clocks) is read by extract-craigslist and arrives here as `capture`.
 *
 * Where each piece lands, all through the writers the repo already has:
 *   - an attributed `listing` observation from the `craigslist` source (the only kind that source supports), keyed by
 *     the post id, with the verbatim block kept in extraction_metadata.raw;
 *   - the observation writer's gap-fill (batUpsertWithProvenance) fills NULL vehicles columns with a provenance
 *     receipt and a *_source stamp, and quarantines a disagreement instead of overwriting it:
 *     vin, drivetrain, fuel_type, listing_posted_at, listing_updated_at, plus confirmations of what ingest wrote at
 *     creation (mileage, transmission, color, body_style, title_status);
 *   - field_evidence rows for each of those, written by the same writer;
 *   - condition, cylinders and the odometer disclosures have no vehicles column; they stay testimony in the observation;
 *   - the post's place (city, region, postal code, approximate point; never the street line) as one listing row in
 *     vehicle_location_observations, the table the map and the county key already read. A re-read of the same post
 *     with the same place adds nothing.
 *
 * Two choices that are not obvious:
 *   1. The VIN is NOT given to ingest's identity machinery for Craigslist (gate, Tier-1 VIN match, the creation insert).
 *      The gate rejects a listing when decodeVin's make disagrees with the title's make. Run over 46 real Craigslist VINs
 *      (2026-10-06) it would have rejected 9, and in none of the 9 was the VIN wrong: six were decoder errors (two 1966
 *      Fords decoded as Cadillac, a 1971 Mustang as Chevrolet, a 1964 Chevrolet as Buick, a GMC Sierra as Chevrolet, an
 *      Acura RL as Honda), three were a make fragment cut from the title ("P3500", "Amc", "Fac"). The poller ledgers a
 *      rejection as skipped for good. A seller-typed VIN lands here instead, after the vehicle exists, so it can never
 *      decide whether a post becomes a vehicle or is merged into another one. The database guards still apply to it:
 *      enforce_vin_uniqueness, flag_vin_structurally_suspect, and the NHTSA decode that flags a make conflict.
 *   2. The seller's condition word goes inside the listing observation, never as a `condition`-kind observation.
 *      discover-description-data treats "has a condition observation" as "description already read" and would skip
 *      every Craigslist vehicle (supabase/functions/discover-description-data/index.ts:441,507).
 */

import { normalizeDrivetrain, normalizeTransmission } from "../_shared/normalizeVehicle.ts";
import { pickCapture, type CraigslistCapture } from "../_shared/craigslistAttributes.ts";
import type { ObservationInput, WriteResult } from "../_shared/observationWriter.ts";
import { vehicleEventWriterFor, type VehicleEventWriteResult } from "../_shared/vehicleEventWrite.ts";
const writeVehicleEventByKey = vehicleEventWriterFor("ingest:craigslist-capture");
import { recordSellerTypes } from "../_shared/sellerType.ts";
import { craigslistSellerTypeRow } from "./craigslistSellerType.ts";

/** What matchOrCreateVehicle was handed (after ingest's gate), so the observation confirms it instead of disagreeing. */
export interface WrittenColumns {
  mileage?: number | null;
  title_status?: string | null;
  transmission?: string | null;
  color?: string | null;
  body_style?: string | null;
}

export type VinOutcome =
  | "absent" // the post has no VIN row
  | "not_accepted" // a VIN row the rules did not accept (attributes.vin_rejected says why)
  | "held_elsewhere" // accepted, but another vehicle already holds it; kept as testimony, not written
  | "unchecked" // accepted, but the holder lookup failed; kept as testimony, not written
  | "filled" // written to vehicles.vin by the gap-fill
  | "confirmed" // the vehicle already had this VIN
  | "conflict" // the vehicle has a different VIN; quarantined by the writer
  | "not_written"; // accepted and free, but the writer did not report it (see errors)

export interface CaptureLanding {
  observation: "written" | "duplicate" | "skipped" | "error";
  vin: VinOutcome;
  gap_filled: string[];
  confirmed: string[];
  conflicted: string[];
  errors: string[];
  observation_id?: string;
  listing_event?: VehicleEventWriteResult;
  place?: "written" | "duplicate" | "error";
  /** The seller class (private | dealer | unknown) written as a lot-level signal for the listing episode. */
  seller_type?: "private" | "dealer" | "unknown" | "error";
  /** The asking price: first reading logged, a changed one applied, an unchanged one left alone. */
  price?: "logged" | "changed" | "unchanged" | "error";
}

/** Craigslist says "gas"; the column's dominant spelling (93,571 + 61,487 rows, 2026-10-06) is "gasoline". "other" is not a fuel. */
export function fuelTypeFrom(fuel: string | null | undefined): string | null {
  const f = (fuel ?? "").trim().toLowerCase();
  if (f === "gas") return "gasoline";
  if (f === "diesel" || f === "electric" || f === "hybrid") return f;
  return null;
}

export function cylindersFrom(text: string | null | undefined): number | null {
  const m = (text ?? "").trim().match(/^(\d{1,2})\s*cylinders?$/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * The flat, scalar fields of the listing observation. `vinWritable` is false when the VIN must stay testimony
 * (another vehicle holds it, or that could not be checked): the number then travels as `vin_claim`, not `vin`.
 */
export function captureObservationFields(
  capture: CraigslistCapture,
  written: WrittenColumns,
  vinWritable: boolean,
): Record<string, string | number | boolean> {
  const a = capture.attributes;
  const out: Record<string, string | number | boolean> = {};
  const put = (k: string, v: string | number | boolean | null | undefined) => {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  };

  if (a.vin) put(vinWritable ? "vin" : "vin_claim", a.vin);
  else put("vin_claim", a.vin_raw);

  // A zero is not offered: ingest never writes one (`if (parsed.mileage)`), and the writer would otherwise fill it in.
  put("mileage", written.mileage || a.odometer || null);
  if (a.odometer_broken) out.odometer_broken = true;
  if (a.odometer_rolled_over) out.odometer_rolled_over = true;
  put("title_status", written.title_status ?? a.title_status);
  put("transmission", written.transmission ?? normalizeTransmission(a.transmission));
  put("drivetrain", normalizeDrivetrain(a.drive));
  put("fuel_type", fuelTypeFrom(a.fuel));
  put("color", written.color ?? a.paint_color);
  put("body_style", written.body_style ?? a.type);
  put("cylinders", cylindersFrom(a.cylinders));
  put("condition", a.condition);
  put("listing_posted_at", capture.posted_at);
  put("listing_updated_at", capture.updated_at);
  put("listing_asking_price", capture.asking_price);
  return out;
}

/** The keys a capture adds to ingest's answer, and so to the poller's queue ledger row. */
export function ledgerFields(capture: CraigslistCapture, landing?: CaptureLanding | null): Record<string, unknown> {
  return {
    post_id: capture.post_id,
    posted_at: capture.posted_at,
    updated_at: capture.updated_at,
    attributes: capture.attributes,
    ...(capture.source_capture ? { source_capture: capture.source_capture } : {}),
    ...(capture.asking_price !== undefined ? { asking_price: capture.asking_price } : {}),
    ...(capture.place ? { place: capture.place } : {}),
    ...(landing ? { capture_landing: landing } : {}),
  };
}

/**
 * The vehicle_location_observations row for a post's place, or null when it has none. Craigslist moves its map pin,
 * so a point is city precision, the same grain the table's other listing rows carry.
 */
export function placeObservationRow(
  vehicleId: string,
  listingUrl: string,
  capture: CraigslistCapture,
  observationId: string | null,
): Record<string, unknown> | null {
  const p = capture.place;
  // A town name alone is already vehicles.location, and ambiguous without its state.
  if (!p || (!p.region && !p.postal_code && p.latitude === null)) return null;
  const text = [p.locality, [p.region, p.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  return {
    vehicle_id: vehicleId,
    source_type: "listing",
    source_platform: "craigslist",
    source_url: listingUrl,
    observed_at: capture.source_capture?.observed_at ?? new Date().toISOString(),
    location_text_raw: text,
    location_text_clean: text,
    country_code: p.country,
    region_code: p.region,
    city: p.locality,
    postal_code: p.postal_code,
    latitude: p.latitude,
    longitude: p.longitude,
    precision: p.locality || p.latitude !== null ? "city" : "region",
    confidence: p.latitude !== null || p.postal_code ? 0.8 : 0.6,
    metadata: {
      method: "json_ld_available_at_or_from",
      ...(observationId ? { observation_id: observationId } : {}),
      ...(capture.source_capture ? { snapshot_id: capture.source_capture.snapshot_id } : {}),
    },
  };
}

/**
 * The post's asking price against the vehicle row. vehicle_price_history is the change log of vehicles.asking_price:
 * a trigger writes a row on every UPDATE of the column, but nothing writes the first reading on INSERT, and the
 * observation writer quarantines a different price instead of applying it. So here:
 *   - a vehicle this page just created: log the first reading, with the source, the page's own observed_at and the URL;
 *   - a vehicle already holding a different price (or none): apply the new price; the trigger logs the change.
 * A page read is newer than every earlier read of the same post, so the later reading is the current claim; the
 * earlier ones stay in the observations and the log. Never throws.
 */
async function landAskingPrice(
  supabase: any,
  args: { vehicleId: string; listingUrl: string; price: number; observedAt: string; postId: string | null; isNewVehicle: boolean },
): Promise<"logged" | "changed" | "unchanged" | "error"> {
  try {
    if (args.isNewVehicle) {
      const { error } = await supabase.from("vehicle_price_history").insert({
        vehicle_id: args.vehicleId, price_type: "asking", value: args.price, source: "craigslist", as_of: args.observedAt,
        confidence: 80, proof_type: "listing", proof_url: args.listingUrl,
        notes: args.postId ? `craigslist post ${args.postId}` : null,
      });
      return error ? "error" : "logged";
    }
    const { data, error } = await supabase.from("vehicles").select("asking_price").eq("id", args.vehicleId).maybeSingle();
    if (error || !data) return "error";
    if (data.asking_price !== null && Number(data.asking_price) === args.price) return "unchanged";
    const { error: upErr } = await supabase.from("vehicles").update({ asking_price: args.price, price: Math.round(args.price) })
      .eq("id", args.vehicleId);
    return upErr ? "error" : "changed";
  } catch {
    return "error";
  }
}

/** Write the place once per (vehicle, post, place). Never throws. */
async function landPlace(supabase: any, row: Record<string, unknown>): Promise<"written" | "duplicate" | "error"> {
  try {
    let seen = supabase.from("vehicle_location_observations").select("id")
      .eq("vehicle_id", row.vehicle_id).eq("source_platform", "craigslist").eq("source_url", row.source_url);
    for (const k of ["postal_code", "latitude", "longitude"]) seen = row[k] === null ? seen.is(k, null) : seen.eq(k, row[k]);
    const { data, error } = await seen.limit(1);
    if (error) return "error";
    if (data && data.length > 0) return "duplicate";
    const { error: insertError } = await supabase.from("vehicle_location_observations").insert(row);
    return insertError ? "error" : "written";
  } catch {
    return "error";
  }
}

/** The columns ingest inserts at creation from the same page. On a vehicle it just created they are already there. */
export const COLUMNS_WRITTEN_AT_CREATION = ["mileage", "title_status", "transmission", "color", "body_style"];

export interface LandDeps {
  /** A service-role client: used for one read (who holds this VIN) and handed to the writer. */
  supabase: any;
  writeObservation: (supabase: any, input: ObservationInput) => Promise<WriteResult>;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms) as unknown as number;
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Who else holds this VIN. Exact match (the column's index); null when nobody does, undefined when the lookup failed. */
async function otherHolder(supabase: any, vehicleId: string, vin: string): Promise<string | null | undefined> {
  try {
    const { data, error } = await supabase.from("vehicles").select("id").eq("vin", vin).neq("id", vehicleId).limit(1);
    if (error) return undefined;
    return data && data.length > 0 ? String(data[0].id) : null;
  } catch {
    return undefined;
  }
}

/**
 * Write the listing observation for a vehicle that now exists. Never throws and is bounded in time: the poller
 * calls ingest one URL at a time inside a 150 s ceiling. The outcome is returned (and kept on the queue ledger),
 * so a landing that failed is a countable row, not a log line.
 */
export async function landCraigslistCapture(
  deps: LandDeps,
  args: {
    vehicleId: string;
    listingUrl: string;
    capture: CraigslistCapture;
    /** Prose parsed from this same source capture; admitted only with its validated snapshot and source clock. */
    sourceDescription?: string | null;
    written: WrittenColumns;
    /** True when ingest created the vehicle from this page a moment ago. Then the columns it wrote are not re-confirmed. */
    isNewVehicle?: boolean;
    /** The span of the post's text the model was read from, when the page's attributes named none. */
    /** The post's body text, read for dealer wording against a declared private class. */
    description?: string | null;
    modelCitation?: { value: string; span: { start: number; end: number; text: string }; rule: string } | null;
    timeoutMs?: number;
  },
): Promise<CaptureLanding> {
  const { vehicleId, listingUrl, capture, written } = args;
  const a = capture.attributes;
  const landing: CaptureLanding = { observation: "skipped", vin: "absent", gap_filled: [], confirmed: [], conflicted: [], errors: [] };
  try {
    let vinWritable = false;
    let heldBy: string | null | undefined = null;
    if (a.vin) {
      heldBy = await otherHolder(deps.supabase, vehicleId, a.vin);
      vinWritable = heldBy === null;
      landing.vin = heldBy === null ? "not_written" : heldBy === undefined ? "unchecked" : "held_elsewhere";
    } else if (a.vin_raw) {
      landing.vin = "not_accepted";
    }

    const fields = captureObservationFields(capture, written, vinWritable);
    // A cached page without its receipt must not acquire a current source clock from the writer's default.
    const sourceDescription = pickCapture(capture)?.source_capture && typeof args.sourceDescription === "string" && args.sourceDescription.trim()
      ? args.sourceDescription : null;
    if (Object.keys(fields).length === 0 && !sourceDescription) return landing;

    const result = await withTimeout(
      deps.writeObservation(deps.supabase, {
        vehicleId,
        source: { platform: "craigslist", url: listingUrl, ...(capture.post_id ? { sourceIdentifier: capture.post_id } : {}) },
        fields,
        // A vehicle created from this page already holds these columns. A matched one may disagree: keep the full
        // comparison there, so a different value is quarantined instead of passing unseen.
        ...(args.isNewVehicle ? { testimonyOnly: COLUMNS_WRITTEN_AT_CREATION } : {}),
        observationKind: "listing",
        extractionMethod: "html_parse",
        ...(sourceDescription ? { contentText: sourceDescription } : {}),
        ...(capture.source_capture ? { observedAt: capture.source_capture.observed_at } : {}),
        // The verbatim block, so the observation stands on its own if the page is gone.
        rawData: { ...ledgerFields(capture), ...(args.modelCitation ? { model_from_text: args.modelCitation } : {}), ...(typeof heldBy === "string" ? { vin_held_by: heldBy } : {}) },
      }),
      args.timeoutMs ?? 8000,
    );

    landing.observation = result.observationId ? (result.duplicate ? "duplicate" : "written") : "skipped";
    landing.gap_filled = result.gapFilled;
    landing.confirmed = result.confirmed;
    landing.conflicted = result.conflicted;
    landing.errors = result.errors.slice(0, 5);
    if (result.observationId) landing.observation_id = result.observationId;
    if (vinWritable) {
      landing.vin = result.gapFilled.includes("vin") ? "filled"
        : result.confirmed.includes("vin") ? "confirmed"
        : result.conflicted.includes("vin") ? "conflict"
        : "not_written";
    }
    // A retained source receipt and canonical observation ACK precede the public listing projection.
    // Retry after a projection failure may have a duplicate observation; it must still finish this relationship.
    if (result.observationId && capture.post_id && capture.source_capture) {
      try {
        landing.listing_event = await withTimeout(writeVehicleEventByKey(deps.supabase, {
          vehicle_id: vehicleId,
          source_platform: "craigslist",
          source_listing_id: capture.post_id,
          source_url: listingUrl,
          event_type: "listing",
          event_status: "unknown",
          ...(capture.asking_price != null ? { current_price: capture.asking_price } : {}),
          metadata: {
            source: "ingest", observation_id: result.observationId,
            snapshot_id: capture.source_capture.snapshot_id,
            source_observed_at: capture.source_capture.observed_at,
            ...(capture.posted_at ? { listing_posted_at: capture.posted_at } : {}),
            ...(capture.updated_at ? { listing_updated_at: capture.updated_at } : {}),
          },
        }, { preserveEventStatus: true, sourceObservedAt: capture.source_capture.observed_at }), args.timeoutMs ?? 8000);
        if (landing.listing_event.action === "error") landing.errors.push(`listing event: ${landing.listing_event.error}`);
        // The seller class, one signal row per listing episode (record_lot_quality_signals; failures are counted, not thrown).
        const eventId = (landing.listing_event as { id?: string | null }).id;
        if (eventId) {
          try {
            const row = craigslistSellerTypeRow(eventId, capture.seller_class, args.description);
            await withTimeout(recordSellerTypes(deps.supabase, [row], "ingest-craigslist"), args.timeoutMs ?? 8000);
            landing.seller_type = row.value;
          } catch (e) {
            landing.seller_type = "error";
            landing.errors.push(`seller_type: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } catch (e) {
        landing.listing_event = { action: "error", error: e instanceof Error ? e.message : String(e), code: null };
        landing.errors.push(`listing event: ${landing.listing_event.error}`);
      }
    }
    if (result.observationId && capture.asking_price != null && capture.asking_price > 0) {
      landing.price = await withTimeout(landAskingPrice(deps.supabase, {
        vehicleId, listingUrl, price: capture.asking_price,
        observedAt: capture.source_capture?.observed_at ?? new Date().toISOString(),
        postId: capture.post_id ?? null, isNewVehicle: !!args.isNewVehicle,
      }), args.timeoutMs ?? 8000).catch(() => "error" as const);
      if (landing.price === "error") landing.errors.push("price: not applied");
    }
    const placeRow = result.observationId ? placeObservationRow(vehicleId, listingUrl, capture, result.observationId) : null;
    if (placeRow) {
      landing.place = await withTimeout(landPlace(deps.supabase, placeRow), args.timeoutMs ?? 8000).catch(() => "error" as const);
      if (landing.place === "error") landing.errors.push("place: not written");
    }
  } catch (e) {
    landing.observation = "error";
    landing.errors.push(e instanceof Error ? e.message : String(e));
  }
  return landing;
}
