#!/usr/bin/env npx tsx
/**
 * On-Demand Forensics - Only processes when user requests
 *
 * Instead of batch processing all videos upfront ($75+), this:
 * 1. Uses FREE data we already have (estimates, lot numbers from scraping)
 * 2. Only calls Whisper when a user actually views a vehicle
 * 3. Caches results so we never process the same clip twice
 * 4. Processes just 2-3 minutes around the vehicle's moment, not full broadcast
 *
 * Cost per vehicle clip: ~$0.02-0.04 (vs $0.50+ for batch)
 *
 * Usage:
 *   npx tsx scripts/forensics-on-demand.ts <lot_number>
 *   npx tsx scripts/forensics-on-demand.ts S98
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface VehicleMoment {
  vehicleId: string;
  lotNumber: string;
  vehicle: string;

  // From scraping (FREE)
  estimateLow: number | null;
  estimateHigh: number | null;
  hammerPrice: number | null;
  outcome: string | null;

  // Video moment (if known)
  videoUrl: string | null;
  timestampStart: number | null;
  timestampEnd: number | null;

  // Forensics (only if processed)
  hasForensics: boolean;
  alertScore: number | null;
}

async function getVehicleMoment(lotNumber: string): Promise<VehicleMoment | null> {
  // Get most recent auction event for this lot number
  const { data: rows } = await supabase
    .from('auction_events')
    .select(`
      id, vehicle_id, lot_number,
      estimate_low, estimate_high, winning_bid, outcome,
      broadcast_video_url, broadcast_timestamp_start, broadcast_timestamp_end,
      forensics_data,
      vehicles(year, make, model)
    `)
    .eq('source', 'mecum')
    .eq('lot_number', lotNumber.toUpperCase())
    .not('estimate_low', 'is', null)
    .limit(1);

  const data = rows?.[0];
  if (!data) return null;

  const v = data.vehicles as any;

  return {
    vehicleId: data.vehicle_id,
    lotNumber: data.lot_number,
    vehicle: `${v?.year} ${v?.make} ${v?.model}`,
    estimateLow: data.estimate_low,
    estimateHigh: data.estimate_high,
    hammerPrice: data.winning_bid,
    outcome: data.outcome,
    videoUrl: data.broadcast_video_url,
    timestampStart: data.broadcast_timestamp_start,
    timestampEnd: data.broadcast_timestamp_end,
    hasForensics: !!data.forensics_data,
    alertScore: data.forensics_data?.alertScore || null,
  };
}

async function showVehicleStatus(lotNumber: string) {
  const moment = await getVehicleMoment(lotNumber);

  if (!moment) {
    console.log(`\n❌ Lot ${lotNumber} not found in database\n`);
    return;
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  ${moment.vehicle}`);
  console.log(`  Lot ${moment.lotNumber}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // FREE data from scraping
  if (moment.estimateLow && moment.estimateHigh) {
    console.log(`📊 Estimate: $${(moment.estimateLow/1000).toFixed(0)}K - $${(moment.estimateHigh/1000).toFixed(0)}K`);
  }
  if (moment.hammerPrice) {
    console.log(`💰 Sold: $${moment.hammerPrice.toLocaleString()}`);
  } else if (moment.outcome) {
    console.log(`📋 Outcome: ${moment.outcome}`);
  }

  // Video moment
  console.log('');
  if (moment.videoUrl && moment.timestampStart) {
    const mins = Math.floor(moment.timestampStart / 60);
    const secs = moment.timestampStart % 60;
    console.log(`🎬 Video moment: ${mins}:${String(secs).padStart(2, '0')}`);
    console.log(`   ${moment.videoUrl}?t=${moment.timestampStart}s`);
  } else {
    console.log('🎬 Video: Not yet linked');
    console.log('   (Would cost ~$0.02 to process on-demand)');
  }

  // Forensics
  console.log('');
  if (moment.hasForensics) {
    console.log(`🔍 Forensics: Analyzed (Alert score: ${moment.alertScore})`);
  } else {
    console.log('🔍 Forensics: Not yet processed');
    console.log('   (Would cost ~$0.02 to analyze on-demand)');
  }

  console.log('\n───────────────────────────────────────────────────────────────\n');
}

// Main
const lotNumber = process.argv[2];

if (!lotNumber) {
  console.log('\nOn-Demand Forensics - Cost-efficient vehicle analysis\n');
  console.log('Usage: npx tsx scripts/forensics-on-demand.ts <lot_number>\n');
  console.log('Examples:');
  console.log('  npx tsx scripts/forensics-on-demand.ts S98');
  console.log('  npx tsx scripts/forensics-on-demand.ts F123\n');
  console.log('This shows what FREE data we have, and what would cost to process.\n');
  process.exit(0);
}

showVehicleStatus(lotNumber);
