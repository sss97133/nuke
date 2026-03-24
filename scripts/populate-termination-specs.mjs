#!/usr/bin/env node
/**
 * populate-termination-specs.mjs
 *
 * Backfills wire_termination_specs for the K5 Blazer.
 * 1. Loads devices from vehicle_build_manifest
 * 2. Calls compute-wiring-overlay to get wire specs
 * 3. Computes termination specs per endpoint (inlined from terminationRules.ts)
 * 4. Upserts ~220 rows into wire_termination_specs
 *
 * Usage: dotenvx run -- node scripts/populate-termination-specs.mjs
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const K5_VEHICLE_ID = 'e04bf9c5-b488-433b-be9a-3d307861d90b';

// ── Inlined from terminationRules.ts ────────────────────────────────

const CONNECTOR_TERMINATION_MAP = {
  deutsch_dtm: [
    { family: 'deutsch_dtm', housing: 'DTM04-xP', male: '0460-202-20141', female: '0462-201-20141', crimp: 'HDT-48-00', gaugeRange: [16, 22], seal: '1010-009-0205', wedge: 'WM-xS' },
  ],
  deutsch_dt: [
    { family: 'deutsch_dt', housing: 'DT04-xP', male: '0460-202-16141', female: '0462-201-16141', crimp: 'HDT-48-00', gaugeRange: [14, 20], seal: '1010-009-0205', wedge: 'W-xP' },
  ],
  deutsch_dtp: [
    { family: 'deutsch_dtp', housing: 'DTP04-xP', male: '0460-204-12141', female: '0462-203-12141', crimp: 'HDT-48-00', gaugeRange: [8, 14], seal: '1010-009-0406' },
  ],
  superseal_1_0: [
    { family: 'superseal_1_0', housing: 'SS-1.0-xP', male: '1-968855-1', female: '1-968857-1', crimp: 'PRO-CRIMPER-III', gaugeRange: [16, 22], seal: '1-967658-1' },
  ],
  weatherpack: [
    { family: 'weatherpack', housing: '12010996', male: '12077411', female: '12089188', crimp: '12014254', gaugeRange: [14, 20], seal: '15324980' },
  ],
  ring_terminal: [
    { family: 'ring_terminal', housing: 'N/A', male: 'RT-16-1/4', female: 'RT-16-1/4', crimp: 'HDT-48-00', gaugeRange: [14, 22] },
    { family: 'ring_terminal', housing: 'N/A', male: 'RT-10-3/8', female: 'RT-10-3/8', crimp: 'HDT-48-00', gaugeRange: [8, 12] },
  ],
  butt_splice: [
    { family: 'butt_splice', housing: 'N/A', male: 'BSV-18', female: 'BSV-18', crimp: 'HDT-48-00', gaugeRange: [14, 22] },
    { family: 'butt_splice', housing: 'N/A', male: 'BSV-10', female: 'BSV-10', crimp: 'HDT-48-00', gaugeRange: [8, 12] },
  ],
};

const HEAT_SHRINK_MAP = [
  { gaugeMin: 20, gaugeMax: 22, size: '3/16"', pn: 'DR-25-3/16' },
  { gaugeMin: 16, gaugeMax: 18, size: '1/4"',  pn: 'DR-25-1/4' },
  { gaugeMin: 12, gaugeMax: 14, size: '3/8"',  pn: 'DR-25-3/8' },
  { gaugeMin: 8,  gaugeMax: 10, size: '1/2"',  pn: 'DR-25-1/2' },
];

const BOOT_MAP = {
  deutsch_dtm: { 2: 'RBT-DTM2', 3: 'RBT-DTM3', 4: 'RBT-DTM4', 6: 'RBT-DTM6', 8: 'RBT-DTM8', 12: 'RBT-DTM12' },
  deutsch_dt: { 2: 'RBT-DT2', 3: 'RBT-DT3', 4: 'RBT-DT4', 6: 'RBT-DT6', 8: 'RBT-DT8', 12: 'RBT-DT12' },
  deutsch_dtp: { 2: 'RBT-DTP2', 4: 'RBT-DTP4' },
};

function getHeatShrink(gaugeAWG) {
  for (const e of HEAT_SHRINK_MAP) {
    if (gaugeAWG >= e.gaugeMin && gaugeAWG <= e.gaugeMax) return { size: e.size, pn: e.pn };
  }
  if (gaugeAWG < 8) return { size: '1/2"', pn: 'DR-25-1/2' };
  return { size: '3/16"', pn: 'DR-25-3/16' };
}

function getLabelText(wireNumber, deviceName, gaugeAWG, color) {
  const short = deviceName.length > 12 ? deviceName.slice(0, 12) : deviceName;
  return `W${wireNumber} ${short} ${gaugeAWG}ga ${color}`;
}

function getTermination(connectorFamily, pinCount, gaugeAWG) {
  const specs = CONNECTOR_TERMINATION_MAP[connectorFamily];
  const hs = getHeatShrink(gaugeAWG);

  if (!specs || specs.length === 0) {
    return {
      housing: 'UNKNOWN', contactMale: 'UNKNOWN', contactFemale: 'UNKNOWN',
      pinSeal: null, wedgeLock: null, boot: null, crimpTool: 'UNKNOWN',
      heatShrink: hs, label: '', ready: false,
    };
  }

  const spec = specs.find(s => gaugeAWG >= s.gaugeRange[0] && gaugeAWG <= s.gaugeRange[1]) ?? specs[0];
  const housing = spec.housing.replace(/x/g, String(pinCount));
  const wedgeLock = spec.wedge ? spec.wedge.replace(/x/g, String(pinCount)) : null;
  const bootFamily = BOOT_MAP[connectorFamily];
  const boot = bootFamily ? (bootFamily[pinCount] ?? null) : null;

  const ready = spec.housing !== 'UNKNOWN' && spec.male !== 'UNKNOWN';

  return {
    housing, contactMale: spec.male, contactFemale: spec.female,
    pinSeal: spec.seal ?? null, wedgeLock, boot,
    crimpTool: spec.crimp, heatShrink: hs, label: '', ready,
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Populate wire_termination_specs for K5 Blazer ===\n');

  // Step 1: Load devices from build manifest
  const { data: devices, error: devErr } = await supabase
    .from('vehicle_build_manifest')
    .select('id, device_name, device_category, pin_count, connector_type, power_draw_amps, signal_type')
    .eq('vehicle_id', K5_VEHICLE_ID)
    .order('device_category');

  if (devErr) { console.error('Failed to load devices:', devErr.message); process.exit(1); }
  if (!devices || devices.length === 0) { console.error('No devices in build manifest'); process.exit(1); }
  console.log(`Loaded ${devices.length} devices from build manifest`);

  // Build device map by name (edge function wires reference by name)
  const deviceByName = new Map();
  for (const d of devices) {
    deviceByName.set(d.device_name, d);
  }

  // Step 2: Call compute-wiring-overlay to get wire specs
  console.log('Calling compute-wiring-overlay...');
  const computeUrl = `${process.env.VITE_SUPABASE_URL}/functions/v1/compute-wiring-overlay`;
  const response = await fetch(computeUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ vehicle_id: K5_VEHICLE_ID, action: 'compute' }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`compute-wiring-overlay returned ${response.status}: ${errText}`);
    process.exit(1);
  }

  const overlay = await response.json();
  const wires = overlay.wires;
  if (!wires || wires.length === 0) {
    console.error('No wires returned from compute-wiring-overlay');
    process.exit(1);
  }
  console.log(`Got ${wires.length} wires from overlay compute`);

  // Step 3: Compute termination specs and upsert
  let inserted = 0;
  let errors = 0;

  for (const wire of wires) {
    const gauge = wire.gauge;
    const color = wire.color || 'BLK';
    const wireNum = wire.wireNumber;

    // Resolve source endpoint (ECU/PDM side — default deutsch_dtm)
    const sourceFamily = 'deutsch_dtm';
    const sourcePins = 12; // ECU/PDM connector pins
    const sourceTerm = getTermination(sourceFamily, sourcePins, gauge);
    sourceTerm.label = getLabelText(wireNum, wire.fromDevice || 'ECU', gauge, color);

    // Resolve device endpoint
    const targetDevice = deviceByName.get(wire.toDevice);
    const targetFamily = targetDevice?.connector_type || 'deutsch_dtm';
    const targetPins = targetDevice?.pin_count || 2;
    const targetTerm = getTermination(targetFamily, targetPins, gauge);
    targetTerm.label = getLabelText(wireNum, wire.toDevice || 'Device', gauge, color);

    const hs = getHeatShrink(gauge);

    // Build two rows: source + device
    const rows = [
      {
        vehicle_id: K5_VEHICLE_ID,
        wire_number: wireNum,
        endpoint_side: 'source',
        connector_housing_pn: sourceTerm.housing,
        connector_family: sourceFamily,
        connector_pin_count: sourcePins,
        terminal_contact_pn: sourceTerm.contactFemale,
        contact_gender: 'female',
        pin_seal_pn: sourceTerm.pinSeal,
        wedge_lock_pn: sourceTerm.wedgeLock,
        crimp_tool_pn: sourceTerm.crimpTool,
        heat_shrink_pn: hs.pn,
        heat_shrink_size: hs.size,
        label_text: sourceTerm.label,
        boot_pn: sourceTerm.boot,
        ready_to_terminate: sourceTerm.ready,
        qty_needed: 1,
      },
      {
        vehicle_id: K5_VEHICLE_ID,
        wire_number: wireNum,
        endpoint_side: 'device',
        connector_housing_pn: targetTerm.housing,
        connector_family: targetFamily,
        connector_pin_count: targetPins,
        terminal_contact_pn: targetTerm.contactMale,
        contact_gender: 'male',
        pin_seal_pn: targetTerm.pinSeal,
        wedge_lock_pn: targetTerm.wedgeLock,
        crimp_tool_pn: targetTerm.crimpTool,
        heat_shrink_pn: hs.pn,
        heat_shrink_size: hs.size,
        label_text: targetTerm.label,
        boot_pn: targetTerm.boot,
        ready_to_terminate: targetTerm.ready,
        qty_needed: 1,
      },
    ];

    try {
      const { error: upsertErr } = await supabase
        .from('wire_termination_specs')
        .upsert(rows, { onConflict: 'vehicle_id,wire_number,endpoint_side' });

      if (upsertErr) {
        console.error(`  Wire ${wireNum} error: ${upsertErr.message}`);
        errors++;
      } else {
        inserted += 2;
        if (wireNum % 20 === 0) console.log(`  ... processed wire ${wireNum}/${wires.length}`);
      }
    } catch (err) {
      console.error(`  Wire ${wireNum} exception: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Upserted: ${inserted} rows (${wires.length} wires x 2 endpoints)`);
  if (errors > 0) console.log(`  Errors: ${errors}`);

  // Verify count
  const { count } = await supabase
    .from('wire_termination_specs')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', K5_VEHICLE_ID);
  console.log(`  Total rows in DB for K5: ${count}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
