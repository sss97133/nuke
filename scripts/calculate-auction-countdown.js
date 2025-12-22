#!/usr/bin/env node
/**
 * CALCULATE AUCTION COUNTDOWN
 * 
 * Calculates and displays countdown for PCarMarket auctions
 * Can be used to continuously update countdown display
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Calculate countdown from end date
 */
function calculateCountdown(endDate) {
  if (!endDate) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      total_seconds: 0,
      is_expired: true,
      formatted: 'No end date',
      formatted_short: 'N/A'
    };
  }
  
  const now = new Date();
  const end = new Date(endDate);
  const diffMs = end.getTime() - now.getTime();
  const totalSeconds = Math.floor(diffMs / 1000);
  
  if (totalSeconds <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      total_seconds: 0,
      is_expired: true,
      formatted: 'Auction ended',
      formatted_short: 'Ended'
    };
  }
  
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  // Formatted strings
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (seconds > 0 && days === 0 && hours === 0) parts.push(`${seconds}s`);
  
  const formattedShort = parts.join(' ') || '<1m';
  
  const partsLong = [];
  if (days > 0) partsLong.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) partsLong.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0 && days === 0) partsLong.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0 && days === 0 && hours === 0) partsLong.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  const formatted = partsLong.join(', ') || 'Less than a minute';
  
  return {
    days,
    hours,
    minutes,
    seconds,
    total_seconds: totalSeconds,
    is_expired: false,
    formatted,
    formatted_short: formattedShort,
    percentage_complete: null // Can calculate if we have start date
  };
}

/**
 * Get countdown for a vehicle
 */
async function getVehicleCountdown(vehicleId) {
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, auction_end_date, origin_metadata')
    .eq('id', vehicleId)
    .single();
  
  if (!vehicle) {
    console.error('Vehicle not found');
    return null;
  }
  
  // Try to get end date from various sources
  let endDate = vehicle.auction_end_date;
  
  if (!endDate && vehicle.origin_metadata?.auction_times?.auction_end_date) {
    endDate = vehicle.origin_metadata.auction_times.auction_end_date;
  }
  
  if (!endDate && vehicle.origin_metadata?.pcarmarket_auction_end_date) {
    endDate = vehicle.origin_metadata.pcarmarket_auction_end_date;
  }
  
  const countdown = calculateCountdown(endDate);
  
  return {
    vehicle_id: vehicleId,
    end_date: endDate,
    countdown,
    updated_at: new Date().toISOString()
  };
}

/**
 * Display countdown in real-time (updates every second)
 */
async function displayLiveCountdown(vehicleId, intervalSeconds = 1) {
  console.log(`\n⏱️  Live Countdown for Vehicle: ${vehicleId}\n`);
  console.log('Press Ctrl+C to stop\n');
  
  const update = async () => {
    const result = await getVehicleCountdown(vehicleId);
    if (result) {
      process.stdout.write('\r\x1b[K'); // Clear line
      if (result.countdown.is_expired) {
        process.stdout.write(`   ⏹️  Auction Ended`);
      } else {
        process.stdout.write(`   ⏰ ${result.countdown.formatted_short.padEnd(20)} | ${result.countdown.formatted}`);
      }
    }
  };
  
  // Update immediately
  await update();
  
  // Update every interval
  const interval = setInterval(update, intervalSeconds * 1000);
  
  // Handle cleanup
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n\n✅ Countdown stopped\n');
    process.exit(0);
  });
}

// Main
async function main() {
  const vehicleId = process.argv[2];
  const live = process.argv.includes('--live');
  
  if (!vehicleId) {
    console.log('Usage: node scripts/calculate-auction-countdown.js <vehicle_id> [--live]');
    console.log('\nExample:');
    console.log('  node scripts/calculate-auction-countdown.js e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8');
    console.log('  node scripts/calculate-auction-countdown.js e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8 --live');
    process.exit(1);
  }
  
  if (live) {
    await displayLiveCountdown(vehicleId);
  } else {
    const result = await getVehicleCountdown(vehicleId);
    if (result) {
      console.log('\n⏱️  Auction Countdown\n');
      console.log(`Vehicle ID: ${result.vehicle_id}`);
      console.log(`End Date: ${result.end_date || 'Not set'}`);
      console.log(`\nCountdown:`);
      console.log(`   Days: ${result.countdown.days}`);
      console.log(`   Hours: ${result.countdown.hours}`);
      console.log(`   Minutes: ${result.countdown.minutes}`);
      console.log(`   Seconds: ${result.countdown.seconds}`);
      console.log(`   Total Seconds: ${result.countdown.total_seconds}`);
      console.log(`   Formatted: ${result.countdown.formatted}`);
      console.log(`   Short: ${result.countdown.formatted_short}`);
      console.log(`   Expired: ${result.countdown.is_expired ? 'Yes' : 'No'}`);
      console.log(`\nUpdated: ${result.updated_at}\n`);
    }
  }
}

main();

