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
 *   - condition, cylinders and the odometer disclosures have no vehicles column; they stay testimony in the observation.
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
import { type CraigslistCapture } from "../_shared/craigslistAttributes.ts";
import type { ObservationInput, WriteResult } from "../_shared/observationWriter.ts";

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
  return out;
}

/** The keys a capture adds to ingest's answer, and so to the poller's queue ledger row. */
export function ledgerFields(capture: CraigslistCapture, landing?: CaptureLanding | null): Record<string, unknown> {
  return {
    post_id: capture.post_id,
    posted_at: capture.posted_at,
    updated_at: capture.updated_at,
    attributes: capture.attributes,
    ...(landing ? { capture_landing: landing } : {}),
  };
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
    written: WrittenColumns;
    /** True when ingest created the vehicle from this page a moment ago. Then the columns it wrote are not re-confirmed. */
    isNewVehicle?: boolean;
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
    if (Object.keys(fields).length === 0) return landing;

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
        // The verbatim block, so the observation stands on its own if the page is gone.
        rawData: { ...ledgerFields(capture), ...(typeof heldBy === "string" ? { vin_held_by: heldBy } : {}) },
      }),
      args.timeoutMs ?? 8000,
    );

    landing.observation = result.observationId ? (result.duplicate ? "duplicate" : "written") : "skipped";
    landing.gap_filled = result.gapFilled;
    landing.confirmed = result.confirmed;
    landing.conflicted = result.conflicted;
    landing.errors = result.errors.slice(0, 5);
    if (vinWritable) {
      landing.vin = result.gapFilled.includes("vin") ? "filled"
        : result.confirmed.includes("vin") ? "confirmed"
        : result.conflicted.includes("vin") ? "conflict"
        : "not_written";
    }
  } catch (e) {
    landing.observation = "error";
    landing.errors.push(e instanceof Error ? e.message : String(e));
  }
  return landing;
}
