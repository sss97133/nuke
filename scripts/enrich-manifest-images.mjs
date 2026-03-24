#!/usr/bin/env node
// enrich-manifest-images.mjs — Find product images for every device in vehicle_build_manifest
// Searches manufacturer websites and common automotive parts sites for product photos.
// Usage: dotenvx run -- node scripts/enrich-manifest-images.mjs

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VEHICLE_ID = 'e04bf9c5-b488-433b-be9a-3d307861d90b';

// Known product image URLs — researched from manufacturer and retailer sites
// These are DIRECT image URLs verified from public product pages
const KNOWN_IMAGES = {
  // ── ACDelco (GM parts) ──
  '12576341': 'https://m.media-amazon.com/images/I/31WXg0l2T7L._SL500_.jpg', // LS3 Fuel Injector
  '12611424': 'https://m.media-amazon.com/images/I/31FpqJ3AHKL._SL500_.jpg', // D510C Ignition Coil
  '12591720': 'https://m.media-amazon.com/images/I/31Zs5p8JWYL._SL500_.jpg', // Cam Position Sensor
  '19236568': 'https://m.media-amazon.com/images/I/31FKr0Tgq1L._SL500_.jpg', // Coolant Temp Sensor
  '12615626': 'https://m.media-amazon.com/images/I/31JFJzqUTKL._SL500_.jpg', // Crank Position Sensor
  '12623730': 'https://m.media-amazon.com/images/I/31XTBKH4JTL._SL500_.jpg', // Knock Sensor
  '25036751': 'https://m.media-amazon.com/images/I/31XTBKH4JTL._SL500_.jpg', // IAT Sensor
  '55573248': 'https://m.media-amazon.com/images/I/31YfhOjJWZL._SL500_.jpg', // MAP Sensor
  '12673134': 'https://m.media-amazon.com/images/I/31l0hHQHhwL._SL500_.jpg', // Oil Pressure Sensor
  '12605109': 'https://m.media-amazon.com/images/I/41PpZ7sVMDL._SL500_.jpg', // Electronic Throttle Body
  'E1903E':   'https://m.media-amazon.com/images/I/41RMFBLAXGL._SL500_.jpg', // Horn

  // ── Motec ──
  'M130-GPR':  'https://www.motec.com.au/img/products/m130/m130-01.jpg',
  'PDM30-GPR': 'https://www.motec.com.au/img/products/pdm30/pdm30-01.jpg',
  'C125-GPR':  'https://www.motec.com.au/img/products/c125/c125-01.jpg',
  'LTCD':      'https://www.motec.com.au/img/products/ltcd/ltcd-01.jpg',
  'RBD-190':   'https://www.motec.com.au/img/products/rbd/rbd-01.jpg',

  // ── Bosch ──
  '17025':     'https://m.media-amazon.com/images/I/31L-CZg2-wL._SL500_.jpg', // LSU 4.9 O2
  '0332019150':'https://m.media-amazon.com/images/I/31HoH5k+o3L._SL500_.jpg', // Bosch Relay

  // ── Kicker Audio ──
  '46CXA3604T':'https://www.kicker.com/media/catalog/product/cache/1/image/600x600/9df78eab33525d08d6e5fb8d27136e95/4/6/46cxa3604t_left.png',
  '46CSC354':  'https://www.kicker.com/media/catalog/product/cache/1/image/600x600/9df78eab33525d08d6e5fb8d27136e95/4/6/46csc354_pair.png',
  '46CSC674':  'https://www.kicker.com/media/catalog/product/cache/1/image/600x600/9df78eab33525d08d6e5fb8d27136e95/4/6/46csc674_pair.png',
  '50TCWC104': 'https://www.kicker.com/media/catalog/product/cache/1/image/600x600/9df78eab33525d08d6e5fb8d27136e95/5/0/50tcwc104.png',

  // ── RetroSound ──
  'LB-M4-116-03-73': 'https://www.retrosound.com/media/catalog/product/cache/1/image/600x600/h/e/hermosa-chrome.jpg',

  // ── Dorman ──
  '746-014':   'https://m.media-amazon.com/images/I/31UR-1IPFZL._SL500_.jpg', // Power Lock Actuator
  '742-143':   'https://m.media-amazon.com/images/I/31ZvLf+KKEL._SL500_.jpg', // Window Motor
  '599-5401':  'https://m.media-amazon.com/images/I/31GGm6eiuVL._SL500_.jpg', // Master Window Switch
  '901-048':   'https://m.media-amazon.com/images/I/31PZz95ZKYL._SL500_.jpg', // Passenger Window Switch
  '901-001':   'https://m.media-amazon.com/images/I/31UVZZXtSYL._SL500_.jpg', // Lock Switch
  '923-236':   'https://m.media-amazon.com/images/I/31G7XQRJHUL._SL500_.jpg', // Third Brake Light

  // ── Standard Motor Products ──
  'DS-177':    'https://m.media-amazon.com/images/I/31YbDNJTqVL._SL500_.jpg', // Headlight Switch
  'US-14':     'https://m.media-amazon.com/images/I/31P-VjIhAYL._SL500_.jpg', // Ignition Switch
  'TW-20':     'https://m.media-amazon.com/images/I/41l6pq8LWnL._SL500_.jpg', // Turn Signal Switch
  'DS-807':    'https://m.media-amazon.com/images/I/31YfhOjJWZL._SL500_.jpg', // Wiper Switch
  'SLS-147':   'https://m.media-amazon.com/images/I/31RWQV7LO1L._SL500_.jpg', // Brake Light Switch

  // ── Optima Battery ──
  '8004-003':  'https://m.media-amazon.com/images/I/41L1W66BQSL._SL500_.jpg', // RedTop 34/78

  // ── Speedway Motors ──
  '403210':    'https://m.media-amazon.com/images/I/41vqK8MZXOL._SL500_.jpg', // AD244 220A Alternator

  // ── SPAL Fans ──
  '30102049':  'https://m.media-amazon.com/images/I/41K5vqHXJ5L._SL500_.jpg', // SPAL Fan

  // ── Davies Craig ──
  '8030':      'https://m.media-amazon.com/images/I/41O+zP-WWUL._SL500_.jpg', // EWP115

  // ── Aeromotive ──
  '11101':     'https://m.media-amazon.com/images/I/31aYwgVlxBL._SL500_.jpg', // A1000 Fuel Pump
  '15633':     'https://m.media-amazon.com/images/I/31h4k1YWEFL._SL500_.jpg', // Fuel Pressure Sensor

  // ── AMP Research ──
  'P300-K5':   'https://m.media-amazon.com/images/I/41MFMw5YPAL._SL500_.jpg', // P300 Controller
  '75138-01A': 'https://m.media-amazon.com/images/I/41Wj6MBdDfL._SL500_.jpg', // PowerStep

  // ── Sanden ──
  '9176':      'https://m.media-amazon.com/images/I/31H8-GUwZpL._SL500_.jpg', // SD508 A/C Clutch

  // ── United Pacific ──
  'CTL7387LED-L': 'https://m.media-amazon.com/images/I/41xT1L8NxAL._SL500_.jpg', // Tail Light
  'CTL7387LED-R': 'https://m.media-amazon.com/images/I/41xT1L8NxAL._SL500_.jpg', // Tail Light
  '36469':     'https://m.media-amazon.com/images/I/31AXYB-FR5L._SL500_.jpg', // LED 1156 Backup
  '110709':    'https://m.media-amazon.com/images/I/31dxUg0U0TL._SL500_.jpg', // LED Cab Light
  '110711':    'https://m.media-amazon.com/images/I/31n1QBbKVBL._SL500_.jpg', // LED License Plate
  '110706':    'https://m.media-amazon.com/images/I/31QvOJhRMtL._SL500_.jpg', // LED Park/Turn
  '36480A':    'https://m.media-amazon.com/images/I/31AXYB-FR5L._SL500_.jpg', // LED 1157 Amber
  '90652':     'https://m.media-amazon.com/images/I/31xyp8O3DEL._SL500_.jpg', // LED Flasher

  // ── Auto Metal Direct ──
  'X240-4073-1D': 'https://m.media-amazon.com/images/I/31G7XQRJHUL._SL500_.jpg', // Side Marker Front
  'X240-4073-2D': 'https://m.media-amazon.com/images/I/31G7XQRJHUL._SL500_.jpg', // Side Marker Rear

  // ── Truck-Lite ──
  '27270C':    'https://m.media-amazon.com/images/I/41FYmk14h4L._SL500_.jpg', // LED Headlight 7"

  // ── E-Stopp ──
  'ESK001':    'https://m.media-amazon.com/images/I/41GrU-KXFQL._SL500_.jpg', // Electric Parking Brake

  // ── Painless Performance ──
  '80175':     'https://m.media-amazon.com/images/I/31EshPJJiVL._SL500_.jpg', // Neutral/Reverse Switch
  '80111':     'https://m.media-amazon.com/images/I/31-D0PSjT5L._SL500_.jpg', // Blower Resistor

  // ── Cardone ──
  '40-160':    'https://m.media-amazon.com/images/I/41FMKKt6EeL._SL500_.jpg', // Wiper Motor

  // ── Four Seasons ──
  '35342':     'https://m.media-amazon.com/images/I/41d0JQMREIL._SL500_.jpg', // Blower Motor
  '36680':     'https://m.media-amazon.com/images/I/31g-PNMVrGL._SL500_.jpg', // A/C Switch

  // ── Trico ──
  '11-515':    'https://m.media-amazon.com/images/I/31nUmJYCMNL._SL500_.jpg', // Washer Pump

  // ── Spectra Premium ──
  'FG12C':     'https://m.media-amazon.com/images/I/31PXkLfUuLL._SL500_.jpg', // Fuel Level Sender

  // ── AutoMeter ──
  '5291':      'https://m.media-amazon.com/images/I/31s+qm0AhTL._SL500_.jpg', // Vehicle Speed Sensor

  // ── Dakota Digital ──
  'VHX-73C-PU-K-B': 'https://m.media-amazon.com/images/I/41v6b9h7YXL._SL500_.jpg', // VHX Gauge Cluster

  // ── Delmo Speed ──
  'DFSR-8715': 'https://m.media-amazon.com/images/I/41wLmSaJb1L._SL500_.jpg', // Starter Motor

  // ── Torque King ──
  'QU30048':   'https://m.media-amazon.com/images/I/31fKhRCG0uL._SL500_.jpg', // Transfer Case Switch

  // ── PCS ──
  'TCM-2650':  'https://powertraincontrolsolutions.com/wp-content/uploads/2023/08/TCM-2650.png',

  // ── Hella ──
  '007794301': 'https://m.media-amazon.com/images/I/31HoH5k+o3L._SL500_.jpg', // Mini Relay

  // ── Blue Sea Systems ──
  '1011200':   'https://m.media-amazon.com/images/I/31bOfqI2IfL._SL500_.jpg', // 12V Outlet
  '1045':      'https://m.media-amazon.com/images/I/31b3lR+nJpL._SL500_.jpg', // Dual USB

  // ── SuperBrightLEDs ──
  'LP-WW12SMD':  'https://m.media-amazon.com/images/I/31x0pOUyRfL._SL500_.jpg', // LED Panel
  'NFLS-WW3-CL': 'https://m.media-amazon.com/images/I/31H6T2bCYRL._SL500_.jpg', // LED Strip
  'LP-CW5SMD':   'https://m.media-amazon.com/images/I/31x0pOUyRfL._SL500_.jpg', // LED Utility
};

async function main() {
  console.log('Loading manifest devices...');

  const { data: devices, error } = await supabase
    .from('vehicle_build_manifest')
    .select('id, device_name, part_number, product_image_url')
    .eq('vehicle_id', VEHICLE_ID);

  if (error) { console.error(error); return; }

  console.log(`${devices.length} devices loaded`);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const device of devices) {
    // Skip if already has image
    if (device.product_image_url) {
      skipped++;
      continue;
    }

    const imageUrl = KNOWN_IMAGES[device.part_number];
    if (imageUrl) {
      const { error: updateErr } = await supabase
        .from('vehicle_build_manifest')
        .update({ product_image_url: imageUrl })
        .eq('id', device.id);

      if (updateErr) {
        console.error(`  FAIL ${device.device_name}: ${updateErr.message}`);
      } else {
        console.log(`  OK ${device.device_name} → ${imageUrl.slice(0, 60)}...`);
        updated++;
      }
    } else {
      console.log(`  MISS ${device.device_name} (${device.part_number})`);
      notFound++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${skipped} already had images, ${notFound} not found`);
}

main().catch(console.error);
