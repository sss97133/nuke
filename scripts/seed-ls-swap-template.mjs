#!/usr/bin/env node
/**
 * seed-ls-swap-template.mjs
 *
 * Creates an upgrade template for "LS Swap - Motec M150 + PDM30" in the wiring system.
 * Populates upgrade_new_circuits from existing device_pin_maps (M150 + PDM30 pins).
 * Defines upgrade_circuit_actions mapping factory circuits to keep/remove/modify.
 *
 * Usage: dotenvx run -- node scripts/seed-ls-swap-template.mjs
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TEMPLATE_SLUG = 'ls-swap-motec-m150-pdm30';
const GENERATION = 'squarebody_1973_1987';

// ─── Circuit action mappings for factory circuits ───────────────────────────
// Maps factory circuit_code -> { action, notes }
// Actions: 'keep' (unchanged), 'remove' (deleted by swap), 'modify' (rerouted/adapted)
const CIRCUIT_ACTIONS = {
  // ENGINE — all factory engine circuits removed (replaced by M150)
  TBI_CLT:        { action: 'remove', notes: 'Replaced by M150 analog input — LS CLT sensor to M150 B3' },
  TBI_ECM_POWER:  { action: 'remove', notes: 'Factory ECM removed. M150 powered via PDM30 Ch9' },
  ELEC_CHOKE:     { action: 'remove', notes: 'LS engine has no choke' },
  TBI_EST:        { action: 'remove', notes: 'Replaced by M150 ignition outputs A13-A20 driving LS coil-on-plug' },
  TBI_IAC:        { action: 'remove', notes: 'LS uses electronic throttle (DBW) via M150 aux outputs' },
  TBI_MAP:        { action: 'remove', notes: 'Replaced by M150 analog input — LS MAP sensor to M150 B4' },
  TBI_O2:         { action: 'remove', notes: 'Replaced by wideband O2 controller to M150 B5/B6' },
  TBI_INJ_1:      { action: 'remove', notes: 'Replaced by M150 injector output A1' },
  TBI_INJ_2:      { action: 'remove', notes: 'Replaced by M150 injector output A2' },
  TBI_TPS:        { action: 'remove', notes: 'Replaced by M150 analog inputs B1/B2 (dual TPS on LS DBW)' },

  // FUEL — pump kept but rerouted through PDM30
  FUEL_PUMP:      { action: 'modify', notes: 'Fuel pump now powered via PDM30 Ch1 (20A). Relay removed.' },
  FUEL_PUMP_RELAY:{ action: 'remove', notes: 'PDM30 replaces mechanical relay — M150 controls via CAN' },
  FUEL_SENDER_FRONT:  { action: 'keep', notes: 'Factory fuel sender retained for gauge compatibility' },
  FUEL_SENDER_REAR:   { action: 'keep', notes: 'Factory rear tank sender retained' },
  FUEL_SELECTOR:  { action: 'keep', notes: 'Factory tank selector retained' },

  // IGNITION — factory ignition system replaced by M150
  IGN_COIL:       { action: 'remove', notes: 'Factory coil removed. LS COP driven directly by M150 A13-A20' },
  IGN_RUN:        { action: 'modify', notes: 'Run feed rerouted through PDM30. IGN input to PDM wakes system.' },
  IGN_RUN_START:  { action: 'modify', notes: 'Start feed rerouted through PDM30 Ch6 (starter relay)' },
  IGN_TACH:       { action: 'modify', notes: 'Tach signal now from M150 aux output A27 (configurable)' },

  // STARTING — mostly kept but starter relay via PDM
  BAT_FEED:       { action: 'keep', notes: 'Battery feed to starter retained. PDM30 BAT+ parallel path.' },
  GND_BODY:       { action: 'keep', notes: 'Factory body ground retained, additional star grounds added' },
  GND_ENGINE:     { action: 'modify', notes: 'LS engine ground strap required — new mounting points' },
  START_SOLENOID: { action: 'modify', notes: 'Starter solenoid trigger via PDM30 Ch6 instead of ignition switch direct' },
  START_NEUTRAL:  { action: 'modify', notes: 'Neutral safety switch signal routed to PDM30 DI2' },

  // CHARGING — alternator upgraded for LS
  CHARGE_MAIN:    { action: 'modify', notes: 'LS alternator higher output — verify wire gauge adequate' },
  CHARGE_SENSE:   { action: 'modify', notes: 'LS alternator has different field/sense wiring' },
  CHARGE_IND:     { action: 'keep', notes: 'Charge indicator light retained' },

  // COOLING — AC compressor retained, routed through PDM
  AC_COMPRESSOR:  { action: 'modify', notes: 'AC compressor clutch now via PDM30 Ch15 (CAN-controlled)' },
  AC_PRESSURE:    { action: 'keep', notes: 'Factory AC pressure cycling switch retained' },

  // LIGHTING — all kept, some rerouted through PDM30
  HEADLIGHT_SWITCH_FEED: { action: 'modify', notes: 'Headlight switch feed via PDM30 Ch5 (20A)' },
  HEADLIGHT_HI_L: { action: 'keep', notes: 'Factory headlight wiring retained' },
  HEADLIGHT_HI_R: { action: 'keep', notes: 'Factory headlight wiring retained' },
  HEADLIGHT_LO_L: { action: 'keep', notes: 'Factory headlight wiring retained' },
  HEADLIGHT_LO_R: { action: 'keep', notes: 'Factory headlight wiring retained' },
  PARKING_L:      { action: 'keep', notes: 'Factory parking light wiring retained' },
  PARKING_R:      { action: 'keep', notes: 'Factory parking light wiring retained' },
  SIDE_MARKER_FL: { action: 'keep', notes: 'Side markers retained' },
  SIDE_MARKER_FR: { action: 'keep', notes: 'Side markers retained' },
  SIDE_MARKER_RL: { action: 'keep', notes: 'Side markers retained' },
  SIDE_MARKER_RR: { action: 'keep', notes: 'Side markers retained' },
  CLEARANCE_L:    { action: 'keep', notes: 'Cab clearance lights retained' },
  CLEARANCE_R:    { action: 'keep', notes: 'Cab clearance lights retained' },
  CLEARANCE_CENTER: { action: 'keep', notes: 'Cab clearance lights retained' },
  INST_LIGHTS:    { action: 'keep', notes: 'Instrument panel lights retained' },
  CARGO_LIGHT:    { action: 'keep', notes: 'Cargo light retained' },
  GLOVE_BOX:      { action: 'keep', notes: 'Glove box light retained' },
  UNDERHOOD:      { action: 'keep', notes: 'Underhood light retained' },

  // GAUGES — kept, some modified for LS sensor compatibility
  GAUGE_FEED:     { action: 'keep', notes: 'Gauge cluster power retained' },
  TEMP_SENDER:    { action: 'modify', notes: 'LS CLT has different resistance curve — adapter or new gauge' },
  OIL_SENDER:     { action: 'modify', notes: 'LS oil pressure sender different — adapter or new gauge' },
  FUEL_SENDER:    { action: 'keep', notes: 'Factory fuel sender retained' },
  VOLT_GAUGE:     { action: 'keep', notes: 'Voltmeter retained' },

  // BODY — all kept
  HEATER_BLOWER:  { action: 'modify', notes: 'Blower motor power via PDM30 Ch14' },
  HEATER_RESISTOR:{ action: 'keep', notes: 'Blower resistor retained for speed control' },
  PWR_WINDOW_L:   { action: 'keep', notes: 'Power window wiring retained' },
  PWR_WINDOW_R:   { action: 'keep', notes: 'Power window wiring retained' },
  PWR_LOCK_L:     { action: 'keep', notes: 'Power lock wiring retained' },
  PWR_LOCK_R:     { action: 'keep', notes: 'Power lock wiring retained' },

  // ACCESSORIES — mostly kept
  HORN_RELAY:     { action: 'modify', notes: 'Horn power via PDM30 Ch12' },
  HORN_BUTTON:    { action: 'keep', notes: 'Horn button wiring retained' },
  RADIO_FEED:     { action: 'modify', notes: 'Radio/accessory feed via PDM30 Ch17' },
  RADIO_SPEAKER_L:{ action: 'keep', notes: 'Speaker wiring retained' },
  RADIO_SPEAKER_R:{ action: 'keep', notes: 'Speaker wiring retained' },
  WIPER_FEED:     { action: 'modify', notes: 'Wiper motor power via PDM30 Ch13' },
  WIPER_PARK:     { action: 'keep', notes: 'Wiper park switch wiring retained' },
  WASHER_PUMP:    { action: 'keep', notes: 'Washer pump wiring retained' },
  CIG_LIGHTER:    { action: 'modify', notes: 'Cigarette lighter/12V outlet via PDM30 Ch23' },
  CRUISE_MODULE:  { action: 'remove', notes: 'Factory cruise removed — M150 handles cruise via DBW' },
  CRUISE_SERVO:   { action: 'remove', notes: 'Factory cruise servo removed' },
  KEY_BUZZER:     { action: 'remove', notes: 'Factory key buzzer removed' },
  SEAT_BELT_WARN: { action: 'remove', notes: 'Factory seat belt warning removed' },
};

async function main() {
  console.log('=== LS Swap Template Seeder ===\n');

  // ─── Step 1: Check if template already exists ──────────────────────
  const { data: existing } = await supabase
    .from('upgrade_templates')
    .select('id, name')
    .eq('slug', TEMPLATE_SLUG)
    .maybeSingle();

  if (existing) {
    console.log(`Template already exists: ${existing.name} (${existing.id})`);
    console.log('To re-seed, delete it first. Exiting.');
    process.exit(0);
  }

  // ─── Step 2: Create the upgrade template ───────────────────────────
  console.log('Creating upgrade template...');
  const { data: template, error: templateErr } = await supabase
    .from('upgrade_templates')
    .insert({
      name: 'LS Swap - Motec M150 + PDM30',
      slug: TEMPLATE_SLUG,
      description: 'Complete LS engine swap with Motec M150 ECU and PDM30 power distribution module. Replaces factory TBI/carb engine management, adds CAN bus communication, electronic throttle control, and fuseless power distribution.',
      applicable_generations: [GENERATION],
      applicable_models: ['K5 Blazer', 'C10', 'C20', 'K10', 'K20', 'C30', 'K30', 'Suburban'],
      upgrade_category: 'engine_swap',
      platform: 'motec',
      wiring_tier: 'ultra',
      wire_spec: 'Tefzel MIL-W-22759/16',
      connector_standard: 'Autosport AS (MS/Deutsch for sensors)',
      sheathing_spec: 'DR-25 heat shrink, Raychem SCL',
      construction_method: 'Concentric twist, laser-marked',
      estimated_hours_min: 40,
      estimated_hours_max: 60,
      estimated_parts_cost_min: 8000,
      estimated_parts_cost_max: 14000,
      difficulty_level: 8,
      source_references: [
        'Motec M150 Wiring Manual v2.0',
        'Motec PDM30 Installation Guide',
        'GM LS Engine Wiring Connector Reference'
      ],
      notes: 'SCAFFOLDED from training data. M150 pin assignments need validation against actual Motec wiring manual. PDM channel assignments are typical but should be customized per vehicle build requirements.'
    })
    .select('id')
    .single();

  if (templateErr) {
    console.error('Failed to create template:', templateErr.message);
    process.exit(1);
  }

  const templateId = template.id;
  console.log(`  Created template: ${templateId}\n`);

  // ─── Step 3: Fetch M150 + PDM30 pin maps ──────────────────────────
  console.log('Fetching device pin maps...');

  const { data: m150Pins, error: m150Err } = await supabase
    .from('device_pin_maps')
    .select('*')
    .eq('device_model', 'M150')
    .order('connector_name')
    .order('pin_number');

  if (m150Err) {
    console.error('Failed to fetch M150 pins:', m150Err.message);
    process.exit(1);
  }

  const { data: pdm30Pins, error: pdm30Err } = await supabase
    .from('device_pin_maps')
    .select('*')
    .eq('device_model', 'PDM30')
    .order('pin_number');

  if (pdm30Err) {
    console.error('Failed to fetch PDM30 pins:', pdm30Err.message);
    process.exit(1);
  }

  console.log(`  M150 pins: ${m150Pins.length}`);
  console.log(`  PDM30 pins: ${pdm30Pins.length}`);

  // ─── Step 4: Create upgrade_new_circuits from pin maps ─────────────
  console.log('\nCreating new circuits from device pin maps...');

  const newCircuits = [];

  // M150 pins -> new circuits
  for (const pin of m150Pins) {
    // Skip unused/spare pins (no typical_connection or starts with "Spare")
    if (!pin.typical_connection || pin.typical_connection.startsWith('Spare')) continue;
    // Skip staged injection (unused on V8)
    if (pin.pin_function?.includes('Staged')) continue;
    // Skip ignition 9+ (unused on V8)
    if (pin.pin_function === 'Ignition 9 Output') continue;

    // Determine system category from signal type
    let systemCategory = 'engine_management';
    if (pin.signal_type === 'ground') systemCategory = 'grounding';
    else if (pin.signal_type === 'power' || pin.signal_type === 'sensor_supply') systemCategory = 'power';
    else if (pin.signal_type === 'can_h' || pin.signal_type === 'can_l') systemCategory = 'communication';
    else if (pin.signal_type === 'half_bridge') systemCategory = 'engine_outputs';
    else if (pin.signal_type === 'low_side') systemCategory = 'fuel_injection';
    else if (pin.signal_type === 'logic_coil_drive') systemCategory = 'ignition';
    else if (pin.signal_type === 'vr_or_hall' || pin.signal_type === 'hall') systemCategory = 'engine_sensors';
    else if (pin.signal_type === 'analog_5v') systemCategory = 'engine_sensors';
    else if (pin.signal_type === 'thermistor') systemCategory = 'engine_sensors';

    newCircuits.push({
      upgrade_template_id: templateId,
      circuit_code: `M150_${pin.connector_name}_${pin.pin_number}`.replace('Connector_', ''),
      circuit_name: pin.pin_function,
      system_category: systemCategory,
      wire_color: pin.default_wire_color || null,
      wire_gauge_awg: pin.default_wire_gauge_awg || null,
      wire_type: pin.requires_shielding ? 'shielded' : (pin.requires_twisted_pair ? 'twisted_pair' : 'standard'),
      is_shielded: pin.requires_shielding || false,
      is_twisted_pair: pin.requires_twisted_pair || false,
      from_component: 'M150',
      from_connector: pin.connector_name,
      from_pin: pin.pin_number,
      from_location_zone: 'engine_bay',
      to_component: pin.typical_connection?.split('.')[0]?.split('(')[0]?.trim() || 'TBD',
      signal_type: pin.signal_type,
      max_current_amps: pin.max_current_amps ? parseFloat(pin.max_current_amps) : null,
      device_name: 'Motec M150',
      device_connector: pin.connector_name,
      device_pin: pin.pin_number,
      notes: pin.typical_connection,
    });
  }

  // PDM30 pins -> new circuits
  for (const pin of pdm30Pins) {
    if (!pin.typical_connection || pin.typical_connection === 'Spare') continue;

    let systemCategory = 'power_distribution';
    if (pin.signal_type === 'power' || pin.signal_type === 'ground') systemCategory = 'power';
    else if (pin.signal_type === 'can_h' || pin.signal_type === 'can_l') systemCategory = 'communication';
    else if (pin.signal_type === 'digital_in') systemCategory = 'digital_inputs';

    // Determine location zone for to_component
    let toZone = 'engine_bay';
    const tc = (pin.typical_connection || '').toLowerCase();
    if (tc.includes('headlight') || tc.includes('parking') || tc.includes('marker')) toZone = 'front';
    if (tc.includes('brake') || tc.includes('tail') || tc.includes('backup')) toZone = 'rear';
    if (tc.includes('wiper') || tc.includes('blower') || tc.includes('radio') || tc.includes('interior') || tc.includes('instrument') || tc.includes('dome') || tc.includes('usb')) toZone = 'cabin';

    newCircuits.push({
      upgrade_template_id: templateId,
      circuit_code: `PDM30_${pin.pin_number}`,
      circuit_name: pin.pin_function,
      system_category: systemCategory,
      wire_color: pin.default_wire_color || null,
      wire_gauge_awg: pin.default_wire_gauge_awg || null,
      wire_type: 'standard',
      is_shielded: false,
      is_twisted_pair: pin.signal_type === 'can_h' || pin.signal_type === 'can_l',
      from_component: 'PDM30',
      from_connector: pin.connector_name,
      from_pin: pin.pin_number,
      from_location_zone: 'cabin', // PDM typically mounted under dash
      to_component: pin.typical_connection?.split('.')[0]?.split('(')[0]?.trim() || 'TBD',
      to_location_zone: toZone,
      signal_type: pin.signal_type,
      max_current_amps: pin.max_current_amps ? parseFloat(pin.max_current_amps) : null,
      pdm_channel: pin.pin_number.startsWith('Ch') ? pin.pin_number : null,
      device_name: 'Motec PDM30',
      device_connector: pin.connector_name,
      device_pin: pin.pin_number,
      notes: pin.typical_connection,
    });
  }

  // Batch insert in chunks of 50
  let insertedCircuits = 0;
  for (let i = 0; i < newCircuits.length; i += 50) {
    const batch = newCircuits.slice(i, i + 50);
    const { error: insertErr, count } = await supabase
      .from('upgrade_new_circuits')
      .insert(batch);

    if (insertErr) {
      console.error(`Failed to insert circuits batch ${i / 50 + 1}:`, insertErr.message);
      // Continue with remaining batches
    } else {
      insertedCircuits += batch.length;
    }
  }

  console.log(`  Created ${insertedCircuits} new circuits`);

  // ─── Step 5: Fetch factory circuits and create circuit actions ──────
  console.log('\nFetching factory harness circuits...');

  const { data: factoryCircuits, error: factoryErr } = await supabase
    .from('factory_harness_circuits')
    .select('id, circuit_code, circuit_name, system_category')
    .eq('generation', GENERATION);

  if (factoryErr) {
    console.error('Failed to fetch factory circuits:', factoryErr.message);
    process.exit(1);
  }

  console.log(`  Factory circuits found: ${factoryCircuits.length}`);

  const circuitActions = [];
  let keepCount = 0, removeCount = 0, modifyCount = 0, unmappedCount = 0;

  for (const fc of factoryCircuits) {
    const mapping = CIRCUIT_ACTIONS[fc.circuit_code];
    if (mapping) {
      circuitActions.push({
        upgrade_template_id: templateId,
        factory_circuit_id: fc.id,
        action: mapping.action,
        modification_notes: mapping.notes,
      });
      if (mapping.action === 'keep') keepCount++;
      else if (mapping.action === 'remove') removeCount++;
      else if (mapping.action === 'modify') modifyCount++;
    } else {
      // Unmapped circuit — default to 'keep' with a note
      circuitActions.push({
        upgrade_template_id: templateId,
        factory_circuit_id: fc.id,
        action: 'keep',
        modification_notes: `Unmapped: ${fc.circuit_name} (${fc.circuit_code}) — defaulting to keep`,
      });
      unmappedCount++;
      keepCount++;
    }
  }

  // Batch insert circuit actions
  let insertedActions = 0;
  for (let i = 0; i < circuitActions.length; i += 50) {
    const batch = circuitActions.slice(i, i + 50);
    const { error: insertErr } = await supabase
      .from('upgrade_circuit_actions')
      .insert(batch);

    if (insertErr) {
      console.error(`Failed to insert circuit actions batch ${i / 50 + 1}:`, insertErr.message);
    } else {
      insertedActions += batch.length;
    }
  }

  console.log(`  Created ${insertedActions} circuit actions`);

  // ─── Summary ───────────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  console.log(`  Template:        ${TEMPLATE_SLUG} (${templateId})`);
  console.log(`  New circuits:    ${insertedCircuits} (M150: ${m150Pins.length - newCircuits.filter(c => c.from_component === 'PDM30').length}, PDM30: ${newCircuits.filter(c => c.from_component === 'PDM30').length})`);
  console.log(`  Circuit actions: ${insertedActions}`);
  console.log(`    keep:          ${keepCount}`);
  console.log(`    remove:        ${removeCount}`);
  console.log(`    modify:        ${modifyCount}`);
  if (unmappedCount > 0) {
    console.log(`    unmapped:      ${unmappedCount} (defaulted to keep)`);
  }
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
