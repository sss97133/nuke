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
import {
  BAT_FORM, COMPONENT_TO_OPTION, TIRE_BRANDS_RE, TIRE_SIZE_RE,
  type BatQuestion, type FieldTier,
} from './batSubmissionForm';

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
export type { FieldTier };

export interface TieredField {
  value: unknown;
  tier: FieldTier;
  /** DOM-order position on the live form (BAT_FORM index). */
  order: number;
  step: BatQuestion['step'];
  control: BatQuestion['control'];
  nameHint: string | null;
  /** Profile attribute the value came from. */
  from: string;
  /** vehicle_images ids that justify an observed value. */
  sourceImageIds?: string[];
  /** For sign rows: the human key that owns the tap. */
  humanKey?: HumanKey;
}

export interface BatSubmission {
  /** Keyed by the BaT question label. Every BAT_FORM row with a value (sign rows always present, value proposed or null). */
  fields: Record<string, TieredField>;
  /** Labels the worker may fill (decode/observe/deliberate with a value), in DOM order. */
  autoFill: string[];
  /** Labels left to the owner (sign tier), in DOM order. */
  ownerTaps: string[];
  /** Non-sign rows the profile has no value for yet (ingest gaps, not owner questions). */
  missing: string[];
  /** Owner signatures required before/at submit — surfaced as the only taps. */
  humanKeys: HumanKey[];
}

const SIGN_KEY: Record<string, HumanKey> = {
  'Do you want a reserve?': 'final_approval',
  'Reserve amount': 'final_approval',
  'Document fee': 'final_approval',
  'Known issues or problems': 'final_approval',
};
const signKeyFor = (q: BatQuestion): HumanKey =>
  SIGN_KEY[q.label] ?? (q.step === 'contact' || q.label === 'Country of residence' ? 'identity_grant' : 'ownership_attestation');

type Component = { label?: string; image_id?: string; confidence?: number };

/** Map observed components to BaT checkbox options, keeping the images that show each one. */
export function componentsToOptions(components: Component[], question: 'Equipment' | 'Wheels') {
  const byOption = new Map<string, Set<string>>();
  for (const c of components) {
    if (!c?.label) continue;
    for (const m of COMPONENT_TO_OPTION) {
      if (m.question !== question || !m.re.test(c.label)) continue;
      const s = byOption.get(m.option) ?? new Set<string>();
      if (c.image_id) s.add(c.image_id);
      byOption.set(m.option, s);
    }
  }
  return [...byOption].map(([option, ids]) => ({ option, image_ids: [...ids] }));
}

function firstMatch(components: Component[], re: RegExp): { value: string; image_ids: string[] } | null {
  for (const c of components) {
    const m = c?.label?.match(re);
    if (m) return { value: m[1] ?? m[0], image_ids: c.image_id ? [c.image_id] : [] };
  }
  return null;
}

const yesNo = (v: unknown) => (v == null || v === '' || (Array.isArray(v) && !v.length) ? null : 'Yes');
const text = (v: unknown): string | null => {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') : null;
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v).trim();
  return s || null;
};

export function mapToBatSubmission(ctx: DispatchContext): BatSubmission {
  const id = (ctx.pkg?.identity ?? ctx.pkg?.vehicle ?? {}) as Record<string, any>;
  const content = (ctx.pkg?.listing_content ?? {}) as Record<string, any>;
  const cowl = (id.cowl_tag ?? {}) as Record<string, any>;
  const components = (ctx.pkg?.observed_components ?? []) as Component[];
  const photos = (ctx.pkg?.photos?.ordered ?? []) as Array<{ id?: string; url: string }>;
  const refurb = (content.refurbishment ?? {}) as Record<string, any>;

  const equipment = componentsToOptions(components, 'Equipment');
  const wheels = componentsToOptions(components, 'Wheels');
  const tireSize = firstMatch(components, TIRE_SIZE_RE);
  const tireBrand = firstMatch(components, TIRE_BRANDS_RE);
  const ids = (xs: Array<{ image_ids: string[] }>) => [...new Set(xs.flatMap((x) => x.image_ids))];

  // Value + source images per question label. Sign rows carry a proposed value
  // (for the owner's review) but are never in autoFill.
  const values: Record<string, { value: unknown; sourceImageIds?: string[] }> = {
    Year: { value: id.year },
    Make: { value: id.make },
    // A clone is entered as its tag's body series; the clone name rides in the title.
    Model: { value: id.bat_model ?? cowl.series_model ?? ([id.model, id.trim].filter(Boolean).join(' ') || null) },
    'Country where the vehicle is located': { value: id.country },
    City: { value: id.city },
    'Postal code': { value: id.zip },
    'YouTube links': { value: text(content.video_urls) },
    Photos: {
      value: photos.length ? photos.map((p) => ({ image_id: p.id ?? null })) : null,
      sourceImageIds: photos.map((p) => p.id).filter(Boolean) as string[],
    },
    'Street address where the vehicle is located': { value: id.street_address },
    VIN: { value: id.vin },
    'Is this a race car?': { value: id.registration_use ? (id.registration_use === 'race' ? 'Yes' : 'No') : null },
    Engine: { value: id.engine_option ?? id.engine ?? id.engine_type ?? id.displacement },
    Transmission: { value: id.transmission ?? id.transmission_type },
    // Cowl tag code first (the option list is keyed by factory code), observed color as fallback.
    'Exterior color': { value: cowl.paint_code ?? id.exterior_color },
    'Interior color': { value: cowl.trim_code ?? id.interior_color },
    Wheels: { value: wheels.length ? wheels.map((w) => w.option) : null, sourceImageIds: ids(wheels) },
    'Tire brand': { value: tireBrand?.value, sourceImageIds: tireBrand?.image_ids },
    'Tire size': { value: tireSize?.value, sourceImageIds: tireSize?.image_ids },
    'Title status': { value: id.title_status },
    'What year did you purchase the vehicle?': { value: id.owned_time },
    'Odometer reading': { value: id.mileage },
    'Has the vehicle been refurbished?': { value: yesNo(refurb.details ?? refurb.year) },
    'Refurbishment year': { value: refurb.year },
    'Refurbishment details': { value: text(refurb.details) },
    'Paint and body history': { value: text(content.paint_body_history) },
    'Accident history': { value: text(content.accident_history) },
    Rust: { value: text(content.rust) },
    Equipment: { value: equipment.length ? equipment.map((e) => e.option) : null, sourceImageIds: ids(equipment) },
    'Has the exhaust or intake been modified?': { value: content.exhaust_intake_modified == null ? null : content.exhaust_intake_modified ? 'Yes' : 'No' },
    'Has the vehicle been modified from stock?': { value: yesNo(content.modifications) },
    'List the modifications': { value: text(content.modifications) },
    'History of the vehicle from new': { value: text(content.description) },
    'Services performed and when': { value: text(content.recent_service_history) },
    Records: { value: text(content.documents_on_hand) },
    'Known issues or problems': { value: text(content.known_flaws) },
    'Anything else we should know?': { value: text(content.highlights) },
    'Reserve amount': { value: ctx.reserveCents != null ? ctx.reserveCents / 100 : null },
  };

  const fields: Record<string, TieredField> = {};
  const autoFill: string[] = [];
  const ownerTaps: string[] = [];
  const missing: string[] = [];
  BAT_FORM.forEach((q, order) => {
    const v = values[q.label];
    const value = v?.value ?? null;
    const has = value != null && value !== '';
    const isSign = q.tier === 'sign';
    if (!has && !isSign) { missing.push(q.label); return; }
    fields[q.label] = {
      value: has ? value : null,
      tier: q.tier,
      order,
      step: q.step,
      control: q.control,
      nameHint: q.nameHint,
      from: q.from,
      ...(v?.sourceImageIds?.length ? { sourceImageIds: v.sourceImageIds } : {}),
      ...(isSign ? { humanKey: signKeyFor(q) } : {}),
    };
    (isSign ? ownerTaps : autoFill).push(q.label);
  });

  // ownership_attestation (title, history, attestations) and final_approval
  // (reserve, fees, known defects) always; identity_grant for the seller's
  // own contact and residence. contract_signature is concierge-only.
  const humanKeys: HumanKey[] = ['ownership_attestation', 'final_approval', 'identity_grant'];
  return { fields, autoFill, ownerTaps, missing, humanKeys };
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
          ? `Mapped ${bat.autoFill.length} fields for ${channel.label} auto-pilot; ${bat.ownerTaps.length} owner taps, ${bat.missing.length} not on the profile yet.`
          : `Queued for AI auto-pilot to submit on ${channel.label}.`,
        payload: bat ? (bat.fields as Record<string, unknown>) : null,
        job: {
          kind: 'browser_submit',
          target: channel.id,
          platform: channel.platform,
          vehicle_id: ctx.vehicleId,
          needs: 'session_link', // requires a logged-in session for the outlet
          ...(bat
            ? {
                field_map: bat.fields,
                auto_fill: bat.autoFill,
                owner_taps: bat.ownerTaps,
                missing: bat.missing,
                human_keys: bat.humanKeys,
              }
            : {}),
          // Freeze the derive-on-read provenance into the attested snapshot: what
          // was submitted, its consensus confidence, and the attribute behind it.
          ...(bat && ctx.pkg?.field_provenance ? { field_provenance: ctx.pkg.field_provenance } : {}),
          ...(bat && ctx.pkg?.contributor_evidence ? { contributor_evidence: ctx.pkg.contributor_evidence } : {}),
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
