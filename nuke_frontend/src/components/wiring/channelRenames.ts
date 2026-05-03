// channelRenames.ts — flat channel names → hierarchical dot-path names.
//
// PDM Manager's Channels tree pane groups channels by dot-separated prefix:
//   fuelpump.lift.output    → fuelpump → lift → output
//   lights.turn.left.flash  → lights → turn → left → flash
//
// This makes the Channels picker (right side of the Output Pin Properties
// dialog, etc.) navigable as a tree. Flat names like ignition_run all dump
// into one ungrouped flat list and become un-searchable.
//
// This map is applied at emit time only — internal code keeps the flat names
// for stability + readability. The XML and YAML output use the renamed
// dotted form.

export const CHANNEL_RENAMES: Record<string, string> = {
  // ── ignition / power ───────────────────────────────────────────────
  ignition_run:            'ignition.run',
  ignition_off:            'ignition.off',
  acc_or_ign:              'ignition.acc_or_run',
  acc_or_ign_relayed:      'ignition.acc_or_run.relayed',
  ignition_run_relayed:    'ignition.run.relayed',

  // ── lighting ────────────────────────────────────────────────────────
  headlight_park_sw:       'lights.park.switch',
  headlight_head_sw:       'lights.head.switch',
  park_lights_on:          'lights.park.on',
  park_lights_on_relayed:  'lights.park.on.relayed',
  headlights_low_on:       'lights.head.low.on',
  headlights_low_on_relayed: 'lights.head.low.on.relayed',
  high_beam_steady:        'lights.head.high.steady',
  high_beam_flash:         'lights.head.high.flash',
  high_beam_output:        'lights.head.high.on',
  high_beam_output_relayed: 'lights.head.high.on.relayed',
  high_beam_detent_sw:     'lights.head.high.detent.switch',
  flash_to_pass_sw:        'lights.head.flash_to_pass.switch',
  turn_left_sw:            'lights.turn.left.switch',
  turn_right_sw:           'lights.turn.right.switch',
  turn_L_flash:            'lights.turn.left.flash',
  turn_R_flash:            'lights.turn.right.flash',
  turn_L_final:            'lights.turn.left.out',
  turn_R_final:            'lights.turn.right.out',
  hazard_sw:               'lights.hazard.switch',
  hazard_override:         'lights.hazard.on',
  hazard_override_relayed: 'lights.hazard.on.relayed',
  both_stalks:             'lights.turn.both',
  flasher_state:           'lights.flasher.state',
  lights_state:            'lights.state',
  lights_state_packed:     'lights.state.packed',
  lights_were_on:          'lights.were_on',
  lights_off_trigger:      'lights.off_trigger',
  courtesy_timer_fire:     'lights.courtesy.timer',
  courtesy_hold_active:    'lights.courtesy.hold',
  courtesy_off_delay:      'lights.courtesy.delay',
  courtesy_on:             'lights.courtesy.on',
  courtesy_on_relayed:     'lights.courtesy.on.relayed',
  backup_group_on:         'lights.backup.on',
  cargo_light_on:          'lights.cargo.on',

  // ── doors + locks ──────────────────────────────────────────────────
  door_left_sw:            'doors.left.switch',
  door_right_sw:           'doors.right.switch',
  door_any_open:           'doors.any_open',
  driver_door_open:        'doors.driver_open',
  lock_sw:                 'locks.command.lock',
  unlock_sw:               'locks.command.unlock',
  lock_cmd:                'locks.cmd.lock',
  unlock_cmd:              'locks.cmd.unlock',
  lock_cmd_gated:          'locks.cmd.gated',
  lock_polarity:           'locks.polarity',
  lock_power:              'locks.power',
  lock_state:              'locks.state',
  lock_state_relayed:      'locks.state.relayed',

  // ── audio ──────────────────────────────────────────────────────────
  horn_btn:                'audio.horn.button',
  hu_power_target:         'audio.hu.power_target',
  hu_power_on:             'audio.hu.power',
  hu_power_on_relayed:     'audio.hu.power.relayed',
  hu_mute:                 'audio.hu.mute',
  amp_remote_on:           'audio.amp.remote',
  amp_remote_on_relayed:   'audio.amp.remote.relayed',
  hu_amp_state_packed:     'audio.state.packed',

  // ── cameras ────────────────────────────────────────────────────────
  cam_hold_timer:          'camera.rear.hold',
  head_unit_camera_request: 'camera.rear.hu_request',
  front_cam_on:            'camera.front.on',
  front_cam_auto_off:      'camera.front.timeout',

  // ── brakes ─────────────────────────────────────────────────────────
  brake_sw:                'brakes.switch',
  brake_active:            'brakes.active',
  brake_active_relayed:    'brakes.active.relayed',
  ibooster_fault:          'brakes.ibooster.fault',
  ibooster_alert_any:      'brakes.ibooster.alert',
  ibooster_can_lost:       'brakes.ibooster.can_lost',
  ibooster_internal_state: 'brakes.ibooster.internal_state',
  ibooster_alert_bits:     'brakes.ibooster.alert_bits',
  ibooster_link_ok:        'pdm.can.ibooster.ok',
  brake_driver_applied:    'brakes.driver_applied',
  brake_driver_applied_relayed: 'brakes.driver_applied.relayed',
  brake_warning_lamp:      'brakes.warning_lamp',
  parking_brake_engaged:   'brakes.parking.engaged',
  estopp_pulse:            'brakes.parking.actuation',

  // ── drivetrain ─────────────────────────────────────────────────────
  reverse_sw:              'drivetrain.reverse.switch',
  in_reverse:              'drivetrain.gear.reverse',
  in_reverse_relayed:      'drivetrain.gear.reverse.relayed',
  in_park:                 'drivetrain.gear.park',
  in_neutral:              'drivetrain.gear.neutral',
  reverse_active:          'drivetrain.reverse.active',
  current_gear:            'drivetrain.gear.current',
  gear_packed:             'drivetrain.gear.packed',
  lever_position:          'drivetrain.gear.lever',
  neutral_safety_ok:       'drivetrain.neutral_safety',

  // ── AMP power steps ────────────────────────────────────────────────
  step_L_deploy_trigger:   'steps.left.deploy',
  step_L_retract_trigger:  'steps.left.retract',
  step_L_retract_trigger_delayed: 'steps.left.retract_delayed',
  step_L_power:            'steps.left.power',
  step_L_polarity:         'steps.left.polarity',
  step_L_state:            'steps.left.state',
  step_R_deploy_trigger:   'steps.right.deploy',
  step_R_retract_trigger:  'steps.right.retract',
  step_R_retract_trigger_delayed: 'steps.right.retract_delayed',
  step_R_power:            'steps.right.power',
  step_R_polarity:         'steps.right.polarity',
  step_R_state:            'steps.right.state',

  // ── windows ────────────────────────────────────────────────────────
  window_L_power:          'windows.left.power',
  window_R_power:          'windows.right.power',

  // ── HVAC + climate ─────────────────────────────────────────────────
  blower_on:               'climate.blower.on',
  ac_clutch_on:            'climate.ac.clutch',
  ac_hp_switch_ok:         'climate.ac.hp_switch_ok',

  // ── engine + cooling ───────────────────────────────────────────────
  engine_rpm:              'engine.rpm',
  engine_coolant_c:        'engine.coolant_c',
  engine_running:          'engine.running',
  fuel_prime_pulse:        'engine.fuel.prime_pulse',
  fuel_pump_latch:         'engine.fuel.pump_latch',
  fuel_pump_relay:         'engine.fuel.pump',
  fan1_on:                 'cooling.fan1.on',
  fan2_on:                 'cooling.fan2.on',
  water_pump_on:           'cooling.water_pump.on',
  ecu_fan1_request:        'ecu.fan1_request',
  ecu_fan2_request:        'ecu.fan2_request',
  ecu_water_pump_request:  'ecu.water_pump_request',
  ecu_ac_request:          'ecu.ac_request',

  // ── wipers + washer ────────────────────────────────────────────────
  wiper_low_sw:            'wipers.command.low',
  wiper_high_sw:           'wipers.command.high',
  wiper_switch_off_edge:   'wipers.command.off_edge',
  wiper_park_sw:           'wipers.parking.switch',
  wiper_parking_hold:      'wipers.parking.hold',
  wiper_low_drive:         'wipers.low.drive',
  wiper_high_drive:        'wipers.high.drive',
  washer_sw:               'wipers.washer.switch',
  washer_wipe_active:      'wipers.washer.active',
  washer_wipe_counter:     'wipers.washer.counter',

  // ── PDM aggregate / health ─────────────────────────────────────────
  master_retry_active:     'pdm.master_retry',
  standby_mode:            'pdm.standby',
  can_link_ok:             'pdm.can.ok',
  pcs_link_ok:             'pdm.can.pcs.ok',
  m130_link_ok:            'pdm.can.ecu.ok',
  keypad_link_ok:          'pdm.can.keypad.ok',
  global_error:            'pdm.global_error',
  pdm_outputs_bank_1_state: 'pdm.outputs.bank.1',
  pdm_outputs_bank_2_state: 'pdm.outputs.bank.2',
  pdm_outputs_bank_3_state: 'pdm.outputs.bank.3',
  pdm_outputs_bank_4_state: 'pdm.outputs.bank.4',
  pdm_flags_byte:          'pdm.flags',
  overall_health_byte:     'pdm.health',
  pdm15_outputs_state:     'pdm15.outputs.state',
  pdm15_flags_byte:        'pdm15.flags',
  pdm15_health_byte:       'pdm15.health',
  pdm15_battery_voltage:   'pdm15.battery_voltage',
  pdm15_internal_temp_c:   'pdm15.temp',

  // ── counters ───────────────────────────────────────────────────────
  window_L_cycle_count:    'windows.left.count',
  window_R_cycle_count:    'windows.right.count',
  window_L_cycle_count_pdm15: 'pdm15.windows.left.count',
  window_R_cycle_count_pdm15: 'pdm15.windows.right.count',
  horn_cycle_count:        'audio.horn.count',
  lock_cycle_count:        'locks.count',
  headlight_cycle_count:   'lights.head.count',
  brake_cycle_count:       'brakes.count',
  hazard_cycle_count:      'lights.hazard.count',
  turn_L_count:            'lights.turn.left.count',
  turn_R_count:            'lights.turn.right.count',
  estopp_cycle_count:      'brakes.parking.count',

  // ── keypad ──────────────────────────────────────────────────────────
  keypad_btn_acc:          'keypad.acc',
  keypad_btn_acc_relayed:  'keypad.acc.relayed',
  keypad_btn_lock_toggle:  'keypad.lock_toggle',
  keypad_btn_lights_toggle: 'keypad.lights_toggle',
  keypad_btn_hazards_toggle: 'keypad.hazards_toggle',
  keypad_btn_front_cam:    'keypad.front_cam',
  keypad_btn_rear_cam_manual: 'keypad.rear_cam',
  keypad_btn_fan_override: 'keypad.fan_override',
  keypad_btn_fan_max:      'keypad.fan_max',
  keypad_btn_all_windows_down: 'keypad.windows_down',
  keypad_btn_all_windows_up:   'keypad.windows_up',
  keypad_btn_valet_toggle: 'keypad.valet_toggle',
  keypad_btn_panic:        'keypad.panic',
  keypad_btn_horn_chirp:   'keypad.horn_chirp',
  keypad_btn_horn_long:    'keypad.horn_long',
  keypad_btn_parking_brake_toggle: 'keypad.parking_brake',
  keypad_btn_blower_toggle: 'keypad.blower_toggle',
  keypad_btn_cargo_light_relayed: 'keypad.cargo_light.relayed',
  keypad_button_master_retry: 'keypad.master_retry',
};

/**
 * PDM Manager channel names are letters + dots only — no underscores.
 * Convert any snake_case segments to camelCase. Example:
 *   "ignition.acc_or_run" → "ignition.accOrRun"
 *   "lights.off_trigger"  → "lights.offTrigger"
 *   "doors.driver_open"   → "doors.driverOpen"
 *
 * Accessor suffixes (.Status, .Voltage, .Status.Active etc.) are PDM Manager's
 * own — don't touch.
 */
function snakeToCamel(name: string): string {
  return name.split('.').map(seg => {
    if (!seg.includes('_')) return seg;
    return seg.split('_').map((p, i) => i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)).join('');
  }).join('.');
}

// Real PDM Manager channel accessor suffixes (per Sample_PDM15.pdm).
// These exist as actual sub-channels and may appear after a base channel name.
const REAL_ACCESSORS = ['.Status', '.Voltage', '.Active', '.Current', '.Load', '.Status.Active', '.Status.Fault', '.Status.Over Current', '.Status.Retries Done'];

// Pseudo-accessors used in MY spec/condition expressions but NOT in PDM Manager.
// Things like .rising_edge / .falling_edge / .expired are operator behaviors
// (handled via Operation Edge field), NOT channel sub-references. Strip them
// when emitting — Dave authors the proper PULSE/FLASH/edge-detect operator
// in the GUI.
const PSEUDO_ACCESSORS = ['.rising_edge', '.falling_edge', '.expired'];

function stripPseudoAccessors(s: string): string {
  let out = s;
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of PSEUDO_ACCESSORS) {
      if (out.endsWith(a)) { out = out.slice(0, -a.length); changed = true; break; }
    }
  }
  return out;
}

function splitOffRealAccessor(s: string): { base: string; accessor: string } {
  // Strip the longest real accessor suffix that matches; collect into accessor.
  let base = s;
  let accessor = '';
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of REAL_ACCESSORS) {
      if (base.endsWith(a)) {
        accessor = a + accessor;
        base = base.slice(0, -a.length);
        changed = true;
        break;
      }
    }
  }
  return { base, accessor };
}

/**
 * Dave's (Desert Performance) hierarchical naming convention.
 *
 * VERIFIED 2026-04-25 against JBS Motorsport reference .pdm file
 * (Racer 6100 Front, Container Version="5", PDMType=2/PDM30).
 *
 * Pattern:  {DeviceName}.{Layer}.{Category}.{Subsystem}.{State}
 *   - DeviceName uses SPACE: "PDM" or "PDM Front" / "PDM Rear" in multi-PDM systems
 *   - TitleCase with spaces allowed: "Engine Oil", "Fuel Pump", "Status Light"
 *   - Status nests: ".Status.Active" / ".Status.Fault" / ".Status.Over Current" / ".Status.Retries Done"
 *
 * NO BACKTICK. The backtick I'd seen earlier was PDM Manager's rename-dialog
 * formatting ("Channel name has been changed FROM x TO y") rendered with a
 * backtick as separator — not actually part of the channel name.
 *
 * Layer / Category taxonomy (from JBS reference):
 *   Input.Digital.{Name}             — physical switch inputs
 *   Input.CAN.{Source}.{Field}       — CAN bytes received from other modules
 *   Input.Keypad.{Position}.{Group}.{Name} — keypad button inputs
 *   Output.Chassis.{Subsystem}       — body electrical (radio, comms, etc)
 *   Output.Engine.{Subsystem}        — engine systems (Fuel Pump, Coils)
 *   Output.Fans.{Subsystem}          — cooling fans (Engine Oil, Steering, Coolant)
 *   Output.Lighting.{Subsystem}      — exterior + interior lights
 *   Output.Instrumentation.{Subsystem} — gauges, dash, cluster
 *   Function.Output.{Category}.{Sub} — derived logic that drives an output
 *   Function.Logic.{Subsystem}.{Name} — intermediate boolean
 *   Function.Counters.{Subsystem}    — counter values
 *   Function.Override.{Name}         — manual override switches
 *
 * Also: Container needs Version="5" attribute, locale "English_United States.1252".
 */
const PDM_DEVICE_NAME = 'PDM';   // For K5 single-PDM. Use 'PDM Front' / 'PDM Rear' for multi-PDM systems.

// Map dotted-camel base channel → (Category, Subsystem) — JBS-style.
// Returns: { category, subsystem } where category is the major Output bucket
// (Lighting/Engine/Fans/Chassis/Instrumentation) and subsystem is TitleCase with spaces.
type Classification = { category: string; subsystem: string };

const SUBSYSTEM_RULES: Array<{ test: RegExp; cls: Classification }> = [
  // ── LIGHTING ──
  { test: /^lights\.head\.high/i,    cls: { category: 'Lighting', subsystem: 'High Beams' } },
  { test: /^lights\.head/i,          cls: { category: 'Lighting', subsystem: 'Headlights' } },
  { test: /^lights\.park/i,          cls: { category: 'Lighting', subsystem: 'Park Lights' } },
  { test: /^lights\.turn\.left/i,    cls: { category: 'Lighting', subsystem: 'Indicator Left' } },
  { test: /^lights\.turn\.right/i,   cls: { category: 'Lighting', subsystem: 'Indicator Right' } },
  { test: /^lights\.turn/i,          cls: { category: 'Lighting', subsystem: 'Indicators' } },
  { test: /^lights\.hazard/i,        cls: { category: 'Lighting', subsystem: 'Hazards' } },
  { test: /^lights\.tail/i,          cls: { category: 'Lighting', subsystem: 'Tail Lights' } },
  { test: /^lights\.brake/i,         cls: { category: 'Lighting', subsystem: 'Brake Lights' } },
  { test: /^lights\.cargo/i,         cls: { category: 'Lighting', subsystem: 'Cargo Light' } },
  { test: /^lights\.dome/i,          cls: { category: 'Lighting', subsystem: 'Dome Light' } },
  { test: /^lights\.courtesy/i,      cls: { category: 'Lighting', subsystem: 'Courtesy Light' } },
  { test: /^lights\.flasher/i,       cls: { category: 'Lighting', subsystem: 'Indicator Flasher' } },
  { test: /^lights\.backup/i,        cls: { category: 'Lighting', subsystem: 'Reverse Lights' } },
  { test: /^lights\.fog/i,           cls: { category: 'Lighting', subsystem: 'Fog Lights' } },
  { test: /^lights\.cab/i,           cls: { category: 'Lighting', subsystem: 'Cab Clearance' } },
  { test: /^lights\.marker/i,        cls: { category: 'Lighting', subsystem: 'Side Markers' } },
  { test: /^lights\.license/i,       cls: { category: 'Lighting', subsystem: 'License Plate' } },
  { test: /^lights\.puddle/i,        cls: { category: 'Lighting', subsystem: 'Puddle Lights' } },
  { test: /^lights\.foot/i,          cls: { category: 'Lighting', subsystem: 'Footwell' } },
  { test: /^lights\.under/i,         cls: { category: 'Lighting', subsystem: 'Under Dash LED' } },
  { test: /^lights/i,                cls: { category: 'Lighting', subsystem: 'Misc' } },

  // ── CHASSIS (body electrical) ──
  { test: /^doors\.left/i,           cls: { category: 'Chassis', subsystem: 'Door Left' } },
  { test: /^doors\.right/i,          cls: { category: 'Chassis', subsystem: 'Door Right' } },
  { test: /^doors/i,                 cls: { category: 'Chassis', subsystem: 'Doors' } },
  { test: /^locks/i,                 cls: { category: 'Chassis', subsystem: 'Door Locks' } },
  { test: /^window|^windows/i,       cls: { category: 'Chassis', subsystem: 'Power Windows' } },
  { test: /^steps\.left/i,           cls: { category: 'Chassis', subsystem: 'Door Step Left' } },
  { test: /^steps\.right/i,          cls: { category: 'Chassis', subsystem: 'Door Step Right' } },
  { test: /^steps/i,                 cls: { category: 'Chassis', subsystem: 'Door Steps' } },
  { test: /^wipers/i,                cls: { category: 'Chassis', subsystem: 'Wipers' } },
  { test: /^washer/i,                cls: { category: 'Chassis', subsystem: 'Washer' } },
  { test: /^audio/i,                 cls: { category: 'Chassis', subsystem: 'Audio' } },
  { test: /^amp\.|^amplifier/i,      cls: { category: 'Chassis', subsystem: 'Amplifier' } },
  { test: /^subwoofer/i,             cls: { category: 'Chassis', subsystem: 'Subwoofer' } },
  { test: /^antenna/i,               cls: { category: 'Chassis', subsystem: 'Antenna' } },
  { test: /^radio|^head\s*unit|^headunit/i, cls: { category: 'Chassis', subsystem: 'Head Unit' } },
  { test: /^usb/i,                   cls: { category: 'Chassis', subsystem: 'USB Ports' } },
  { test: /^cigaret/i,               cls: { category: 'Chassis', subsystem: 'Cigarette Lighter' } },
  { test: /^camera/i,                cls: { category: 'Chassis', subsystem: 'Camera' } },
  { test: /^trailer/i,               cls: { category: 'Chassis', subsystem: 'Trailer' } },
  { test: /^brakes\.driver/i,        cls: { category: 'Chassis', subsystem: 'Brake Driver Input' } },
  { test: /^brakes/i,                cls: { category: 'Chassis', subsystem: 'Brakes' } },
  { test: /^ibooster/i,              cls: { category: 'Chassis', subsystem: 'iBooster' } },
  { test: /^eparkbrake|^parking\s*brake/i, cls: { category: 'Chassis', subsystem: 'E Park Brake' } },
  { test: /^horn/i,                  cls: { category: 'Chassis', subsystem: 'Horn' } },

  // ── FANS / COOLING ──
  { test: /^cooling\.fan/i,          cls: { category: 'Fans', subsystem: 'Radiator' } },
  { test: /^cooling\.water|^cooling\.pump|^waterpump/i, cls: { category: 'Fans', subsystem: 'Water Pump' } },
  { test: /^cooling/i,               cls: { category: 'Fans', subsystem: 'Cooling' } },
  { test: /^climate/i,               cls: { category: 'Fans', subsystem: 'Climate' } },
  { test: /^heater/i,                cls: { category: 'Fans', subsystem: 'Heater Blower' } },
  { test: /^ac\.|^a_c/i,             cls: { category: 'Fans', subsystem: 'AC Compressor' } },

  // ── ENGINE ──
  { test: /^fuelpump/i,              cls: { category: 'Engine', subsystem: 'Fuel Pump' } },
  { test: /^injector|^injectors/i,   cls: { category: 'Engine', subsystem: 'Fuel Injectors' } },
  { test: /^coil|^coils/i,           cls: { category: 'Engine', subsystem: 'Ignition Coils' } },
  { test: /^starter/i,               cls: { category: 'Engine', subsystem: 'Starter' } },
  { test: /^alternator/i,            cls: { category: 'Engine', subsystem: 'Alternator' } },
  { test: /^etb|^throttle/i,         cls: { category: 'Engine', subsystem: 'Throttle' } },
  { test: /^pedal|^aps/i,            cls: { category: 'Engine', subsystem: 'Pedal' } },
  { test: /^ignition/i,              cls: { category: 'Engine', subsystem: 'Ignition' } },
  { test: /^engine/i,                cls: { category: 'Engine', subsystem: 'Engine' } },

  // ── INSTRUMENTATION (gauges, dash, cluster) ──
  { test: /^cluster|^vhx|^dakota/i,  cls: { category: 'Instrumentation', subsystem: 'Cluster' } },

  // ── DRIVETRAIN ──
  { test: /^drivetrain/i,            cls: { category: 'Drivetrain', subsystem: 'Drivetrain' } },
  { test: /^transmission|^trans\./i, cls: { category: 'Drivetrain', subsystem: 'Transmission' } },
  { test: /^gear/i,                  cls: { category: 'Drivetrain', subsystem: 'Gear' } },

  // ── SYSTEM / DEVICE ──
  { test: /^keypad/i,                cls: { category: 'System', subsystem: 'Keypad' } },
  { test: /^master\.retry|^masterretry/i, cls: { category: 'System', subsystem: 'Master Retry' } },
  { test: /^ecu/i,                   cls: { category: 'System', subsystem: 'ECU' } },
  { test: /^pdm\.battery/i,          cls: { category: 'System', subsystem: 'Battery Voltage' } },
  { test: /^pdm\.internal/i,         cls: { category: 'System', subsystem: 'PDM Internal' } },
];

function classifySubsystem(base: string): Classification {
  // pdm.outputs.X — strip prefix and classify remainder so output pins
  // get categorized by what they DRIVE, not the "pdm" wrapper word.
  const outMatch = base.match(/^pdm\.outputs?\.(.+)$/i);
  if (outMatch) {
    const sub = outMatch[1];
    for (const r of SUBSYSTEM_RULES) {
      if (r.test.test(sub)) return r.cls;
    }
    return { category: 'Chassis', subsystem: titleCase(sub) };
  }
  // CAN sub-channel: strip pdm.can. prefix and classify the remainder
  const canMatch = base.match(/^pdm\.can\.([^.]+)/i);
  if (canMatch) {
    const sub = canMatch[1];
    for (const r of SUBSYSTEM_RULES) {
      if (r.test.test(sub)) return r.cls;
    }
    return { category: 'CAN', subsystem: titleCase(sub) };
  }
  for (const r of SUBSYSTEM_RULES) {
    if (r.test.test(base)) return r.cls;
  }
  // Fallback: TitleCase the first segment
  const first = base.split('.')[0] || 'Misc';
  return { category: 'Misc', subsystem: titleCase(first) };
}

function titleCase(s: string): string {
  return s.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Wrap a base channel name in JBS-style hierarchical taxonomy.
 *   "steps.right.deploy"       → "PDM.Function.Output.Chassis.Door Step Right"
 *   "pdm.outputs.fuelPump"     → "PDM.Output.Engine.Fuel Pump"
 *   "ignition.run"             → "PDM.Input.Digital.Ignition Run"
 *   "pdm.outputs.headlights.Voltage" → "PDM.Output.Lighting.Headlights.Voltage"
 *
 * No backtick, no flat suffix. Pure hierarchical name matching JBS reference.
 */
export function daveify(baseChannel: string): string {
  if (!baseChannel) return baseChannel;
  const { base, accessor } = splitOffRealAccessor(baseChannel);

  // PDM Manager built-in channels — pass through unchanged
  if (/^PDM\.(Input Voltages|CAN Inputs|CAN Outputs|Battery Voltage|Internal Temperature)/i.test(base)) {
    return baseChannel;
  }

  // Determine layer
  let layerPath: string;
  if (/^pdm\.outputs?\./i.test(base)) {
    layerPath = `${PDM_DEVICE_NAME}.Output`;
  } else if (/^pdm\.can\./i.test(base)) {
    layerPath = `${PDM_DEVICE_NAME}.Input.CAN`;
  } else if (/\.switch$|\.button$|\.detent\.switch$/i.test(base)) {
    layerPath = `${PDM_DEVICE_NAME}.Input.Digital`;
  } else if (/^keypad/i.test(base)) {
    layerPath = `${PDM_DEVICE_NAME}.Input.Keypad`;
  } else {
    layerPath = `${PDM_DEVICE_NAME}.Function.Output`;
  }

  // Classify subsystem + category
  const cls = classifySubsystem(base);
  // Output / Function paths get a Category layer; Input.Digital / Input.CAN go straight to subsystem
  const tail = layerPath.endsWith('.Output')
    ? `${cls.category}.${cls.subsystem}`
    : cls.subsystem;

  // Accessor (.Voltage / .Status.Active / etc.) — preserve as-is, JBS-style
  // Convert pseudo-accessors to JBS spelling
  let accSuffix = accessor;
  if (accSuffix) {
    accSuffix = accSuffix
      .replace(/\.Over\s*Current/i, '.Over Current')
      .replace(/\.Retries\s*Done/i, '.Retries Done')
      .replace(/\.OverCurrent/i, '.Over Current')
      .replace(/\.RetriesDone/i, '.Retries Done');
  }

  return `${layerPath}.${tail}${accSuffix}`;
}

/**
 * Apply renames to a single channel reference. Strips pseudo-accessors
 * (rising_edge etc — not real PDM Manager) and preserves real accessors
 * (.Status, .Voltage, .Active etc).
 *
 * Output is wrapped in Dave's hierarchical taxonomy via `daveify()`.
 */
export function rename(channel: string): string {
  if (!channel) return channel;
  const trimmed = channel.trim();
  // Step 1: drop pseudo-accessors entirely
  const noPseudo = stripPseudoAccessors(trimmed);
  // Step 2: split off real accessor for separate handling
  const { base, accessor } = splitOffRealAccessor(noPseudo);
  // Step 3: look up base in rename map, falling back to snake_to_camel
  const renamed = CHANNEL_RENAMES[base] || base;
  // Always snake→camel the result — many rename targets still contain
  // snake_case segments (e.g. "doors.any_open" → "doors.anyOpen").
  const flatBase = snakeToCamel(renamed) + accessor;
  // Step 4: wrap in Dave's hierarchical taxonomy.
  // Per dave-channel-naming-convention.md memory.
  return daveify(flatBase);
}

/**
 * Apply renames inside a free-form expression. Walks identifiers, leaves
 * keywords / operators / numerics alone.
 */
export function renameExpression(expression: string): string {
  return expression.replace(/[a-zA-Z_][a-zA-Z0-9_.]*/g, (token) => {
    // Skip operator keywords + parameter labels
    const reserved = new Set([
      'NOT','AND','OR','TRUE','FALSE',
      'PULSE','FLASH','SET_RESET','HYSTERESIS','TOGGLE','COUNTER','PACK','CAN_RELAY','CAN_LINK_OK','AND_BITMASK',
      'Equal_to','Greater_than','Less_than','Not_equal_to',
      'input','set','reset','width','on_time','off_time','rise_delay','fall_delay','overflow_at','ms',
    ]);
    if (reserved.has(token)) return token;
    return rename(token);
  });
}
