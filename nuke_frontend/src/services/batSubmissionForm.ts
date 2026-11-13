/**
 * batSubmissionForm.ts
 * ---------------------------------------------------------------------------
 * The BaT seller submission form, as data. Read from the live form on
 * 2026-10-28 (Pontiac Firebird branch: 180 inputs, 4 steps: Make & Model,
 * Basic Facts, Details, Contact Info). Rows are in DOM order. The question
 * label is the stable key; `nameHint` is the input name when it was read
 * (input ids shift with the per-model overlay, labels do not).
 *
 * Each row carries the tier that justifies its value:
 *   decode     deterministic from a document (VIN plate, cowl tag, profile identity)
 *   observe    from the image cascade (vehicle_images.components_seen) or a document read
 *   deliberate ownership-era reasoning over sessions, receipts and the description
 *   sign       legal / value / liability: never auto-filled; the owner taps it.
 *
 * The browser worker (scripts/listing/bat-submit-worker.mjs) fills every
 * non-sign row it has a value for, in this order, and stops before Finish.
 */

export type FieldTier = 'decode' | 'observe' | 'deliberate' | 'sign';
export type FormControl = 'select' | 'text' | 'textarea' | 'radio' | 'checkboxes' | 'files' | 'address';
export type BatStep = 'make_model' | 'basic_facts' | 'details' | 'contact';

export interface BatQuestion {
  /** BaT's question label, as read on the live form. The field-map key. */
  label: string;
  /** Input name when known; the worker uses it before falling back to the label. */
  nameHint: string | null;
  step: BatStep;
  control: FormControl;
  tier: FieldTier;
  /** The profile attribute the value is read from (provenance, shown on the receipt). */
  from: string;
  /** Checkbox / select option labels BaT offers on this branch, when fixed. */
  options?: readonly string[];
}

export const BAT_EQUIPMENT_OPTIONS = [
  'Safe-T-Track', 'Cordova vinyl roof', 'Dual exhaust', 'Faux hood scoops', 'Ram Air hood', 'Rear spoiler',
  'Power brakes', 'Power steering', 'Formula steering wheel', 'Tilt steering column', 'Engine-turned dash',
  'Trans Am hood decal', 'Tachometer', 'Clock', 'Grab bar', 'Console', 'Hurst shifter', 'Power windows',
  'Rear defogger', 'Air conditioning', 'Radio', 'Other',
] as const;

export const BAT_DOCUMENT_OPTIONS = [
  'Window sticker', 'PHS documentation', "Owner's manual", 'Service records', 'Spare parts', 'Car cover', 'Other',
] as const;

export const BAT_WHEEL_OPTIONS = ['15" honeycomb wheels', '15" Rally II wheels', 'Other'] as const;

const q = (
  label: string, step: BatStep, control: FormControl, tier: FieldTier, from: string,
  nameHint: string | null = null, options?: readonly string[],
): BatQuestion => ({ label, nameHint, step, control, tier, from, ...(options ? { options } : {}) });

export const BAT_FORM: readonly BatQuestion[] = [
  // Step 1: Make & Model (selects load in sequence: year, then make, then model)
  q('Year', 'make_model', 'select', 'decode', 'identity.year'),
  q('Make', 'make_model', 'select', 'decode', 'identity.make'),
  q('Model', 'make_model', 'select', 'decode', 'identity.bat_model'),

  // Step 2: Basic Facts
  q('Country where the vehicle is located', 'basic_facts', 'select', 'decode', 'identity.country'),
  q('City', 'basic_facts', 'text', 'decode', 'identity.city'),
  q('Postal code', 'basic_facts', 'text', 'decode', 'identity.zip'),
  q('Country of residence', 'basic_facts', 'select', 'sign', 'owner'),
  q('Has the vehicle been listed for sale elsewhere since you owned it?', 'basic_facts', 'radio', 'sign', 'owner'),
  q('Where and when was it listed?', 'basic_facts', 'textarea', 'sign', 'owner'),
  q('Has the vehicle been listed on BaT before?', 'basic_facts', 'radio', 'sign', 'owner'),
  q('Link to the previous BaT listing', 'basic_facts', 'text', 'sign', 'owner'),
  q('What has changed since the previous listing?', 'basic_facts', 'textarea', 'sign', 'owner'),
  q('Are you a dealer?', 'basic_facts', 'radio', 'sign', 'owner'),
  q('Is this a consignment?', 'basic_facts', 'radio', 'sign', 'owner'),
  q('YouTube links', 'basic_facts', 'textarea', 'deliberate', 'listing_content.video_urls'),
  q('Photos', 'basic_facts', 'files', 'decode', 'photos.ordered', 'files[]'),

  // Step 3: Details
  q('Street address where the vehicle is located', 'details', 'address', 'decode', 'identity.street_address'),
  q('VIN', 'details', 'text', 'decode', 'identity.vin'),
  q('Is this a race car?', 'details', 'radio', 'observe', 'identity.registration_use'),
  q('Engine', 'details', 'select', 'observe', 'identity.engine_type', null, ['350ci V8', '400ci V8', 'Other']),
  q('Transmission', 'details', 'select', 'observe', 'identity.transmission'),
  q('Exterior color', 'details', 'select', 'decode', 'identity.cowl_tag.paint_code'),
  q('Interior color', 'details', 'select', 'decode', 'identity.cowl_tag.trim_code'),
  q('Wheels', 'details', 'checkboxes', 'observe', 'components_seen', null, BAT_WHEEL_OPTIONS),
  q('Wheels (other)', 'details', 'text', 'observe', 'components_seen'),
  q('Tire brand', 'details', 'text', 'observe', 'components_seen'),
  q('Tire size', 'details', 'text', 'observe', 'components_seen'),
  q('How is the vehicle titled?', 'details', 'radio', 'sign', 'title document'),
  q('How is the vehicle registered?', 'details', 'radio', 'sign', 'title document'),
  q('Name on title', 'details', 'text', 'sign', 'title document'),
  q('Title state', 'details', 'select', 'sign', 'title document'),
  q('Title status', 'details', 'select', 'sign', 'title document', null, ['Clean', 'Rebuilt', 'Salvage', 'Branded', 'Other']),
  q('What year did you purchase the vehicle?', 'details', 'text', 'sign', 'identity.owned_time'),
  q('Odometer reading', 'details', 'text', 'sign', 'identity.mileage'),
  q('Is the odometer reading accurate?', 'details', 'radio', 'sign', 'owner'),
  q('Miles added since you purchased it', 'details', 'text', 'sign', 'owner'),
  q('Has the vehicle been refurbished?', 'details', 'radio', 'deliberate', 'listing_content.refurbishment'),
  q('Refurbishment year', 'details', 'text', 'deliberate', 'listing_content.refurbishment.year'),
  q('Refurbishment details', 'details', 'textarea', 'deliberate', 'listing_content.refurbishment.details'),
  q('Paint and body history', 'details', 'textarea', 'deliberate', 'listing_content.paint_body_history'),
  q('Accident history', 'details', 'textarea', 'deliberate', 'listing_content.accident_history'),
  q('Rust', 'details', 'textarea', 'deliberate', 'listing_content.rust'),
  q('Equipment', 'details', 'checkboxes', 'observe', 'components_seen', null, BAT_EQUIPMENT_OPTIONS),
  q('Equipment (other)', 'details', 'text', 'observe', 'components_seen'),
  q('Has the exhaust or intake been modified?', 'details', 'radio', 'deliberate', 'listing_content.modifications'),
  q('Has the vehicle been modified from stock?', 'details', 'radio', 'deliberate', 'listing_content.modifications'),
  q('List the modifications', 'details', 'textarea', 'deliberate', 'listing_content.modifications'),
  q('History of the vehicle from new', 'details', 'textarea', 'deliberate', 'listing_content.description'),
  q('Services performed and when', 'details', 'textarea', 'deliberate', 'listing_content.recent_service_history'),
  q('Documents', 'details', 'checkboxes', 'sign', 'owner', null, BAT_DOCUMENT_OPTIONS),
  q('Records', 'details', 'textarea', 'sign', 'listing_content.documents_on_hand'),
  q('Known issues or problems', 'details', 'textarea', 'deliberate', 'listing_content.known_flaws'),
  q('California smog', 'details', 'radio', 'sign', 'owner'),
  q('Anything else we should know?', 'details', 'textarea', 'deliberate', 'listing_content.highlights'),
  q('Do you want a reserve?', 'details', 'radio', 'sign', 'owner'),
  q('Reserve amount', 'details', 'text', 'sign', 'reserve_price_cents'),
  q('Document fee', 'details', 'text', 'sign', 'owner'),
  q('I attest that the information provided is accurate', 'details', 'checkboxes', 'sign', 'owner'),
  q('I agree to the BaT listing terms', 'details', 'checkboxes', 'sign', 'owner'),

  // Step 4: Contact Info: the seller's identity, always the owner's.
  q('First name', 'contact', 'text', 'sign', 'owner'),
  q('Last name', 'contact', 'text', 'sign', 'owner'),
  q('Email', 'contact', 'text', 'sign', 'owner'),
  q('Phone', 'contact', 'text', 'sign', 'owner'),
];

/**
 * Observed component label -> BaT equipment / wheel option. Matched
 * case-insensitively against vehicle_images.components_seen[].label.
 */
export const COMPONENT_TO_OPTION: ReadonlyArray<{ re: RegExp; option: string; question: 'Equipment' | 'Wheels' }> = [
  { re: /safe-?t-?track|limited.?slip|posi/i, option: 'Safe-T-Track', question: 'Equipment' },
  { re: /vinyl roof|cordova/i, option: 'Cordova vinyl roof', question: 'Equipment' },
  { re: /dual exhaust/i, option: 'Dual exhaust', question: 'Equipment' },
  { re: /hood scoop/i, option: 'Faux hood scoops', question: 'Equipment' },
  { re: /ram air|shaker/i, option: 'Ram Air hood', question: 'Equipment' },
  { re: /spoiler/i, option: 'Rear spoiler', question: 'Equipment' },
  { re: /power brake|brake booster/i, option: 'Power brakes', question: 'Equipment' },
  { re: /power steering/i, option: 'Power steering', question: 'Equipment' },
  { re: /formula (steering )?wheel/i, option: 'Formula steering wheel', question: 'Equipment' },
  { re: /tilt (steering )?column/i, option: 'Tilt steering column', question: 'Equipment' },
  { re: /engine.?turned/i, option: 'Engine-turned dash', question: 'Equipment' },
  { re: /hood (bird|decal)|screaming chicken/i, option: 'Trans Am hood decal', question: 'Equipment' },
  { re: /tach/i, option: 'Tachometer', question: 'Equipment' },
  { re: /\bclock\b/i, option: 'Clock', question: 'Equipment' },
  { re: /grab bar/i, option: 'Grab bar', question: 'Equipment' },
  { re: /console/i, option: 'Console', question: 'Equipment' },
  { re: /hurst/i, option: 'Hurst shifter', question: 'Equipment' },
  { re: /power window/i, option: 'Power windows', question: 'Equipment' },
  { re: /defog/i, option: 'Rear defogger', question: 'Equipment' },
  { re: /a\/c|air condition|ac compressor/i, option: 'Air conditioning', question: 'Equipment' },
  { re: /radio/i, option: 'Radio', question: 'Equipment' },
  { re: /honeycomb/i, option: '15" honeycomb wheels', question: 'Wheels' },
  { re: /rally ii|rally 2/i, option: '15" Rally II wheels', question: 'Wheels' },
];

/** Tire size as molded on the sidewall: FR70-15, P225/70R15, 235/60R15. */
export const TIRE_SIZE_RE = /\b(?:[A-Z]{1,2}R?\d{2}-\d{2}|P?\d{3}\/\d{2}R\d{2})\b/i;
export const TIRE_BRANDS_RE = /\b(BFGoodrich|Goodyear|Firestone|Michelin|Coker|Uniroyal|Cooper|Pirelli|Bridgestone|General|Kelly|Hankook|Toyo|Nitto|Diamond Back|Radir)\b/i;
