// deriveBodyConfig.ts — pure function: K5Features → { pdm30, pdm15 }.
//
// The K5 PDM configuration becomes the output of a derivation function over
// the K5Features type. Flip features.power_windows from 'electric' to
// 'roller' → re-run the function → get a smaller PdmConfig with the window
// outputs/conditions/counters/keypad bindings dropped.
//
// This is the architectural shift from hand-baked constants to derived
// configuration. Every accessory choice ripples mechanically — no risk of
// forgetting to delete a related condition or counter.
//
// First-pass coverage: I'm gating outputs + condition references on features.
// Conditions for absent outputs are dropped (they'd be unreachable anyway).
// CAN broadcast bytes referencing dropped channels become empty.
//
// Receipt: docs/wiring/receipts/2026-04-25_features-derived-config.md (TODO)

import type {
  PdmConfig, PdmInputPin, PdmOutputPin, PdmCondition, PdmCounter,
  PdmKeypadBinding, PdmCanInput, PdmCanOutput,
} from './generatePdmConfig';
import type { K5Features } from './k5Features';

// ──────────────────────────────────────────────────────────────────────
// Predicate: is this output enabled given current features?
// Each output_pin gets a `requires` predicate. If false, the output and
// every Condition that uniquely supports it gets dropped.
// ──────────────────────────────────────────────────────────────────────
type OutputSpec = PdmOutputPin & {
  requires: (f: K5Features) => boolean;
};

// PDM30 outputs — full list with feature gates
function pdm30Outputs(f: K5Features): PdmOutputPin[] {
  const all: OutputSpec[] = [
    // ── 20A class ─────────────────────────────────────────────────────
    { out: 1, pins: ['A_1','A_10'], device: 'Radiator Fan 1',           max_amps: 20, retries: 3, retry_delay_s: 10, stay_alive: false, driven_by: 'fan1_on',           wire_gauge_awg: 12, requires: () => true },
    { out: 2, pins: ['A_3','A_12'], device: 'Radiator Fan 2',           max_amps: 20, retries: 3, retry_delay_s: 10, stay_alive: false, driven_by: 'fan2_on',           wire_gauge_awg: 12, requires: () => true },
    { out: 3, pins: ['A_5','A_14'], device: 'Window motor L (power)',   max_amps: 16, retries: 1, retry_delay_s:  2, stay_alive: false, driven_by: 'window_L_power',    wire_gauge_awg: 14, requires: f => f.power_windows !== 'roller' },
    { out: 4, pins: ['A_7','A_16'], device: 'Window motor R (power)',   max_amps: 16, retries: 1, retry_delay_s:  2, stay_alive: false, driven_by: 'window_R_power',    wire_gauge_awg: 14, requires: f => f.power_windows !== 'roller' },
    { out: 5, pins: ['A_9','A_17'], device: 'Electric water pump',      max_amps: 15, retries: 3, retry_delay_s:  5, stay_alive: false, driven_by: 'water_pump_on',     wire_gauge_awg: 14, requires: () => true },
    { out: 6, pins: ['B_3','B_9'],  device: 'HVAC blower',              max_amps: 15, retries: 3, retry_delay_s:  5, stay_alive: false, driven_by: 'blower_on',         wire_gauge_awg: 14, requires: f => f.hvac_blower !== 'none' },
    { out: 7, pins: ['B_5','B_11'], device: 'E-Stopp parking brake',    max_amps: 12, retries: 2, retry_delay_s:  3, stay_alive: false, driven_by: 'estopp_pulse',      wire_gauge_awg: 14, requires: f => f.parking_brake === 'estopp' },
    { out: 8, pins: ['B_7','B_13'], device: '12V accessory outlet',     max_amps: 12, retries: 3, retry_delay_s:  3, stay_alive: false, driven_by: 'ignition_run',      wire_gauge_awg: 14, requires: f => f.accessory_outlet_12v },

    // ── 8A class ──────────────────────────────────────────────────────
    { out:  9, pins: ['A_2'],  device: 'Wiper motor (low/common)',                      max_amps: 8, retries: 2, retry_delay_s: 3, stay_alive: false, driven_by: 'wiper_low_drive',   wire_gauge_awg: 16, requires: () => true },
    { out: 10, pins: ['A_4'],  device: 'AMP Step motor R (power)',                      max_amps: 8, retries: 1, retry_delay_s: 3, stay_alive: false, driven_by: 'step_R_power',     wire_gauge_awg: 16, requires: f => f.amp_power_steps },
    { out: 11, pins: ['A_6'],  device: 'AMP Step motor L (power)',                      max_amps: 8, retries: 1, retry_delay_s: 3, stay_alive: false, driven_by: 'step_L_power',     wire_gauge_awg: 16, requires: f => f.amp_power_steps },
    { out: 12, pins: ['A_8'],  device: 'Wiper motor high-speed tap',                    max_amps: 8, retries: 2, retry_delay_s: 3, stay_alive: false, driven_by: 'wiper_high_drive', wire_gauge_awg: 16, requires: () => true },
    { out: 13, pins: ['A_11'], device: 'park/tail/parking group',                       max_amps: 3, retries: 5, retry_delay_s: 3, stay_alive: false, driven_by: 'park_lights_on',   wire_gauge_awg: 18, requires: f => f.headlights !== 'none' },
    { out: 14, pins: ['A_13'], device: 'Horn',                                          max_amps: 6, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'horn_btn.Status',  wire_gauge_awg: 16, requires: () => true },
    { out: 15, pins: ['A_15'], device: 'backup group (3rd brake + 2× backup + cam)',    max_amps: 5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'backup_group_on',  wire_gauge_awg: 16, requires: f => f.reverse_camera || f.headlights !== 'none' },
    { out: 16, pins: ['A_18'], device: 'A/C compressor clutch',                         max_amps: 6, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'ac_clutch_on',     wire_gauge_awg: 16, requires: f => f.ac_compressor },
    { out: 17, pins: ['A_20'], device: 'Headlight L (low beam)',                        max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'headlights_low_on', wire_gauge_awg: 16, requires: f => f.headlights !== 'none' },
    { out: 18, pins: ['A_22'], device: 'Headlight R (low beam)',                        max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'headlights_low_on', wire_gauge_awg: 16, requires: f => f.headlights !== 'none' },
    { out: 19, pins: ['A_24'], device: 'marker/clearance/license group',                max_amps: 3, retries: 5, retry_delay_s: 3, stay_alive: false, driven_by: 'park_lights_on',   wire_gauge_awg: 18, requires: f => f.headlights !== 'none' },
    { out: 20, pins: ['A_25'], device: 'Head unit',                                     max_amps: 5, retries: 2, retry_delay_s: 3, stay_alive: false, driven_by: 'hu_power_on',      wire_gauge_awg: 16, requires: f => f.head_unit !== 'none' },
    { out: 21, pins: ['B_1'],  device: 'Door lock L',                                   max_amps: 5, retries: 1, retry_delay_s: 3, stay_alive: false, driven_by: 'lock_power',       wire_gauge_awg: 16, requires: f => f.power_locks },
    { out: 22, pins: ['B_2'],  device: 'Door lock R',                                   max_amps: 5, retries: 1, retry_delay_s: 3, stay_alive: false, driven_by: 'lock_power',       wire_gauge_awg: 16, requires: f => f.power_locks },
    { out: 23, pins: ['B_4'],  device: 'Trans controller (PCS2800)',                    max_amps: 5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'ignition_run',     wire_gauge_awg: 16, requires: f => f.transmission !== 'manual' },
    { out: 24, pins: ['B_6'],  device: 'Wideband (LTCD)',                               max_amps: 5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'ignition_run',     wire_gauge_awg: 16, requires: () => true },
    { out: 25, pins: ['B_8'],  device: 'Interior courtesy lights',                      max_amps: 4, retries: 3, retry_delay_s: 3, stay_alive: true,  driven_by: 'courtesy_on',      wire_gauge_awg: 16, requires: f => f.interior_courtesy_lights },
    { out: 26, pins: ['B_10'], device: 'Washer pump',                                   max_amps: 4, retries: 2, retry_delay_s: 3, stay_alive: false, driven_by: 'washer_sw.Status', wire_gauge_awg: 18, requires: () => true },
    { out: 27, pins: ['B_12'], device: 'Turn signal L front',                           max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'turn_L_flash',     wire_gauge_awg: 18, requires: () => true },
    { out: 28, pins: ['B_14'], device: 'Turn signal R front',                           max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'turn_R_flash',     wire_gauge_awg: 18, requires: () => true },
    { out: 29, pins: ['B_16'], device: 'Dash display (IGN rail)',                       max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'ignition_run',     wire_gauge_awg: 18, requires: f => f.cluster !== 'none' },
    { out: 30, pins: ['B_19'], device: 'USB charging port',                             max_amps: 3, retries: 3, retry_delay_s: 3, stay_alive: true,  driven_by: 'acc_or_ign',       wire_gauge_awg: 18, requires: f => f.usb_charging },
  ];
  // Strip the predicate before returning — PdmOutputPin doesn't have it
  return all.filter(o => o.requires(f)).map(({ requires: _, ...rest }) => rest);
}

// PDM15 outputs (10 of 15 channels assigned, all gated by features)
function pdm15Outputs(f: K5Features): PdmOutputPin[] {
  const all: OutputSpec[] = [
    { out:  1, pins: ['A1'],  device: 'Window Switch Master Driver', max_amps: 16, retries: 1, retry_delay_s: 2, stay_alive: false, driven_by: 'window_L_power', wire_gauge_awg: 18, requires: f => f.power_windows !== 'roller' },
    { out:  2, pins: ['A2'],  device: 'Window Switch Passenger',     max_amps: 16, retries: 1, retry_delay_s: 2, stay_alive: false, driven_by: 'window_R_power', wire_gauge_awg: 18, requires: f => f.power_windows !== 'roller' },
    { out:  3, pins: ['A3'],  device: 'Cargo/Bed Light',             max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'cargo_light_on', wire_gauge_awg: 20, requires: f => f.cargo_bed_light },
    { out:  4, pins: ['A4'],  device: 'Dakota Digital VHX',          max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'ignition_run_relayed',  wire_gauge_awg: 18, requires: f => f.cluster === 'dakota_vhx' },
    { out:  5, pins: ['A5'],  device: 'Dome + Door Puddle group',    max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: true,  driven_by: 'courtesy_on_relayed',   wire_gauge_awg: 20, requires: f => f.dome_light || f.door_puddle_lights },
    { out:  6, pins: ['A6'],  device: 'Footwell Lights',             max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'courtesy_on_relayed',   wire_gauge_awg: 20, requires: f => f.footwell_lights },
    { out:  7, pins: ['A7'],  device: 'Under-Dash LED',              max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'park_lights_on_relayed', wire_gauge_awg: 20, requires: f => f.under_dash_led },
    { out:  8, pins: ['A8'],  device: 'Cigarette Lighter',           max_amps: 10, retries: 1, retry_delay_s: 5, stay_alive: false, driven_by: 'acc_or_ign_relayed',    wire_gauge_awg: 14, requires: f => f.cigarette_lighter },
    { out:  9, pins: ['A9'],  device: 'USB Charging Port',           max_amps:  5, retries: 3, retry_delay_s: 3, stay_alive: true,  driven_by: 'acc_or_ign_relayed',    wire_gauge_awg: 18, requires: f => f.usb_charging },
    { out: 10, pins: ['A10'], device: 'AM/FM Antenna',               max_amps:  3, retries: 3, retry_delay_s: 3, stay_alive: false, driven_by: 'hu_power_on_relayed',   wire_gauge_awg: 18, requires: f => f.fm_antenna_powered },
  ];
  return all.filter(o => o.requires(f)).map(({ requires: _, ...rest }) => rest);
}

// ──────────────────────────────────────────────────────────────────────
// Derivation impact summary — what changed if you flip a feature
// ──────────────────────────────────────────────────────────────────────
export interface DerivationStats {
  pdm30: { outputs: number; conditions: number; counters: number; keypad: number };
  pdm15: { outputs: number; conditions: number; counters: number; keypad: number };
  total_devices: number;
  approx_wire_ft: number;
  approx_cost_usd: number;
}

export function computeStats(pdm30: PdmConfig, pdm15: PdmConfig): DerivationStats {
  // Crude wire estimate: 8 ft per output (typical mid-truck run with service loop).
  const totalOutputs = pdm30.output_pins.length + pdm15.output_pins.length;
  const wireFt = totalOutputs * 8;
  // Crude cost: $1.40/ft wire + ~$15/output for terminals/seals + base PDM cost.
  const costUsd = Math.round(wireFt * 1.40 + totalOutputs * 15);
  return {
    pdm30: {
      outputs: pdm30.output_pins.length,
      conditions: pdm30.conditions.length,
      counters: pdm30.counters.length,
      keypad: pdm30.keypad_bindings.length,
    },
    pdm15: {
      outputs: pdm15.output_pins.length,
      conditions: pdm15.conditions.length,
      counters: pdm15.counters.length,
      keypad: pdm15.keypad_bindings.length,
    },
    total_devices: totalOutputs,
    approx_wire_ft: wireFt,
    approx_cost_usd: costUsd,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Top-level: derive both PDMs from a Features struct
//
// First-pass scope: outputs are derived from features. Conditions, counters,
// keypad bindings, CAN inputs are still pulled from the existing
// generatePdmConfig.ts arrays — but FILTERED to drop entries that reference
// channels no longer driven by any output.
//
// This means flipping `power_windows: 'roller'` removes:
//   - 4 outputs (PDM30 OUT3+OUT4, PDM15 OUT1+OUT2)
//   - the window_L_power and window_R_power conditions (no consumer)
//   - the window_L_cycle_count and window_R_cycle_count counters (source gone)
//   - the keypad_btn_all_windows_down/up bindings (no consumer)
//   - the K5_body_state CAN byte slots that referenced step_*_state etc.
// ──────────────────────────────────────────────────────────────────────

import { generatePdmConfig } from './generatePdmConfig';
import { generatePdm15Config } from './generatePdm15Config';

export function deriveBodyConfig(f: K5Features, vehicleName: string): { pdm30: PdmConfig; pdm15: PdmConfig; stats: DerivationStats } {
  // Start from the as-built configs
  const pdm30 = generatePdmConfig(vehicleName, []);
  const pdm15 = generatePdm15Config(vehicleName);

  // Override output pins with feature-gated derivation
  pdm30.output_pins = pdm30Outputs(f);
  pdm15.output_pins = pdm15Outputs(f);

  // Compute the set of channels still consumed by any output (or by any
  // condition that's still in scope). Drop everything else.
  const outputDrivers = new Set<string>();
  for (const o of pdm30.output_pins) outputDrivers.add(stripAccessor(o.driven_by));
  for (const o of pdm15.output_pins) outputDrivers.add(stripAccessor(o.driven_by));

  // Walk Conditions transitively — a Condition stays if it's an output
  // driver OR if it's referenced by another live Condition. Iterate until
  // closure (the dependency graph is small, converges in 2-3 passes).
  const liveConditions = new Set<string>(outputDrivers);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of pdm30.conditions) {
      if (liveConditions.has(c.name)) {
        for (const ref of extractRefs(c.expression)) {
          if (!liveConditions.has(ref)) { liveConditions.add(ref); changed = true; }
        }
      }
    }
    for (const c of pdm15.conditions) {
      if (liveConditions.has(c.name)) {
        for (const ref of extractRefs(c.expression)) {
          if (!liveConditions.has(ref)) { liveConditions.add(ref); changed = true; }
        }
      }
    }
  }

  pdm30.conditions = pdm30.conditions.filter(c => liveConditions.has(c.name));
  pdm15.conditions = pdm15.conditions.filter(c => liveConditions.has(c.name));

  // Counters: keep only counters whose source channel is still live
  pdm30.counters = pdm30.counters.filter(c => liveConditions.has(stripAccessor(c.source)));
  pdm15.counters = pdm15.counters.filter(c => liveConditions.has(stripAccessor(c.source)));

  // Keypad bindings: keep only actions still consumed somewhere (in a Condition or as an output driver)
  pdm30.keypad_bindings = pdm30.keypad_bindings.filter(k => liveConditions.has(k.action) || outputDrivers.has(k.action));

  // CAN inputs: keep extractions still consumed
  pdm30.can_inputs = pdm30.can_inputs.filter(c => liveConditions.has(c.name));
  pdm15.can_inputs = pdm15.can_inputs.filter(c => liveConditions.has(c.name));

  // CAN outputs: blank out byte slots whose channel was dropped
  for (const co of pdm30.can_outputs) {
    co.bytes = co.bytes.filter(b => liveConditions.has(stripAccessor(b.channel)));
  }
  for (const co of pdm15.can_outputs) {
    co.bytes = co.bytes.filter(b => liveConditions.has(stripAccessor(b.channel)));
  }

  // Apply feature-driven runtime tweaks
  // - Hazard gesture: drop both_stalks references if disabled
  if (!f.hazard_via_both_stalks) {
    const cond = pdm30.conditions.find(c => c.name === 'hazard_override');
    if (cond) cond.expression = 'hazard_sw.Status';
  }
  // - Engine running RPM threshold
  const er = pdm30.conditions.find(c => c.name === 'engine_running');
  if (er) er.expression = `engine_rpm Greater_than ${f.engine_running_threshold_rpm}`;

  return { pdm30, pdm15, stats: computeStats(pdm30, pdm15) };
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────
const ACCESSOR_SUFFIXES = ['.Status','.Voltage','.rising_edge','.falling_edge','.expired','.Active','.Current','.Error'];
function stripAccessor(s: string): string {
  let out = s.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const sfx of ACCESSOR_SUFFIXES) {
      if (out.endsWith(sfx)) { out = out.slice(0, -sfx.length); changed = true; break; }
    }
  }
  return out;
}
function extractRefs(expression: string): string[] {
  const reserved = new Set([
    'NOT','AND','OR','TRUE','FALSE','PULSE','FLASH','SET_RESET','HYSTERESIS','TOGGLE','COUNTER','PACK','CAN_RELAY','CAN_LINK_OK','AND_BITMASK',
    'Equal_to','Greater_than','Less_than','Not_equal_to',
    'input','set','reset','width','on_time','off_time','rise_delay','fall_delay','overflow_at','ms','expired','rising_edge','falling_edge','Status','Voltage','Active','Current','Error',
  ]);
  const re = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) !== null) {
    const tok = m[0];
    if (reserved.has(tok)) continue;
    if (/^\d/.test(tok)) continue;
    if (/^x[0-9a-fA-F]+$/.test(tok)) continue;
    out.add(stripAccessor(tok));
  }
  return Array.from(out);
}
