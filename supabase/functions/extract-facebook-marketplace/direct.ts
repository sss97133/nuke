// The existing direct writer, separated from Deno.serve for executable custody/error assays.
import { corsHeaders } from "../_shared/cors.ts";
import { captureReference, captureSightingId, type BrowserCapture } from "./capture.ts";
import { type ListingFacts, withListingFacts } from "./listingFacts.ts";

export interface DirectDeps {
  supabase: any;
  linkToVehicle: (params: any) => Promise<{vehicle_id: string | null; suggested_vehicle_id: string | null}>;
  writeObservation: (supabase: any, input: any) => Promise<any>;
  capturePrepared?: boolean;
}

function extractFacebookItemId(url: string): string | null {
  return url.match(/marketplace\/item\/([A-Za-z0-9_]+)/)?.[1] ?? null;
}
function normalizeUrl(id: string): string { return `https://www.facebook.com/marketplace/item/${id}/`; }
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export interface DirectInput {
  mode: "direct";
  capture?: BrowserCapture;
  content_text?: string;
  facebook_id?: string;
  url?: string;
  title?: string;
  price?: number;
  current_price?: number;
  description?: string;
  location?: string;
  parsed_year?: number;
  parsed_make?: string;
  parsed_model?: string;
  mileage?: number;
  exterior_color?: string;
  interior_color?: string;
  transmission?: string;
  fuel_type?: string;
  image_url?: string;
  all_images?: string[];
  seller_name?: string;
  /** The seller's Marketplace profile link as rendered on the listing page; its numeric id is the identity key. */
  seller_profile_url?: string;
  contact_info?: Record<string, unknown>;
  status?: string;
  /** Set by withListingFacts: what this input's own text states, with the reader's method. */
  listing_facts?: ListingFacts;
  /** A revisit that saw the listing gone: the evidence, never a sale. removed_at is fill-only. */
  removal?: { observed_at: string; reason: "revisit_unavailable" | "displayed_sold"; basis: string; evidence?: string };
  agent_context?: {
    agent_id?: string;
    on_behalf_of?: string | null;
    session_type?: string;
  };
}

export async function handleDirect(body: DirectInput, deps: DirectDeps) {
  const { supabase, linkToVehicle, writeObservation } = deps;
  // Resolve facebook_id: from body or URL
  let facebookId = body.facebook_id;
  if (!facebookId && body.url) {
    facebookId = extractFacebookItemId(body.url) ?? undefined;
  }
  if (!facebookId) {
    return jsonResponse({ error: "facebook_id or valid url required" }, 400);
  }

  if (body.capture && !deps.capturePrepared) return jsonResponse({ error: "use browser_capture mode for retained capture input" }, 400);
  body = withListingFacts({ ...body, facebook_id: facebookId });
  const observedAt = body.capture?.observed_at || new Date().toISOString();
  const facts = body.listing_facts!;
  // A search card's thumbnail never replaces a gallery read from the listing page.
  const cardImage = body.agent_context?.session_type === "browser_search_card";

  // Check existing
  const { data: existing, error: readError } = await supabase
    .from("marketplace_listings")
    .select("id, vehicle_id, submission_count, first_seen_at, last_seen_at, raw_scrape_data, removed_at, image_url")
    .eq("facebook_id", facebookId)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    const raw = existing.raw_scrape_data && typeof existing.raw_scrape_data === "object" && !Array.isArray(existing.raw_scrape_data)
      ? existing.raw_scrape_data : (existing.raw_scrape_data == null ? {} : { original_raw_scrape_data: existing.raw_scrape_data });
    const history = Array.isArray(raw.browser_captures) ? raw.browser_captures : [];
    const duplicateCapture = !!body.capture && history.some((c: any) => c.capture_id === body.capture!.capture_id);
    const isLatest = Date.parse(observedAt) >= Date.parse(existing.last_seen_at ?? "1970-01-01");
    // A local retry never becomes a new source visit; an older capture cannot regress current state.
    const updates: Record<string, unknown> = {
      last_seen_at: isLatest ? observedAt : existing.last_seen_at,
      first_seen_at: Date.parse(observedAt) < Date.parse(existing.first_seen_at ?? observedAt) ? observedAt : (existing.first_seen_at ?? observedAt),
      submission_count: (existing.submission_count || 1) + (duplicateCapture ? 0 : 1),
    };

    // Merge any new non-null fields from body
    const mergeFields: Array<[string, unknown]> = [
      ["title", body.title],
      ["price", body.price != null ? Math.round(body.price) : undefined],
      ["current_price", body.current_price ?? body.price],
      ["description", body.description],
      ["location", body.location],
      ["parsed_year", body.parsed_year],
      ["extracted_year", body.parsed_year],
      ["parsed_make", body.parsed_make],
      ["parsed_model", body.parsed_model],
      ["mileage", body.mileage],
      ["exterior_color", body.exterior_color],
      ["interior_color", body.interior_color],
      ["transmission", body.transmission],
      ["fuel_type", body.fuel_type],
      ["image_url", cardImage && existing.image_url ? undefined : body.image_url],
      ["all_images", cardImage && existing.image_url ? undefined : body.all_images],
      ["seller_name", body.seller_name],
      ["seller_profile_url", body.seller_profile_url],
      ["contact_info", body.contact_info],
      ["status", body.status],
      ["listed_days_ago", facts.listed_days_ago],
    ];

    for (const [col, val] of mergeFields) {
      if (isLatest && val != null && val !== undefined) {
        updates[col] = val;
      }
    }

    if (body.removal && isLatest && !duplicateCapture) {
      updates.status = body.removal.reason === "displayed_sold" ? "sold" : "removed";
      updates.removed_at = existing.removed_at ?? body.removal.observed_at;
      updates.removal_reason = body.removal.reason;
    }

    // Retain previous raw material and attribution. The full new browser testimony lives in its sweep row.
    {
      updates.raw_scrape_data = {
        ...raw,
        direct_submissions: [...(Array.isArray(raw.direct_submissions) ? raw.direct_submissions : []),
          ...(!body.capture ? [{ agent_context: body.agent_context, submitted_at: observedAt, input: body }] : [])],
        browser_captures: [...history, ...(body.capture && !duplicateCapture ? [captureReference(body.capture)] : [])],
        ...(body.removal && !duplicateCapture ? { removals: [...(Array.isArray(raw.removals) ? raw.removals : []), body.removal] } : {}),
        ...(isLatest ? { listing_facts: { ...facts, observed_at: observedAt } } : {}),
      };
    }

    // Attempt vehicle linking if not already linked
    let vehicleId = existing.vehicle_id;
    if (!vehicleId) {
      const link = await linkToVehicle({
        vin: null,
        parsed_year: body.parsed_year,
        parsed_make: body.parsed_make,
        parsed_model: body.parsed_model,
        location: body.location,
        description: body.description,
        vinOnly: !!body.capture,
      });
      if (link.vehicle_id) {
        updates.vehicle_id = link.vehicle_id;
        vehicleId = link.vehicle_id;
      }
      if (link.suggested_vehicle_id) {
        updates.suggested_vehicle_id = link.suggested_vehicle_id;
      }
    }

    const updated = await supabase.from("marketplace_listings").update(updates)
      .eq("id", existing.id).select("id").maybeSingle();
    if (updated.error || !updated.data) throw updated.error ?? new Error("listing update not acknowledged");

    return jsonResponse(await finishLanding(body, deps, {
      listing_id: existing.id, vehicle_id: vehicleId, is_new: false,
      submission_count: updates.submission_count, duplicate_capture: duplicateCapture,
    }));
  }

  // New listing — attempt vehicle linking before insert
  const link = await linkToVehicle({
    vin: null,
    parsed_year: body.parsed_year,
    parsed_make: body.parsed_make,
    parsed_model: body.parsed_model,
    location: body.location,
    description: body.description,
    vinOnly: !!body.capture,
  });

  const row: Record<string, unknown> = {
    facebook_id: facebookId,
    platform: "facebook_marketplace",
    url: normalizeUrl(facebookId),
    title: body.title || null,
    price: body.price != null ? Math.round(body.price) : null,
    current_price: body.current_price ?? body.price ?? null,
    description: body.description || null,
    location: body.location || null,
    parsed_year: body.parsed_year || null,
    extracted_year: body.parsed_year || null,
    parsed_make: body.parsed_make || null,
    parsed_model: body.parsed_model || null,
    mileage: body.mileage ?? null,
    exterior_color: body.exterior_color || null,
    interior_color: body.interior_color || null,
    transmission: body.transmission || null,
    fuel_type: body.fuel_type || null,
    image_url: body.image_url || null,
    all_images: body.all_images || null,
    seller_name: body.seller_name || null,
    seller_profile_url: body.seller_profile_url || null,
    contact_info: body.contact_info || null,
    status: body.status || "active",
    listed_days_ago: facts.listed_days_ago ?? null,
    first_seen_at: observedAt,
    last_seen_at: observedAt,
    raw_scrape_data: {
      agent_context: body.agent_context || null,
      submitted_at: observedAt,
      mode: "direct",
      listing_facts: { ...facts, observed_at: observedAt },
      ...(body.capture ? { browser_captures: [captureReference(body.capture)] } : { original_direct_input: body }),
    },
  };

  // Apply vehicle linking results
  if (link.vehicle_id) row.vehicle_id = link.vehicle_id;
  if (link.suggested_vehicle_id) row.suggested_vehicle_id = link.suggested_vehicle_id;

  const { data: inserted, error: insertError } = await supabase
    .from("marketplace_listings")
    .insert(row)
    .select("id, vehicle_id")
    .maybeSingle();

  if (insertError?.code === "23505") return await handleDirect(body, deps);
  if (insertError || !inserted) throw insertError ?? new Error("listing insert not acknowledged");

  return jsonResponse(await finishLanding(body, deps, {
    listing_id: inserted.id, vehicle_id: inserted.vehicle_id || link.vehicle_id,
    is_new: true, submission_count: 1, duplicate_capture: false,
    linked_via: link.vehicle_id ? "vin" : link.suggested_vehicle_id ? "ymm_match" : null,
  }));
}

/** One listing observation for a linked vehicle: the seller's stated fields, quoted from this input. */
export async function writeListingObservation(body: DirectInput, deps: Pick<DirectDeps, "supabase" | "writeObservation">, vehicleId: string) {
  const observedAt = body.capture?.observed_at || new Date().toISOString();
  const v = body.listing_facts?.vehicle;
  const t = body.listing_facts?.title;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ year: body.parsed_year, make: body.parsed_make,
    model: body.parsed_model, asking_price: body.current_price ?? body.price, mileage: body.mileage,
    color: body.exterior_color, interior_color: body.interior_color, transmission: body.transmission,
    fuel_type: body.fuel_type, title_status: v?.title_status, body_style: t?.body_style, doors: t?.doors,
    owner_count: v?.owners?.count, condition_stated: v?.condition })) {
    if (value != null) fields[key] = value;
  }
  try {
    const result = await deps.writeObservation(deps.supabase, {
      vehicleId,
      source: { platform: "facebook_marketplace", url: normalizeUrl(body.facebook_id!), trustScore: 0.4,
        sourceIdentifier: body.capture ? `${body.facebook_id}:${body.capture.capture_id}` : body.facebook_id },
      fields, observationKind: "listing", extractionMethod: "fb_direct_input", observedAt,
      contentText: body.content_text ?? body.description,
      rawData: { capture: body.capture ?? null, input: body },
    });
    const observation = { status: result.observationId ? (result.duplicate ? "duplicate" : "written") : "error",
      observation_id: result.observationId ?? null, errors: [...(result.errors ?? [])] };
    if (!result.observationId) observation.errors.push("observation custody not acknowledged");
    return observation;
  } catch (e) {
    return { status: "error", observation_id: null, errors: [e instanceof Error ? e.message : String(e)] };
  }
}

/** Await canonical observation custody and the existing price/visit ledger before claiming success. */
async function finishLanding(body: DirectInput, deps: DirectDeps, listing: any) {
  const { supabase } = deps;
  const observedAt = body.capture?.observed_at || new Date().toISOString();
  const errors: string[] = [];
  let observation: any = { status: "unlinked", observation_id: null, errors: [] };
  if (listing.vehicle_id) {
    observation = await writeListingObservation(body, deps, listing.vehicle_id);
    errors.push(...observation.errors);
  }
  let sightingLanded = false;
  let sightingId: string | null = null;
  if (body.capture) {
    sightingId = await captureSightingId(body.capture.capture_id, listing.listing_id);
    const sighting = await supabase.from("fb_listing_sightings").upsert({
      id: sightingId, listing_id: listing.listing_id, sweep_job_id: body.capture.capture_id,
      price_at_sighting: body.current_price ?? body.price ?? null, seen_at: observedAt,
      source: "browser_capture", submitted_by: body.agent_context?.agent_id ?? "fb-browser-capture",
    }, { onConflict: "id", ignoreDuplicates: true });
    if (sighting.error) errors.push(sighting.error.message);
    else {
      const ack = await supabase.from("fb_listing_sightings").select("id").eq("id", sightingId).maybeSingle();
      sightingLanded = !!ack.data && !ack.error;
      if (!sightingLanded) errors.push(ack.error?.message ?? "sighting custody not acknowledged");
    }
  }
  return { ...listing, success: errors.length === 0, listing_landed: true,
    ...(body.capture ? { capture_id: body.capture.capture_id, observed_at: observedAt,
      sighting_id: sightingId, sighting_landed: sightingLanded } : {}),
    observation_landing: observation, errors };
}
