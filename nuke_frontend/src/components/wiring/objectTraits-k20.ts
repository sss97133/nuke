// objectTraits-k20.ts — Per-object physical traits for the K20 LWB pickup.
//
// Overlay on K5 trait table. Squarebody platform commonality means most
// cab/dash/door/engine-bay objects port verbatim. K20-specific objects
// (pickup bed, dual saddle tanks, bed-cab grommet, trailer prep) are
// added here. Chassis frame is overridden for LWB length (~131" vs K5
// ~106"). The K5 file is NOT modified.
//
// Reference: docs/wiring/HARNESS_RULES.md (rules R1-R15, T1-T5, etc.)
// Source overlay: wiring/k20-overlay/K20_BUILD_OVERLAY.md
//
// Open questions are flagged with `notes` containing "OPEN:" — these
// require physical measurement on the truck or factory FSM lookup.

import {
  K5_OBJECT_TRAITS,
  inferCategory,
  type Material,
  type FactoryHole,
  type GroundPoint,
  type ObjectTraits,
} from './objectTraits';

// Re-export type helpers so K20 consumers don't need to dual-import.
export {
  MATERIAL_DEFAULTS,
  inferCategory,
  passThroughScore,
  reuseHoleScore,
  nearestReusableHole,
} from './objectTraits';
export type { Material, FactoryHole, GroundPoint, ObjectTraits } from './objectTraits';

// ── K5 → K20 carry-forward set ────────────────────────────────────────
// These cab / dash / door / engine-bay / lighting objects are unchanged
// between Blazer and K20 LWB pickup (squarebody platform commonality).
// Per K20_BUILD_OVERLAY.md §2, ~70% of K5 wire-list rows port directly.
const K5_CARRY_FORWARD = [
  // Engine bay (LS3 is identical per overlay §2)
  'Under_Engine_Simple',
  // Wheels (forbidden zones — same)
  'Wheel_Front_Left',
  'Wheel_Front_Right',
  'Wheel_Back_Left',
  'Wheel_Back_Right',
  // Dash (same dashboard architecture per overlay §2)
  'Dash_Main',
  'Dash_Panel_01',
  'Dash_Panel_02',
  'Dash_Speedo',
  'Dash_Speedo_Glass',
  'Dash_Vent_01',
  'Dash_Vent_02',
  'Dash_Vent_03',
  'Dash_Vent_04',
  // Doors (same door platform per overlay §2)
  'Door_Left_Details',
  'Door_Right_Details',
  'Door_Left_Main',
  'Door_Right_Main',
  'Door_Left_Window',
  'Door_Right_Window',
  'Door_Left_Mirror',
  'Door_Right_Mirror',
  // Steering column (cab-internal, unchanged)
  'Steering_Main',
  'Steering_Wheel',
  // Front lighting endpoints (same front clip era per overlay §2)
  'Headlights',
  'Parking_Lights',
  'Marker_Lights',
  'Exterior_License_Plate_Front',
  'Exterior_Windshield_Wiper_Systems_Left',
  'Exterior_Windshield_Wiper_Systems_Right',
  // Cab interior (same cab — three-window squarebody per overlay §3.3)
  'Interior_Carpets_Rubber',
  'Interior_Body',
  'Interior_Main',
  'Interior_Seat_Belts',
  'Interior_Mirror',
  'Interior_Dome_Light_Blazer',
  'Interior_Center_Box',
  'Interior_Seat_Front_Left',
  'Interior_Seat_Front_Right',
  // Front exterior structure (front bumper, grille, roof — same)
  'Exterior_Bumper_Front',
  'Exterior_Grille',
  'Exterior_Roof',
  'Exterior_Window_Front',
] as const;

// Build the carry-forward subset of K5 traits.
const K5_INHERITED: Record<string, ObjectTraits> = Object.fromEntries(
  K5_CARRY_FORWARD
    .filter((name) => K5_OBJECT_TRAITS[name])
    .map((name) => [name, K5_OBJECT_TRAITS[name]]),
);

// ── K20 OVERRIDES — shared objects with K20-specific deltas ───────────
// These objects exist in K5 too but have different traits on the K20.

const K20_OVERRIDES: Record<string, ObjectTraits> = {

  // ── FRAME — K20 LWB ladder frame (~131" wheelbase vs K5 ~106") ─────
  // Same C-channel section, but +25" between cab firewall and rear axle.
  // Affects rear loom length, fuel pump runs (saddles further from cab),
  // engine-to-rear ground bond cable, trailer-prep run.
  // Source: K20_BUILD_OVERLAY.md §3.2
  Under_Frame_Blazer: {
    name: 'Under_Frame_Blazer',
    category: 'frame',
    material: 'frame_steel_c_channel',
    channel_along: true,
    channel_over: false,
    ground_points: [
      { id: 'STAR_BAT_CHASSIS', pos: [-0.60, -2.30, 0.45], serves: 'Battery return to chassis (LS-swap star ground leg)', criticality: 'CRITICAL', min_gauge_awg: 4, notes: 'Within 12" of battery per Holley/PSI. Welded threaded boss, serrated star washer, bare metal, dielectric grease, heat-shrink boot. Same as K5.' },
      { id: 'STAR_ENG_FRAME', pos: [+0.30, -1.40, 0.50], serves: 'Engine block to frame (LS-swap, separate from battery run)', criticality: 'CRITICAL', min_gauge_awg: 4, notes: 'Separate cable from battery-to-chassis. Lands on rear head bolt or bellhousing lug. Same as K5.' },
      // K20 adds an intermediate frame ground at the saddle-tank station so dual fuel pumps have a short return path.
      { id: 'STAR_FUEL_FRAME', pos: [+0.40, +0.80, 0.50], serves: 'Saddle-tank fuel pump return (mid-chassis bond, both LH and RH pumps)', criticality: 'IMPORTANT', min_gauge_awg: 10, notes: 'Mid-chassis welded boss between saddles. Both saddle pumps land here rather than running 12+ ft of return all the way back to STAR_BAT_CHASSIS. Reduces voltage drop on pump runs (E2). OPEN: confirm exact frame x-section thickness for stud welding — 1984 K20 LWB frame may differ from K5.' },
    ],
    notes: 'K20 LWB frame: 131" wheelbase, ~25" longer between cab and rear axle vs K5. Driver-side rail (X=+0.45m) carries rear loom — adds ~25" of wire vs K5 per overlay §3.2. Saddle tanks straddle the rails behind cab — fuel pump runs get an additional +30" each. Trailer-prep 7-pin connector at LWB tail is a new run, ~110" total length from PDM30. Frame rail spacing same as K5 (~34"). Same C-channel section so channel_along inside the rail is still the canonical rear loom path. Wires clipped to inside surface every 12" (C4).',
    source_topics: ['frame', 'grounds', 'fuel_system'],
  },

  // ── EXTERIOR BODY — K20 cab (3-window pickup cab) ──────────────────
  // The cab itself is the same squarebody cab (firewall grommets H1-H4
  // same locations). The Blazer's wagon-style rear cargo body is GONE —
  // K20 has a separate pickup bed instead. Re-uses K5 traits for the
  // CAB portion but tagged as cab-only (the bed is a separate object).
  // Source: K20_BUILD_OVERLAY.md §3.3
  Exterior_Body_Blazer: {
    ...K5_OBJECT_TRAITS.Exterior_Body_Blazer,
    name: 'Exterior_Body_Blazer',
    notes: (K5_OBJECT_TRAITS.Exterior_Body_Blazer.notes ?? '') +
      ' K20 NOTE: cab portion identical to K5 (same firewall, same H1-H4 grommets, same G3/G4/G5 grounds). On the K20 the rear-of-cab pass-through (CB grommet, see Cab_Back_Grommet) replaces the K5 wagon-rear interior routing. No rear hatch glass / wiper / defrost on K20 — those circuits are DELETED per overlay §3.3.',
  },

  // ── REAR BUMPER — K20 with trailer hitch + 7-pin trailer connector ─
  // K5 has a step bumper. K20 typically has a step bumper PLUS a Class IV
  // hitch receiver and 7-pin trailer connector (RV-style flat-7).
  // Source: K20_BUILD_OVERLAY.md §3.4 (trailer-brake controller pre-wire)
  Exterior_Bumper_Rear_Blazer: {
    name: 'Exterior_Bumper_Rear_Blazer',
    category: 'sheet_metal',
    material: 'sheet_metal_medium',
    channel_along: false,
    channel_over: false,
    notes: 'K20 rear bumper: step bumper with Class IV hitch receiver. Hosts 7-pin trailer connector (RV-style, ~$25 SAE J560/J2863) on the bumper or hitch tongue. License plate light wire routes through top edge same as K5. Trailer 7-pin pinout: GND, BAT(+12V), TAIL, BRK, LH-TURN, RH-TURN, AUX (reverse or trailer-brake).',
    source_topics: ['body', 'lighting_rear', 'trailer'],
  },
};

// ── K20-SPECIFIC NEW OBJECTS ───────────────────────────────────────────
// Objects that have no K5 equivalent — pickup bed, saddle tanks,
// cab-bed grommet, trailer-prep, optional bed-rail accessories.

const K20_NEW_OBJECTS: Record<string, ObjectTraits> = {

  // ── PICKUP BED FLOOR — 8' (96") long for LWB, sheet-metal stamping ──
  // Replaces the Blazer rear cargo body. The bed floor is a flat
  // stamping with corrugated ribs; wires can route ALONG the underside
  // (between the bed floor underside and the frame rails). Wires must
  // NOT route on the top surface (cargo abrasion).
  // Source: K20_BUILD_OVERLAY.md §3.3 ("rear harness ... runs along bed
  // rail underneath bed liner to taillight buckets")
  Bed_Floor: {
    name: 'Bed_Floor',
    category: 'sheet_metal',
    material: 'sheet_metal_medium',
    channel_along: true,    // Underside of bed = valid harness channel
    channel_over: false,    // Top surface = cargo zone, forbidden
    notes: 'K20 LWB pickup bed floor: 96" L × ~64" W stamped sheet steel with corrugated ribs. Bed harness routes ALONG the underside between bed floor and frame rails (R9-style channel — analogous to inner-fender well). Bed bolts to frame via 8 body-mount points (rubber-isolated, like cab) — chassis bond required (see Bed_Floor.ground_points). NEVER route on top surface (cargo + bedliner abrasion). OPEN: confirm 1984 K20 bed mount count + locations from factory FSM.',
    ground_points: [
      { id: 'G_BED_FRAME', pos: [+0.40, +1.50, 0.55], serves: 'Bed sheetmetal bond to chassis (analogous to G4 cab-frame strap)', criticality: 'IMPORTANT', min_gauge_awg: 10, notes: 'Bed mounts are rubber-isolated; this is the only metallic bond between bed sheetmetal and frame. Without it, bed-mounted lighting/accessories float. Replace OEM strap (often missing or rusted) with 10 AWG welding cable + welded tab.', classic_failure: 'Strap missing after bed-off restoration; rust at body mount' },
    ],
    source_topics: ['body', 'frame', 'grounds', 'lighting_rear'],
  },

  // ── BEDSIDE WALLS (LH/RH) — vertical bed sides, hosts fuel filler + bed-rail accessories
  // Sheet metal stamping; inner cavity carries fuel filler neck + vent
  // hose for the saddle tank on that side, and is the mount surface
  // for optional bed-rail LED pucks.
  // Source: K20_BUILD_OVERLAY.md §3.3 ("dual fuel fillers (both bedsides
  // on K20 saddles)") and §3.4 (bed-rail LEDs)
  Bed_Side_LH: {
    name: 'Bed_Side_LH',
    category: 'sheet_metal',
    material: 'sheet_metal_thin',
    channel_along: true,    // Inner bedside cavity is a channel for filler-area light + bed-rail LED feed
    channel_over: false,
    factory_holes: [
      { id: 'BS_FILLER_LH', pos: [+0.85, +1.20, 0.95], diameter_in: 2.5, original_use: 'LH fuel filler neck pass-through to saddle tank', sealed: true, reuse_score: 0.0, /* not for wire reuse — the filler neck is in this hole; wires route AROUND it */ },
    ],
    notes: 'LH bedside wall — hosts the LH fuel filler (factory K20 has dual fillers, one each bedside, feeding the corresponding saddle tank). Filler-neck hole is NOT reusable for wire pass-through (filler occupies it). Optional filler-area courtesy lamp routes through inner cavity. Optional bed-rail LED puck feed routes along inner top edge of bedside. OPEN: confirm exact filler position from factory FSM — depends on cab-axle dim of 1984 K20 LWB.',
    source_topics: ['body', 'fuel_system', 'lighting_marker'],
  },
  Bed_Side_RH: {
    name: 'Bed_Side_RH',
    category: 'sheet_metal',
    material: 'sheet_metal_thin',
    channel_along: true,
    channel_over: false,
    factory_holes: [
      { id: 'BS_FILLER_RH', pos: [-0.85, +1.20, 0.95], diameter_in: 2.5, original_use: 'RH fuel filler neck pass-through to saddle tank', sealed: true, reuse_score: 0.0 },
    ],
    notes: 'RH bedside wall — mirror of LH. Hosts RH fuel filler feeding RH saddle tank.',
    source_topics: ['body', 'fuel_system', 'lighting_marker'],
  },

  // ── WHEEL WELLS (BED) — inner sheet-metal humps over rear wheels ────
  // Distinct from the Wheel_Back_* (which is the tire bbox / forbidden
  // zone). The bedside wheel wells are sheet-metal humps INSIDE the bed
  // — routing must avoid them (they consume bed floor real estate).
  Bed_Wheel_Well_LH: {
    name: 'Bed_Wheel_Well_LH',
    category: 'sheet_metal',
    material: 'sheet_metal_medium',
    channel_along: false,
    channel_over: false,
    notes: 'LH bed wheel-well hump. Sheet-metal arch over rear tire. Wires route AROUND it on the underside-of-bed channel (between hump outer wall and frame rail). Forbidden zone for wires from above (cargo abrasion).',
    source_topics: ['body'],
  },
  Bed_Wheel_Well_RH: {
    name: 'Bed_Wheel_Well_RH',
    category: 'sheet_metal',
    material: 'sheet_metal_medium',
    channel_along: false,
    channel_over: false,
    notes: 'RH bed wheel-well hump. Mirror of LH.',
    source_topics: ['body'],
  },

  // ── PICKUP TAILGATE — bottom-pivot truck tailgate ──────────────────
  // Distinct from K5 Tailgate_Main (which is top-pivot Blazer tailgate
  // with power glass + defrost + lock). K20 standard build has NO
  // electrical to tailgate; backup camera is an optional add per
  // overlay §3.4. Replaces K5 Tailgate_Main / Tailgate_Window /
  // Tailgate_Band on the K20 model.
  // Source: K20_BUILD_OVERLAY.md §3.3
  Bed_Tailgate: {
    name: 'Bed_Tailgate',
    category: 'sheet_metal',
    material: 'sheet_metal_thin',
    channel_along: false,   // No factory wiring through K20 tailgate (no power glass, no defrost)
    channel_over: false,
    notes: 'K20 truck tailgate: bottom-pivot + side-hinge cable. NO factory electrical (vs K5 Blazer tailgate which has power glass motor, defrost grid, license-plate lamp on the gate, and the G8 flex-ground failure mode). Optional backup camera (overlay §3.4) requires a flex loom through one of the tailgate hinge cables — same failure mode as K5 G8. If camera is specified, mirror K5 TG_HINGE_L pass-through pattern with silicone-jacketed loom. License plate light is on the rear bumper / tailgate exterior — see Exterior_License_Plate_Back.',
    source_topics: ['body', 'lighting_rear'],
  },

  // ── BED-CAB GROMMET — pass-through at rear of cab to bed harness ───
  // K5 has no equivalent (Blazer is one-piece body, rear interior
  // routing is internal). K20 needs a sealed grommet through the rear
  // cab wall (the third window cab area) for the bed harness exit.
  // Coupled with a DT-junction-cluster mounted at the rear of cab
  // pass-through so the bed harness is removable for bed-off service.
  // Source: K20_BUILD_OVERLAY.md §3.3 ("Bed-mounted DT connector cluster
  // (4-6 way) lets the bed harness be removable for bed-off service")
  Cab_Back_Grommet: {
    name: 'Cab_Back_Grommet',
    category: 'firewall',     // structurally analogous to firewall grommets — sealed pass-through
    material: 'rubber',
    channel_along: false,
    channel_over: false,
    factory_holes: [
      { id: 'CB1', pos: [+0.30, +0.55, 0.95], diameter_in: 1.5, original_use: 'OPEN: 1984 K20 may or may not have factory cab-back grommet — confirm from FSM. If absent, drill new and seal with Caplugs/Heyco SB-1500.', sealed: false, reuse_score: 0.85 },
    ],
    notes: 'Rear-of-cab harness pass-through. Cab-side terminates in a 4-6 pin DT/DTM connector cluster mounted to the rear cab wall (interior side). Bed-side carries: bed lighting feed, fuel pump LH+RH power+ground (4 wires), fuel sender LH+RH signal+ground (4 wires twisted-pair shielded per E4), trailer 7-pin feed, optional bed-rail LED feed, optional in-bed 12V outlet feed, optional bedside reverse light feed, optional backup camera signal. Total ~16-22 conductors depending on options. Sealed connector required (K5 — under-hood/exposed environment per K5 rule, bed underside qualifies). OPEN: Skylar to specify whether factory cab-back grommet exists on this 1984 K20 or if drilling is required.',
    source_topics: ['body', 'fuel_system', 'lighting_rear', 'trailer', 'connector'],
  },

  // ── SADDLE FUEL TANKS — dual tanks, between frame rails behind cab ──
  // K5 has ONE fuel tank. K20 has TWO factory saddle tanks. Each tank
  // hosts an in-tank fuel pump + level sender. ECU (M150) electrically
  // switches between pumps (Manual / Auto / Balance modes) — no
  // commercial selector valve. Each saddle ~24"L × 18"W × 14"D.
  // Source: K20_BUILD_OVERLAY.md §3.1 (THE PRIMARY DELTA)
  Fuel_Tank_LH: {
    name: 'Fuel_Tank_LH',
    category: 'misc',          // not 'frame' / 'sheet_metal' — fuel tank is its own thing
    material: 'sheet_metal_medium',  // factory steel saddle tank (16-ga stamped)
    channel_along: false,      // no routing on/along tank surface (fuel safety)
    channel_over: false,       // no routing over (top is straps + filler neck + vent)
    pierceable_override: 0,    // ABSOLUTELY forbidden to pierce (fuel containment)
    factory_holes: [
      { id: 'FT_LH_PUMP', pos: [+0.40, +0.80, 0.55], diameter_in: 4.0, original_use: 'In-tank fuel pump module access — top of tank, sealed by lock-ring + O-ring', sealed: true, reuse_score: 0.0 /* dedicated to pump module, not a wire pass-through */ },
      { id: 'FT_LH_FILLER', pos: [+0.50, +0.95, 0.65], diameter_in: 2.5, original_use: 'Filler neck weld bung', sealed: true, reuse_score: 0.0 },
    ],
    ground_points: [
      { id: 'G_FUEL_LH', pos: [+0.40, +0.80, 0.45], serves: 'LH saddle pump return + LH sender ground', criticality: 'CRITICAL', min_gauge_awg: 12, notes: 'Pump return lands on STAR_FUEL_FRAME (see Under_Frame_Blazer). Sender ground is a SEPARATE wire to M150 sensor ground — do NOT share with pump power-return (would inject pump noise into 5V analog level signal, violating E4). E4 requires shielded twisted pair for sender signal+ground.' },
    ],
    notes: 'LH saddle fuel tank — factory K20 dual-tank system. ~24"L × 18"W × 14"D, ~17 gal capacity. Mounted between LH frame rail and inboard structural element, behind cab, ahead of rear axle. Hosts: in-tank fuel pump module (Walbro/Aeromotive equivalent, ~10-15A peak), fuel level sender (resistive, 0-90Ω or 240-33Ω depending on M150 cal). Pump+sender wiring exits through pump module top connector — 4-pin sealed (pump+, pump-, sender_sig, sender_gnd). PDM30 channel `FUEL-PUMP-LH-PWR` fused 20A drives this pump. M150 calibration handles LH/RH/AUTO/BALANCE mode logic — no mechanical selector valve. NEVER pierce, NEVER route wires touching tank skin (fire risk). Pump module connector pigtail routes ~6" up to a frame-rail-mounted DT connector, then joins the underbody bed harness. OPEN: confirm exact tank position vs frame rails from 1984 K20 FSM (saddle tanks varied across model years).',
    source_topics: ['fuel_system', 'grounds'],
  },
  Fuel_Tank_RH: {
    name: 'Fuel_Tank_RH',
    category: 'misc',
    material: 'sheet_metal_medium',
    channel_along: false,
    channel_over: false,
    pierceable_override: 0,
    factory_holes: [
      { id: 'FT_RH_PUMP', pos: [-0.40, +0.80, 0.55], diameter_in: 4.0, original_use: 'In-tank fuel pump module access', sealed: true, reuse_score: 0.0 },
      { id: 'FT_RH_FILLER', pos: [-0.50, +0.95, 0.65], diameter_in: 2.5, original_use: 'Filler neck weld bung', sealed: true, reuse_score: 0.0 },
    ],
    ground_points: [
      { id: 'G_FUEL_RH', pos: [-0.40, +0.80, 0.45], serves: 'RH saddle pump return + RH sender ground', criticality: 'CRITICAL', min_gauge_awg: 12, notes: 'Mirror of G_FUEL_LH. Lands on STAR_FUEL_FRAME.' },
    ],
    notes: 'RH saddle fuel tank — mirror of LH. Same construction, same wiring topology. PDM30 channel `FUEL-PUMP-RH-PWR` drives this pump. Combined with LH tank: M150 sees two analog level inputs and one digital tank-select switch input, runs the mode logic in calibration. See K20_BUILD_OVERLAY.md §3.1 for full circuit list.',
    source_topics: ['fuel_system', 'grounds'],
  },

  // ── TANK SELECTOR SWITCH — dash-mounted, M150 digital input ─────────
  // Three-position rotary or toggle: LH / RH / AUTO. Lives in dash.
  // Source: K20_BUILD_OVERLAY.md §3.1 (FUEL-SELECT-SW circuit)
  Dash_Tank_Selector_Switch: {
    name: 'Dash_Tank_Selector_Switch',
    category: 'dash',
    material: 'plastic_intake',
    channel_along: false,
    channel_over: false,
    notes: 'Dash-mounted 3-position fuel tank selector (LH/RH/AUTO). 22 AWG signal + ground to M150 digital input. Mounts in lower dash near other accessory switches. Replaces the K5 dash position used for any single-tank-related control.',
    source_topics: ['fuel_system', 'instrument_cluster'],
  },

  // ── REAR LICENSE PLATE — on K20 lives on tailgate or rear bumper ────
  // K5 Exterior_License_Plate_Back is on the Blazer tailgate. On K20
  // it's on the truck tailgate or rear bumper bracket. Same lighting
  // function, different mount.
  Exterior_License_Plate_Back: {
    name: 'Exterior_License_Plate_Back',
    category: 'lighting',
    material: 'composite',
    channel_along: false,
    channel_over: false,
    notes: 'K20 rear license plate lamp — mounts on tailgate or rear bumper bracket. 2-wire (+12V tail circuit, ground via Bed_Floor G_BED_FRAME). On K20 standard build (no electrical to tailgate per overlay §3.3) the plate lamp typically lives on the bumper bracket to avoid the flex-ground issue.',
    source_topics: ['lighting_rear'],
  },

  // ── BED REAR — taillight bucket region of bed (rear wall) ──────────
  // K20 taillights mount in the bed's rear corners (in pickup beds,
  // taillights are integrated into the bedside or rear cap). Wires
  // exit underbody at the rear of bed and rise into the bucket.
  Bed_Rear: {
    name: 'Bed_Rear',
    category: 'sheet_metal',
    material: 'sheet_metal_medium',
    channel_along: true,
    channel_over: false,
    notes: 'K20 bed rear panel / taillight bucket area. Tail / brake / turn / backup / side-marker pigtails exit the underbody harness here, rise through grommets into the bucket. 4-wire per side (tail/brake/turn/backup). Optional 5th wire for bedside reverse lights (overlay §3.4 upsell).',
    source_topics: ['body', 'lighting_rear'],
  },

  // ── TAIL LIGHT (K20-specific, sits at bed rear) ─────────────────────
  // Distinct from K5's Tail_Lights_Main (which is Blazer rear-corner
  // bucket). K20 tail lights are smaller, mount in bed rear panel.
  // Default to inheriting the K5 tail light traits but tag as K20.
  Tail_Lights_Main: {
    ...K5_OBJECT_TRAITS.Tail_Lights_Main,
    notes: (K5_OBJECT_TRAITS.Tail_Lights_Main.notes ?? '') + ' K20 NOTE: mounted in bed-rear bucket (vs K5 Blazer rear-corner). Same 4-wire pigtail. Routing different — exits under-bed harness, rises through Bed_Rear grommet.',
    source_topics: ['lighting_rear'],
  },
  Tail_Lights_Glass_Front: { ...K5_OBJECT_TRAITS.Tail_Lights_Glass_Front },
  Tail_Lights_Glass_Behind: { ...K5_OBJECT_TRAITS.Tail_Lights_Glass_Behind },

  // ── TRAILER PREP — 7-pin connector at LWB tail ─────────────────────
  // Source: K20_BUILD_OVERLAY.md §3.2 (LWB extension) + §3.4 (trailer-brake prep upsell)
  Trailer_Connector_7pin: {
    name: 'Trailer_Connector_7pin',
    category: 'lighting',  // closest fit — endpoint device, lighting + brake + power
    material: 'composite',
    channel_along: false,
    channel_over: false,
    notes: 'SAE J560 / J2863 7-pin RV-style trailer connector at rear of bed / on rear bumper. Pins: GND, BAT(+12V always-hot via PDM30 fused 30A), TAIL, LH-TURN, RH-TURN, BRK (brake-controller output), AUX (reverse lamp or trailer-brake controller-fed). Cable from PDM30 → connector ~110" total length per overlay §3.2. Sealed connector (K5 rule). Trailer-brake controller pre-wire (Tekonsha P3 or equivalent) is owner-installable per overlay §3.4 — wiring just provides the BRK feed from PDM30 brake-pressure channel.',
    source_topics: ['trailer', 'lighting_rear'],
  },

  // ── OPTIONAL BED-RAIL LED PUCKS (4× under bed rails) ────────────────
  // Per overlay §3.4 — single PDM channel with ambient-light auto-on.
  // Modeled as one logical lighting object (4 pucks daisy-chained).
  Bed_Rail_LEDs: {
    name: 'Bed_Rail_LEDs',
    category: 'lighting',
    material: 'composite',
    channel_along: false,
    channel_over: false,
    notes: 'Optional: 4× LED pucks under bed rails for cargo work (overlay §3.4 upsell, ~$200 hardware). Single PDM30 channel `BED-RAIL-LED` fused 5A (LEDs are low draw). 16 AWG feed from PDM30 → Cab_Back_Grommet → along bed-rail underside → daisy-chained pucks. Optional ambient-light photocell auto-on logic in PDM30 calibration. Pucks mount to underside of bed-rail cap.',
    source_topics: ['lighting_rear', 'lighting_marker'],
  },

  // ── OPTIONAL IN-BED 12V OUTLET ─────────────────────────────────────
  // Per overlay §3.4 upsell. Sealed accessory port at front of bed.
  Bed_12V_Outlet: {
    name: 'Bed_12V_Outlet',
    category: 'misc',
    material: 'plastic_intake',
    channel_along: false,
    channel_over: false,
    notes: 'Optional: sealed 12V cigarette-style or SAE 2-pin accessory port at front bulkhead of bed (overlay §3.4 upsell, ~$80). 14 AWG, PDM30 channel `BED-12V-OUTLET` fused 15A. Same architecture as console outlet but waterproof (K5 sealed-connector rule).',
    source_topics: ['power_dist'],
  },

  // ── OPTIONAL BEDSIDE REVERSE LIGHTS ────────────────────────────────
  // Per overlay §3.4 upsell.
  Bed_Reverse_Lights: {
    name: 'Bed_Reverse_Lights',
    category: 'lighting',
    material: 'composite',
    channel_along: false,
    channel_over: false,
    notes: 'Optional: auxiliary reverse illumination over the bed for nighttime loading (overlay §3.4 upsell, ~$100). Single PDM30 channel `BED-REVERSE-AUX` fused 10A, triggered by reverse signal (CAN message from PCM, or hard-wired from trans range sensor).',
    source_topics: ['lighting_rear'],
  },
};

// ── COMPOSED K20 TRAIT TABLE ───────────────────────────────────────────
// Order: K5 inherited (carry-forward) → K20 overrides → K20-new objects.
// Spread order: later keys win, so overrides stomp inherited correctly.
export const K20_OBJECT_TRAITS: Record<string, ObjectTraits> = {
  ...K5_INHERITED,
  ...K20_OVERRIDES,
  ...K20_NEW_OBJECTS,
};

// ── K20 trait lookup ──────────────────────────────────────────────────
/** Get traits for a K20 object name — use the K20 curated table or
 *  fall back to category inference. Mirrors `getTraits()` from the K5
 *  module but consults K20_OBJECT_TRAITS first. */
export function getK20Traits(name: string): ObjectTraits {
  if (K20_OBJECT_TRAITS[name]) return K20_OBJECT_TRAITS[name];
  const category = inferCategory(name);
  const defaultMaterial: Material = (
    category === 'frame'      ? 'frame_steel_c_channel' :
    category === 'engine'     ? 'cast_aluminum' :
    category === 'wheel'      ? 'composite' :
    category === 'dash'       ? 'sheet_metal_thin' :
    category === 'lighting'   ? 'plastic_intake' :
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

// ── Counts (for self-documentation / receipt verification) ────────────
/** Number of K5 traits inherited verbatim into the K20 table. */
export const K20_INHERITED_COUNT = Object.keys(K5_INHERITED).length;
/** Number of K5 traits overridden with K20-specific deltas. */
export const K20_OVERRIDE_COUNT = Object.keys(K20_OVERRIDES).length;
/** Number of brand-new K20-only trait entries. */
export const K20_NEW_COUNT = Object.keys(K20_NEW_OBJECTS).length;
