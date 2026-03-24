#!/usr/bin/env node
/**
 * create-k5-wiring-overlay.mjs
 *
 * Creates/upserts a vehicle_wiring_overlays record for the K5 Blazer,
 * links the LS swap template, and calls compute-wiring-overlay to
 * generate the full harness spec.
 *
 * Usage: dotenvx run -- node scripts/create-k5-wiring-overlay.mjs
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const K5_VEHICLE_ID = 'e04bf9c5-b488-433b-be9a-3d307861d90b';
const GENERATION = 'squarebody_1973_1987';
const TEMPLATE_SLUG = 'ls-swap-motec-m150-pdm30';

async function main() {
  console.log('=== K5 Blazer Wiring Overlay Creator ===\n');

  // ─── Step 1: Verify the K5 vehicle exists ──────────────────────────
  const { data: vehicle, error: vErr } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('id', K5_VEHICLE_ID)
    .single();

  if (vErr || !vehicle) {
    console.error('K5 vehicle not found:', vErr?.message);
    process.exit(1);
  }
  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})`);

  // ─── Step 2: Find the LS swap template ─────────────────────────────
  const { data: template, error: tErr } = await supabase
    .from('upgrade_templates')
    .select('id, name')
    .eq('slug', TEMPLATE_SLUG)
    .maybeSingle();

  if (tErr || !template) {
    console.error(`Template "${TEMPLATE_SLUG}" not found. Run seed-ls-swap-template.mjs first.`);
    process.exit(1);
  }
  console.log(`Template: ${template.name} (${template.id})`);

  // ─── Step 3: Check existing overlay ────────────────────────────────
  const { data: existingOverlay } = await supabase
    .from('vehicle_wiring_overlays')
    .select('id, status, applied_upgrade_ids')
    .eq('vehicle_id', K5_VEHICLE_ID)
    .maybeSingle();

  if (existingOverlay) {
    console.log(`\nExisting overlay found: ${existingOverlay.id} (status: ${existingOverlay.status})`);

    // Check if template already linked
    const alreadyLinked = (existingOverlay.applied_upgrade_ids || []).includes(template.id);
    if (alreadyLinked) {
      console.log('  LS swap template already linked.');
    } else {
      // Add template to applied_upgrade_ids
      const updatedIds = [...(existingOverlay.applied_upgrade_ids || []), template.id];
      const { error: updateErr } = await supabase
        .from('vehicle_wiring_overlays')
        .update({
          applied_upgrade_ids: updatedIds,
          wiring_tier: 'ultra',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingOverlay.id);

      if (updateErr) {
        console.error('Failed to update overlay:', updateErr.message);
        process.exit(1);
      }
      console.log('  Linked LS swap template to existing overlay.');
    }
  } else {
    // Create new overlay
    console.log('\nNo existing overlay. Creating new one...');
    const { error: createErr } = await supabase
      .from('vehicle_wiring_overlays')
      .insert({
        vehicle_id: K5_VEHICLE_ID,
        factory_generation: GENERATION,
        wiring_tier: 'ultra',
        status: 'planning',
        applied_upgrade_ids: [template.id],
        notes: 'LS swap with Motec M150 ECU + PDM30 power distribution',
      });

    if (createErr) {
      console.error('Failed to create overlay:', createErr.message);
      process.exit(1);
    }
    console.log('  Created new overlay record.');
  }

  // ─── Step 4: Call compute-wiring-overlay ────────────────────────────
  console.log('\nCalling compute-wiring-overlay edge function...');

  const computeUrl = `${process.env.VITE_SUPABASE_URL}/functions/v1/compute-wiring-overlay`;
  const response = await fetch(computeUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      vehicle_id: K5_VEHICLE_ID,
      action: 'compute',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`  Edge function returned ${response.status}: ${errText}`);
    console.log('\n  Note: compute-wiring-overlay requires devices in vehicle_build_manifest.');
    console.log('  If the build manifest is empty, populate it first.');
  } else {
    const result = await response.json();

    console.log('\n=== Compute Results ===');
    console.log(`  Total devices:     ${result.summary?.total_devices || 0}`);
    console.log(`  Total wires:       ${result.summary?.total_wires || 0}`);
    console.log(`  Total wire length: ${result.summary?.total_wire_length_ft || 0} ft`);
    console.log(`  Shielded wires:    ${result.summary?.shielded_wires || 0}`);
    console.log(`  Twisted pairs:     ${result.summary?.twisted_pairs || 0}`);
    console.log(`  Continuous amps:   ${result.summary?.total_continuous_amps || 0}A`);
    console.log(`\n  ECU requirement:   ${result.ecu?.model} — ${result.ecu?.reason}`);
    console.log(`  Alternator:        ${result.alternator?.recommendation}`);
    console.log(`  PDM model:         ${result.pdm?.model} (${result.pdm?.channels_used}/${result.pdm?.channels_available} channels)`);

    if (result.warnings?.length > 0) {
      console.log(`\n  Warnings (${result.warnings.length}):`);
      for (const w of result.warnings) {
        console.log(`    - ${w}`);
      }
    }

    // Show I/O requirements
    if (result.io_requirements) {
      const io = result.io_requirements;
      console.log('\n  I/O Requirements:');
      console.log(`    Injector outputs:    ${io.injectorOutputs}`);
      console.log(`    Ignition outputs:    ${io.ignitionOutputs}`);
      console.log(`    Half-bridge outputs: ${io.halfBridgeOutputs}`);
      console.log(`    Analog inputs:       ${io.analogInputs}`);
      console.log(`    Temp inputs:         ${io.tempInputs}`);
      console.log(`    Digital inputs:      ${io.digitalInputs}`);
      console.log(`    Knock inputs:        ${io.knockInputs}`);
      console.log(`    CAN buses:           ${io.canBuses}`);
    }
  }

  // ─── Step 5: Verify final state ────────────────────────────────────
  const { data: finalOverlay } = await supabase
    .from('vehicle_wiring_overlays')
    .select('*')
    .eq('vehicle_id', K5_VEHICLE_ID)
    .single();

  console.log('\n=== Final Overlay State ===');
  console.log(`  ID:                 ${finalOverlay.id}`);
  console.log(`  Vehicle:            ${K5_VEHICLE_ID}`);
  console.log(`  Generation:         ${finalOverlay.factory_generation}`);
  console.log(`  Wiring tier:        ${finalOverlay.wiring_tier}`);
  console.log(`  Status:             ${finalOverlay.status}`);
  console.log(`  Total circuits:     ${finalOverlay.total_circuits}`);
  console.log(`  Total wire length:  ${finalOverlay.total_wire_length_ft} ft`);
  console.log(`  Estimated hours:    ${finalOverlay.estimated_hours}`);
  console.log(`  Applied upgrades:   ${(finalOverlay.applied_upgrade_ids || []).length}`);
  console.log(`  Updated at:         ${finalOverlay.updated_at}`);

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
