// objectTraits.ts — Per-object physical traits for the K5 Blazer Blender model.
//
// Every named 3D object inherits traits from its material, location, and
// historical use. Routing decisions consult these traits to compute scores.
// No trait is invented — each one traces to a measurable property or a
// documented K5 detail. Edit the table to encode expert knowledge.
//
// This is the "database math" foundation: rules are functions on traits,
// not free-floating logic. Add a new object → it inherits its category's
// defaults, then override per-row for K5-specific facts.

// ── Material taxonomy ─────────────────────────────────────────────────
// Each material has measured properties that drive what wires can do
// near or through it.
export type Material =
  | 'sheet_metal_thin'      // 18-22 gauge stamped steel — firewall, doors, body panels
  | 'sheet_metal_medium'    // 14-16 gauge — inner fenders, floor pan
  | 'sheet_metal_thick'     // 12-14 gauge — frame stiffeners, brackets
  | 'frame_steel_c_channel' // K5 ladder frame — 3/16" C-channel
  | 'cast_aluminum'         // LS3 block, heads, intake (when aluminum)
  | 'cast_iron'             // LS3 manifolds, cylinder liners
  | 'plastic_intake'        // composite intake manifold
  | 'glass'                 // windshield, side glass
  | 'rubber'                // weatherstrip, grommets, mounts
  | 'chrome_trim'           // bumpers, exterior trim
  | 'fabric_carpet'         // interior carpet (under-carpet routing)
  | 'foam_padding'          // dash padding, headliner foam
  | 'composite';            // unknown / mixed

// Per-material physical defaults. These traits propagate to objects
// unless overridden in the per-object row.
export const MATERIAL_DEFAULTS: Record<Material, {
  pierceable: 0 | 0.2 | 0.5 | 0.7 | 0.9 | 1.0;  // 0=destroys part, 1=trivial
  thermal_max_c: number;                          // continuous max temp (°C)
  hot_surface: boolean;                           // radiates heat at running temp
  vibration_class: 'low' | 'medium' | 'high';
  reachable_score: number;                        // 0-1, builder hand access during install
  noise_emission: boolean;                        // EMI/RF source (alternator, coils, ignition)
}> = {
  sheet_metal_thin:      { pierceable: 0.9, thermal_max_c: 85,  hot_surface: false, vibration_class: 'medium', reachable_score: 0.8, noise_emission: false },
  sheet_metal_medium:    { pierceable: 0.7, thermal_max_c: 85,  hot_surface: false, vibration_class: 'medium', reachable_score: 0.6, noise_emission: false },
  sheet_metal_thick:     { pierceable: 0.5, thermal_max_c: 80,  hot_surface: false, vibration_class: 'medium', reachable_score: 0.5, noise_emission: false },
  frame_steel_c_channel: { pierceable: 0.2, thermal_max_c: 70,  hot_surface: false, vibration_class: 'high',   reachable_score: 0.4, noise_emission: false },
  cast_aluminum:         { pierceable: 0,   thermal_max_c: 200, hot_surface: true,  vibration_class: 'high',   reachable_score: 0.3, noise_emission: true  },
  cast_iron:             { pierceable: 0,   thermal_max_c: 800, hot_surface: true,  vibration_class: 'high',   reachable_score: 0.2, noise_emission: false },
  plastic_intake:        { pierceable: 0,   thermal_max_c: 120, hot_surface: false, vibration_class: 'high',   reachable_score: 0.5, noise_emission: false },
  glass:                 { pierceable: 0,   thermal_max_c: 60,  hot_surface: false, vibration_class: 'low',    reachable_score: 0.7, noise_emission: false },
  rubber:                { pierceable: 1.0, thermal_max_c: 100, hot_surface: false, vibration_class: 'low',    reachable_score: 0.9, noise_emission: false },
  chrome_trim:           { pierceable: 0.3, thermal_max_c: 70,  hot_surface: false, vibration_class: 'low',    reachable_score: 0.7, noise_emission: false },
  fabric_carpet:         { pierceable: 1.0, thermal_max_c: 60,  hot_surface: false, vibration_class: 'low',    reachable_score: 0.8, noise_emission: false },
  foam_padding:          { pierceable: 1.0, thermal_max_c: 60,  hot_surface: false, vibration_class: 'low',    reachable_score: 0.5, noise_emission: false },
  composite:             { pierceable: 0.5, thermal_max_c: 80,  hot_surface: false, vibration_class: 'medium', reachable_score: 0.5, noise_emission: false },
};

// ── Object traits per Blender object ──────────────────────────────────
// Maps Blender object name → physical traits. Only K5-critical objects
// need explicit rows. Other objects fall back to material defaults via
// inferMaterialFromName().

export type FactoryHole = {
  /** Hole identifier — H1/H2/H3/H4 firewall grommets, FB for fuse block, etc. */
  id: string;
  /** Position in Blender meters (x driver+, y front-, z up+) */
  pos: [number, number, number];
  /** Diameter in inches (for fitment math) */
  diameter_in: number;
  /** Original factory use — relevant for nostalgia/aesthetics scoring */
  original_use: string;
  /** Currently sealed (TRUE if grommet present, FALSE if open hole or removed) */
  sealed: boolean;
  /** Reusability score for new harness pass-through (0=blocked, 1=ideal) */
  reuse_score: number;
};

/** A ground bonding point — where a return conductor terminates. Encoded
 *  from GM squarebody factory topology + LS-swap best practice.
 *  Source: docs/wiring/research/k5-body-grounds.md (G1-G8 taxonomy). */
export type GroundPoint = {
  /** Ground identifier — G1-G8 from factory, or STAR_* for LS-swap star ground legs */
  id: string;
  /** Position in Blender meters (best estimate) */
  pos: [number, number, number];
  /** Circuit served (what fails when this ground opens) */
  serves: string;
  /** Criticality — CRITICAL strands the truck, IMPORTANT flickers dash, MINOR is localized */
  criticality: 'CRITICAL' | 'IMPORTANT' | 'MINOR';
  /** Minimum wire gauge for this bonding leg (AWG) */
  min_gauge_awg: number;
  /** Best-practice construction notes */
  notes?: string;
  /** Failure mode that originally produces this ground requirement */
  classic_failure?: string;
};

export type ObjectTraits = {
  /** Blender object name (matches model_analysis.json key) */
  name: string;
  /** What category — drives default behavior */
  category:
    | 'frame'
    | 'sheet_metal'
    | 'firewall'
    | 'engine'
    | 'transmission'
    | 'wheel'
    | 'dash'
    | 'door'
    | 'window'
    | 'interior'
    | 'lighting'
    | 'misc';
  material: Material;
  /** Override pierceable score for this specific object (vs. material default) */
  pierceable_override?: number;
  /** Documented factory holes / grommets / pass-throughs that can be reused */
  factory_holes?: FactoryHole[];
  /** Ground bonding points — where return conductors terminate.
   *  See docs/wiring/research/k5-body-grounds.md for the G1-G8 taxonomy. */
  ground_points?: GroundPoint[];
  /** Wires can route ALONG this object's surface (e.g., inside fender wells) */
  channel_along: boolean;
  /** Wires can route OVER the top (e.g., intake manifold top is a valid channel) */
  channel_over: boolean;
  /** Free-form notes for builder reference */
  notes?: string;
  /** Source documents from k5-knowledge-index.json — proves these traits.
   *  Topic tags or doc IDs. Agents can pull these for verification. */
  source_topics?: string[];
};

/** Curated traits for K5 Blazer LS3-swap critical objects. Edit freely.
 *  Every entry here is K5-specific knowledge — don't invent these from
 *  generic vehicle assumptions. */
export const K5_OBJECT_TRAITS: Record<string, ObjectTraits> = {

  // ── FRAME — K5 squarebody ladder frame, 3/16" C-channel steel ──────
  Under_Frame_Blazer: {
    name: 'Under_Frame_Blazer',
    category: 'frame',
    material: 'frame_steel_c_channel',
    channel_along: true,    // Inside the C-channel is the canonical rear loom path
    channel_over: false,    // Don't route over (exposed to road debris)
    ground_points: [
      { id: 'STAR_BAT_CHASSIS', pos: [-0.60, -2.30, 0.45], serves: 'Battery return to chassis (LS-swap star ground leg)', criticality: 'CRITICAL', min_gauge_awg: 4, notes: 'Within 12" of battery per Holley/PSI. Welded threaded boss, serrated star washer, bare metal, dielectric grease, heat-shrink boot.' },
      { id: 'STAR_ENG_FRAME', pos: [+0.30, -1.40, 0.50], serves: 'Engine block to frame (LS-swap, separate from battery run)', criticality: 'CRITICAL', min_gauge_awg: 4, notes: 'Separate cable from battery-to-chassis. Lands on rear head bolt or bellhousing lug.' },
    ],
    notes: 'Driver-side rail (X=+0.45m) carries the rear loom 12-16 ft from cab to tail per THE_HARNESS_BUILD.md. Wires clipped to inside surface every 12". Rivet holes from factory body mounts may be reusable for clip anchors. Battery-to-chassis and engine-to-frame ground legs land on this rail (star topology, see ground_points).',
    source_topics: ['frame', 'grounds'],  // GM SM Section 2A + k5-body-grounds.md
  },

  // ── BODY SHELL — outer K5 shell, includes firewall by virtue of bbox ─
  Exterior_Body_Blazer: {
    name: 'Exterior_Body_Blazer',
    category: 'sheet_metal',
    material: 'sheet_metal_medium',
    channel_along: true,    // Inner fender wells = the engine bay channels
    channel_over: false,
    factory_holes: [
      { id: 'H1', pos: [+0.35, -1.02, 0.92], diameter_in: 1.5, original_use: 'Main engine harness (driver)', sealed: true, reuse_score: 1.0 },
      { id: 'H2', pos: [ 0.00, -1.02, 0.95], diameter_in: 1.5, original_use: 'HVAC + wiper (center)',         sealed: true, reuse_score: 1.0 },
      { id: 'H3', pos: [-0.35, -1.02, 0.90], diameter_in: 1.5, original_use: 'A/C + ECU (passenger)',         sealed: true, reuse_score: 1.0 },
      { id: 'H4', pos: [ 0.00, -1.05, 0.80], diameter_in: 1.0, original_use: 'Trans + ground (lower center)', sealed: true, reuse_score: 1.0 },
      { id: 'FB', pos: [+0.50, -1.00, 0.90], diameter_in: 4.0, original_use: 'Original fuse block punch-out — driver kick panel', sealed: false, reuse_score: 0.9 },
      { id: 'WP', pos: [ 0.00, -0.95, 1.30], diameter_in: 1.0, original_use: 'Original wiper motor hole — under cowl', sealed: false, reuse_score: 0.6 },
    ],
    ground_points: [
      { id: 'G3', pos: [-0.35, -1.02, 0.85], serves: 'ALL cab electrical (gauges, ignition, heater, radio, dash illumination, injectors/coils on later engines)', criticality: 'CRITICAL', min_gauge_awg: 8, notes: 'Original: PS rear cylinder head → firewall stud. Cab is rubber-isolated; this is the one strap that makes the cab electrically alive. Replace with welded tab + 8 AWG welding cable, NOT sheet-metal screw. In LS swap this becomes a leg of the star ground from engine block → firewall.', classic_failure: 'Exhaust heat cycles braid; corrosion between head and firewall stud; often missing after head or engine swap. Symptoms: no-start, swinging voltmeter, flickering dash, injector/sensor flakiness.' },
      { id: 'G4', pos: [ 0.40, -1.05, 0.70], serves: 'Cab sheetmetal bond to chassis', criticality: 'IMPORTANT', min_gauge_awg: 8, notes: 'Short cab-to-frame strap. Cab body mounts are rubber; this is the only metallic bond. Frequently rusted or cut off.', classic_failure: 'Rust or amputation during restoration' },
      { id: 'G5', pos: [+0.60, -0.70, 0.55], serves: 'Interior lamps, heater, HVAC blower, under-dash accessories', criticality: 'IMPORTANT', min_gauge_awg: 10, notes: 'Driver kick panel / front body mount, behind parking brake bracket.', classic_failure: 'Corrosion behind kick panel carpet from windshield water intrusion' },
    ],
    notes: 'The 4 firewall grommets H1-H4 are the ONLY pre-sealed engine→cabin pass-throughs. The fuse block (FB) and wiper motor (WP) holes still exist on a stock K5 firewall — high nostalgia / aesthetics reuse value if relocated. WP requires sealing if the wiper is moved. G3 is the single strap that makes or breaks the cab — see ground_points.',
    source_topics: ['body', 'fuse_block', 'grommet_firewall', 'engine_bay', 'grounds'],
  },

  Exterior_Body_Blazer_Rear: {
    name: 'Exterior_Body_Blazer_Rear',
    category: 'sheet_metal',
    material: 'sheet_metal_medium',
    channel_along: true,
    channel_over: false,
    notes: 'Rear cab section. Tailgate harness routes through tailgate hinge area.',
  },

  // ── ENGINE — LS3 cosmetic-kit (Delmo Speed) on GM crate engine ─────
  Under_Engine_Simple: {
    name: 'Under_Engine_Simple',
    category: 'engine',
    material: 'cast_aluminum',
    channel_along: false,
    channel_over: true,     // Wires CAN route across the top of the intake manifold
    ground_points: [
      { id: 'STAR_BAT_ENG',    pos: [+0.30, -1.80, 0.70], serves: 'Battery return to engine block (LS-swap star ground leg)', criticality: 'CRITICAL', min_gauge_awg: 4, notes: 'Rear head bolt or bellhousing lug near starter. Drilled/tapped boss preferred.' },
      { id: 'STAR_ECM_HEAD',   pos: [-0.20, -1.50, 0.95], serves: 'Dedicated ECM ground per GM LS service manual', criticality: 'CRITICAL', min_gauge_awg: 12, notes: 'Terminator X / Holley harnesses land this on a specific cylinder head bolt. Do NOT share with chassis or battery grounds.' },
      { id: 'G2_LEGACY',       pos: [+0.25, -1.70, 0.45], serves: 'Starter/alternator return (original factory location — repurpose for LS)', criticality: 'IMPORTANT', min_gauge_awg: 4, notes: 'Original SBC G2 was bellhousing bolt → frame. In LS swap, this can remain as a redundant engine-to-frame path.', classic_failure: 'Oil-soaked braided strap, bolt backs out, strap frays' },
    ],
    notes: 'LS3 block + heads = aluminum (250-300°F running). Intake is plastic composite (cooler, can route over). Headers (NOT in this bbox, attached to heads) reach 800°F+ — wires need 1" clearance + DR-25 sleeving when crossing. Three ground legs land on the block itself — see ground_points. Do NOT daisy-chain ECM ground through the chassis run; it must land direct on a head bolt.',
    source_topics: ['engine_bay', 'grounds'],
  },

  // ── WHEELS — wires never route through wheel wells (rocks, water, salt) ─
  Wheel_Front_Left:  { name: 'Wheel_Front_Left',  category: 'wheel', material: 'composite', channel_along: false, channel_over: false, notes: 'Forbidden zone. Brake wear sensor (if present) routes via inner fender, NOT through the wheel well.' },
  Wheel_Front_Right: { name: 'Wheel_Front_Right', category: 'wheel', material: 'composite', channel_along: false, channel_over: false },
  Wheel_Back_Left:   { name: 'Wheel_Back_Left',   category: 'wheel', material: 'composite', channel_along: false, channel_over: false },
  Wheel_Back_Right:  { name: 'Wheel_Back_Right',  category: 'wheel', material: 'composite', channel_along: false, channel_over: false },

  // ── DASH STRUCTURE — wires route BEHIND the dash padding ───────────
  Dash_Main: {
    name: 'Dash_Main',
    category: 'dash',
    material: 'sheet_metal_thin',
    channel_along: true,   // The cavity behind the dash IS a channel
    channel_over: false,   // Don't route over the visible dash face
    notes: 'Behind the dash padding is the canonical dash crossbar trunk. Harness tape (no split loom — quiet) per THE_HARNESS_BUILD.md.',
  },
  Dash_Panel_01: { name: 'Dash_Panel_01', category: 'dash', material: 'sheet_metal_thin', channel_along: false, channel_over: false, notes: 'Gauge cluster area. Dakota Digital VHX-73C-PU mounts here. 22-pin connector behind.' },
  Dash_Panel_02: { name: 'Dash_Panel_02', category: 'dash', material: 'sheet_metal_thin', channel_along: false, channel_over: false },

  // ── DOORS — wires flex through door jamb boots ─────────────────────
  Door_Left_Details:  { name: 'Door_Left_Details',  category: 'door', material: 'sheet_metal_thin', channel_along: true, channel_over: false, notes: 'Driver door — 7-wire pigtail through A-pillar boot.' },
  Door_Right_Details: { name: 'Door_Right_Details', category: 'door', material: 'sheet_metal_thin', channel_along: true, channel_over: false, notes: 'Passenger door — 4-wire pigtail.' },

  // ── INTERIOR — under-carpet routing along rocker panels ────────────
  Interior_Carpets_Rubber: { name: 'Interior_Carpets_Rubber', category: 'interior', material: 'fabric_carpet', channel_along: true, channel_over: false, notes: 'Wires can route UNDER the carpet along rocker panels.', source_topics: ['body', 'routing'] },
  Interior_Body: { name: 'Interior_Body', category: 'interior', material: 'sheet_metal_medium', channel_along: true, channel_over: false, notes: 'Floor pan + rocker — under-carpet harness channel.', source_topics: ['body', 'routing'] },
  // Interior_Main is the full cabin envelope bbox (Z=0.63 to 1.90, x/y covering the entire cab).
  // It is NOT a solid object — it's the volume that contains seats, dash, steering wheel, etc.
  // Routing runs THROUGH this volume via dash crossbar, headliner, rocker panel channels.
  // Mark channel_along so the 2D obstacle filter doesn't treat the envelope itself as a wall.
  Interior_Main: { name: 'Interior_Main', category: 'interior', material: 'fabric_carpet', channel_along: true, channel_over: false, notes: 'Full cabin envelope — a container volume, not a solid obstacle. Individual sub-objects (seats, dash face) are modeled separately.', source_topics: ['body', 'routing'] },
  Interior_Seat_Belts: { name: 'Interior_Seat_Belts', category: 'interior', material: 'fabric_carpet', channel_along: false, channel_over: false, notes: 'Seatbelt webbing — NOT a wire obstacle (fabric, small cross-section). Wires route around belt retractors via B-pillar.', source_topics: ['body'] },
  Interior_Mirror: { name: 'Interior_Mirror', category: 'interior', material: 'composite', channel_along: false, channel_over: false, notes: 'Rear-view mirror. Dash cam / auto-dim wires enter via headliner.', source_topics: ['body'] },

  // ── DASH SPEEDO + VENTS — gauge cluster housing + HVAC ductwork ────
  // Dakota Digital VHX-73C-PU replaces the stock speedo. 22-pin ribbon
  // enters from behind; nothing routes THROUGH the speedo face.
  Dash_Speedo: {
    name: 'Dash_Speedo', category: 'dash', material: 'sheet_metal_thin',
    channel_along: false, channel_over: false,
    notes: 'Speedo pod. 22-pin Dakota connector on rear face. No wire crosses the bezel.',
    source_topics: ['instrument_cluster'],
  },
  Dash_Speedo_Glass: { name: 'Dash_Speedo_Glass', category: 'dash', material: 'composite', channel_along: false, channel_over: false, notes: 'Lens — total forbidden zone.', source_topics: ['instrument_cluster'] },
  Dash_Vent_01: { name: 'Dash_Vent_01', category: 'dash', material: 'plastic_intake', channel_along: false, channel_over: true, notes: 'HVAC vent housing. Never route INTO the duct (airflow noise + heat). Routing OVER the top of the duct shell is allowed.', source_topics: ['hvac'] },
  Dash_Vent_02: { name: 'Dash_Vent_02', category: 'dash', material: 'plastic_intake', channel_along: false, channel_over: true, source_topics: ['hvac'] },
  Dash_Vent_03: { name: 'Dash_Vent_03', category: 'dash', material: 'plastic_intake', channel_along: false, channel_over: true, source_topics: ['hvac'] },
  Dash_Vent_04: { name: 'Dash_Vent_04', category: 'dash', material: 'plastic_intake', channel_along: false, channel_over: true, source_topics: ['hvac'] },

  // ── DOOR (full) — full door shells include inner skin + cavity ─────
  // The inner door cavity is a legitimate channel (window mech, lock
  // actuator, speaker). The outer skin is a forbidden piercing target.
  Door_Left_Main:   { name: 'Door_Left_Main',   category: 'door', material: 'sheet_metal_thin', channel_along: true, channel_over: false, notes: 'Driver door shell — inner cavity carries window + lock + speaker wires. Exit through A-pillar jamb boot.', source_topics: ['door'] },
  Door_Right_Main:  { name: 'Door_Right_Main',  category: 'door', material: 'sheet_metal_thin', channel_along: true, channel_over: false, notes: 'Passenger door shell.', source_topics: ['door'] },
  Door_Left_Window:  { name: 'Door_Left_Window',  category: 'door', material: 'composite', channel_along: false, channel_over: false, notes: 'Glass — forbidden.', source_topics: ['door'] },
  Door_Right_Window: { name: 'Door_Right_Window', category: 'door', material: 'composite', channel_along: false, channel_over: false, source_topics: ['door'] },
  Door_Left_Mirror:  { name: 'Door_Left_Mirror',  category: 'door', material: 'plastic_intake', channel_along: true, channel_over: false, notes: 'Power mirror endpoint. 5-wire pigtail exits the mirror base into door cavity.', source_topics: ['door'] },
  Door_Right_Mirror: { name: 'Door_Right_Mirror', category: 'door', material: 'plastic_intake', channel_along: true, channel_over: false, source_topics: ['door'] },

  // ── TAILGATE — hinge-side harness pass-through for tailgate lights
  Tailgate_Main: {
    name: 'Tailgate_Main', category: 'sheet_metal', material: 'sheet_metal_thin',
    channel_along: true,   // Inside tailgate shell carries defroster + power lock
    channel_over: false,
    factory_holes: [
      { id: 'TG_HINGE_L', pos: [-0.40, +2.05, 1.05], diameter_in: 0.75, original_use: 'Tailgate hinge loom pass-through (driver)', sealed: false, reuse_score: 0.85 },
      { id: 'TG_HINGE_R', pos: [+0.40, +2.05, 1.05], diameter_in: 0.75, original_use: 'Tailgate hinge loom pass-through (passenger)', sealed: false, reuse_score: 0.85 },
    ],
    ground_points: [
      { id: 'G8', pos: [ 0.00, +2.00, 0.95], serves: 'Rear window motor, license plate lamp, tail lights (tailgate-mounted portion only)', criticality: 'MINOR', min_gauge_awg: 14, notes: 'Tailgate harness ground crosses the hinge via flex wire. Vibration breaks it at the jamb. Replace with high-flex Tefzel + soldered crimp + dual-wall heat shrink.', classic_failure: 'Flexing of the gate breaks the wire at the jamb' },
    ],
    notes: 'Tailgate loom runs through flexible boot at hinge. Replace with silicone-jacketed loom (Bill Hirsch #BH-SILI-050) — original vinyl cracks in <5 years. G8 flex ground (see ground_points) is the Blazer-specific failure mode.',
    source_topics: ['body', 'lighting_rear', 'grounds'],
  },
  Tailgate_Window: { name: 'Tailgate_Window', category: 'sheet_metal', material: 'composite', channel_along: false, channel_over: false, notes: 'Power tailgate glass. 2-wire motor pigtail inside the shell.', source_topics: ['body'] },
  Tailgate_Band:   { name: 'Tailgate_Band',   category: 'sheet_metal', material: 'sheet_metal_thin', channel_along: false, channel_over: false, source_topics: ['body'] },

  // ── UNDERBODY — floor pan + transmission tunnel ────────────────────
  Under_Main_Blazer: {
    name: 'Under_Main_Blazer', category: 'frame', material: 'sheet_metal_medium',
    channel_along: true, channel_over: false,
    notes: 'Underfloor routing for fuel + trans harness. Pass-throughs exist at trans tunnel (grommets degrade — replace) and at tail for fuel sender / tail lights. Exposed to road salt — use jacketed loom only.',
    source_topics: ['frame', 'routing', 'fuel_system'],
  },

  // ── STEERING — column carries ignition switch + turn + horn ────────
  Steering_Main: {
    name: 'Steering_Main', category: 'misc', material: 'sheet_metal_thin',
    channel_along: true,   // Wires route INSIDE the column tube
    channel_over: false,
    notes: 'Column wiring: ignition switch (+12V, START, ACC, IGN1, IGN2), turn signal cam, hazard, horn, cruise (if fitted). Exits column at base into bulkhead disconnect.',
    source_topics: ['ignition', 'steering'],
  },
  Steering_Wheel: { name: 'Steering_Wheel', category: 'misc', material: 'plastic_intake', channel_along: false, channel_over: false, notes: 'No wire crosses the steering wheel. Horn button contact is internal.', source_topics: ['steering', 'horn'] },

  // ── LIGHTING ENDPOINTS — where wires terminate (not route through) ──
  Headlights:      { name: 'Headlights',      category: 'lighting', material: 'composite', channel_along: false, channel_over: false, notes: 'H4 halogen (stock) or LED conversion. 3-wire connector per side.', source_topics: ['lighting_front'] },
  Parking_Lights:  { name: 'Parking_Lights',  category: 'lighting', material: 'composite', channel_along: false, channel_over: false, notes: 'Front turn / park combo. 2-wire per side.', source_topics: ['lighting_front'] },
  Marker_Lights:   { name: 'Marker_Lights',   category: 'lighting', material: 'composite', channel_along: false, channel_over: false, notes: 'Side markers — front + rear. Single-wire + ground.', source_topics: ['lighting_marker'] },
  Tail_Lights_Main:          { name: 'Tail_Lights_Main',          category: 'lighting', material: 'composite', channel_along: false, channel_over: false, notes: 'Tail lamp housing. 4-wire (tail/brake/turn/backup).', source_topics: ['lighting_rear'] },
  Tail_Lights_Glass_Front:   { name: 'Tail_Lights_Glass_Front',   category: 'lighting', material: 'composite', channel_along: false, channel_over: false, source_topics: ['lighting_rear'] },
  Tail_Lights_Glass_Behind:  { name: 'Tail_Lights_Glass_Behind',  category: 'lighting', material: 'composite', channel_along: false, channel_over: false, source_topics: ['lighting_rear'] },

  // ── EXTERIOR STRUCTURE — bumpers, grille, roof ─────────────────────
  Exterior_Bumper_Front: {
    name: 'Exterior_Bumper_Front', category: 'sheet_metal', material: 'sheet_metal_medium',
    channel_along: false,   // Wires route BEHIND the bumper, not through it
    channel_over: false,
    ground_points: [
      { id: 'G6', pos: [ 0.00, -2.55, 0.85], serves: 'Headlights, park lamps, horn', criticality: 'IMPORTANT', min_gauge_awg: 10, notes: 'Radiator core support tab. Star-grounded to chassis via 6 AWG for LS swap; factory was single-point. Paint under tab is the classic failure.', classic_failure: 'Rust where core support meets fender, paint buildup under ring terminal' },
    ],
    notes: 'Front bumper = engine-bay forward boundary. Parking + turn + headlight pigtails route between bumper and radiator core support. G6 lighting ground lives on the core support tab — see ground_points.',
    source_topics: ['lighting_front', 'body', 'grounds'],
  },
  Exterior_Bumper_Rear_Blazer: { name: 'Exterior_Bumper_Rear_Blazer', category: 'sheet_metal', material: 'sheet_metal_medium', channel_along: false, channel_over: false, notes: 'Rear bumper with step notch. License plate light wire routes through top edge.', source_topics: ['body', 'lighting_rear'] },
  Exterior_Grille: {
    name: 'Exterior_Grille', category: 'sheet_metal', material: 'plastic_intake',
    channel_along: false, channel_over: false,
    notes: 'Grille shell. Horn mounts behind passenger-side, electric fans mount on radiator just behind. No wire pierces the grille itself.',
    source_topics: ['horn', 'lighting_front'],
  },
  Exterior_Roof: {
    name: 'Exterior_Roof', category: 'sheet_metal', material: 'sheet_metal_thin',
    channel_along: true,    // Inside headliner is a channel
    channel_over: false,
    notes: 'Headliner cavity carries dome light feed + cab clearance light pigtails. Three cab-roof clearance lights need 10A feed from main fuse block.',
    source_topics: ['lighting_marker', 'routing'],
  },
  Exterior_License_Plate_Front: { name: 'Exterior_License_Plate_Front', category: 'lighting', material: 'composite', channel_along: false, channel_over: false, source_topics: ['lighting_rear'] },
  Exterior_License_Plate_Back:  { name: 'Exterior_License_Plate_Back',  category: 'lighting', material: 'composite', channel_along: false, channel_over: false, source_topics: ['lighting_rear'] },
  Exterior_Windshield_Wiper_Systems_Left:  { name: 'Exterior_Windshield_Wiper_Systems_Left',  category: 'misc', material: 'sheet_metal_thin', channel_along: false, channel_over: false, notes: 'Wiper motor endpoint. 3-wire (low/high/park).', source_topics: ['wiper'] },
  Exterior_Windshield_Wiper_Systems_Right: { name: 'Exterior_Windshield_Wiper_Systems_Right', category: 'misc', material: 'sheet_metal_thin', channel_along: false, channel_over: false, source_topics: ['wiper'] },

  // ── INTERIOR SUBASSEMBLIES ──────────────────────────────────────────
  Interior_Dome_Light_Blazer: { name: 'Interior_Dome_Light_Blazer', category: 'lighting', material: 'composite', channel_along: false, channel_over: false, notes: 'Dome light endpoint. 2-wire (+12V fused, ground with door-switch trigger via body control).', source_topics: ['lighting_interior'] },
  Interior_Center_Box: { name: 'Interior_Center_Box', category: 'interior', material: 'sheet_metal_medium', channel_along: true, channel_over: false, notes: 'Center console cavity — accessory switches, shifter electronics, aux-power outlet routing.', source_topics: ['routing'] },
  Interior_Panels_Rear: { name: 'Interior_Panels_Rear', category: 'interior', material: 'plastic_intake', channel_along: true, channel_over: false, notes: 'Rear quarter panels — cargo light + rear speaker wiring. Access through the rear plastic panel.', source_topics: ['lighting_interior', 'audio'] },
  Interior_Seat_Front_Left:  { name: 'Interior_Seat_Front_Left',  category: 'interior', material: 'fabric_carpet', channel_along: false, channel_over: false, notes: 'Seat — potential heat/memory/seatbelt sensor wiring inside the track. Not a routing channel.', source_topics: ['body'] },
  Interior_Seat_Front_Right: { name: 'Interior_Seat_Front_Right', category: 'interior', material: 'fabric_carpet', channel_along: false, channel_over: false, source_topics: ['body'] },
  Interior_Seat_Rear: { name: 'Interior_Seat_Rear', category: 'interior', material: 'fabric_carpet', channel_along: false, channel_over: false, source_topics: ['body'] },

  // ── WINDSHIELD / GLASS — opaque obstacles ──────────────────────────
  Exterior_Window_Front: { name: 'Exterior_Window_Front', category: 'sheet_metal', material: 'composite', channel_along: false, channel_over: false, notes: 'Windshield. Total forbidden zone.', source_topics: ['body'] },
};

// ── Inference helpers ─────────────────────────────────────────────────

/** When an object isn't in K5_OBJECT_TRAITS, infer category from name. */
export function inferCategory(name: string): ObjectTraits['category'] {
  const lower = name.toLowerCase();
  if (lower.startsWith('wheel'))     return 'wheel';
  if (lower.startsWith('door'))      return 'door';
  if (lower.startsWith('dash'))      return 'dash';
  if (lower.startsWith('interior')) return 'interior';
  if (lower.startsWith('headlight') || lower.startsWith('tail') || lower.startsWith('marker') || lower.startsWith('parking') || lower.startsWith('turn')) return 'lighting';
  if (lower.includes('frame'))      return 'frame';
  if (lower.includes('engine'))     return 'engine';
  if (lower.includes('exterior'))   return 'sheet_metal';
  return 'misc';
}

/** Get traits for an object name — use the curated entry or infer defaults. */
export function getTraits(name: string): ObjectTraits {
  if (K5_OBJECT_TRAITS[name]) return K5_OBJECT_TRAITS[name];
  const category = inferCategory(name);
  // Default material per category
  const defaultMaterial: Material = (
    category === 'frame'      ? 'frame_steel_c_channel' :
    category === 'engine'     ? 'cast_aluminum' :
    category === 'wheel'      ? 'composite' :
    category === 'dash'       ? 'sheet_metal_thin' :
    category === 'lighting'   ? 'plastic_intake' :  // close enough
    category === 'door'       ? 'sheet_metal_thin' :
    category === 'interior'   ? 'fabric_carpet' :
    'sheet_metal_thin'
  );
  return {
    name,
    category,
    material: defaultMaterial,
    channel_along: false,
    channel_over: false,
  };
}

// ── Scoring functions (creative solutions within constraints) ─────────

/** Can a wire pass through this object's bbox? Returns 0 if forbidden,
 *  positive score otherwise (higher = easier / more preferred). */
export function passThroughScore(traits: ObjectTraits): number {
  if (traits.pierceable_override !== undefined) return traits.pierceable_override;
  return MATERIAL_DEFAULTS[traits.material].pierceable;
}

/** Score reusing a factory hole for a new wire pass-through.
 *  Combines: hole's reuse_score + bonus if it's already sealed. */
export function reuseHoleScore(hole: FactoryHole): number {
  let score = hole.reuse_score;
  if (hole.sealed) score += 0.15;  // bonus for sealed (no leak risk)
  return Math.min(1, score);
}

/** Find the BEST factory hole on a given object near a target point.
 *  Used by the path finder to prefer "nostalgia" routing through
 *  original GM holes rather than drilling new ones. */
export function nearestReusableHole(
  traits: ObjectTraits,
  target: [number, number, number],
  maxDistance_m: number = 0.5,
): FactoryHole | null {
  if (!traits.factory_holes) return null;
  let best: FactoryHole | null = null;
  let bestScore = -Infinity;
  for (const h of traits.factory_holes) {
    const d = Math.hypot(
      h.pos[0] - target[0],
      h.pos[1] - target[1],
      h.pos[2] - target[2],
    );
    if (d > maxDistance_m) continue;
    // Composite score: distance penalty + reuse bonus
    const score = reuseHoleScore(h) - (d / maxDistance_m) * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}
