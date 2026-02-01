#!/usr/bin/env npx tsx
/**
 * Show Auction Receipt
 *
 * Displays a complete receipt for a vehicle's auction appearance
 * including video moment link.
 *
 * Usage:
 *   npx tsx scripts/show-receipt.ts <lot_number> [price]
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

async function showReceipt(lotNumber: string, priceFilter?: number) {
  // First get auction event
  let aeQuery = supabase
    .from('auction_events')
    .select('*')
    .eq('lot_number', lotNumber.toUpperCase());

  if (priceFilter) {
    aeQuery = aeQuery.eq('winning_bid', priceFilter);
  } else {
    aeQuery = aeQuery.not('broadcast_timestamp_start', 'is', null);
  }

  const { data: aeRows, error: aeError } = await aeQuery.limit(1);

  if (aeError) {
    console.log(`Error: ${aeError.message}`);
    return;
  }

  const ae = aeRows?.[0];
  if (!ae) {
    console.log(`\nNo auction record found for lot ${lotNumber}\n`);
    return;
  }

  // Get vehicle separately
  let v: any = null;
  if (ae.vehicle_id) {
    const { data: vRows } = await supabase
      .from('vehicles')
      .select('id, year, make, model, vin')
      .eq('id', ae.vehicle_id)
      .limit(1);
    v = vRows?.[0];
  }

  const data = { ...ae, vehicles: v };
  const vehicle = `${v?.year} ${v?.make} ${v?.model}`;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  ${vehicle}`);
  console.log(`  ${data.source?.toUpperCase() || 'AUCTION'} - ${data.auction_name || ''}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Lot and Date
  console.log(`📍 Lot ${data.lot_number}`);
  if (data.auction_start_date) {
    console.log(`📅 ${new Date(data.auction_start_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`);
  }
  console.log('');

  // Timing (video moment)
  if (data.broadcast_timestamp_start) {
    const start = data.broadcast_timestamp_start;
    const end = data.broadcast_timestamp_end || start + 60;
    const duration = end - start;

    console.log(`🕐 On Block: ${formatTimestamp(start)} → ${formatTimestamp(end)} (${formatDuration(duration)})`);
    console.log('');
  }

  // Outcome
  if (data.winning_bid) {
    console.log(`✅ SOLD: $${data.winning_bid.toLocaleString()}`);
  } else if (data.outcome) {
    console.log(`📋 Outcome: ${data.outcome}`);
  }

  // Estimate comparison
  if (data.estimate_low && data.estimate_high) {
    console.log(`📊 Estimate: $${(data.estimate_low/1000).toFixed(0)}K - $${(data.estimate_high/1000).toFixed(0)}K`);
    if (data.winning_bid) {
      const mid = (data.estimate_low + data.estimate_high) / 2;
      const diff = ((data.winning_bid - mid) / mid * 100).toFixed(0);
      if (Math.abs(parseFloat(diff)) > 5) {
        const sign = parseFloat(diff) > 0 ? '+' : '';
        console.log(`   ${sign}${diff}% vs estimate`);
      }
    }
  }

  // Fees (if sold)
  if (data.winning_bid) {
    const hammer = data.winning_bid;
    const buyerPremium = hammer * 0.10;
    const buyerTotal = hammer + buyerPremium;
    const sellerComm = hammer * 0.10;
    const sellerEntry = 350;
    const sellerNet = hammer - sellerComm - sellerEntry;
    const houseTake = buyerPremium + sellerComm + sellerEntry;

    console.log('');
    console.log('💰 FEES (Mecum):');
    console.log(`   Buyer pays: $${buyerTotal.toLocaleString()} (incl 10% premium)`);
    console.log(`   Seller nets: $${sellerNet.toLocaleString()} (after 10% + $350)`);
    console.log(`   House take: $${houseTake.toLocaleString()}`);
  }

  // Video clip
  if (data.broadcast_video_url && data.broadcast_timestamp_start) {
    const watchUrl = `${data.broadcast_video_url}&t=${data.broadcast_timestamp_start}s`;
    const start = data.broadcast_timestamp_start;
    const end = data.broadcast_timestamp_end || start + 60;

    console.log('');
    console.log(`🎬 Watch: ${watchUrl}`);
    console.log(`   Clip: ${formatTimestamp(start)} - ${formatTimestamp(end)}`);
  }

  // Alert score
  if (data.forensics_data?.alertScore > 30) {
    console.log('');
    console.log(`⚠️ Alert Score: ${data.forensics_data.alertScore}`);
    data.forensics_data.alerts?.forEach((a: string) => console.log(`   - ${a}`));
  }

  console.log('');
  console.log('───────────────────────────────────────────────────────────────\n');
}

// Main
const lotNumber = process.argv[2];
const price = process.argv[3] ? parseInt(process.argv[3]) : undefined;

if (!lotNumber) {
  console.log('\nShow Auction Receipt\n');
  console.log('Usage: npx tsx scripts/show-receipt.ts <lot_number> [price]');
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx scripts/show-receipt.ts F199          # Shows one with video');
  console.log('  npx tsx scripts/show-receipt.ts F199 185000   # Filter by price\n');
  process.exit(0);
}

showReceipt(lotNumber, price);
