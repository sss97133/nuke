// generatePdmConfig.ts — emit PDM Manager–importable YAML from the K5 manifest.
//
// SCAFFOLD — not feature-complete. Produces the structural outline the real
// emitter will fill. Source-of-truth for behavior is
// `docs/wiring/output/K5_PDM30_config_spec.md` (authored 2026-04-22). The
// emitter's job is to mechanize that spec: every PDM pin, input, CAN input,
// CAN output, condition, counter, and keypad binding expressed in the
// structured shape PDM Manager's File → Import consumes.
//
// Current coverage: enumerates pdm_controlled devices, emits Output Pin
// stubs with max-current hints, emits the 16 Input Pin names from the spec,
// emits the standard CAN base address (0x300). Missing: Conditions (14
// native ops), Counters, per-output Driven-By logic, CAN extraction recipes,
// Keypad binding table. Fill from the config spec doc.

import type { ManifestDevice } from './overlayCompute';

export interface PdmInputPin {
  dig: number;
  pin: string;          // A_27 etc.
  channel_name: string; // ignition_run etc.
  trigger_low_v: number;
  trigger_high_v: number;
  debounce_ms: number;
  purpose: string;
}

export interface PdmOutputPin {
  out: number;
  pins: string[];       // some outputs parallel two pins (A_1+A_10)
  device: string;
  max_amps: number;
  retries: number;
  retry_delay_s: number;
  stay_alive: boolean;
  driven_by: string;    // logical channel / condition name
  wire_gauge_awg: number;
  notes?: string;
}

export interface PdmCanInput {
  slot: number;
  can_id: string;       // 0x100 etc.
  name: string;
  byte_offset: number;
  size_bits: 8 | 16;
  signed: boolean;
  mask?: string;
  divisor?: number;
  timeout_ms: number;
  fail_value?: number;
}

export interface PdmCanOutput {
  slot: number;
  can_id: string;
  rate_hz: number;
  bytes: Array<{ byte: number; channel: string }>;
  transmit_when: string;  // channel expression
}

export interface PdmCondition {
  name: string;
  expression: string;   // free-form, uses 14 PDM operators
  note?: string;
}

export interface PdmCounter {
  name: string;
  source: string;
  on_edge: 'rising' | 'falling' | 'both';
  overflow_at: number;
  /** Optional reset channel — counter clears to 0 when this fires.
   *  PDM Manager Counters support a separate reset input (Manual p.22). */
  reset?: string;
}

export interface PdmKeypadBinding {
  page: 1 | 2;
  button: number;         // 1-8
  press: 'short' | 'long' | 'double';
  action: string;
}

export interface PdmConfig {
  metadata: {
    pdm_type: 'PDM30' | 'PDM15' | 'PDM32';
    vehicle: string;
    spec_source: string;
    generated_at: string;
  };
  global: {
    can_bitrate_kbps: number;
    can_base_address: string;
    transmit_channel: string;
    master_retry_channel?: string;
    master_shutdown_channel?: string;
    keypad_count: number;
    keypad_bitrate_kbps: number;
    password_protected: boolean;
  };
  input_pins: PdmInputPin[];
  output_pins: PdmOutputPin[];
  can_inputs: PdmCanInput[];
  can_outputs: PdmCanOutput[];
  conditions: PdmCondition[];
  counters: PdmCounter[];
  keypad_bindings: PdmKeypadBinding[];
}

// Pulled verbatim from docs/wiring/output/K5_PDM30_config_spec.md §2.
// Moved here so the emitter can stand alone until we parse the md directly.
const K5_INPUT_PINS: PdmInputPin[] = [
  { dig: 1,  pin: 'A_27', channel_name: 'ignition_run',      trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms: 100, purpose: 'Master ignition state' },
  { dig: 2,  pin: 'A_19', channel_name: 'headlight_park_sw', trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms: 100, purpose: 'Park/marker position of headlight switch' },
  { dig: 3,  pin: 'A_29', channel_name: 'headlight_head_sw', trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms: 100, purpose: 'Head position of headlight switch' },
  { dig: 4,  pin: 'A_21', channel_name: 'turn_left_sw',      trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms:  50, purpose: 'Turn stalk left' },
  { dig: 5,  pin: 'A_30', channel_name: 'turn_right_sw',     trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms:  50, purpose: 'Turn stalk right' },
  { dig: 6,  pin: 'A_31', channel_name: 'horn_btn',          trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms:  30, purpose: 'Horn button' },
  { dig: 7,  pin: 'A_23', channel_name: 'wiper_low_sw',      trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms: 100, purpose: 'Wiper stalk low' },
  { dig: 8,  pin: 'A_32', channel_name: 'wiper_high_sw',     trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms: 100, purpose: 'Wiper stalk high' },
  { dig: 9,  pin: 'A_33', channel_name: 'washer_sw',         trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms:  50, purpose: 'Washer momentary' },
  { dig: 10, pin: 'A_34', channel_name: 'lock_sw',           trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms:  50, purpose: 'Dash lock button' },
  { dig: 11, pin: 'B_20', channel_name: 'unlock_sw',         trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms:  50, purpose: 'Dash unlock button' },
  { dig: 12, pin: 'B_21', channel_name: 'door_left_sw',      trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms: 150, purpose: 'Driver door open (active low)' },
  { dig: 13, pin: 'B_15', channel_name: 'door_right_sw',     trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms: 150, purpose: 'Passenger door open' },
  { dig: 14, pin: 'B_23', channel_name: 'brake_sw',          trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms:  30, purpose: 'Brake pedal switch' },
  { dig: 15, pin: 'B_17', channel_name: 'reverse_sw',        trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms:  50, purpose: 'Transmission reverse light switch' },
  { dig: 16, pin: 'B_24', channel_name: 'hazard_sw',         trigger_low_v: 3.5, trigger_high_v: 4.2, debounce_ms:  50, purpose: 'Hazard button' },
];

// All 30 outputs transcribed from docs/wiring/output/K5_PDM30_config_spec.md
// §3.1 (20A class, OUT1-8) + §3.2 (8A class, OUT9-30). Retry delay unspecified
// in §3.2 — defaulted to 3s as a safe conservative value.
const K5_OUTPUT_PINS: PdmOutputPin[] = [
  // ── §3.1 20A class (dual-pin OUT1-8) ──────────────────────────────
  { out:  1, pins: ['A_1','A_10'], device: 'Radiator Fan 1',           max_amps: 20, retries: 3, retry_delay_s: 10, stay_alive: false, driven_by: 'fan1_on',                  wire_gauge_awg: 12, notes: 'CAN-relayed from ECU' },
  { out:  2, pins: ['A_3','A_12'], device: 'Radiator Fan 2',           max_amps: 20, retries: 3, retry_delay_s: 10, stay_alive: false, driven_by: 'fan2_on',                  wire_gauge_awg: 12, notes: 'CAN-relayed from ECU' },
  { out:  3, pins: ['A_5','A_14'], device: 'Window motor L (power)',   max_amps: 16, retries: 1, retry_delay_s:  2, stay_alive: false, driven_by: 'window_L_power',            wire_gauge_awg: 14 },
  { out:  4, pins: ['A_7','A_16'], device: 'Window motor R (power)',   max_amps: 16, retries: 1, retry_delay_s:  2, stay_alive: false, driven_by: 'window_R_power',            wire_gauge_awg: 14 },
  { out:  5, pins: ['A_9','A_17'], device: 'Electric water pump',      max_amps: 15, retries: 3, retry_delay_s:  5, stay_alive: false, driven_by: 'water_pump_on',            wire_gauge_awg: 14, notes: 'CAN-relayed from ECU' },
  { out:  6, pins: ['B_3','B_9'],  device: 'HVAC blower (single-speed)',max_amps: 15, retries: 3, retry_delay_s:  5, stay_alive: false, driven_by: 'blower_on',                wire_gauge_awg: 14, notes: 'single-speed until external PWM added' },
  { out:  7, pins: ['B_5','B_11'], device: 'E-Stopp parking brake',    max_amps: 12, retries: 2, retry_delay_s:  3, stay_alive: false, driven_by: 'estopp_pulse',              wire_gauge_awg: 14 },
  { out:  8, pins: ['B_7','B_13'], device: '12V accessory outlet',     max_amps: 12, retries: 3, retry_delay_s:  3, stay_alive: false, driven_by: 'ignition_run',              wire_gauge_awg: 14 },
  // ── §3.2 8A class (single-pin OUT9-30) ────────────────────────────
  { out:  9, pins: ['A_2'],        device: 'Wiper motor (low/common) — linked to OUT12', max_amps: 8, retries: 2, retry_delay_s: 3, stay_alive: false, driven_by: 'wiper_low_drive',   wire_gauge_awg: 16, notes: 'linked channel per Manual p.9' },
  { out: 10, pins: ['A_4'],        device: 'AMP Step motor R (power)',      max_amps: 8, retries: 1, retry_delay_s: 3, stay_alive: false, driven_by: 'step_R_power',     wire_gauge_awg: 16 },
  { out: 11, pins: ['A_6'],        device: 'AMP Step motor L (power)',      max_amps: 8, retries: 1, retry_delay_s: 3, stay_alive: false, driven_by: 'step_L_power',     wire_gauge_awg: 16 },
  { out: 12, pins: ['A_8'],        device: 'Wiper motor high-speed tap',    max_amps: 8, retries: 2, retry_delay_s: 3, stay_alive: false, driven_by: 'wiper_high_drive', wire_gauge_awg: 16, notes: 'linked-channel per Manual p.9' },
  { out: 13, pins: ['A_11'],       device: 'park/tail/parking group (4 LEDs)',  max_amps: 3, retries: 5, retry_delay_s: 3, stay_alive: false, driven_by: 'park_lights_on', wire_gauge_awg: 18 },
  { out: 14, pins: ['A_13'],       device: 'Horn',                          max_amps: 6, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'horn_btn.Status', wire_gauge_awg: 16, notes: 'direct passthrough — no Condition needed' },
  { out: 15, pins: ['A_15'],       device: 'backup group (3rd brake + 2× backup + cam)', max_amps: 5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'backup_group_on', wire_gauge_awg: 16 },
  { out: 16, pins: ['A_18'],       device: 'A/C compressor clutch',         max_amps: 6, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'ac_clutch_on', wire_gauge_awg: 16, notes: 'CAN from ECU ANDed with HP switch (see ac_hp_switch_ok Condition)' },
  { out: 17, pins: ['A_20'],       device: 'Headlight L (low beam)',        max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'headlights_low_on', wire_gauge_awg: 16 },
  { out: 18, pins: ['A_22'],       device: 'Headlight R (low beam)',        max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'headlights_low_on', wire_gauge_awg: 16 },
  { out: 19, pins: ['A_24'],       device: 'marker/clearance/license group (8 fixtures)', max_amps: 3, retries: 5, retry_delay_s: 3, stay_alive: false, driven_by: 'park_lights_on', wire_gauge_awg: 18 },
  { out: 20, pins: ['A_25'],       device: 'Head unit (RetroSound)',        max_amps: 5, retries: 2, retry_delay_s: 3, stay_alive: false, driven_by: 'hu_power_on', wire_gauge_awg: 16 },
  { out: 21, pins: ['B_1'],        device: 'Door lock L',                   max_amps: 5, retries: 1, retry_delay_s: 3, stay_alive: false, driven_by: 'lock_power', wire_gauge_awg: 16 },
  { out: 22, pins: ['B_2'],        device: 'Door lock R',                   max_amps: 5, retries: 1, retry_delay_s: 3, stay_alive: false, driven_by: 'lock_power', wire_gauge_awg: 16 },
  { out: 23, pins: ['B_4'],        device: 'Trans controller (PCS2800)',    max_amps: 5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'ignition_run', wire_gauge_awg: 16 },
  { out: 24, pins: ['B_6'],        device: 'Wideband (LTCD)',               max_amps: 5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'ignition_run', wire_gauge_awg: 16 },
  { out: 25, pins: ['B_8'],        device: 'Interior courtesy lights (5 fixtures)', max_amps: 4, retries: 3, retry_delay_s: 3, stay_alive: true, driven_by: 'courtesy_on', wire_gauge_awg: 16, notes: 'stay-alive so door triggers wake PDM' },
  { out: 26, pins: ['B_10'],       device: 'Washer pump',                   max_amps: 4, retries: 2, retry_delay_s: 3, stay_alive: false, driven_by: 'washer_sw.Status', wire_gauge_awg: 18 },
  { out: 27, pins: ['B_12'],       device: 'Turn signal L front',           max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'turn_L_flash', wire_gauge_awg: 18 },
  { out: 28, pins: ['B_14'],       device: 'Turn signal R front',           max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'turn_R_flash', wire_gauge_awg: 18 },
  { out: 29, pins: ['B_16'],       device: 'Dash display (IGN rail)',       max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'ignition_run', wire_gauge_awg: 18 },
  { out: 30, pins: ['B_19'],       device: 'USB charging port',             max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: true, driven_by: 'acc_or_ign', wire_gauge_awg: 18, notes: 'stay-alive; phone-capable, NOT laptop' },
];

// CAN Inputs §4 — all 4 slots per Manual p.36 limit.
const K5_CAN_INPUTS: PdmCanInput[] = [
  { slot: 1, can_id: '0x100',     name: 'engine_rpm',                byte_offset: 0, size_bits: 16, signed: false, divisor: 1,   timeout_ms: 200 },
  { slot: 1, can_id: '0x100',     name: 'engine_coolant_c',          byte_offset: 4, size_bits:  8, signed: false, mask: '0xFF', timeout_ms: 200 },
  // ECU control-request bits — placeholder positions on byte 6 of 0x100.
  // FIX (2026-04-25 receipt): adds the previously-undefined ecu_*_request
  // channels referenced by fan1_on / fan2_on / water_pump_on / ac_clutch_on
  // conditions. Dave must confirm the actual ECU CAN broadcast
  // map and re-edit the byte/mask if these positions differ.
  { slot: 1, can_id: '0x100',     name: 'ecu_fan1_request',         byte_offset: 6, size_bits:  8, signed: false, mask: '0x01', timeout_ms: 200, fail_value: 0 },
  { slot: 1, can_id: '0x100',     name: 'ecu_fan2_request',         byte_offset: 6, size_bits:  8, signed: false, mask: '0x02', timeout_ms: 200, fail_value: 0 },
  { slot: 1, can_id: '0x100',     name: 'ecu_water_pump_request',   byte_offset: 6, size_bits:  8, signed: false, mask: '0x04', timeout_ms: 200, fail_value: 0 },
  { slot: 1, can_id: '0x100',     name: 'ecu_ac_request',           byte_offset: 6, size_bits:  8, signed: false, mask: '0x08', timeout_ms: 200, fail_value: 0 },
  { slot: 2, can_id: '0x39D',     name: 'brake_driver_applied',      byte_offset: 2, size_bits:  8, signed: false, mask: '0x03', timeout_ms: 100, fail_value: 0 },
  { slot: 2, can_id: '0x39D',     name: 'ibooster_internal_state',   byte_offset: 2, size_bits:  8, signed: false, mask: '0x1C', timeout_ms: 100 },
  { slot: 3, can_id: '0x35D',     name: 'ibooster_alert_page',       byte_offset: 0, size_bits:  8, signed: false, mask: '0x0F', timeout_ms: 500 },
  { slot: 3, can_id: '0x35D',     name: 'ibooster_alert_bits',       byte_offset: 1, size_bits:  8, signed: false, mask: '0xFF', timeout_ms: 500 },
  { slot: 4, can_id: '0x00200200',name: 'current_gear',              byte_offset: 7, size_bits:  8, signed: false, mask: '0xFF', timeout_ms: 100 },
  { slot: 4, can_id: '0x00200200',name: 'lever_position',            byte_offset: 6, size_bits:  8, signed: false, mask: '0xFF', timeout_ms: 100 },
];

// Conditions §5 — the behavior logic. ~115 ops of 200 budget used.
// Expressed in the config spec's `[OP inputs → output]` idiom (free-form here;
// a future pass converts each row to a structured Condition with typed
// operator + inputs array for true PDM Manager import).
//
// Every channel referenced in K5_OUTPUT_PINS[].driven_by, K5_CAN_OUTPUTS[].bytes[].channel,
// or K5_KEYPAD[].action MUST resolve to one of:
//   - an Input Pin name (16 of them, listed above)
//   - a CAN Input extraction name (8 of them, listed above)
//   - a Condition name (this list)
//   - a Counter name (K5_COUNTERS below)
//   - a built-in PDM channel (PDM Manual p.16): `<name>.Status`, `<name>.Voltage`,
//     `<name>.rising_edge`, `<name>.falling_edge`, `<name>.expired`,
//     and the standard CAN-broadcast diagnostic channels (output current, load, etc.)
const K5_CONDITIONS: PdmCondition[] = [
  // ── §5.1 basic ignition + power distribution ───────────────────────
  { name: 'ignition_off',        expression: 'NOT ignition_run.Status' },
  { name: 'acc_or_ign',          expression: 'ignition_run.Status OR keypad_btn_acc' },

  // ── §5.2 lighting ──────────────────────────────────────────────────
  { name: 'lights_were_on',      expression: 'park_lights_on', note: 'feedback channel for courtesy_hold' },
  { name: 'park_lights_on',      expression: 'headlight_park_sw.Status OR headlight_head_sw.Status OR courtesy_hold_active' },
  { name: 'headlights_low_on',   expression: 'headlight_head_sw.Status OR courtesy_hold_active' },
  { name: 'lights_off_trigger',  expression: 'SET_RESET(set=ignition_off, reset=ignition_run.Status)' },
  { name: 'courtesy_timer_fire', expression: 'PULSE(input=lights_off_trigger, width=30000ms)' },
  { name: 'courtesy_hold_active',expression: 'lights_off_trigger AND NOT courtesy_timer_fire.expired' },
  { name: 'turn_L_flash',        expression: 'FLASH(input=turn_left_sw.Status OR hazard_sw.Status, on_time=250ms, off_time=250ms)' },
  { name: 'turn_R_flash',        expression: 'FLASH(input=turn_right_sw.Status OR hazard_sw.Status, on_time=250ms, off_time=250ms)' },
  { name: 'both_stalks',         expression: 'turn_left_sw.Status AND turn_right_sw.Status' },
  { name: 'hazard_override',     expression: 'hazard_sw.Status OR both_stalks' },
  { name: 'turn_L_final',        expression: '(hazard_override AND turn_L_flash) OR (NOT hazard_override AND turn_L_flash)' },
  { name: 'turn_R_final',        expression: '(hazard_override AND turn_L_flash) OR (NOT hazard_override AND turn_R_flash)', note: 'shares L flasher when hazard active' },
  { name: 'flasher_state',       expression: 'PACK(turn_L_final, turn_R_final, hazard_override)', note: '2-bit encoding for CAN byte 1 of K5_body_state' },
  { name: 'lights_state',        expression: 'PACK(park_lights_on, headlights_low_on, hazard_override, high_beam_output)', note: '4-bit packed for CAN byte 0 of K5_body_state' },

  // ── §5.3 door locks ────────────────────────────────────────────────
  { name: 'lock_cmd',            expression: 'PULSE(input=lock_sw.Status OR keypad_btn_lock_toggle, width=400ms)' },
  { name: 'unlock_cmd',          expression: 'PULSE(input=unlock_sw.Status, width=400ms)' },
  { name: 'driver_door_open',    expression: 'door_left_sw.Status' },
  { name: 'lock_cmd_gated',      expression: 'lock_cmd AND NOT driver_door_open' },
  { name: 'lock_polarity',       expression: 'SET_RESET(set=lock_cmd_gated, reset=unlock_cmd)' },
  { name: 'lock_power',          expression: 'lock_cmd_gated OR unlock_cmd' },
  { name: 'lock_state',          expression: 'lock_polarity', note: '0=unlocked, 1=locked — CAN byte 3' },

  // ── §5.4 horn ──────────────────────────────────────────────────────
  // OUT14 driven directly by horn_btn.Status — passthrough, no Condition required.

  // ── §5.5 backup + reverse camera ───────────────────────────────────
  { name: 'in_reverse',          expression: 'current_gear Equal_to 6' },
  { name: 'in_park',             expression: 'current_gear Equal_to 8' },
  { name: 'in_neutral',          expression: 'current_gear Equal_to 7' },
  { name: 'reverse_active',      expression: 'reverse_sw.Status OR in_reverse' },
  { name: 'backup_group_on',     expression: 'reverse_active' },
  { name: 'cam_hold_timer',      expression: 'PULSE(input=reverse_active.falling_edge, width=2500ms)' },
  { name: 'head_unit_camera_request', expression: 'reverse_active OR cam_hold_timer OR keypad_btn_rear_cam_manual' },

  // ── §5.6 front camera ──────────────────────────────────────────────
  { name: 'front_cam_on',        expression: 'TOGGLE(input=keypad_btn_front_cam, reset=front_cam_auto_off)' },
  { name: 'front_cam_auto_off',  expression: 'PULSE(input=front_cam_on.rising_edge, width=15000ms).expired', note: 'speed>40km/h descoped — no speed channel yet' },

  // ── §5.7 AMP steps (L + R symmetric) ───────────────────────────────
  { name: 'step_L_deploy_trigger',   expression: 'door_left_sw.Status.rising_edge AND ignition_run.Status' },
  { name: 'step_L_retract_trigger',  expression: 'door_left_sw.Status.falling_edge AND ignition_run.Status' },
  { name: 'step_L_retract_trigger_delayed', expression: 'PULSE(input=step_L_retract_trigger, width=3000ms).expired' },
  { name: 'step_L_power',        expression: 'PULSE(input=step_L_deploy_trigger OR step_L_retract_trigger_delayed, width=2200ms)' },
  { name: 'step_L_polarity',     expression: 'SET_RESET(set=step_L_deploy_trigger, reset=step_L_retract_trigger)' },
  { name: 'step_L_state',        expression: 'step_L_polarity', note: 'nibble for CAN byte 4' },
  { name: 'step_R_deploy_trigger',   expression: 'door_right_sw.Status.rising_edge AND ignition_run.Status' },
  { name: 'step_R_retract_trigger',  expression: 'door_right_sw.Status.falling_edge AND ignition_run.Status' },
  { name: 'step_R_retract_trigger_delayed', expression: 'PULSE(input=step_R_retract_trigger, width=3000ms).expired' },
  { name: 'step_R_power',        expression: 'PULSE(input=step_R_deploy_trigger OR step_R_retract_trigger_delayed, width=2200ms)' },
  { name: 'step_R_polarity',     expression: 'SET_RESET(set=step_R_deploy_trigger, reset=step_R_retract_trigger)' },
  { name: 'step_R_state',        expression: 'step_R_polarity', note: 'nibble for CAN byte 4' },

  // ── §5.8 start sequence (PDM-side interlock only — START is GM direct-wired) ─
  { name: 'fuel_prime_pulse',    expression: 'PULSE(input=ignition_run.Status.rising_edge, width=2000ms)' },
  // FIX (2026-04-25 receipt): SR latch instead of OR with engine_running.
  // Bug: PULSE(2000ms) OR engine_running fails if cranking >2s before catch
  // (cold start / weak battery). Pump turned off mid-crank → won't start.
  // SR latch keeps pump alive between prime end and engine catching.
  { name: 'fuel_pump_latch',     expression: 'SET_RESET(set=fuel_prime_pulse OR engine_running, reset=NOT ignition_run.Status)', note: 'pump stays alive from prime through crank until ignition off' },
  { name: 'fuel_pump_relay',     expression: 'fuel_pump_latch', note: 'M130 still owns the runtime decision via engine_running once it latches' },

  // ── §5.9 high beam ─────────────────────────────────────────────────
  { name: 'high_beam_steady',    expression: 'headlight_head_sw.Status AND high_beam_detent_sw' },
  { name: 'high_beam_flash',     expression: 'PULSE(input=flash_to_pass_sw, width=500ms)' },
  { name: 'high_beam_output',    expression: 'high_beam_steady OR high_beam_flash', note: 'detent + flash inputs route via M130 aux analog → CAN — wire path TBD' },

  // ── §5.10 courtesy ─────────────────────────────────────────────────
  { name: 'door_any_open',       expression: 'door_left_sw.Status OR door_right_sw.Status' },
  { name: 'courtesy_off_delay',  expression: 'PULSE(input=door_any_open.falling_edge, width=8000ms)' },
  { name: 'courtesy_on',         expression: 'door_any_open OR courtesy_hold_active OR courtesy_off_delay', note: 'unified courtesy_on (was courtesy_on_final in spec)' },

  // ── §5.11 audio ────────────────────────────────────────────────────
  { name: 'hu_power_target',     expression: 'acc_or_ign' },
  { name: 'hu_power_on',         expression: 'HYSTERESIS(input=hu_power_target, rise_delay=500ms, fall_delay=300ms)' },
  { name: 'amp_remote_on',       expression: 'PULSE(input=hu_power_on.rising_edge, width=500ms).expired AND hu_power_on', note: '500ms thump-suppression delay after HU on' },
  { name: 'hu_mute',             expression: 'reverse_active OR cam_hold_timer', note: 'requires Hermosa mute pin wire — color TBD' },

  // ── §5.12 wipers ───────────────────────────────────────────────────
  { name: 'wiper_switch_off_edge', expression: 'wiper_low_sw.Status.falling_edge OR wiper_high_sw.Status.falling_edge' },
  { name: 'wiper_parking_hold', expression: 'SET_RESET(set=wiper_switch_off_edge, reset=wiper_park_sw.Status)', note: 'wiper_park_sw is a future input — currently descoped, hold drops to 0' },
  { name: 'wiper_low_drive',    expression: 'wiper_low_sw.Status OR wiper_parking_hold OR washer_wipe_active' },
  { name: 'wiper_high_drive',   expression: 'wiper_high_sw.Status' },
  { name: 'washer_wipe_active', expression: 'washer_sw.Status OR (washer_wipe_counter Less_than 3)', note: '3-wipe count after washer release' },

  // ── §5.13 brake warning lamp ──────────────────────────────────────
  { name: 'parking_brake_engaged', expression: 'estopp_pulse', note: 'estopp_pulse rising_edge implies engaged; SR latch could refine — ~3 ops, deferred' },
  { name: 'estopp_pulse',       expression: 'PULSE(input=keypad_btn_parking_brake_toggle, width=500ms)', note: 'PDM-side actuation; bench-tune width' },
  // FIX (2026-04-25 receipt): was missing CAN-timeout clauses.
  // iBooster is on CAN slots 2 (0x39D) and 3 (0x35D). If iBooster falls off
  // the bus the brake-warning lamp must light; PDM Manager exposes built-in
  // timeout channels per Manual p.41.
  { name: 'ibooster_can_lost',  expression: 'PDM.CAN Timeout.Message 1 OR PDM.CAN Timeout.Message 2', note: 'iBooster status (slot 2 / 0x39D) or fault (slot 3 / 0x35D) timeout' },
  { name: 'brake_warning_lamp', expression: 'ibooster_fault OR ibooster_alert_any OR ibooster_can_lost OR parking_brake_engaged' },

  // ── CAN-derived helpers (also from §5.2) ──────────────────────────
  { name: 'engine_running',      expression: 'engine_rpm Greater_than 400' },
  { name: 'brake_active',        expression: '(brake_driver_applied Equal_to 2) OR brake_sw.Status' },
  { name: 'ibooster_fault',      expression: 'ibooster_internal_state Equal_to 4' },
  { name: 'ibooster_alert_any',  expression: 'ibooster_alert_bits Not_equal_to 0' },
  { name: 'neutral_safety_ok',   expression: '(current_gear Equal_to 8) OR (current_gear Equal_to 7)' },

  // ── M130 relays (CAN passthrough — M130 owns the decision) ────────
  // FIX (2026-04-25 receipt): ecu_* channels now resolve to real CAN
  // extractions in K5_CAN_INPUTS (slot 1, byte 6, bits 0-3). Bit positions
  // are placeholder — confirm with Dave's GPR V8 CAN map and re-edit if
  // different.
  { name: 'fan1_on',             expression: 'ecu_fan1_request', note: 'CAN bit from M130 0x100 byte 6 bit 0' },
  { name: 'fan2_on',             expression: 'ecu_fan2_request', note: 'CAN bit from M130 0x100 byte 6 bit 1' },
  { name: 'water_pump_on',       expression: 'ecu_water_pump_request', note: 'CAN bit from M130 0x100 byte 6 bit 2' },
  { name: 'ac_clutch_on',        expression: 'ecu_ac_request AND ac_hp_switch_ok', note: 'high-pressure cutout switch ANDed' },
  // FIX (2026-04-25 receipt): was TRUE — that bypassed the HP cutout and
  // let the compressor run regardless of refrigerant pressure. Catastrophic
  // failure mode if A/C ever engages with this config. Now FALSE: A/C
  // refuses to engage until the HP switch wire is real and routed to a
  // PDM input. Replace with the actual input channel name when wired.
  { name: 'ac_hp_switch_ok',     expression: 'FALSE', note: 'fail-safe placeholder — A/C disabled until HP switch wired to PDM input' },

  // ── Window control (on/off only — variable speed needs external PWM) ─
  { name: 'window_L_power',      expression: 'keypad_btn_all_windows_down OR keypad_btn_all_windows_up', note: 'placeholder — cabin window switches not yet on PDM input map' },
  { name: 'window_R_power',      expression: 'keypad_btn_all_windows_down OR keypad_btn_all_windows_up' },

  // ── HVAC blower (single-speed gate) ───────────────────────────────
  { name: 'blower_on',           expression: 'ignition_run.Status AND keypad_btn_blower_toggle', note: 'single-speed; multi-speed needs external PWM controller' },

  // ── PDM-builtin status channels referenced by aggregate broadcasts.
  // PDM Manager exposes these directly as PDM.* (Manual p.51-57). We wrap
  // each in a local Condition so the K5 config is self-contained and the
  // audit can resolve every name without crossing into firmware-builtins.
  { name: 'master_retry_active', expression: 'PDM.Master Retry Status', note: 'firmware channel, high while master retry active' },
  { name: 'standby_mode',        expression: 'PDM.Standby', note: 'firmware channel, high in standby (Manual p.34)' },
  { name: 'can_link_ok',         expression: 'NOT PDM.CAN Timeout', note: 'overall CAN bus health' },
  { name: 'ibooster_link_ok',    expression: 'NOT (PDM.CAN Timeout.Message 1 OR PDM.CAN Timeout.Message 2)' },
  { name: 'pcs_link_ok',         expression: 'NOT PDM.CAN Timeout.Message 3' },
  { name: 'ecu_link_ok',        expression: 'NOT PDM.CAN Timeout.Message 0' },
  { name: 'keypad_link_ok',      expression: 'TRUE', note: 'keypad on dedicated bus per Manual p.32 — placeholder until firmware exposes a dedicated keypad timeout channel' },
  { name: 'global_error',        expression: 'PDM.Global Error', note: 'firmware aggregate error flag — drives keypad button 6 red LED' },

  // ── Placeholder inputs flagged in spec but not yet wired.
  // FALSE today so any condition gating on them is a safe no-op. Replace
  // each with the real channel reference once routed (see spec §5.9 high
  // beam, §5.12 wiper park).
  { name: 'high_beam_detent_sw', expression: 'FALSE', note: 'placeholder — needs M130 aux analog → CAN, then unpack here' },
  { name: 'flash_to_pass_sw',    expression: 'FALSE', note: 'placeholder — same routing as high_beam_detent_sw' },
  { name: 'wiper_park_sw',       expression: 'FALSE', note: 'placeholder — needs PDM input pin to factory wiper park switch (was on GM column, now severed)' },

  // ── Aggregate state bytes for the user-defined CAN broadcast.
  // PACK() expressions are documentation only. The real byte packing
  // happens in K5_CAN_OUTPUTS where each byte slot picks a real channel.
  { name: 'pdm_outputs_bank_1_state', expression: 'PACK(out1..out8 status bits)', note: 'PDM Manager auto-broadcasts via Standard messages (Manual p.51) — these symbols are the user-defined mirror' },
  { name: 'pdm_outputs_bank_2_state', expression: 'PACK(out9..out16 status bits)' },
  { name: 'pdm_outputs_bank_3_state', expression: 'PACK(out17..out24 status bits)' },
  { name: 'pdm_outputs_bank_4_state', expression: 'PACK(out25..out30 status bits + 2 spare)' },
  { name: 'pdm_flags_byte',          expression: 'PACK(global_error, master_retry_active, standby_mode, can_link_ok, ibooster_link_ok, pcs_link_ok, ecu_link_ok, keypad_link_ok)' },
  { name: 'overall_health_byte',     expression: 'PACK(brake_warning_lamp, ibooster_fault, parking_brake_engaged, neutral_safety_ok, engine_running, hu_power_on, courtesy_on, ignition_run.Status)' },
];

// Counters §6 — every cycle_count channel referenced in K5_CAN_OUTPUTS bytes
// must exist as a Counter (PDM Manual p.22). Counters are persistent across
// power cycles when used with the firmware's nonvolatile flag (set in PDM
// Manager). All listed below increment on rising_edge of the source channel.
const K5_COUNTERS: PdmCounter[] = [
  { name: 'window_L_cycle_count',   source: 'window_L_power',   on_edge: 'falling', overflow_at: 65535 },
  { name: 'window_R_cycle_count',   source: 'window_R_power',   on_edge: 'falling', overflow_at: 65535 },
  { name: 'horn_cycle_count',       source: 'horn_btn.Status',  on_edge: 'falling', overflow_at: 65535 },
  { name: 'lock_cycle_count',       source: 'lock_polarity',    on_edge: 'rising',  overflow_at: 65535 },
  { name: 'headlight_cycle_count',  source: 'headlights_low_on',on_edge: 'rising',  overflow_at: 65535 },
  { name: 'brake_cycle_count',      source: 'brake_active',     on_edge: 'rising',  overflow_at: 65535 },
  { name: 'hazard_cycle_count',     source: 'hazard_override',  on_edge: 'rising',  overflow_at: 65535 },
  { name: 'turn_L_count',           source: 'turn_left_sw.Status',  on_edge: 'rising', overflow_at: 65535 },
  { name: 'turn_R_count',           source: 'turn_right_sw.Status', on_edge: 'rising', overflow_at: 65535 },
  { name: 'estopp_cycle_count',     source: 'estopp_pulse',     on_edge: 'rising',  overflow_at: 65535 },
  // §5.12 wiper helper — re-wipe count after washer release
  // FIX (2026-04-25 receipt): added reset. Without it the counter saturates
  // at 3 after first wash and the (washer_wipe_counter Less_than 3) gate in
  // washer_wipe_active stays false forever — washer triggers exactly one
  // 3-wipe burst per power cycle. Reset on washer rising_edge so each
  // washer press kicks off a fresh 3-wipe sequence.
  { name: 'washer_wipe_counter',    source: 'wiper_low_drive',  on_edge: 'falling', overflow_at: 255, reset: 'washer_sw.Status.rising_edge' },
];

// Keypad §7 — single Motec 8-button keypad, factory default ID. Each button
// has 3 LEDs (green/red/amber) bound to feedback channels. Short press fires
// momentary; long press (>1s) fires the long-press action; double-press
// reserved (none configured). Italics in the spec are still Dave's calls; the
// channel names below are placeholders that resolve cleanly to existing
// Conditions or new TOGGLE/PULSE channels Dave can refine.
const K5_KEYPAD: PdmKeypadBinding[] = [
  // Button 1 — lights
  { page: 1, button: 1, press: 'short', action: 'keypad_btn_lights_toggle' },
  { page: 1, button: 1, press: 'long',  action: 'keypad_btn_hazards_toggle' },
  // Button 2 — cameras
  { page: 1, button: 2, press: 'short', action: 'keypad_btn_front_cam' },
  { page: 1, button: 2, press: 'long',  action: 'keypad_btn_rear_cam_manual' },
  // Button 3 — fans
  { page: 1, button: 3, press: 'short', action: 'keypad_btn_fan_override' },
  { page: 1, button: 3, press: 'long',  action: 'keypad_btn_fan_max' },
  // Button 4 — windows (gesture, not yet implemented on PDM30 — placeholder)
  { page: 1, button: 4, press: 'short', action: 'keypad_btn_all_windows_down' },
  { page: 1, button: 4, press: 'long',  action: 'keypad_btn_all_windows_up' },
  // Button 5 — central locking
  { page: 1, button: 5, press: 'short', action: 'keypad_btn_lock_toggle' },
  { page: 1, button: 5, press: 'long',  action: 'keypad_btn_valet_toggle' },
  // Button 6 — master retry / fault clear
  { page: 1, button: 6, press: 'short', action: 'keypad_button_master_retry' },
  // Button 7 — ACC override + panic
  { page: 1, button: 7, press: 'short', action: 'keypad_btn_acc' },
  { page: 1, button: 7, press: 'long',  action: 'keypad_btn_panic' },
  // Button 8 — horn
  { page: 1, button: 8, press: 'short', action: 'keypad_btn_horn_chirp' },
  { page: 1, button: 8, press: 'long',  action: 'keypad_btn_horn_long' },

  // ── Page 2 — overflow actions referenced by Conditions
  // Page 2 entered by long-pressing Button 7 (or whichever button you
  // pick for the "page-flip" gesture in PDM Manager's Keypad screen).
  // Page 2 button 1: parking brake toggle (E-Stopp). Spec §5.13 references
  // keypad_btn_parking_brake_toggle but didn't define the binding.
  { page: 2, button: 1, press: 'short', action: 'keypad_btn_parking_brake_toggle' },
  // Page 2 button 2: HVAC blower toggle (single-speed today; multi-speed
  // needs external PWM). Spec §3.1 OUT6 references keypad_btn_blower_toggle.
  { page: 2, button: 2, press: 'short', action: 'keypad_btn_blower_toggle' },
];

// CAN Outputs §6 — 2 user-defined messages at 50 Hz (manual default).
const K5_CAN_OUTPUTS: PdmCanOutput[] = [
  {
    slot: 1, can_id: '0x320', rate_hz: 20, transmit_when: 'ignition_run.Status',
    bytes: [
      { byte: 0, channel: 'pdm_outputs_bank_1_state' },    // 8 output states packed
      { byte: 1, channel: 'pdm_outputs_bank_2_state' },
      { byte: 2, channel: 'pdm_outputs_bank_3_state' },
      { byte: 3, channel: 'pdm_outputs_bank_4_state' },
      { byte: 4, channel: 'pdm_flags_byte' },               // fault flags
      { byte: 5, channel: 'window_L_cycle_count' },
      { byte: 6, channel: 'window_R_cycle_count' },
      { byte: 7, channel: 'horn_cycle_count' },
    ],
  },
  {
    slot: 2, can_id: '0x321', rate_hz: 20, transmit_when: 'ignition_run.Status',
    bytes: [
      { byte: 0, channel: 'lock_cycle_count' },
      { byte: 1, channel: 'headlight_cycle_count' },
      { byte: 2, channel: 'brake_cycle_count' },
      { byte: 3, channel: 'hazard_cycle_count' },
      { byte: 4, channel: 'turn_L_count' },
      { byte: 5, channel: 'turn_R_count' },
      { byte: 6, channel: 'estopp_cycle_count' },
      { byte: 7, channel: 'overall_health_byte' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────
// Emitter
// ──────────────────────────────────────────────────────────────────────

export function generatePdmConfig(
  vehicleName: string,
  manifest: ManifestDevice[],
): PdmConfig {
  const _pdmControlled = manifest.filter(d => d.pdm_controlled || d.pdm_channel_group);

  return {
    metadata: {
      pdm_type: 'PDM30',
      vehicle: vehicleName,
      spec_source: 'docs/wiring/output/K5_PDM30_config_spec.md',
      generated_at: new Date().toISOString(),
    },
    global: {
      can_bitrate_kbps: 500,
      can_base_address: '0x300',
      transmit_channel: 'ignition_run',
      master_retry_channel: 'keypad_button_master_retry',
      keypad_count: 1,
      keypad_bitrate_kbps: 500,
      password_protected: true,
    },
    input_pins: K5_INPUT_PINS,
    output_pins: K5_OUTPUT_PINS,
    can_inputs: K5_CAN_INPUTS,
    can_outputs: K5_CAN_OUTPUTS,
    conditions: K5_CONDITIONS,
    counters: K5_COUNTERS,
    keypad_bindings: K5_KEYPAD,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Static audit — every output's driven_by must resolve to a defined symbol
// ──────────────────────────────────────────────────────────────────────

const BUILTIN_INPUT_NAMES = new Set(K5_INPUT_PINS.map(p => p.channel_name));
const BUILTIN_CAN_NAMES   = new Set(K5_CAN_INPUTS.map(c => c.name));
const CONDITION_NAMES     = new Set(K5_CONDITIONS.map(c => c.name));
const COUNTER_NAMES       = new Set(K5_COUNTERS.map(c => c.name));

// PDM Manager auto-generates these accessor suffixes on any defined channel
// (Manual p.16). The audit strips them before resolving the base symbol.
const CHANNEL_ACCESSOR_SUFFIXES = [
  '.Status', '.Voltage', '.rising_edge', '.falling_edge', '.expired', '.Active',
  '.Current', '.Error', '.Over Current',
];

function stripAccessor(symbol: string): string {
  let s = symbol.trim();
  // Strip until no more accessor suffixes match — handles chained refs like
  // "door_left_sw.Status.rising_edge".
  let changed = true;
  while (changed) {
    changed = false;
    for (const sfx of CHANNEL_ACCESSOR_SUFFIXES) {
      if (s.endsWith(sfx)) { s = s.slice(0, -sfx.length); changed = true; break; }
    }
  }
  return s;
}

// Identifiers PDM Manager auto-creates from keypad bindings (Manual p.29-32).
// When a Keypad short/long press is bound, PDM Manager generates a channel of
// the action name; we whitelist those so they don't show as unresolved.
const KEYPAD_AUTO_CHANNELS = new Set<string>();

// PDM built-in channels (Manual p.16, p.41, p.51-57). Anything starting with
// PDM. is provided by the firmware; we don't need to define these. Also
// covers the bare-suffix tokens that appear after splitting "PDM.X.Y Z" on
// whitespace (e.g. "Timeout.Message" from "PDM.CAN Timeout.Message 1").
const PDM_BUILTIN_BARE_SUFFIXES = new Set([
  'Timeout.Message', 'Battery Voltage', 'Temperature', 'Total Current',
  'Global Error', 'CAN Timeout', 'Standby', 'Master Retry Status',
  'Constants.True', 'Constants.False',
]);
function isPdmBuiltin(name: string): boolean {
  return name.startsWith('PDM.') || PDM_BUILTIN_BARE_SUFFIXES.has(name);
}

// Placeholder meta-tokens that appear inside PACK(...) annotations. PACK
// expressions in the emitter are documentation — the actual byte packing
// is done by referencing real channels in CAN Output byte slots. These
// tokens are deliberately not channels.
const PACK_META_TOKENS = new Set([
  'status', 'bits', 'spare', 'reserved',
  // outN..outM range markers
]);
function isPackMetaToken(t: string): boolean {
  if (PACK_META_TOKENS.has(t)) return true;
  if (/^out\d+(\.\.out\d+)?$/.test(t)) return true; // out1..out8 etc.
  return false;
}

// Extract identifier-like tokens from a free-form Condition expression.
// We're not parsing — we're listing every dotted/underscored word and
// asking "does this resolve to something defined?".
function extractIdentifiers(expression: string): string[] {
  const out: string[] = [];
  // Match identifier-ish words: letters/digits/dots/underscores; allow leading lowercase.
  const re = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
  let m: RegExpExecArray | null;
  const reservedOps = new Set([
    'NOT','AND','OR','TRUE','FALSE',
    'PULSE','FLASH','SET_RESET','HYSTERESIS','TOGGLE','COUNTER','PACK','CAN_RELAY','CAN_LINK_OK','AND_BITMASK',
    'Equal_to','Greater_than','Less_than','Not_equal_to',
    // common parameter labels — not channel refs
    'input','set','reset','width','on_time','off_time','rise_delay','fall_delay','overflow_at',
    'ms','set_reset',
    // bare accessor tokens that appear after splitting "x.expired" — handled
    // upstream when attached, but show up bare when the whole expression is
    // wrapped (e.g. "PULSE(...).expired" — the outer .expired isn't on a
    // channel, it's on the PULSE result).
    'expired','rising_edge','falling_edge','Status','Voltage','Active','Current','Error',
  ]);
  while ((m = re.exec(expression)) !== null) {
    const tok = m[0];
    if (reservedOps.has(tok)) continue;
    if (/^\d/.test(tok)) continue;          // numeric
    if (/^x[0-9a-fA-F]+$/.test(tok)) continue; // hex tail after lone-zero leading-digit reject (e.g. "xFF" from "0xFF")
    if (/^[A-Z][a-z]+$/.test(tok) && tok.length < 8) continue; // PascalCase short token (rare)
    if (isPackMetaToken(tok)) continue;
    out.push(tok);
  }
  return out;
}

export function auditPdmConfig(cfg: PdmConfig): { unresolved: string[]; ok: boolean } {
  // Refresh keypad auto-channels from the bound actions.
  KEYPAD_AUTO_CHANNELS.clear();
  for (const k of cfg.keypad_bindings) KEYPAD_AUTO_CHANNELS.add(k.action);

  const defined = new Set<string>([
    ...BUILTIN_INPUT_NAMES, ...BUILTIN_CAN_NAMES,
    ...CONDITION_NAMES, ...COUNTER_NAMES,
    ...KEYPAD_AUTO_CHANNELS,
  ]);

  const refs: { sym: string; where: string }[] = [];
  // 1. output_pin.driven_by — was the only thing checked previously
  for (const o of cfg.output_pins) refs.push({ sym: o.driven_by, where: `OUT${o.out}.driven_by` });
  // 2. can_output bytes
  for (const co of cfg.can_outputs) {
    for (const b of co.bytes) refs.push({ sym: b.channel, where: `CAN ${co.can_id} byte${b.byte}` });
  }
  // 3. NEW: walk every Condition expression body
  for (const c of cfg.conditions) {
    for (const sym of extractIdentifiers(c.expression)) {
      refs.push({ sym, where: `Condition ${c.name}` });
    }
  }
  // 4. NEW: walk Counter source + reset
  for (const c of cfg.counters) {
    refs.push({ sym: c.source, where: `Counter ${c.name}.source` });
    if (c.reset) refs.push({ sym: c.reset, where: `Counter ${c.name}.reset` });
  }

  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const { sym, where } of refs) {
    const base = stripAccessor(sym);
    // Strip free-form CAN_RELAY/PACK/PULSE wrappers — these are inline ops.
    if (/^\s*(CAN_RELAY|PACK|PULSE|FLASH|SET_RESET|HYSTERESIS|TOGGLE|COUNTER)\(/.test(base)) continue;
    if (/Equal_to|Greater_than|Less_than|Not_equal_to|AND_BITMASK/.test(base)) continue;
    if (defined.has(base)) continue;
    if (base === 'TRUE' || base === 'FALSE' || base === 'global_kill') continue;
    if (isPdmBuiltin(base)) continue;
    // De-dupe identical symbols across multiple uses
    const tag = `${base} (${where})`;
    if (seen.has(base)) continue;
    seen.add(base);
    unresolved.push(tag);
  }
  return { unresolved, ok: unresolved.length === 0 };
}

// YAML-ish serializer (intentionally minimal — no external dep).
// Output is intended for human review + paste into PDM Manager. When the
// config is richer, swap to a proper YAML lib.
export function pdmConfigToYaml(cfg: PdmConfig): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);
  const block = (indent: number, obj: Record<string, unknown>) => {
    const pad = '  '.repeat(indent);
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        if (v.length === 0) { push(`${pad}${k}: []`); continue; }
        push(`${pad}${k}:`);
        for (const item of v) {
          push(`${pad}  - ${JSON.stringify(item)}`);
        }
      } else if (typeof v === 'object' && v !== null) {
        push(`${pad}${k}:`);
        block(indent + 1, v as Record<string, unknown>);
      } else {
        push(`${pad}${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`);
      }
    }
  };

  const audit = auditPdmConfig(cfg);
  push(`# K5 PDM30 config — generated ${cfg.metadata.generated_at}`);
  push(`# Spec: ${cfg.metadata.spec_source}`);
  push(`# STATUS: ${cfg.input_pins.length}/16 inputs · ${cfg.output_pins.length}/30 outputs · ${cfg.conditions.length} conditions · ${cfg.counters.length} counters · ${cfg.can_inputs.length} CAN extractions · ${cfg.can_outputs.length} CAN tx · ${cfg.keypad_bindings.length} keypad bindings`);
  push(`# Audit: ${audit.ok ? 'all driven_by symbols resolve' : `UNRESOLVED → ${audit.unresolved.join(', ')}`}`);
  push('');
  block(0, cfg as unknown as Record<string, unknown>);
  return lines.join('\n');
}
