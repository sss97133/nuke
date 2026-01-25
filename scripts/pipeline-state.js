#!/usr/bin/env node
/**
 * Pipeline State Intelligence
 *
 * Provides comprehensive state for zero-context agents to understand:
 * - Discovery progress per source
 * - Extraction progress per source
 * - What's queued vs processed
 * - Where to pick up from
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function query(endpoint) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'count=exact'
    }
  });
  const count = res.headers.get('content-range')?.split('/')[1];
  const data = await res.json();
  return { count: parseInt(count || '0'), data: Array.isArray(data) ? data : [] };
}

async function getPipelineState() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  PIPELINE STATE INTELLIGENCE                               ║');
  console.log('║  Use this to understand extraction progress                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const sources = [
    { name: 'bat', aliases: ['bringatrailer', 'bat'] },
    { name: 'carsandbids', aliases: ['carsandbids', 'c&b'] },
    { name: 'mecum', aliases: ['mecum'] },
    { name: 'hagerty', aliases: ['hagerty'] },
    { name: 'pcarmarket', aliases: ['pcarmarket'] },
    { name: 'hemmings', aliases: ['hemmings'] },
  ];

  console.log('DISCOVERY & EXTRACTION STATUS BY SOURCE:');
  console.log('═'.repeat(60));

  for (const src of sources) {
    // Vehicles by status
    const pending = await query(`vehicles?discovery_source=eq.${src.name}&status=eq.pending&select=id&limit=1`);
    const active = await query(`vehicles?discovery_source=eq.${src.name}&status=eq.active&select=id&limit=1`);
    const total = pending.count + active.count;

    // Auction events
    const events = await query(`auction_events?source=eq.${src.name}&select=id&limit=1`);

    // VIN coverage
    const withVin = await query(`vehicles?discovery_source=eq.${src.name}&vin=not.is.null&select=id&limit=1`);

    const pct = total > 0 ? Math.round((active.count / total) * 100) : 0;
    const vinPct = total > 0 ? Math.round((withVin.count / total) * 100) : 0;

    console.log(`\n${src.name.toUpperCase()}`);
    console.log(`  Discovered:     ${total.toLocaleString()} vehicles`);
    console.log(`  Extracted:      ${active.count.toLocaleString()} (${pct}%)`);
    console.log(`  Pending:        ${pending.count.toLocaleString()}`);
    console.log(`  VIN Coverage:   ${vinPct}%`);
    console.log(`  Auction Events: ${events.count.toLocaleString()}`);
  }

  // Check import_queue
  console.log('\n' + '═'.repeat(60));
  console.log('IMPORT QUEUE STATUS:');
  const iqTotal = await query('import_queue?select=id&limit=1');
  const iqPending = await query('import_queue?status=eq.pending&select=id&limit=1');
  const iqProcessed = await query('import_queue?status=eq.processed&select=id&limit=1');
  const iqFailed = await query('import_queue?status=eq.failed&select=id&limit=1');

  console.log(`  Total:     ${iqTotal.count.toLocaleString()}`);
  console.log(`  Pending:   ${iqPending.count.toLocaleString()}`);
  console.log(`  Processed: ${iqProcessed.count.toLocaleString()}`);
  console.log(`  Failed:    ${iqFailed.count.toLocaleString()}`);

  // Check bat_listings (discovered BaT URLs)
  console.log('\n' + '═'.repeat(60));
  console.log('BAT DISCOVERY STATUS:');
  const batListings = await query('bat_listings?select=id&limit=1');
  const batWithVehicle = await query('bat_listings?vehicle_id=not.is.null&select=id&limit=1');
  const batWithComments = await query('bat_listings?comments_extracted_at=not.is.null&select=id&limit=1');

  console.log(`  Discovered URLs:    ${batListings.count.toLocaleString()}`);
  console.log(`  Linked to Vehicle:  ${batWithVehicle.count.toLocaleString()}`);
  console.log(`  Comments Extracted: ${batWithComments.count.toLocaleString()}`);
  console.log(`  Unlinked:          ${(batListings.count - batWithVehicle.count).toLocaleString()}`);

  // Check external_listings
  console.log('\n' + '═'.repeat(60));
  console.log('EXTERNAL LISTINGS:');
  const extTotal = await query('external_listings?select=id&limit=1');
  console.log(`  Total: ${extTotal.count.toLocaleString()}`);

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('TOTALS:');
  const totalVehicles = await query('vehicles?select=id&limit=1');
  const totalEvents = await query('auction_events?select=id&limit=1');
  const totalWithVin = await query('vehicles?vin=not.is.null&select=id&limit=1');

  console.log(`  Vehicles:       ${totalVehicles.count.toLocaleString()}`);
  console.log(`  With VIN:       ${totalWithVin.count.toLocaleString()} (${Math.round(totalWithVin.count/totalVehicles.count*100)}%)`);
  console.log(`  Auction Events: ${totalEvents.count.toLocaleString()}`);

  // Recommended actions
  console.log('\n' + '═'.repeat(60));
  console.log('RECOMMENDED ACTIONS:');

  for (const src of sources) {
    const pending = await query(`vehicles?discovery_source=eq.${src.name}&status=eq.pending&select=id&limit=1`);
    if (pending.count > 0) {
      console.log(`  - ${src.name}: ${pending.count.toLocaleString()} pending extraction`);
    }
  }

  const unlinkedBat = batListings.count - batWithVehicle.count;
  if (unlinkedBat > 0) {
    console.log(`  - BaT: ${unlinkedBat.toLocaleString()} discovered URLs not linked to vehicles`);
  }
}

getPipelineState().catch(console.error);
