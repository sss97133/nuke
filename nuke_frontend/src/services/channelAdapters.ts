/**
 * channelAdapters.ts
 * ---------------------------------------------------------------------------
 * The layer behind the toggle. Each mechanism resolves a normalized
 * AdapterResult from the prepared listing package — same input, the outlet's
 * own delivery path. submitToChannel persists the result faithfully; the
 * switchboard renders status from it. The toggle never sees any of this.
 *
 * Today this is synchronous contract resolution (mapping + queueing + honest
 * credential gating). The network half — the eBay HTTP call, the browser
 * worker, the concierge notification — lands behind an edge function next,
 * because it needs secrets a browser can't hold. The seams are marked.
 */

import type { ChannelDef } from './channelRegistry';

export type DispatchStatus = 'active' | 'submitted' | 'prepared' | 'blocked';

/** What's missing before a blocked channel can actually fire. */
export type DispatchBlocker = 'ebay_account_link' | 'dealer_identity' | 'session_link' | null;

export interface AdapterResult {
  status: DispatchStatus;
  /** Set when status === 'blocked' — the concrete thing the user must connect. */
  needs?: DispatchBlocker;
  externalRef?: { url?: string; id?: string } | null;
  /** Work spec a downstream worker (browser agent / concierge queue) consumes. */
  job?: Record<string, unknown> | null;
  /** Outbound field map (e.g. eBay AddItem item specifics), ready to ship. */
  payload?: Record<string, unknown> | null;
  /** Human-readable next action, surfaced on the toggle. */
  note: string;
}

export interface DispatchContext {
  vehicleId: string;
  /** The package from generate-listing-package (identity, listing_content, photos, valuation). */
  pkg: any;
  askingPriceCents?: number;
  reserveCents?: number;
}

// ---------------------------------------------------------------------------
// eBay Motors — the one true instant-list. Maps the digital twin to a Trading
// API AddItem (Site ID 100). VIN + SellerProvidedTitle are required for
// Cars & Trucks. Whole-vehicle listings are Trading API only (the REST
// Inventory API is parts-compatibility only).
// ---------------------------------------------------------------------------

export function mapToEbayAddItem(ctx: DispatchContext): Record<string, unknown> {
  const id = (ctx.pkg?.identity ?? {}) as Record<string, any>;
  const content = (ctx.pkg?.listing_content ?? {}) as Record<string, any>;
  const photos = ((ctx.pkg?.photos?.ordered ?? []) as Array<{ url: string }>).map((p) => p.url);
  const priceUsd = ctx.askingPriceCents ? ctx.askingPriceCents / 100 : null;
  const title = (content.title as string) || `${id.year ?? ''} ${id.make ?? ''} ${id.model ?? ''}`.trim();

  // Item specifics are NameValueList pairs (verified against ItemType schema). The
  // legal title status (clean/salvage) is a specific — NOT SellerProvidedTitle,
  // which is the seller's free-text vehicle title for the listing.
  const nameValueList = [
    { Name: 'Make', Value: id.make },
    { Name: 'Model', Value: id.model },
    { Name: 'Year', Value: id.year },
    { Name: 'Mileage', Value: id.mileage },
    { Name: 'Transmission', Value: id.transmission ?? id.transmission_type },
    { Name: 'Drive Type', Value: id.drivetrain },
    { Name: 'Engine', Value: id.engine_type },
    { Name: 'Body Type', Value: id.body_style },
    { Name: 'Exterior Color', Value: id.exterior_color },
    { Name: 'Interior Color', Value: id.interior_color },
    { Name: 'Vehicle Title', Value: id.title_status }, // legal title status (clean/salvage/rebuilt)
    { Name: 'For Sale By', Value: 'Private Seller' },
  ].filter((s) => s.Value != null && s.Value !== '');

  return {
    Title: title,
    Site: 'eBayMotors',
    SiteID: 100,
    PrimaryCategory: { CategoryID: '6001' }, // Cars & Trucks
    VIN: id.vin ?? null, // Item.VIN — required for model year >= 1981
    SellerProvidedTitle: title, // required for Cars & Trucks — seller's vehicle title for the listing
    ListingType: priceUsd ? 'FixedPriceItem' : 'Chinese', // auction fallback
    StartPrice: priceUsd,
    ReservePrice: ctx.reserveCents ? ctx.reserveCents / 100 : null,
    Location: id.location ?? null,
    Description: (content.description as string) || '',
    ItemSpecifics: { NameValueList: nameValueList }, // Item.ItemSpecifics.NameValueList[]
    PictureDetails: { PictureURL: photos.slice(0, 24) }, // PictureDetails.PictureURL[], eBay caps at 24
  };
}

// ---------------------------------------------------------------------------
// Bring a Trailer — agent_pilot. No API; an AI drives BaT's Gravity Forms
// wizard (gform_1) under the seller's session. Same idea as the eBay mapper,
// but the target is BaT's own field_map (BAT_GRAVITYFORMS_FORM.field_map:
// chassis/mileage/transmission/reserve/owned_time + a per-model overlay) — so
// we project onto STABLE semantic names and let the browser worker resolve
// them to the live DOM (input ids shift with the model overlay; names don't).
//
// Every projected field carries a tier — how its value is justified:
//   decode     deterministic from a document (VIN, title)
//   observe    from the image cascade (color, wheels, engine family)
//   deliberate ownership-era timeline reasoning (description, condition)
//   sign       legal/value/liability — NOT auto-fillable; needs a human key.
// The human-key taxonomy is canonical: see
// docs/library/technical/design-book/sales-channels-are-service-businesses.md.
// ---------------------------------------------------------------------------

/** The only things an agent cannot resolve — they need the owner's signature. */
export type HumanKey = 'identity_grant' | 'ownership_attestation' | 'contract_signature' | 'final_approval';
type FieldTier = 'decode' | 'observe' | 'deliberate' | 'sign';
interface TieredField { value: unknown; tier: FieldTier; }

export interface BatSubmission {
  /** Keyed by BaT field_map semantic name. Worker resolves name → live DOM field. */
  fields: Record<string, TieredField>;
  /** Owner signatures required before/at submit — surfaced as the only taps. */
  humanKeys: HumanKey[];
}

export function mapToBatSubmission(ctx: DispatchContext): BatSubmission {
  const id = (ctx.pkg?.identity ?? ctx.pkg?.vehicle ?? {}) as Record<string, any>;
  const content = (ctx.pkg?.listing_content ?? {}) as Record<string, any>;
  const fields: Record<string, TieredField> = {};
  const put = (name: string, value: unknown, tier: FieldTier) => {
    if (value != null && value !== '') fields[name] = { value, tier };
  };

  // Decode — from the title / VIN (deterministic identity & provenance).
  put('chassis', id.vin, 'decode');
  put('make_model_year', id.year, 'decode');
  put('make_name', id.make, 'decode');
  put('model_name', id.model, 'decode');
  put('location_input', id.location, 'decode');
  put('location_zip', id.zip, 'decode'); // generate-listing-package: identity.zip (vehicles.zip_code)
  put('title_status', id.title_status, 'decode'); // null here → rides on ownership_attestation
  put('owned_time', id.owned_time, 'decode'); // identity.owned_time = purchase year

  // Observe — from the image cascade.
  put('mileage', id.mileage, 'observe');
  put('transmission', id.transmission ?? id.transmission_type, 'observe');
  put('body_style', id.body_style, 'observe');
  put('engine', id.engine ?? id.engine_type, 'observe');
  put('exterior_color', id.exterior_color, 'observe');
  put('interior_color', id.interior_color, 'observe');

  // Deliberate — ownership-era narrative.
  put('description', content.description, 'deliberate');

  // Reserve / price is always a final-approval decision; carry the proposed value.
  if (ctx.reserveCents != null) put('reserve', ctx.reserveCents / 100, 'sign');

  // Human keys: title photo + status (ownership_attestation) and the
  // price/known-defects sign-off (final_approval) can never be auto-resolved.
  // identity_grant is satisfied by a linked seller account; add it only if the
  // package can't prove seller identity. contract_signature is concierge-only.
  const humanKeys: HumanKey[] = ['ownership_attestation', 'final_approval'];
  if (!id.title_status) {
    // status unknown → it rides on the title doc the owner must attest anyway.
  }
  return { fields, humanKeys };
}

// ---------------------------------------------------------------------------
// Dispatch — resolve the channel's mechanism to a normalized result.
// ---------------------------------------------------------------------------

export function dispatchChannel(channel: ChannelDef, ctx: DispatchContext): AdapterResult {
  switch (channel.mechanism) {
    case 'native':
      // Nuke's own surface — flipping it on IS the listing.
      return { status: 'active', note: 'Live on Nuke.' };

    case 'instant_api': {
      // eBay. Field map is ready; firing it needs a linked eBay seller token
      // (OAuth), which lives server-side. Until that's connected we surface the
      // mapped payload and block on the account link rather than fake a submit.
      const payload = mapToEbayAddItem(ctx);
      return {
        status: 'blocked',
        needs: 'ebay_account_link',
        payload,
        note: 'Mapped to eBay AddItem. Connect an eBay seller account to fire.',
        // SEAM: when linked → server-side edge fn calls VerifyAddItem (dry-run validation)
        // then AddItem (Trading API, Site 100). VerifyAddItem first so a bad payload
        // surfaces as a fixable error, never a failed live listing.
      };
    }

    case 'dealer_feed':
      // ClassicCars / AutoTrader ingest a dealer inventory feed. Requires a
      // dealer identity before the row can be syndicated.
      return {
        status: 'blocked',
        needs: 'dealer_identity',
        note: `Queued for ${channel.label} dealer feed. Connect a dealer identity to syndicate.`,
        // SEAM: when dealer identity exists → add row to the outbound feed builder.
      };

    case 'agent_pilot': {
      // No API / bot-hostile. An AI drives the outlet's own form under the
      // user's session. We enqueue a browser-submit job; the worker (Chrome
      // automation, same muscle as fb-scraper) picks it up.
      // BaT gets a real field projection now (the rest enqueue bare until their
      // form is mapped). The job carries the tiered field_map + human keys so
      // the worker fills decode/observe/deliberate and the switchboard surfaces
      // only the human keys as the owner's taps.
      const bat = channel.platform === 'bat' ? mapToBatSubmission(ctx) : null;
      return {
        status: 'prepared',
        note: bat
          ? `Mapped ${Object.keys(bat.fields).length} fields for ${channel.label} auto-pilot; ${bat.humanKeys.length} owner sign-offs remain.`
          : `Queued for AI auto-pilot to submit on ${channel.label}.`,
        payload: bat ? (bat.fields as Record<string, unknown>) : null,
        job: {
          kind: 'browser_submit',
          target: channel.id,
          platform: channel.platform,
          vehicle_id: ctx.vehicleId,
          needs: 'session_link', // requires a logged-in session for the outlet
          ...(bat ? { field_map: bat.fields, human_keys: bat.humanKeys } : {}),
          // Freeze the derive-on-read provenance into the attested snapshot: what
          // was submitted, its consensus confidence, and the attribute behind it.
          ...(bat && ctx.pkg?.field_provenance ? { field_provenance: ctx.pkg.field_provenance } : {}),
        },
        // SEAM: worker reads listing_exports where metadata.job.kind='browser_submit'.
      };
    }

    case 'concierge_human':
      // Structurally non-automatable (valuation + signed contract). AI
      // assembles the dossier; a human completes the consignment handoff.
      return {
        status: 'prepared',
        note: `Dossier assembled. Queued for concierge handoff to ${channel.label}.`,
        job: {
          kind: 'consignment_handoff',
          target: channel.id,
          vehicle_id: ctx.vehicleId,
        },
        // SEAM: worker notifies the concierge queue (imessage-router / notifications).
      };

    default:
      return { status: 'prepared', note: 'Queued.' };
  }
}
