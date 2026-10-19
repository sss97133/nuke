/**
 * After custody: connect each landed Facebook listing to the rest of the graph, the way Craigslist's posts are.
 *
 * A listing ID is a source presentation, not a car (data-machine.md, Facebook acquisition). So:
 *   - a listing whose title states year, make and model goes through `ingest`: VIN / URL matching, the quality gate,
 *     a new `discovered` vehicle when nothing matches, year/make/model candidates as merge_proposals (never auto-links),
 *     and the classified listing event (vehicle_events, event_type 'listing') the market and Sources boards read;
 *   - a listing that does not state a model stays retained and unresolved in marketplace_listings;
 *   - a listing already linked gets its listing event at this capture's clock (keyed, so a repeat sighting updates it);
 *   - a revisit that saw it gone ends its event (ended_at = that revisit; outcome unknown, never a sale);
 *   - its gallery is copied into storage through backfill-images (Facebook's CDN links expire within days);
 *   - a seller profile id becomes an external_identities key ('facebook', numeric id). The name stays in
 *     marketplace_listings, which anonymous readers cannot read; external_identities is public.
 *
 * Failures here never undo custody: the packet, listing and sighting are already acknowledged. Each outcome is counted.
 */
import { type DirectInput, writeListingObservation } from "./direct.ts";
import { withListingFacts } from "./listingFacts.ts";

export interface IngestOutcome { status: string; vehicle_id?: string | null; reason?: string; error?: string }

export interface IntegrationDeps {
  supabase: any;
  writeObservation: (supabase: any, input: any) => Promise<any>;
  /** One `ingest` batch call (at most 50 items); results come back in input order. */
  callIngest: (batch: Record<string, unknown>[]) => Promise<IngestOutcome[]>;
  /** The classified listing event writer (ingest/classifiedEvent.ts landClassifiedListing). */
  landEvent: (supabase: any, a: any) => Promise<{ event: { action: string; error?: string } }>;
  /** The keyed episode writer (_shared/vehicleEventWrite.ts writeVehicleEventByKey). */
  writeEvent: (supabase: any, row: any, policy?: any) => Promise<{ action: string; error?: string }>;
  /** Background photo copy; must not block the response. Returns whether a copy was queued. */
  persistPhotos: (vehicleId: string, urls: string[], observedAt: string) => boolean;
  /** How many listings this invocation may send to ingest: the owner's platform_config source_intake ceiling. */
  promotionLimit: () => Promise<number>;
}

export interface LandedResult {
  facebook_id?: string; listing_id?: string; vehicle_id?: string | null; listing_landed?: boolean; success?: boolean;
  observation_landing?: { observation_id?: string | null };
}

export interface IntegrationReceipt {
  listings: number; already_linked: number; candidates: number; deferred: number; unresolved_identity: number;
  vehicles_created: number; vehicles_matched: number; rejected: number; rejected_reasons: Record<string, number>;
  observations: number; events: Record<string, number>; ended: number; places: Record<string, number>; photo_jobs: number;
  seller_identities: number; errors: string[];
}

const itemUrl = (id: string) => `https://www.facebook.com/marketplace/item/${id}/`;

/** The seller's numeric Facebook id from a rendered profile link or an older collector's contact block. */
export function sellerKey(body: DirectInput): { id: string; url: string } | null {
  const fromUrl = (u: unknown) => String(u ?? "").match(/facebook\.com\/(?:marketplace\/profile\/|profile\.php\?id=)(\d{5,})/)?.[1];
  const ci = (body.contact_info ?? {}) as Record<string, unknown>;
  const raw = String(ci.seller_fb_user_id ?? "");
  const id = fromUrl(body.seller_profile_url) ?? (/^\d{5,}$/.test(raw) ? raw : undefined) ?? fromUrl(ci.seller_profile_url);
  return id ? { id, url: `https://www.facebook.com/marketplace/profile/${id}/` } : null;
}

async function landSeller(supabase: any, listingId: string, body: DirectInput, observedAt: string): Promise<boolean> {
  const key = sellerKey(body);
  if (!key) return false;
  const s = body.listing_facts?.seller;
  const marketplace = { observed_at: observedAt, ...(s?.rating_count != null ? { rating_count: s.rating_count } : {}),
    ...(s?.joined_year ? { joined_year: s.joined_year } : {}), ...(s?.badges?.length ? { badges: s.badges } : {}) };
  const held = await supabase.from("external_identities").select("id, first_seen_at, last_seen_at, metadata")
    .eq("platform", "facebook").eq("handle", key.id).maybeSingle();
  if (held.error) throw held.error;
  let identityId: string | null = held.data?.id ?? null;
  if (!identityId) {
    const ins = await supabase.from("external_identities").insert({
      platform: "facebook", handle: key.id, profile_url: key.url, display_name: null,
      first_seen_at: observedAt, last_seen_at: observedAt, metadata: { source: "facebook_marketplace", marketplace },
    }).select("id").maybeSingle();
    if (ins.error && ins.error.code !== "23505") throw ins.error;
    identityId = ins.data?.id ?? (await supabase.from("external_identities").select("id")
      .eq("platform", "facebook").eq("handle", key.id).maybeSingle()).data?.id ?? null;
  } else if (Date.parse(observedAt) > Date.parse(held.data.last_seen_at ?? "1970-01-01")) {
    const upd = await supabase.from("external_identities").update({
      last_seen_at: observedAt, metadata: { ...(held.data.metadata ?? {}), marketplace },
    }).eq("id", identityId);
    if (upd.error) throw upd.error;
  }
  if (!identityId) return false;
  const link = await supabase.from("marketplace_listings").update({ seller_identity_id: identityId })
    .eq("id", listingId).is("seller_identity_id", null);
  if (link.error) throw link.error;
  return true;
}

const US_REGIONS = new Set(("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM " +
  "NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR").split(" "));

/**
 * The listing's place as one vehicle_location_observations row, the table the map (map-vehicles) and the county key
 * read. Facebook shows "City, ST" and says the location is approximate, so the grain is city; the point is that city's
 * entry in city_geocode_lookup, or none. Confidence follows the Craigslist rule beside it: 0.8 with a point, else 0.6.
 */
export function placeRow(vehicleId: string, listingUrl: string, location: string | null | undefined, observedAt: string,
  point: { latitude: number; longitude: number } | null, observationId: string | null): Record<string, unknown> | null {
  const m = String(location ?? "").trim().match(/^([^,]{2,}),\s*([A-Z]{2})$/);
  if (!m) return null;
  const [, city, region] = m;
  const text = `${city.trim()}, ${region}`;
  return {
    vehicle_id: vehicleId, source_type: "listing", source_platform: "facebook_marketplace", source_url: listingUrl,
    observed_at: observedAt, location_text_raw: location, location_text_clean: text,
    country_code: US_REGIONS.has(region) ? "US" : null, region_code: region, city: city.trim(), postal_code: null,
    latitude: point?.latitude ?? null, longitude: point?.longitude ?? null, precision: "city",
    confidence: point ? 0.8 : 0.6,
    metadata: { method: "fb_displayed_city", geocode: point ? "city_geocode_lookup" : null,
      ...(observationId ? { observation_id: observationId } : {}) },
  };
}

async function landPlace(supabase: any, vehicleId: string, body: DirectInput, observedAt: string, observationId: string | null): Promise<string> {
  const draft = placeRow(vehicleId, itemUrl(body.facebook_id!), body.location, observedAt, null, observationId);
  if (!draft) return "no_place";
  const geo = await supabase.from("city_geocode_lookup").select("latitude, longitude")
    .ilike("city", String(draft.city)).eq("state", draft.region_code).limit(1);
  if (geo.error) throw geo.error;
  const hit = geo.data?.[0];
  const point = hit && Number.isFinite(Number(hit.latitude)) ? { latitude: Number(hit.latitude), longitude: Number(hit.longitude) } : null;
  const row = placeRow(vehicleId, itemUrl(body.facebook_id!), body.location, observedAt, point, observationId)!;
  let seen = supabase.from("vehicle_location_observations").select("id").eq("vehicle_id", vehicleId)
    .eq("source_platform", "facebook_marketplace").eq("source_url", row.source_url);
  seen = row.latitude === null ? seen.is("latitude", null) : seen.eq("latitude", row.latitude);
  const prior = await seen.limit(1);
  if (prior.error) throw prior.error;
  if (prior.data?.length) return "duplicate";
  const ins = await supabase.from("vehicle_location_observations").insert(row);
  if (ins.error) throw ins.error;
  return "written";
}

function photosFor(body: DirectInput): string[] {
  const urls = Array.isArray(body.all_images) && body.all_images.length ? body.all_images : body.image_url ? [body.image_url] : [];
  return urls.filter((u) => typeof u === "string" && /fbcdn\.net/.test(u)).slice(0, 20);
}

export async function integrateListings(items: DirectInput[], landed: LandedResult[], deps: IntegrationDeps, observedAtFor: (b: DirectInput) => string): Promise<IntegrationReceipt> {
  const r: IntegrationReceipt = { listings: 0, already_linked: 0, candidates: 0, deferred: 0, unresolved_identity: 0, vehicles_created: 0,
    vehicles_matched: 0, rejected: 0, rejected_reasons: {}, observations: 0, events: {}, ended: 0, places: {}, photo_jobs: 0,
    seller_identities: 0, errors: [] };
  const byId = new Map(items.filter((i) => i.facebook_id).map((i) => [String(i.facebook_id), i]));
  const rows: { body: DirectInput; listingId: string; vehicleId: string | null; observationId: string | null; observedAt: string; isDetail: boolean }[] = [];
  for (const res of landed) {
    const item = res.facebook_id ? byId.get(String(res.facebook_id)) : undefined;
    if (!item || !res.listing_landed || !res.listing_id) continue;
    const body = withListingFacts({ ...item, facebook_id: String(res.facebook_id) });
    rows.push({ body, listingId: res.listing_id, vehicleId: res.vehicle_id ?? null,
      observationId: res.observation_landing?.observation_id ?? null, observedAt: observedAtFor(body),
      isDetail: body.agent_context?.session_type === "browser_listing_page" });
  }
  r.listings = rows.length;
  const count = (k: string) => { r.events[k] = (r.events[k] ?? 0) + 1; };

  for (const row of rows) {
    try { if (await landSeller(deps.supabase, row.listingId, row.body, row.observedAt)) r.seller_identities++; }
    catch (e) { r.errors.push(`seller ${row.body.facebook_id}: ${e instanceof Error ? e.message : String(e)}`); }
  }

  const gone = (b: DirectInput) => !!b.removal || b.status === "sold" || b.status === "removed";
  const candidates = rows.filter((x) => !x.vehicleId && !gone(x.body));
  const titled = candidates.filter((x) => x.body.parsed_year && x.body.parsed_make && x.body.parsed_model);
  r.unresolved_identity = candidates.length - titled.length;
  r.candidates = titled.length;
  let limit = 0;
  if (titled.length) {
    try { limit = await deps.promotionLimit(); } catch (e) { r.errors.push(`intake throttle: ${e instanceof Error ? e.message : String(e)}`); }
  }
  // Over the ceiling (or switched off) a listing stays unlinked; its next sighting offers it again.
  const promotable = titled.slice(0, limit);
  r.deferred = titled.length - promotable.length;
  const promoted = new Set<string>();
  if (promotable.length) {
    let outcomes: IngestOutcome[] = [];
    try {
      outcomes = await deps.callIngest(promotable.map(({ body: b }) => ({
        url: itemUrl(b.facebook_id!), year: b.parsed_year, make: b.parsed_make, model: b.parsed_model,
        price: b.current_price ?? b.price, location: b.location, description: b.description, mileage: b.mileage,
        transmission: b.transmission, color: b.exterior_color, title_status: b.listing_facts?.vehicle?.title_status,
        body_style: b.listing_facts?.title?.body_style, enrich: false,
      })));
    } catch (e) { r.errors.push(`ingest: ${e instanceof Error ? e.message : String(e)}`); }
    for (const [i, x] of promotable.entries()) {
      const out = outcomes[i];
      if (!out) continue;
      if ((out.status === "created" || out.status === "matched") && out.vehicle_id) {
        if (out.status === "created") r.vehicles_created++; else r.vehicles_matched++;
        const link = await deps.supabase.from("marketplace_listings").update({ vehicle_id: out.vehicle_id })
          .eq("id", x.listingId).is("vehicle_id", null);
        if (link.error) { r.errors.push(`link ${x.body.facebook_id}: ${link.error.message}`); continue; }
        x.vehicleId = out.vehicle_id;
        promoted.add(x.listingId);
        const obs = await writeListingObservation(x.body, deps, out.vehicle_id);
        x.observationId = obs.observation_id;
        if (obs.observation_id) r.observations++; else r.errors.push(...obs.errors.map((m) => `observation ${x.body.facebook_id}: ${m}`));
      } else {
        r.rejected++;
        const reason = String(out.reason ?? out.error ?? out.status).split(/[:—]/)[0].trim().slice(0, 60);
        r.rejected_reasons[reason] = (r.rejected_reasons[reason] ?? 0) + 1;
      }
    }
  }

  for (const x of rows) {
    if (!x.vehicleId) continue;
    if (!promoted.has(x.listingId)) r.already_linked++;
    const listingUrl = itemUrl(x.body.facebook_id!);
    try {
      if (x.body.removal) {
        const res = await deps.writeEvent(deps.supabase, {
          vehicle_id: x.vehicleId, source_platform: "facebook_marketplace", source_listing_id: x.body.facebook_id,
          source_url: listingUrl, event_type: "listing", event_status: "ended", ended_at: x.body.removal.observed_at,
          metadata: { source_observed_at: x.body.removal.observed_at,
            removal: { reason: x.body.removal.reason, basis: x.body.removal.basis, observed_at: x.body.removal.observed_at } },
        });
        if (res.action === "error") r.errors.push(`ended ${x.body.facebook_id}: ${res.error}`); else if (res.action !== "skipped") r.ended++;
      } else if (!promoted.has(x.listingId)) {
        const price = x.body.current_price ?? x.body.price ?? null;
        const landedEvent = await deps.landEvent(deps.supabase, { vehicleId: x.vehicleId, platform: "facebook_marketplace",
          listingUrl, listingId: x.body.facebook_id, price: typeof price === "number" ? price : null, postedAt: null,
          observedAt: x.observedAt });
        count(landedEvent.event.action);
        if (landedEvent.event.action === "error") r.errors.push(`event ${x.body.facebook_id}: ${landedEvent.event.error}`);
      }
    } catch (e) { r.errors.push(`event ${x.body.facebook_id}: ${e instanceof Error ? e.message : String(e)}`); }
    if (!x.body.removal) {
      try { const place = await landPlace(deps.supabase, x.vehicleId, x.body, x.observedAt, x.observationId); r.places[place] = (r.places[place] ?? 0) + 1; }
      catch (e) { r.places.error = (r.places.error ?? 0) + 1; r.errors.push(`place ${x.body.facebook_id}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const photos = photosFor(x.body);
    // A repeat search sighting copies its card photo only for a vehicle that still has none.
    const needsPhoto = async () => {
      const v = await deps.supabase.from("vehicles").select("primary_image_url").eq("id", x.vehicleId).maybeSingle();
      return !v.error && !!v.data && !v.data.primary_image_url;
    };
    if (photos.length && (promoted.has(x.listingId) || x.isDetail || await needsPhoto())) {
      if (deps.persistPhotos(x.vehicleId, photos, x.observedAt)) r.photo_jobs++;
    }
  }
  return r;
}
