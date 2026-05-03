// k5Features.ts — the configuration variables every PDM/harness/BOM choice depends on.
//
// Skylar 2026-04-25: "It should be able to automatically recalibrate. Choose
// electric windows vs roller windows, lights on the doors or no, electric
// locks or no — every accessory choice ripples through the manifest."
//
// This file is the contract. K5Features is a typed feature flag set; every
// downstream artifact (PDM30/PDM15 config, harness BOM, cut list, cost rollup)
// is a pure function of it. Flip a checkbox → derive everything fresh.
//
// Today: the K5 features are explicit constants below. The PDM derivation
// functions in `deriveBodyConfig.ts` consume this struct.
// Tomorrow: a Features panel in the UI lets you toggle and watch live updates.

export type EcuChoice = 'M150' | 'M130';
export type EnginePackage = 'GPR_V8' | 'custom';

export type WindowChoice = 'electric_single_speed' | 'electric_multi_speed' | 'roller';
export type HvacBlowerChoice = 'single_speed' | 'multi_speed' | 'none';
export type HeadlightChoice = 'led' | 'halogen' | 'none';
export type HighBeamInput = 'factory_column' | 'ecu_relayed' | 'none';
export type ClusterChoice = 'dakota_vhx' | 'analog' | 'none';
export type HeadUnitChoice = 'retrosound_hermosa' | 'aftermarket_other' | 'none';
export type BrakeBoosterChoice = 'ibooster' | 'vacuum';
export type ParkingBrakeChoice = 'estopp' | 'mechanical';
export type TransmissionChoice = 'PCS_4L60E' | 'PCS_4L80E' | 'manual';
export type TransferCaseChoice = 'NV241_manual' | 'NV241_electric' | 'none';

export interface K5Features {
  // ── ENGINE ──────────────────────────────────────────────────────────
  ecu: EcuChoice;
  package: EnginePackage;
  drive_by_wire: boolean;
  cylinders: 8;                 // V8 assumed; placeholder for future flexibility
  forced_induction: boolean;    // affects MAP range + CAN bytes

  // ── DRIVETRAIN ──────────────────────────────────────────────────────
  transmission: TransmissionChoice;
  transfer_case: TransferCaseChoice;

  // ── BRAKES ──────────────────────────────────────────────────────────
  brake_booster: BrakeBoosterChoice;
  parking_brake: ParkingBrakeChoice;

  // ── BODY CONVENIENCE ───────────────────────────────────────────────
  power_windows: WindowChoice;
  power_locks: boolean;
  speed_auto_lock: boolean;     // descope today — needs CAN vehicle speed
  door_puddle_lights: boolean;
  amp_power_steps: boolean;
  reverse_camera: boolean;
  front_camera: boolean;
  cargo_bed_light: boolean;
  footwell_lights: boolean;
  under_dash_led: boolean;
  dome_light: boolean;
  interior_courtesy_lights: boolean;

  // ── CLIMATE ─────────────────────────────────────────────────────────
  hvac_blower: HvacBlowerChoice;
  ac_compressor: boolean;
  ac_hp_switch_wired: boolean;  // false today — gates compressor for safety

  // ── LIGHTING ────────────────────────────────────────────────────────
  headlights: HeadlightChoice;
  high_beam_input: HighBeamInput;
  flash_to_pass: boolean;
  hazard_via_both_stalks: boolean;  // gesture: pulling both turn stalks = hazards

  // ── WIPER / WASHER ──────────────────────────────────────────────────
  wiper_park_input: boolean;    // factory wiper park switch wired to PDM input
  three_wipe_after_washer: boolean;

  // ── AUDIO ───────────────────────────────────────────────────────────
  head_unit: HeadUnitChoice;
  audio_amp: boolean;
  mute_on_reverse: boolean;     // requires Hermosa mute pin wire

  // ── CLUSTER + ACCESSORIES ──────────────────────────────────────────
  cluster: ClusterChoice;
  cigarette_lighter: boolean;
  usb_charging: boolean;        // stay-alive USB
  fm_antenna_powered: boolean;
  accessory_outlet_12v: boolean;

  // ── KEYPAD ──────────────────────────────────────────────────────────
  keypad_count: 0 | 1 | 2;

  // ── CAN BUS ─────────────────────────────────────────────────────────
  can_bitrate_kbps: 500;
  can_base_address: string;     // hex like '0x300'
  ecu_can_id: string;           // hex like '0x100'
  ibooster_status_id: string;   // hex like '0x39D'
  ibooster_fault_id: string;    // hex like '0x35D'
  pcs_gear_id: string;          // hex like '0x00200200' (29-bit)

  // ── ENGINE TUNING ──────────────────────────────────────────────────
  engine_running_threshold_rpm: number;  // currently 400; Dave to tune
}

// ──────────────────────────────────────────────────────────────────────
// The K5 as currently configured (2026-04-25). Edit this constant to
// rebuild the truck's config.
// ──────────────────────────────────────────────────────────────────────
export const K5_FEATURES: K5Features = {
  // Engine — undecided per Skylar 2026-04-25; defaulting to M150 per memory
  ecu: 'M150',
  package: 'GPR_V8',
  drive_by_wire: true,
  cylinders: 8,
  forced_induction: false,

  // Drivetrain
  transmission: 'PCS_4L60E',    // TBD 4L60E vs 4L80E
  transfer_case: 'NV241_manual',

  // Brakes
  brake_booster: 'ibooster',
  parking_brake: 'estopp',

  // Body convenience — all ON for the K5 build
  power_windows: 'electric_single_speed',
  power_locks: true,
  speed_auto_lock: false,        // descoped — needs CAN vehicle speed
  door_puddle_lights: true,
  amp_power_steps: true,
  reverse_camera: true,
  front_camera: true,
  cargo_bed_light: true,
  footwell_lights: true,
  under_dash_led: true,
  dome_light: true,
  interior_courtesy_lights: true,

  // Climate
  hvac_blower: 'single_speed',  // multi-speed deferred — needs PWM
  ac_compressor: true,
  ac_hp_switch_wired: false,    // safety: A/C disabled until wired

  // Lighting
  headlights: 'led',
  high_beam_input: 'ecu_relayed', // factory column exhausted — relay via ECU
  flash_to_pass: true,
  hazard_via_both_stalks: true, // soft choice — flag for Skylar review

  // Wiper
  wiper_park_input: false,      // not yet wired
  three_wipe_after_washer: true,

  // Audio
  head_unit: 'retrosound_hermosa',
  audio_amp: true,
  mute_on_reverse: true,        // needs Hermosa mute pin wire

  // Cluster + accessories
  cluster: 'dakota_vhx',
  cigarette_lighter: true,
  usb_charging: true,
  fm_antenna_powered: true,
  accessory_outlet_12v: true,

  // Keypad
  keypad_count: 1,

  // CAN bus
  can_bitrate_kbps: 500,
  can_base_address: '0x300',
  ecu_can_id: '0x100',
  ibooster_status_id: '0x39D',
  ibooster_fault_id: '0x35D',
  pcs_gear_id: '0x00200200',

  // Engine tuning
  engine_running_threshold_rpm: 400,
};

// ──────────────────────────────────────────────────────────────────────
// Helper — list what changes if a feature flips. Used by the UI to show
// "removing this would drop X outputs and Y conditions." Not the source
// of truth (that's the derivation function); this is preview tooling.
// ──────────────────────────────────────────────────────────────────────
export interface FeatureImpact {
  output_pins_added: string[];   // device names
  output_pins_removed: string[];
  conditions_added: string[];
  conditions_removed: string[];
  can_extractions_added: string[];
  can_extractions_removed: string[];
  keypad_bindings_added: string[];
  keypad_bindings_removed: string[];
}
