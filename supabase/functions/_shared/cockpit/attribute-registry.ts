// Attribute registry — the checklist a caller agent can answer about a subject.
//
// Pairs with the cockpit's `ProjectionRequest.attribute` field. Each entry
// declares: which subject_kind it applies to, what kind of result it produces
// (substrate vs projection per observation-projection-boundary.md), what prompt
// the caller agent should run, and what shape the answer must take.
//
// The laser-tag model (per feedback_vision_is_caller_byok_laser_tag.md):
// Nuke owns the checklist + harness + substrate. The caller's agent owns the
// compute. This registry IS the checklist. It's exposed via mcp-connector tools
// and consumed by walk-in / user_byok callers per http-walkin.ts.
//
// Surface-level extractions (vehicle bbox, GPS, EXIF date, top-level make/model)
// are table stakes. The depth that separates Nuke is the long tail — paint
// chemistry, weld pattern, period-correctness, ownership era, modification
// indicators, materials provenance, owner-recognized memory anchors. The
// registry is structured so the long tail can extend indefinitely without
// changing the cockpit interface.
//
// Discovery sources (2026-05-02):
// - validate-vehicle-image (image_type taxonomy + content detection)
// - identify-vehicle-from-image (year/make/model/trim/body_style)
// - api-v1-vision /classify and /analyze (make hierarchy, condition_score, zone, damage)
// - project_image-to-atom-taxonomy.md (L1–L5 baseline taxonomy)
// - project_observation-as-schrodinger.md (atoms latent until queried;
//   registry is the materialization checklist)

import type { ResultKind } from "./types.ts";

export type SubjectKind = "vehicle" | "image" | "person" | "cluster" | "user";

// ── Evidence-class binding (the anti-laundering rule) ────────────────────────
// Every attribute declares which classes of evidence may legitimately CITE it.
// A photo cannot show horsepower; a VIN decode cannot show the current paint.
// submit_attribute_value rejects any claim whose citation class is not admissible
// for the attribute — so a high-tier fact can't be laundered in behind a low-tier
// (or simply wrong-modality) citation.
//
//   image         — visible in a photograph of THIS asset (current color, seat count,
//                   body style, visible mods, condition, plate/VIN read).
//   vin_decode    — derived from the VIN per a factory decode rule (hp, torque,
//                   displacement, engine/trans codes, factory equipment).
//   document      — a record: build sheet / Marti report / title / service history
//                   (original color, mileage, ownership chain).
//   owner_claim   — the owner asserts it. Universally admissible but LOWEST tier and
//                   upgradable — a confirming image/document/decode supersedes it.
//   context_atoms — derived from Nuke's own graph (user/cluster substrate joins);
//                   the "evidence" is existing attributed atoms, not an external source.
export type EvidenceClass =
  | "image"
  | "vin_decode"
  | "document"
  | "owner_claim"
  | "context_atoms";

export const EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "image", "vin_decode", "document", "owner_claim", "context_atoms",
];

export type ExpectedShape =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "ratio_0_1"
  | "bbox"
  | "uuid"
  | "iso_date"
  | "iso_timestamp"
  | "structured";

export interface AttributeDefinition {
  // The canonical attribute name passed in ProjectionRequest.attribute.
  attribute: string;

  // The subject_kind this attribute applies to. A caller iterating a checklist
  // for an image will get back the union of attributes for the image AND any
  // vehicle the image is bound to (when bound).
  subject_kind: SubjectKind;

  // result_kind per observation-projection-boundary.md.
  // 'substrate' = direct measurement on the captured artifact (a vehicle has
  //               two doors visible in this frame; the EXIF lat is X).
  // 'projection' = inference about the world (this vehicle is a 1977 K5 Blazer;
  //                its condition relative to peers is p65).
  // Walk-in adapters that misdeclare get rejected with BoundaryViolationError.
  result_kind: ResultKind;

  // The L1–L5 layer per project_image-to-atom-taxonomy.md.
  // Lower layers must be answered before higher layers can be (e.g. L3 color
  // depends on L2 vehicle bbox per layer-dependencies.md).
  layer: 1 | 2 | 3 | 4 | 5;

  // Modality hints help the caller pick the right model. An attribute may
  // require the image, the EXIF, an OCR pass, or the surrounding atoms.
  modalities: Array<"image" | "exif" | "ocr" | "context_atoms" | "audio" | "text">;

  // What atoms must already exist before this attribute can be answered.
  // The harness uses this to order the checklist for the caller.
  depends_on?: string[];

  // The prompt the caller agent should run. Stable across versions; the
  // prompt's sha256 ends up in projection_event for survival-rate analytics.
  prompt: string;

  // Shape of the value the caller submits.
  expected_shape: ExpectedShape;
  enum_values?: string[];

  // For sanity-checking caller submissions before they hit cockpit.project().
  validate?: (value: unknown) => boolean;

  // Versioning so prompt drift is observable. Bump when the prompt changes.
  prompt_version: string;

  // Admissible evidence classes for this attribute. Optional on the definition;
  // the authoritative binding is ADMISSIBLE_EVIDENCE below (one auditable block).
  // admissibleEvidence(attribute) resolves the effective set.
  admissible_evidence?: EvidenceClass[];
}

// ============================================================================
// L1 — Detection (must come first; nothing higher works without it)
// ============================================================================

const L1: AttributeDefinition[] = [
  {
    attribute: "image.has_vehicle",
    subject_kind: "image",
    result_kind: "substrate",
    layer: 1,
    modalities: ["image"],
    prompt:
      "Look at this image. Is at least one vehicle (car, truck, motorcycle, " +
      "van, SUV, trailer, RV, boat-on-trailer) physically present in the frame? " +
      "Answer true if any vehicle is visible. Answer false if the frame contains " +
      "only people, scenery, documents, screenshots, parts laid out without a " +
      "vehicle, or unrelated content. A vehicle reflected in a mirror counts as " +
      "present. A photograph-of-a-photograph counts only if the inner image is a vehicle.",
    expected_shape: "boolean",
    prompt_version: "v1",
  },
  {
    attribute: "image.classification",
    subject_kind: "image",
    result_kind: "substrate",
    layer: 1,
    modalities: ["image"],
    depends_on: ["image.has_vehicle"],
    prompt:
      "Classify what this image primarily shows. Pick exactly one of: " +
      "vehicle_exterior (whole or majority of vehicle body), " +
      "vehicle_interior (cabin, dashboard, seats, headliner), " +
      "engine_bay (under-hood, engine, accessories), " +
      "undercarriage (frame, drivetrain from below, transmission, transfer case), " +
      "detail_part (close-up of a single component, badge, gauge, bolt, weld), " +
      "documentation (title, registration, service record, build sheet, receipt, VIN plate), " +
      "in_progress (work being performed, hands+tool on vehicle, mid-disassembly), " +
      "scene_context (vehicle present but not the subject — landscape, garage, shop wide-shot), " +
      "ui_element (screenshot, app, listing thumbnail), " +
      "unrelated (no vehicle).",
    expected_shape: "enum",
    enum_values: [
      "vehicle_exterior",
      "vehicle_interior",
      "engine_bay",
      "undercarriage",
      "detail_part",
      "documentation",
      "in_progress",
      "scene_context",
      "ui_element",
      "unrelated",
    ],
    prompt_version: "v1",
  },
  {
    attribute: "image.vehicle_bboxes",
    subject_kind: "image",
    result_kind: "substrate",
    layer: 1,
    modalities: ["image"],
    depends_on: ["image.has_vehicle"],
    prompt:
      "For every vehicle visible in the frame, return a bounding box as " +
      "[x_min, y_min, x_max, y_max] in normalized 0..1 image coordinates. " +
      "Order boxes by area, largest first. Include partially-visible vehicles. " +
      "Do not include reflections.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "image.ocr_regions",
    subject_kind: "image",
    result_kind: "substrate",
    layer: 1,
    modalities: ["image", "ocr"],
    prompt:
      "Detect every readable text region in the image. For each, return " +
      "{ text, bbox: [x_min,y_min,x_max,y_max] in 0..1, kind } where kind is " +
      "vin | plate | odometer | sign | gauge | badge | document_text | other. " +
      "Skip text that is not legibly readable. VINs are 17 alphanumerics " +
      "excluding I, O, Q. Plates vary by jurisdiction.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
];

// ============================================================================
// L2 — Identity (depends on L1; what IS the vehicle)
// ============================================================================

const L2: AttributeDefinition[] = [
  {
    attribute: "vehicle.viewpoint",
    subject_kind: "image",
    result_kind: "substrate",
    layer: 2,
    modalities: ["image"],
    depends_on: ["image.vehicle_bboxes"],
    prompt:
      "For the largest vehicle in the frame, classify the viewpoint. Pick one of: " +
      "front_three_quarter | front | rear | rear_three_quarter | profile_left | " +
      "profile_right | overhead | low_angle | engine_bay | interior_front | " +
      "interior_rear | trunk_or_bed | undercarriage | detail.",
    expected_shape: "enum",
    enum_values: [
      "front_three_quarter",
      "front",
      "rear",
      "rear_three_quarter",
      "profile_left",
      "profile_right",
      "overhead",
      "low_angle",
      "engine_bay",
      "interior_front",
      "interior_rear",
      "trunk_or_bed",
      "undercarriage",
      "detail",
    ],
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.year_range",
    subject_kind: "vehicle",
    result_kind: "projection",
    layer: 2,
    modalities: ["image", "context_atoms"],
    depends_on: ["image.vehicle_bboxes"],
    prompt:
      "Estimate the model year of the vehicle. Use generation cues: body style, " +
      "grille design, headlight shape, side profile, roofline, taillights, " +
      "wheels, badges, era-specific features. Return both a single best year " +
      "and a year range expressing your uncertainty. If you can only narrow to " +
      "a generation, return the generation's start–end years.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.make",
    subject_kind: "vehicle",
    result_kind: "projection",
    layer: 2,
    modalities: ["image", "context_atoms"],
    depends_on: ["image.vehicle_bboxes"],
    prompt:
      "Identify the vehicle manufacturer. Use badges, grille shape, body silhouette. " +
      "Return canonical name (e.g. 'Chevrolet' not 'Chevy'). If multiple " +
      "manufacturers are plausible, return your top choice and list alternates " +
      "as candidates.",
    expected_shape: "string",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.model",
    subject_kind: "vehicle",
    result_kind: "projection",
    layer: 2,
    modalities: ["image", "context_atoms"],
    depends_on: ["vehicle.make"],
    prompt:
      "Given the manufacturer, identify the model and (if possible) trim level. " +
      "Use body style, badges, optional equipment. Return the canonical model " +
      "designation a marque enthusiast would use (e.g. 'K5 Blazer' not 'Blazer'; " +
      "'M635CSI' not 'M6'). If unsure between trims, return the family.",
    expected_shape: "string",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.vin_visible",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 2,
    modalities: ["image", "ocr"],
    depends_on: ["image.ocr_regions"],
    prompt:
      "If a VIN is legibly visible in this image (door jamb, dashboard, fender, " +
      "title document), return the 17-character VIN (or full pre-1981 VIN). " +
      "Reject any string with I, O, or Q in the 17-char era. Return null if " +
      "no VIN is readable.",
    expected_shape: "string",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.plate_redacted",
    subject_kind: "image",
    result_kind: "substrate",
    layer: 2,
    modalities: ["image", "ocr"],
    depends_on: ["image.ocr_regions"],
    prompt:
      "If a license plate is visible, return the bounding box as [x_min,y_min,x_max,y_max] " +
      "in 0..1 coordinates. Do NOT return the plate text. Return null if no plate visible.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
];

// ============================================================================
// L3 — Attributes (depends on L2 vehicle bbox)
// ============================================================================

const L3: AttributeDefinition[] = [
  // ── Factory-spec facts (VIN-decode tier) ───────────────────────────────────
  // A photograph cannot show these; admissible evidence is the VIN decode (factory
  // rule), a document (build sheet / window sticker), or a low-tier owner_claim.
  {
    attribute: "vehicle.horsepower",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 3,
    modalities: ["context_atoms"],
    admissible_evidence: ["vin_decode", "document", "owner_claim"],
    prompt:
      "Report the factory-rated gross horsepower for this VIN's engine code. " +
      "Cite the decode rule (e.g. 1966 Ford 289 2V C-code = 200 hp gross). Do NOT " +
      "infer from a photo — a photo cannot show horsepower. Return an integer.",
    expected_shape: "number",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.torque",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 3,
    modalities: ["context_atoms"],
    admissible_evidence: ["vin_decode", "document", "owner_claim"],
    prompt:
      "Report the factory-rated gross torque (lb-ft) for this VIN's engine code. " +
      "Cite the decode rule (e.g. 1966 Ford 289 2V C-code = 282 lb-ft). Return an integer.",
    expected_shape: "number",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.displacement",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 3,
    modalities: ["context_atoms"],
    admissible_evidence: ["vin_decode", "document", "owner_claim"],
    prompt:
      "Report the factory engine displacement for this VIN's engine code, as cubic " +
      "inches or liters (e.g. '289' or '4.7L'). Cite the decode rule. Return a string.",
    expected_shape: "string",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.seat_count",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 3,
    modalities: ["image", "context_atoms"],
    admissible_evidence: ["image", "vin_decode", "document", "owner_claim"],
    prompt:
      "Report the number of factory seating positions. May be counted from an interior " +
      "photo OR derived from the body style via VIN decode (e.g. 1966 Mustang hardtop " +
      "coupe = 4). Return an integer.",
    expected_shape: "number",
    prompt_version: "v1",
  },
  {
    // Market disposition. The single most fraud-prone and contamination-prone field on an
    // asset: "sold" vs "for sale" vs "owner-retained" drives value perception AND leaks across
    // records in bulk auction scrapes. Admissible evidence is a DOCUMENT (title / bill of sale —
    // who legally holds it), an IMAGE (ongoing possession / restoration), or an owner_claim.
    attribute: "vehicle.sale_disposition",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 3,
    modalities: ["ocr", "image", "context_atoms"],
    admissible_evidence: ["document", "image", "owner_claim"],
    expected_shape: "enum",
    enum_values: ["for_sale", "sold", "owner_retained", "in_restoration", "withdrawn", "unknown"],
    prompt:
      "What is the asset's true market disposition RIGHT NOW? 'sold' means it changed hands to a " +
      "new owner; 'owner_retained' / 'in_restoration' mean the current owner still holds it (a " +
      "title in their name + ongoing possession/build photos prove this and OVERRIDE a stale " +
      "auction-scrape 'sold'). Cite the title/bill-of-sale (document) or possession photos (image).",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.exterior_color",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 3,
    modalities: ["image"],
    depends_on: ["image.vehicle_bboxes", "vehicle.viewpoint"],
    prompt:
      "Extract the exterior color from the vehicle's body panels ONLY (ignore " +
      "background, sky, ground, wheels, glass). Return the dominant body color " +
      "as a common name (yellow, white, dark_blue, two_tone_white_over_red, " +
      "raw_metal, primer, satin_black, etc.) and a sRGB hex approximation. " +
      "If the vehicle is mid-restoration with multiple panel colors, list each " +
      "panel and its color separately.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  // ── Color decomposition (time-varying) ─────────────────────────────────────
  // The single `exterior_color` field conflates two different facts with different
  // evidence: what color it IS now (a photo shows it) vs what color it LEFT THE
  // FACTORY (only a document — Marti report / door tag — can prove it). They are
  // separate claims; a refinish_event links them. The canonical profile projects
  // current as the headline and retains original + the change history.
  {
    attribute: "vehicle.current_color",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 3,
    modalities: ["image"],
    admissible_evidence: ["image", "owner_claim"],
    depends_on: ["image.vehicle_bboxes", "vehicle.viewpoint"],
    prompt:
      "What color IS the vehicle now? Read it from the body panels in a current " +
      "photograph (ignore background, glass, wheels). Return { color, hex }. This is " +
      "present-state — a refinished car reports its refinished color, not the factory color.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.original_color",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 3,
    modalities: ["ocr", "context_atoms"],
    admissible_evidence: ["document", "owner_claim"],
    prompt:
      "What color did the vehicle LEAVE THE FACTORY? This is NOT visible in a photo of " +
      "a refinished car — it requires a document: a Marti report, build sheet, window " +
      "sticker, or the door-jamb paint code. Return { color, code, source_doc }. If you " +
      "only have a photo, you cannot answer this — submit it as vehicle.current_color instead.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.condition_cues",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 3,
    modalities: ["image"],
    depends_on: ["image.vehicle_bboxes"],
    prompt:
      "Catalog every visible condition cue on the vehicle's body, glass, trim, " +
      "and interior. For each cue return { kind, severity, bbox, panel } where " +
      "kind is one of: paint_chip | paint_fade | clearcoat_failure | rust_surface | " +
      "rust_perforation | dent | crease | misaligned_panel_gap | broken_trim | " +
      "cracked_glass | torn_upholstery | worn_carpet | broken_emblem | " +
      "missing_part | aftermarket_modification | recent_repair_evidence. " +
      "severity is minor | moderate | severe. List exhaustively; do not summarize.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.odometer_reading",
    subject_kind: "vehicle",
    result_kind: "substrate",
    layer: 3,
    modalities: ["image", "ocr"],
    depends_on: ["image.ocr_regions"],
    prompt:
      "If an odometer is visible (instrument cluster, gauge, digital display), " +
      "return { miles_or_km: number, units: 'mi' | 'km', confidence: 0..1 }. " +
      "Use units from the gauge face. Return null if no odometer visible or " +
      "the reading is not legible.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.modifications",
    subject_kind: "vehicle",
    result_kind: "projection",
    layer: 3,
    modalities: ["image", "context_atoms"],
    depends_on: ["vehicle.year_range", "vehicle.model"],
    prompt:
      "List visible departures from factory specification. For each modification " +
      "return { kind, evidence_bbox, era_appropriate: boolean }. Examples: " +
      "non-OEM wheels, lift kit, lowered suspension, custom bumpers, aftermarket " +
      "exhaust tips, hood scoop addition, badge deletion, tinted glass, custom " +
      "lighting, roll cage, fender flares, body kit, color-change wrap. Mark " +
      "era_appropriate true if the modification matches the period the vehicle " +
      "would have been customized in (e.g. 1970s Cragar SS wheels on a 1977 K5 " +
      "= era_appropriate; 2020s Tesla wheels on the same = not era_appropriate).",
    expected_shape: "structured",
    prompt_version: "v1",
  },
];

// ============================================================================
// L4 — Context (depends on L1–L3 + EXIF + corpus)
// ============================================================================

const L4: AttributeDefinition[] = [
  {
    // Links original_color → current_color as an explicit state-change in the append-only
    // log. result_kind 'projection' — it's an inference ABOUT a change in the world, not a
    // direct measurement. Evidence can be a before/after image pair, a paint receipt
    // (document), or the owner's account.
    attribute: "vehicle.refinish_event",
    subject_kind: "vehicle",
    result_kind: "projection",
    layer: 4,
    modalities: ["image", "ocr", "context_atoms"],
    admissible_evidence: ["image", "document", "owner_claim"],
    depends_on: ["vehicle.current_color"],
    prompt:
      "Record a documented repaint/refinish as a state change. Return " +
      "{ from_color, to_color, observed_change_date?, method? (respray|wrap|patina_preserve), " +
      "shop? }. Cite the evidence: a before/after image pair, a paint/body invoice, or the " +
      "owner's statement. This is what reconciles a 'factory blue' original with a 'black now' current.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "image.location_class",
    subject_kind: "image",
    result_kind: "projection",
    layer: 4,
    modalities: ["image", "exif", "context_atoms"],
    prompt:
      "Classify where the photo was taken. Pick one of: shop (workspace with " +
      "tools, lift, organized parts), driveway (residential), garage (residential), " +
      "road (in motion or roadside), parking_lot, dealership, auction_lot, " +
      "showroom (museum or display setting), barn_find_site, junkyard, " +
      "transport (car hauler, trailer), unknown.",
    expected_shape: "enum",
    enum_values: [
      "shop",
      "driveway",
      "garage",
      "road",
      "parking_lot",
      "dealership",
      "auction_lot",
      "showroom",
      "barn_find_site",
      "junkyard",
      "transport",
      "unknown",
    ],
    prompt_version: "v1",
  },
  {
    attribute: "image.in_progress_work",
    subject_kind: "image",
    result_kind: "substrate",
    layer: 4,
    modalities: ["image"],
    prompt:
      "If the image shows work being performed on the vehicle, describe the " +
      "specific task. Look for: hands holding tools, removed panels, exposed " +
      "wiring, lifted/jacked vehicle, parts laid out, fluids being drained, " +
      "welding sparks, paint application, sanding dust, masking tape. Return " +
      "{ task, evidence_bboxes[], tools_visible[], stage: 'disassembly' | " +
      "'modification' | 'repair' | 'restoration' | 'finishing' | 'reassembly' }.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
];

// ============================================================================
// L5 — Linking (depends on L1–L4 + cross-image corpus)
// ============================================================================

const L5: AttributeDefinition[] = [
  {
    attribute: "image.likely_vehicle_id",
    subject_kind: "image",
    result_kind: "projection",
    layer: 5,
    modalities: ["context_atoms"],
    depends_on: [
      "image.vehicle_bboxes",
      "vehicle.year_range",
      "vehicle.make",
      "vehicle.model",
      "vehicle.exterior_color",
    ],
    prompt:
      "Given the L2/L3 atoms already extracted from this image and a candidate " +
      "list of known vehicles in the corpus, return the most likely vehicle_id " +
      "this image belongs to, with confidence and the matching atoms used. " +
      "Return null if no candidate exceeds 0.80 confidence (per entity-resolution " +
      "auto-match threshold).",
    expected_shape: "uuid",
    prompt_version: "v1",
  },
];

// ============================================================================
// Aggregate registry
// ============================================================================

// ============================================================================
// Compound projections — full-artifact compositions over many atoms.
// Layer is nominal (5 = synthesis); these are produced by deterministic-sql
// adapters (project_invoice, project_work_log) rather than walk-in callers,
// but listing them in the registry makes them discoverable via
// get_attribute_checklist for any consumer asking "what artifacts can I get?"
// ============================================================================

const COMPOUND: AttributeDefinition[] = [
  {
    attribute: "vehicle.invoice_artifact",
    subject_kind: "vehicle",
    result_kind: "projection",
    layer: 5,
    modalities: ["context_atoms"],
    prompt:
      "Compose a customer invoice for the vehicle by joining work_orders + " +
      "work_order_{parts,labor,payments} + vehicle_receipts. Audience-tier " +
      "the field set: client = customer-facing summary; irs = audit-defensible " +
      "with provenance per line; internal = unredacted. Return composite JSON " +
      "with summary totals + per-line atom citations.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "vehicle.work_log_artifact",
    subject_kind: "vehicle",
    result_kind: "projection",
    layer: 5,
    modalities: ["context_atoms"],
    prompt:
      "Compose a shop work-log for a date by joining vehicle_images (taken_at " +
      "= date) + work_order_{labor,parts,payments} (touched on date) + " +
      "vehicle_receipts (purchased on date) + per-photo atoms from " +
      "projection_event. Audience: public = journal-page render; owner = full " +
      "diary; counterparty = customer view of their build.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
];

// ============================================================================
// USER — first-class subject_kind added 2026-05-24 per Skylar directive:
// "user profiles are the drivers of progress on the platform otherwise the
// system is dead. its a shell without a driver just a bunch of boring useless
// assets." Vehicles/images are derivative; users are the source-of-truth subject.
// These attributes are answerable by a caller agent reading the user-substrate
// (user_profiles + user_emails + user_phones + user_addresses + user_roles +
// user_observations + user_contributions + vehicle_images.user_id), not from
// an image directly. Modality is predominantly context_atoms.
// ============================================================================
const USER: AttributeDefinition[] = [
  // L1 — existence/identity baseline
  {
    attribute: "user.has_profile",
    subject_kind: "user",
    result_kind: "substrate",
    layer: 1,
    modalities: ["context_atoms"],
    prompt:
      "Does this user have a `user_profiles` row with at minimum a display_name " +
      "and a primary email? Answer true if both exist and verified, false otherwise. " +
      "This is the gate for whether any higher-layer user attribute can be queried.",
    expected_shape: "boolean",
    prompt_version: "v1",
  },
  // L2 — identity surface
  {
    attribute: "user.display_identity",
    subject_kind: "user",
    result_kind: "substrate",
    layer: 2,
    modalities: ["context_atoms"],
    depends_on: ["user.has_profile"],
    prompt:
      "Return the user's display identity: display_name + preferred_username + " +
      "primary email + locale + timezone. Pull from user_profiles + user_emails. " +
      "All directly from substrate — no inference.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "user.contact_surface",
    subject_kind: "user",
    result_kind: "substrate",
    layer: 2,
    modalities: ["context_atoms"],
    depends_on: ["user.has_profile"],
    prompt:
      "Enumerate all multi-valued contact rows: every email in user_emails, " +
      "every phone in user_phones, every address in user_addresses. Return as " +
      "structured arrays with type, primary flag, verified flag. Substrate only.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  // L3 — derived profile/state
  {
    attribute: "user.role_set",
    subject_kind: "user",
    result_kind: "substrate",
    layer: 3,
    modalities: ["context_atoms"],
    depends_on: ["user.has_profile"],
    prompt:
      "List all active user_roles for this user — role + scope_type + scope_id + " +
      "granted_at. Exclude revoked_at IS NOT NULL. This answers 'what can this " +
      "user do, and inside which organizations/vehicles.'",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "user.possession_set",
    subject_kind: "user",
    result_kind: "substrate",
    layer: 3,
    modalities: ["context_atoms"],
    depends_on: ["user.has_profile"],
    prompt:
      "List all vehicles this user owns or stewards via vehicle_user_permissions " +
      "(verified_owner / previous_owner / contributor / etc). Include vehicle_id, " +
      "year/make/model, permission_level, evidence_count. Substrate join, no inference.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  // L4 — projection (inference about behavior/pattern)
  {
    attribute: "user.vendor_preference_signal",
    subject_kind: "user",
    result_kind: "projection",
    layer: 4,
    modalities: ["context_atoms"],
    depends_on: ["user.has_profile"],
    prompt:
      "From user_observations of kind='vendor_preference' joined with " +
      "user_contributions (qb_txn, email, imessage), produce the user's top-N " +
      "vendors by spend + frequency, with recency-decay weighting. Return ranked " +
      "list with (vendor, spend_total, txn_count, last_txn_date, signal_score). " +
      "Per Skylar 2026-05-23: $ totals from QB are flagged unverified — surface " +
      "qualitative ranking (vendor exists / frequency / recency) as primary; " +
      "dollars as secondary with .unverified suffix.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "user.daily_activity_density",
    subject_kind: "user",
    result_kind: "projection",
    layer: 4,
    modalities: ["context_atoms"],
    depends_on: ["user.has_profile"],
    prompt:
      "Compose a GitHub-style 365-day activity heatmap from v_user_daily_activity. " +
      "Return per-day (date, contribution_count, dominant_kind, subject_breakdown). " +
      "This is THE product per Skylar (session 5d0848ba): 'once we're able to fully " +
      "establish user behavior then we're able to establish asset growth.'",
    expected_shape: "structured",
    prompt_version: "v1",
  },
  {
    attribute: "user.relationship_map",
    subject_kind: "user",
    result_kind: "projection",
    layer: 4,
    modalities: ["context_atoms"],
    depends_on: ["user.has_profile"],
    prompt:
      "From user_observations of kind='counterparty_relationship' joined with " +
      "contacts + payment_events + apple_cash data, produce the user's " +
      "relationship graph: per-counterparty (name, relationship_type, txn_count, " +
      "total_value, last_interaction, evidence_sources). Tag spouse/family/" +
      "contractor/vendor/customer where determinable. Per Skylar: Jenny is wife, " +
      "Apple Cash to her is spousal not commercial.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
];

// ============================================================================
// CLUSTER — temporal-change (dT) over the work-session chain. Added 2026-05-31.
// The transition unit is a `work_sessions` row (the labor ledger — "work story
// lives in work_sessions"). Consecutive sessions for one vehicle are ordered by
// `session_date`; the predecessor is simply the prior work_sessions row for that
// vehicle_id (no predecessor/successor columns needed — ORDER BY session_date IS
// the chain). Member photos resolve via `vehicle_images.work_session_id`; per-
// image state lives at ai_scan_metadata->'byok_deep_analysis'->'state_observations'.
// The dT signal — what WORK happened — lives in the transition between a session
// and the prior one, not in any single frame (per engineering-manual ch.19 and
// feedback_photo_intent_must_be_confirmed_not_assumed). subject_kind="cluster",
// subject_id = the later work_session.id. It is a HYPOTHESIS generator:
// result_kind=projection, owner-confirmation gated downstream — value accrues to
// work_sessions only from confirmed labor, never from the delta alone.
// ============================================================================
const CLUSTER: AttributeDefinition[] = [
  {
    attribute: "cluster.work_transition",
    subject_kind: "cluster",
    result_kind: "projection",
    layer: 5,
    modalities: ["image", "context_atoms"],
    // Consumes the state atoms on THIS work_session's images and on the prior
    // work_session (same vehicle_id, previous session_date). Dependency is
    // encoded in the prompt rather than via depends_on because the per-image
    // condition atoms live in ai_scan_metadata, not declared as registry attrs.
    prompt:
      "You are given two consecutive work_sessions for one vehicle, ordered by " +
      "session_date: THIS session (subject_id) and the prior session for the same " +
      "vehicle_id. For each, you have the member photos (vehicle_images where " +
      "work_session_id = the session) and their already-extracted state atoms from " +
      "ai_scan_metadata.byok_deep_analysis.state_observations (rust_severity, " +
      "paint_state, completeness, build_phase_guess, damage_callouts, scene_type). " +
      "Diff them and return the TRANSITION: { state_before, state_after, change_type " +
      "one of [teardown|repair|fabrication|surface_prep|paint|assembly|wiring|" +
      "interior|diagnosis|none], zones_changed[], evidence_image_ids[], confidence }. " +
      "Report ONLY change you can see across the pair. If nothing changed, return " +
      "change_type='none'. Do NOT estimate labor hours or value — that is decided " +
      "by owner confirmation downstream, not by you. If there is no prior session or " +
      "the pair is not comparable (different vehicle/zone), return null.",
    expected_shape: "structured",
    prompt_version: "v1",
  },
];

const REGISTRY: AttributeDefinition[] = [...L1, ...L2, ...L3, ...L4, ...L5, ...USER, ...COMPOUND, ...CLUSTER];

const BY_NAME: Record<string, AttributeDefinition> = Object.fromEntries(
  REGISTRY.map((a) => [a.attribute, a])
);

// ============================================================================
// Public API
// ============================================================================

/**
 * Return the full checklist for a subject_kind, ordered so dependencies precede
 * dependents. The harness exposes this via mcp-connector so a caller agent can
 * iterate the list against an image (or other subject) using its own model.
 */
export function getChecklist(
  subject_kind: SubjectKind,
  opts?: { include_layers?: Array<1 | 2 | 3 | 4 | 5>; include_dependencies?: boolean }
): AttributeDefinition[] {
  const layers = opts?.include_layers ?? [1, 2, 3, 4, 5];
  const filtered = REGISTRY.filter(
    (a) =>
      (a.subject_kind === subject_kind ||
        (subject_kind === "vehicle" && a.subject_kind === "image") ||
        (subject_kind === "image" && a.subject_kind === "vehicle" && opts?.include_dependencies)) &&
      layers.includes(a.layer)
  );
  return topoSort(filtered);
}

export function getAttribute(name: string): AttributeDefinition | null {
  return BY_NAME[name] ?? null;
}

export function listAttributes(): string[] {
  return REGISTRY.map((a) => a.attribute);
}

// ── Evidence-class binding (authoritative table) ─────────────────────────────
// One auditable block (Skylar's call: registry code is source of truth, not a DB
// table). Attributes whose definitions carry an inline `admissible_evidence` win;
// this map covers the rest. The anti-laundering invariant to eyeball here: no
// spec fact (hp/torque/displacement/codes) lists "image".
const ADMISSIBLE_EVIDENCE: Record<string, EvidenceClass[]> = {
  // Pure vision tasks — only a photo can answer them.
  "image.has_vehicle": ["image"],
  "image.classification": ["image"],
  "image.vehicle_bboxes": ["image"],
  "image.ocr_regions": ["image"],
  "image.location_class": ["image"],
  "image.in_progress_work": ["image"],
  "image.likely_vehicle_id": ["image", "context_atoms"],
  "vehicle.viewpoint": ["image"],
  "vehicle.vin_visible": ["image"],
  "vehicle.plate_redacted": ["image"],
  // Identity — establishable from a badge (image), the VIN, a document, or the owner.
  "vehicle.year_range": ["image", "vin_decode", "document", "owner_claim"],
  "vehicle.make": ["image", "vin_decode", "document", "owner_claim"],
  "vehicle.model": ["image", "vin_decode", "document", "owner_claim"],
  // Observed present-state — what a photo (or the owner) shows now.
  "vehicle.exterior_color": ["image", "owner_claim"],
  "vehicle.condition_cues": ["image", "owner_claim"],
  "vehicle.modifications": ["image", "owner_claim"],
  // Mileage — read off the odometer (image), a title/service doc, or owner.
  "vehicle.odometer_reading": ["image", "document", "owner_claim"],
  // Artifacts — documents (optionally photographed).
  "vehicle.invoice_artifact": ["document", "image"],
  "vehicle.work_log_artifact": ["document", "image", "owner_claim"],
  // User / cluster — substrate joins over Nuke's own attributed graph.
  "user.has_profile": ["context_atoms"],
  "user.display_identity": ["context_atoms", "owner_claim"],
  "user.contact_surface": ["context_atoms", "owner_claim"],
  "user.role_set": ["context_atoms", "owner_claim"],
  "user.possession_set": ["context_atoms"],
  "user.vendor_preference_signal": ["context_atoms"],
  "user.daily_activity_density": ["context_atoms"],
  "user.relationship_map": ["context_atoms"],
  "cluster.work_transition": ["context_atoms", "image"],
};

/**
 * Resolve the admissible evidence classes for an attribute:
 *   1. inline `admissible_evidence` on the definition (spec attrs use this)
 *   2. the ADMISSIBLE_EVIDENCE table
 *   3. a conservative default derived from modalities (image→[image,owner_claim],
 *      else [context_atoms]) — never silently confers vin_decode/document.
 * Returns [] for an unknown attribute (caller treats as reject).
 */
export function admissibleEvidence(attribute: string): EvidenceClass[] {
  const def = BY_NAME[attribute];
  if (!def) return [];
  if (def.admissible_evidence && def.admissible_evidence.length) return def.admissible_evidence;
  if (ADMISSIBLE_EVIDENCE[attribute]) return ADMISSIBLE_EVIDENCE[attribute];
  return def.modalities.includes("image") ? ["image", "owner_claim"] : ["context_atoms"];
}

/**
 * The anti-laundering gate. Returns null if `evidenceClass` may legitimately cite
 * `attribute`, else an error string. This is what makes a photo-cited horsepower
 * claim fail: "image" is not in horsepower's admissible set.
 */
export function validateEvidenceClass(
  attribute: string,
  evidenceClass: unknown,
): string | null {
  const def = BY_NAME[attribute];
  if (!def) return `unknown attribute: ${attribute}`;
  if (typeof evidenceClass !== "string" || !EVIDENCE_CLASSES.includes(evidenceClass as EvidenceClass)) {
    return `unknown evidence class '${String(evidenceClass)}'; must be one of [${EVIDENCE_CLASSES.join(", ")}]`;
  }
  const adm = admissibleEvidence(attribute);
  if (!adm.includes(evidenceClass as EvidenceClass)) {
    return `evidence class '${evidenceClass}' is not admissible for ${attribute} (a ${evidenceClass} can't establish it); admissible: [${adm.join(", ")}]`;
  }
  return null;
}

/**
 * Validate a caller's submission against the registry's expected_shape and
 * (if present) enum_values / custom validator. Returns null if valid, or an
 * error string. The cockpit's project() will additionally enforce the
 * substrate-vs-projection boundary; this is a pre-check.
 */
export function validateSubmission(
  attribute: string,
  value: unknown
): string | null {
  const def = BY_NAME[attribute];
  if (!def) return `unknown attribute: ${attribute}`;
  if (def.expected_shape === "enum") {
    if (typeof value !== "string") return `expected enum string, got ${typeof value}`;
    if (!def.enum_values?.includes(value)) {
      return `value '${value}' not in enum [${def.enum_values?.join(", ")}]`;
    }
  }
  if (def.expected_shape === "boolean" && typeof value !== "boolean") {
    return `expected boolean, got ${typeof value}`;
  }
  if (def.expected_shape === "number" && typeof value !== "number") {
    return `expected number, got ${typeof value}`;
  }
  if (def.expected_shape === "ratio_0_1") {
    if (typeof value !== "number" || value < 0 || value > 1) {
      return `expected number in [0,1], got ${value}`;
    }
  }
  if (def.expected_shape === "string" && typeof value !== "string" && value !== null) {
    return `expected string or null, got ${typeof value}`;
  }
  if (def.validate && !def.validate(value)) {
    return `value failed custom validator for ${attribute}`;
  }
  return null;
}

// ============================================================================
// Topological sort by depends_on
// ============================================================================

function topoSort(defs: AttributeDefinition[]): AttributeDefinition[] {
  const inSet = new Set(defs.map((d) => d.attribute));
  const visited = new Set<string>();
  const out: AttributeDefinition[] = [];
  const byName = new Map(defs.map((d) => [d.attribute, d]));

  function visit(d: AttributeDefinition) {
    if (visited.has(d.attribute)) return;
    visited.add(d.attribute);
    for (const dep of d.depends_on ?? []) {
      const depDef = byName.get(dep);
      if (depDef && inSet.has(dep)) visit(depDef);
    }
    out.push(d);
  }

  for (const d of defs) visit(d);
  return out;
}

