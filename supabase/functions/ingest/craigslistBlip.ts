/**
 * ingest/craigslistBlip.ts — a Craigslist post whose model the seller left blank.
 *
 * AGENTS.md: a listing first establishes a blip, with attributed text, photos, source identity and clocks, and an
 * unresolved vehicle match is retained. Measured 2026-10-15 (10 h of post pages): 73 of 332 posts (22%) had a year and
 * a make but no model ("75 datsun"), were refused by the identity gate, and left no row but a snapshot.
 *
 * Two things happen to such a post:
 *   1. If the post's own text states the model next to the year or the make ("1987 GMC C7000 Series", "1966 F100 V8"),
 *      the model is read from that span and cited, and the post proceeds as a normal listing (`vehicles.model_source`
 *      says "listing_text"). The rule is narrow on purpose: a token that carries a digit, so "75 datsun long bed" does
 *      not read "long" as a model. A body that names no such token stays unresolved.
 *   2. Otherwise the post lands as a `listing` observation with no vehicle (vehicle_id NULL, the home the observation
 *      table already has for unresolved listings), carrying the verbatim attribute block, the description, the photo
 *      URLs, the place, the post id and both clocks. Nothing is minted, and the post is not retried as a failure.
 */

import type { CraigslistCapture } from "../_shared/craigslistAttributes.ts";
import type { ObservationInput, WriteResult } from "../_shared/observationWriter.ts";
import { captureObservationFields, ledgerFields } from "./craigslistCapture.ts";

export interface ModelCitation {
  value: string;
  /** Character offsets in the description text, and the text they cover. */
  span: { start: number; end: number; text: string };
  rule: "year_make_token" | "year_token";
}

const TOKEN = String.raw`[A-Za-z]{0,2}\d{2,4}[A-Za-z]{0,2}`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The model a post's text states, or null. `year` is the four-digit model year; `make` the make the page's attributes
 * gave. Accepted: "<year> <make> <token>" and "<year> <token>" where the token carries a digit (F100, C7000, 914, 240Z,
 * K5). The second form requires a letter in the token, so a bare "1966 351" (an engine) is never read as a model.
 */
export function modelFromText(text: string | null | undefined, year: number, make: string): ModelCitation | null {
  const body = text ?? "";
  if (!body || !year || !make) return null;
  const yy = String(year);
  const short = yy.slice(2);
  const years = `(?:${yy}|'?${short})`;
  const withMake = new RegExp(`\\b${years}\\s+${escape(make)}\\s+(${TOKEN})\\b`, "i").exec(body);
  if (withMake) {
    const start = withMake.index, end = start + withMake[0].length;
    return { value: withMake[1].toUpperCase(), span: { start, end, text: body.slice(start, end) }, rule: "year_make_token" };
  }
  const bare = new RegExp(`\\b${yy}\\s+([A-Za-z]{1,2}\\d{2,4}[A-Za-z]{0,2})\\b`, "i").exec(body);
  if (bare) {
    const start = bare.index, end = start + bare[0].length;
    return { value: bare[1].toUpperCase(), span: { start, end, text: body.slice(start, end) }, rule: "year_token" };
  }
  return null;
}

export interface BlipDeps {
  supabase: any;
  writeObservation: (supabase: any, input: ObservationInput) => Promise<WriteResult>;
}

export interface BlipLanding {
  observation: "written" | "duplicate" | "error";
  observation_id?: string;
  errors: string[];
}

/** Land the post as an unresolved listing observation. Never throws. */
export async function landCraigslistBlip(
  deps: BlipDeps,
  args: {
    listingUrl: string;
    capture: CraigslistCapture;
    year: number | null;
    make: string | null;
    description?: string | null;
    imageUrls?: string[] | null;
    title?: string | null;
  },
): Promise<BlipLanding> {
  const { capture } = args;
  try {
    const fields: Record<string, string | number | boolean> = { ...captureObservationFields(capture, {}, false) };
    if (args.year) fields.year_claim = args.year;
    if (args.make) fields.make_claim = args.make;
    const makeModel = (capture.attributes?.raw as Record<string, string> | undefined)?.makemodel;
    if (makeModel) fields.makemodel_text = makeModel;
    if (args.title) fields.listing_title = args.title;
    const place = capture.place;
    if (place) {
      if (place.locality) fields.place_city = place.locality;
      if (place.region) fields.place_region = place.region;
      if (place.postal_code) fields.place_postal_code = place.postal_code;
      if (place.latitude !== null && place.latitude !== undefined) fields.place_latitude = place.latitude;
      if (place.longitude !== null && place.longitude !== undefined) fields.place_longitude = place.longitude;
    }
    fields.unresolved_reason = "model_not_stated";
    const result = await deps.writeObservation(deps.supabase, {
      vehicleId: null,
      unresolved: true,
      source: { platform: "craigslist", url: args.listingUrl, ...(capture.post_id ? { sourceIdentifier: capture.post_id } : {}) },
      fields,
      observationKind: "listing",
      extractionMethod: "html_parse",
      ...(capture.source_capture ? { observedAt: capture.source_capture.observed_at } : {}),
      ...(args.description ? { contentText: args.description } : {}),
      rawData: { ...ledgerFields(capture), ...(args.imageUrls?.length ? { image_urls: args.imageUrls } : {}) },
    });
    if (!result.observationId) return { observation: "error", errors: result.errors.slice(0, 5) };
    return { observation: result.duplicate ? "duplicate" : "written", observation_id: result.observationId, errors: result.errors.slice(0, 5) };
  } catch (e) {
    return { observation: "error", errors: [e instanceof Error ? e.message : String(e)] };
  }
}
