// generatePdm15Config.ts — PDM Manager–importable YAML for the K5's PDM15.
//
// The PDM15 is the second body PDM. It owns 10 of its 15 outputs (cabin /
// cargo lighting, windows, gauges, USB, antenna, cig lighter) and shares the
// 500 kbps · 0x300-base CAN bus with the PDM30. Most decisions are broadcast
// by the PDM30 on 0x320 (K5_body_state) and the PDM15 follows.
//
// Source-of-truth for output assignments: live DB query
//   SELECT * FROM wiring_tech_pdm_channel_map(K5_ID) WHERE pdm='PDM15'
// Source-of-truth for emitter behavior: same as PDM30
//   docs/wiring/output/K5_PDM30_config_spec.md (operator semantics, conditions
//   that PDM15 listens to over CAN)
// Receipt: docs/wiring/receipts/2026-04-24_pdm15-emitter.md
//
// PDM15 has its own 16 switch inputs (B1..B16) and 15 output pins (A1..A8 are
// 20A class, A9..A15 are 8A class). For the K5 today the 16 switch inputs are
// not yet authored — every output is driven by either a CAN-relayed channel
// from the PDM30 or a directly-followed condition. Two outputs are stay-alive:
// USB charging (so phones charge overnight) and dome/puddle group (so a door
// open with ignition off lights the cabin via PDM30 → CAN → PDM15 wake).

import type {
  PdmConfig, PdmInputPin, PdmOutputPin, PdmCanInput, PdmCanOutput,
  PdmCondition, PdmCounter, PdmKeypadBinding,
} from './generatePdmConfig';

// ──────────────────────────────────────────────────────────────────────
// Inputs — none authored yet; window-switch routing is on PDM30 input map
// per K5_PDM30_config_spec.md §2 today. If Skylar moves the master/passenger
// window switches to PDM15 inputs B1/B2, add them here.
// ──────────────────────────────────────────────────────────────────────
const PDM15_INPUT_PINS: PdmInputPin[] = [];

// ──────────────────────────────────────────────────────────────────────
// Outputs §3 — 10 of 15 PDM15 channels assigned. Pulled from DB via
// wiring_tech_pdm_channel_map(K5_ID); transcribed at receipt time
// (2026-04-24). Channels CH11-CH15 reserved for future expansion.
// ──────────────────────────────────────────────────────────────────────
const PDM15_OUTPUT_PINS: PdmOutputPin[] = [
  // ── 20A class (A1-A8, dual-pin parallel where load demands) ───────
  { out:  1, pins: ['A1'], device: 'Window Switch Master Driver',     max_amps: 16, retries: 1, retry_delay_s: 2, stay_alive: false, driven_by: 'window_L_power',           wire_gauge_awg: 18, notes: 'wire 18 today; upgrade to 14 if continuous draw exceeds 10A' },
  { out:  2, pins: ['A2'], device: 'Window Switch Passenger',         max_amps: 16, retries: 1, retry_delay_s: 2, stay_alive: false, driven_by: 'window_R_power',           wire_gauge_awg: 18 },
  { out:  3, pins: ['A3'], device: 'Cargo/Bed Light',                 max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'cargo_light_on',           wire_gauge_awg: 20 },
  { out:  4, pins: ['A4'], device: 'Dakota Digital VHX (cluster)',    max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'ignition_run_relayed',     wire_gauge_awg: 18 },
  { out:  5, pins: ['A5'], device: 'Dome + Door Puddle L + Door Puddle R (group)', max_amps: 5, retries: 3, retry_delay_s: 3, stay_alive: true, driven_by: 'courtesy_on_relayed', wire_gauge_awg: 20, notes: 'stay-alive so PDM30 door-open broadcast lights cabin' },
  { out:  6, pins: ['A6'], device: 'Footwell Lights',                 max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'courtesy_on_relayed',      wire_gauge_awg: 20 },
  { out:  7, pins: ['A7'], device: 'Under-Dash LED',                  max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'park_lights_on_relayed',   wire_gauge_awg: 20, notes: 'on with parking lights for night ambience' },
  { out:  8, pins: ['A8'], device: 'Cigarette Lighter',               max_amps: 10, retries: 1, retry_delay_s: 5, stay_alive: false, driven_by: 'acc_or_ign_relayed',       wire_gauge_awg: 14 },
  // ── 8A class (A9-A15) ─────────────────────────────────────────────
  { out:  9, pins: ['A9'],  device: 'USB Charging Port',              max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: true,  driven_by: 'acc_or_ign_relayed',       wire_gauge_awg: 18, notes: 'stay-alive; phone overnight charging' },
  { out: 10, pins: ['A10'], device: 'AM/FM Antenna (powered)',        max_amps:  3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'hu_power_on_relayed',      wire_gauge_awg: 18 },
  // CH11-CH15: reserved for future loads. Left intentionally absent.
];

// ──────────────────────────────────────────────────────────────────────
// CAN Inputs §4 — listen to PDM30 broadcasts. Per Manual p.36, max 4
// message slots. We use 2: K5_body_state (0x320) + K5_brake_status (0x321).
// Both are user-defined messages broadcast by the PDM30 at 50 Hz when
// ignition_run is active.
// ──────────────────────────────────────────────────────────────────────
const PDM15_CAN_INPUTS: PdmCanInput[] = [
  // K5_body_state @ 0x320 (PDM30 §6.2 message 1)
  { slot: 1, can_id: '0x320', name: 'lights_state_packed',     byte_offset: 0, size_bits: 8, signed: false, mask: '0xFF', timeout_ms: 200, fail_value: 0 },
  { slot: 1, can_id: '0x320', name: 'flasher_state_packed',    byte_offset: 1, size_bits: 8, signed: false, mask: '0x03', timeout_ms: 200, fail_value: 0 },
  { slot: 1, can_id: '0x320', name: 'brake_active_relayed',    byte_offset: 2, size_bits: 8, signed: false, mask: '0x01', timeout_ms: 200, fail_value: 0 },
  { slot: 1, can_id: '0x320', name: 'lock_state_relayed',      byte_offset: 3, size_bits: 8, signed: false, mask: '0x01', timeout_ms: 200, fail_value: 0 },
  { slot: 1, can_id: '0x320', name: 'courtesy_on_relayed',     byte_offset: 5, size_bits: 8, signed: false, mask: '0x01', timeout_ms: 200, fail_value: 0 },
  { slot: 1, can_id: '0x320', name: 'hu_amp_state_packed',     byte_offset: 6, size_bits: 8, signed: false, mask: '0x03', timeout_ms: 200, fail_value: 0 },
  // K5_brake_status @ 0x321
  { slot: 2, can_id: '0x321', name: 'brake_driver_applied_relayed', byte_offset: 0, size_bits: 8, signed: false, mask: '0xFF', timeout_ms: 200, fail_value: 0 },
  { slot: 2, can_id: '0x321', name: 'gear_packed',                  byte_offset: 3, size_bits: 8, signed: false, mask: '0xFF', timeout_ms: 200, fail_value: 0 },
];

// ──────────────────────────────────────────────────────────────────────
// CAN Outputs §6 — PDM15 health back to the bus so PDM30 can roll it up
// into overall_health_byte. Different base address from PDM30's 0x320/0x321.
// ──────────────────────────────────────────────────────────────────────
const PDM15_CAN_OUTPUTS: PdmCanOutput[] = [
  {
    slot: 1, can_id: '0x340', rate_hz: 20, transmit_when: 'ignition_run_relayed',
    bytes: [
      { byte: 0, channel: 'pdm15_outputs_state' },     // 10 output bits packed
      { byte: 1, channel: 'pdm15_flags_byte' },        // overcurrent / retry / standby flags
      { byte: 2, channel: 'pdm15_battery_voltage' },   // built-in PDM voltage broadcast
      { byte: 3, channel: 'pdm15_internal_temp_c' },   // built-in PDM temp broadcast
      { byte: 4, channel: 'window_L_cycle_count_pdm15' },
      { byte: 5, channel: 'window_R_cycle_count_pdm15' },
      { byte: 6, channel: 'reserved' },
      { byte: 7, channel: 'pdm15_health_byte' },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────
// Conditions §5 — PDM15 is a CAN follower. Most "logic" is just unpacking
// CAN bytes into channels the outputs can reference. ~12 ops total.
// ──────────────────────────────────────────────────────────────────────
const PDM15_CONDITIONS: PdmCondition[] = [
  // Unpack PDM30 broadcast lights_state byte (4 bits used: park, head, hazard, high)
  { name: 'park_lights_on_relayed',   expression: 'lights_state_packed AND_BITMASK 0x01' },
  { name: 'headlights_low_on_relayed',expression: 'lights_state_packed AND_BITMASK 0x02' },
  { name: 'hazard_override_relayed',  expression: 'lights_state_packed AND_BITMASK 0x04' },
  { name: 'high_beam_output_relayed', expression: 'lights_state_packed AND_BITMASK 0x08' },
  // Unpack hu/amp packed byte
  { name: 'hu_power_on_relayed',      expression: 'hu_amp_state_packed AND_BITMASK 0x01' },
  { name: 'amp_remote_on_relayed',    expression: 'hu_amp_state_packed AND_BITMASK 0x02' },
  // ignition_run isn't directly broadcast — derived from any active-bit of K5_body_state
  // (PDM30 only transmits this message when ignition_run is true per §6 transmit gate).
  { name: 'ignition_run_relayed',     expression: 'CAN_LINK_OK(0x320)' },
  { name: 'acc_or_ign_relayed',       expression: 'ignition_run_relayed OR keypad_btn_acc_relayed', note: 'keypad_btn_acc not broadcast yet — reduces to ignition_run_relayed in MVP' },
  { name: 'keypad_btn_acc_relayed',   expression: 'FALSE', note: 'placeholder until PDM30 adds keypad button bits to its CAN tx' },
  // Reverse-derived for cargo light auto-on (handy when bed-loading at night)
  { name: 'in_reverse_relayed',       expression: 'gear_packed Equal_to 6' },
  { name: 'cargo_light_on',           expression: 'in_reverse_relayed OR keypad_btn_cargo_light_relayed' },
  { name: 'keypad_btn_cargo_light_relayed', expression: 'FALSE', note: 'future keypad page-2 button — placeholder' },
  // Window power — local switches on PDM15 inputs B1/B2 not yet wired. Until then,
  // gate by ignition. When window switches arrive on B1/B2, replace with
  // window_L_local_sw.Status / window_R_local_sw.Status references.
  { name: 'window_L_power',           expression: 'FALSE', note: 'placeholder — window switch wiring on PDM15 input B1 pending' },
  { name: 'window_R_power',           expression: 'FALSE', note: 'placeholder — window switch wiring on PDM15 input B2 pending' },
  // Health rollup
  { name: 'pdm15_outputs_state',      expression: 'PACK(out1..out10 status bits)', note: 'auto-broadcast via Standard messages too — this is the user-defined mirror' },
  { name: 'pdm15_flags_byte',         expression: 'PACK(any_overcurrent, any_retry_active, standby_mode, can_link_ok, 4 spare)' },
  { name: 'pdm15_health_byte',        expression: 'pdm15_flags_byte Equal_to 0x08', note: 'health-OK = only can_link_ok bit set' },
];

// ──────────────────────────────────────────────────────────────────────
// Counters — minimal. PDM30 already counts most cycles. PDM15 keeps its
// own window-power counters since the window outputs live here.
// ──────────────────────────────────────────────────────────────────────
const PDM15_COUNTERS: PdmCounter[] = [
  { name: 'window_L_cycle_count_pdm15', source: 'window_L_power', on_edge: 'falling', overflow_at: 65535 },
  { name: 'window_R_cycle_count_pdm15', source: 'window_R_power', on_edge: 'falling', overflow_at: 65535 },
];

// PDM15 has no keypad — single keypad architecture owned by the PDM30.
const PDM15_KEYPAD: PdmKeypadBinding[] = [];

// ──────────────────────────────────────────────────────────────────────
// Emitter
// ──────────────────────────────────────────────────────────────────────

export function generatePdm15Config(vehicleName: string): PdmConfig {
  return {
    metadata: {
      pdm_type: 'PDM15',
      vehicle: vehicleName,
      spec_source: 'docs/wiring/output/K5_PDM30_config_spec.md (shared bus) + DB rows wiring_tech_pdm_channel_map WHERE pdm=PDM15',
      generated_at: new Date().toISOString(),
    },
    global: {
      can_bitrate_kbps: 500,
      can_base_address: '0x340',
      transmit_channel: 'ignition_run_relayed',
      keypad_count: 0,
      keypad_bitrate_kbps: 500,
      password_protected: true,
    },
    input_pins: PDM15_INPUT_PINS,
    output_pins: PDM15_OUTPUT_PINS,
    can_inputs: PDM15_CAN_INPUTS,
    can_outputs: PDM15_CAN_OUTPUTS,
    conditions: PDM15_CONDITIONS,
    counters: PDM15_COUNTERS,
    keypad_bindings: PDM15_KEYPAD,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Static audit — same shape as PDM30 emitter. Cross-PDM CAN-relayed
// channels resolve via the *_relayed naming convention; everything else
// must be a defined Condition/Counter or a built-in accessor.
// ──────────────────────────────────────────────────────────────────────

const PDM15_INPUT_NAMES = new Set(PDM15_INPUT_PINS.map(p => p.channel_name));
const PDM15_CAN_NAMES   = new Set(PDM15_CAN_INPUTS.map(c => c.name));
const PDM15_CONDITION_NAMES = new Set(PDM15_CONDITIONS.map(c => c.name));
const PDM15_COUNTER_NAMES   = new Set(PDM15_COUNTERS.map(c => c.name));

const ACCESSOR_SUFFIXES = ['.Status', '.Voltage', '.rising_edge', '.falling_edge', '.expired'];

function stripAccessor(symbol: string): string {
  let s = symbol.trim();
  for (const sfx of ACCESSOR_SUFFIXES) {
    if (s.endsWith(sfx)) { s = s.slice(0, -sfx.length); break; }
  }
  return s;
}

export function auditPdm15Config(cfg: PdmConfig): { unresolved: string[]; ok: boolean } {
  const defined = new Set<string>([
    ...PDM15_INPUT_NAMES, ...PDM15_CAN_NAMES,
    ...PDM15_CONDITION_NAMES, ...PDM15_COUNTER_NAMES,
  ]);
  const refs: string[] = [];
  for (const o of cfg.output_pins) refs.push(o.driven_by);
  for (const co of cfg.can_outputs) for (const b of co.bytes) refs.push(b.channel);

  const unresolved: string[] = [];
  for (const ref of refs) {
    const base = stripAccessor(ref);
    if (/^\s*(CAN_RELAY|CAN_LINK_OK|PACK|PULSE|FLASH|SET_RESET|HYSTERESIS|TOGGLE|COUNTER)\(/.test(base)) continue;
    if (/Equal_to|Greater_than|Less_than|Not_equal_to|AND_BITMASK/.test(base)) continue;
    if (defined.has(base)) continue;
    if (base === 'TRUE' || base === 'FALSE' || base === 'reserved') continue;
    // PDM auto-broadcasts these per Manual p.51-57 (Standard messages).
    if (/^pdm15_(battery_voltage|internal_temp_c|outputs_state|flags_byte|health_byte)$/.test(base)) continue;
    unresolved.push(ref);
  }
  return { unresolved, ok: unresolved.length === 0 };
}

// ──────────────────────────────────────────────────────────────────────
// YAML preview — shares conventions with pdmConfigToYaml() in PDM30 emitter.
// ──────────────────────────────────────────────────────────────────────
export function pdm15ConfigToYaml(cfg: PdmConfig): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);
  const block = (indent: number, obj: Record<string, unknown>) => {
    const pad = '  '.repeat(indent);
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        if (v.length === 0) { push(`${pad}${k}: []`); continue; }
        push(`${pad}${k}:`);
        for (const item of v) push(`${pad}  - ${JSON.stringify(item)}`);
      } else if (typeof v === 'object' && v !== null) {
        push(`${pad}${k}:`);
        block(indent + 1, v as Record<string, unknown>);
      } else {
        push(`${pad}${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`);
      }
    }
  };

  const audit = auditPdm15Config(cfg);
  push(`# K5 PDM15 config — generated ${cfg.metadata.generated_at}`);
  push(`# Spec: ${cfg.metadata.spec_source}`);
  push(`# STATUS: ${cfg.input_pins.length}/16 inputs · ${cfg.output_pins.length}/15 outputs · ${cfg.conditions.length} conditions · ${cfg.counters.length} counters · ${cfg.can_inputs.length} CAN extractions · ${cfg.can_outputs.length} CAN tx`);
  push(`# Audit: ${audit.ok ? 'all driven_by symbols resolve' : `UNRESOLVED → ${audit.unresolved.join(', ')}`}`);
  push(`# Architecture: CAN follower of PDM30 (listens on 0x320/0x321, broadcasts on 0x340)`);
  push('');
  block(0, cfg as unknown as Record<string, unknown>);
  return lines.join('\n');
}
