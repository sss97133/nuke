#!/usr/bin/env node
// scrape-product-images.mjs — Scrape real product images from retailer sites
// Uses Summit Racing, RockAuto, and manufacturer sites
// Usage: dotenvx run -- node scripts/scrape-product-images.mjs

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VEHICLE_ID = 'e04bf9c5-b488-433b-be9a-3d307861d90b';

// Search queries for finding product images
// Map: part_number → { query, manufacturer }
const PARTS_TO_SEARCH = [
  // ACDelco
  { pn: '12576341', q: 'ACDelco 217-2425 fuel injector LS3', mfr: 'ACDelco' },
  { pn: '12611424', q: 'ACDelco D510C ignition coil LS3', mfr: 'ACDelco' },
  { pn: '12591720', q: 'ACDelco 213-3826 cam sensor LS', mfr: 'ACDelco' },
  { pn: '19236568', q: 'ACDelco 213-4514 coolant temp sensor', mfr: 'ACDelco' },
  { pn: '12615626', q: 'ACDelco 213-4573 crank sensor LS', mfr: 'ACDelco' },
  { pn: '12623730', q: 'ACDelco 213-1576 knock sensor LS', mfr: 'ACDelco' },
  { pn: '25036751', q: 'ACDelco 25036751 IAT sensor', mfr: 'ACDelco' },
  { pn: '55573248', q: 'ACDelco 55573248 MAP sensor', mfr: 'ACDelco' },
  { pn: '12673134', q: 'ACDelco D1846A oil pressure sensor', mfr: 'ACDelco' },
  { pn: '12605109', q: 'GM 12605109 throttle body LS3 DBW', mfr: 'GM' },
  { pn: 'E1903E', q: 'ACDelco E1903E horn', mfr: 'ACDelco' },
  // Dorman
  { pn: '746-014', q: 'Dorman 746-014 door lock actuator', mfr: 'Dorman' },
  { pn: '742-143', q: 'Dorman 742-143 window motor', mfr: 'Dorman' },
  { pn: '599-5401', q: 'Dorman 599-5401 window switch', mfr: 'Dorman' },
  { pn: '901-048', q: 'Dorman 901-048 window switch', mfr: 'Dorman' },
  { pn: '901-001', q: 'Dorman 901-001 lock switch', mfr: 'Dorman' },
  { pn: '923-236', q: 'Dorman 923-236 third brake light', mfr: 'Dorman' },
  // SMP
  { pn: 'DS-177', q: 'Standard Motor Products DS-177 headlight switch', mfr: 'SMP' },
  { pn: 'US-14', q: 'Standard Motor Products US-14 ignition switch', mfr: 'SMP' },
  { pn: 'TW-20', q: 'Standard Motor Products TW-20 turn signal switch', mfr: 'SMP' },
  { pn: 'DS-807', q: 'Standard Motor Products DS-807 wiper switch', mfr: 'SMP' },
  { pn: 'SLS-147', q: 'Standard Motor Products SLS-147 brake light switch', mfr: 'SMP' },
  // Other
  { pn: '8004-003', q: 'Optima 8004-003 RedTop battery', mfr: 'Optima' },
  { pn: '403210', q: 'Speedway Motors AD244 220A alternator', mfr: 'Speedway' },
  { pn: '30102049', q: 'SPAL 30102049 electric fan', mfr: 'SPAL' },
  { pn: '8030', q: 'Davies Craig EWP115 electric water pump 8030', mfr: 'Davies Craig' },
  { pn: '11101', q: 'Aeromotive A1000 fuel pump 11101', mfr: 'Aeromotive' },
  { pn: '15633', q: 'Aeromotive fuel pressure sensor 15633', mfr: 'Aeromotive' },
  { pn: 'P300-K5', q: 'AMP Research P300 controller', mfr: 'AMP Research' },
  { pn: '75138-01A', q: 'AMP Research 75138-01A PowerStep', mfr: 'AMP Research' },
  { pn: '9176', q: 'Sanden SD508 AC compressor clutch', mfr: 'Sanden' },
  { pn: '27270C', q: 'Truck-Lite 27270C LED headlight 7 inch', mfr: 'Truck-Lite' },
  { pn: 'ESK001', q: 'E-Stopp ESK001 electric parking brake', mfr: 'E-Stopp' },
  { pn: '80175', q: 'Painless Performance 80175 neutral safety switch', mfr: 'Painless' },
  { pn: '80111', q: 'Painless Performance 80111 blower resistor', mfr: 'Painless' },
  { pn: '40-160', q: 'Cardone 40-160 wiper motor', mfr: 'Cardone' },
  { pn: '35342', q: 'Four Seasons 35342 blower motor', mfr: 'Four Seasons' },
  { pn: '36680', q: 'Four Seasons 36680 AC pressure switch', mfr: 'Four Seasons' },
  { pn: '11-515', q: 'Trico 11-515 washer pump', mfr: 'Trico' },
  { pn: 'FG12C', q: 'Spectra Premium FG12C fuel sender', mfr: 'Spectra' },
  { pn: '5291', q: 'AutoMeter 5291 speed sensor', mfr: 'AutoMeter' },
  { pn: 'VHX-73C-PU-K-B', q: 'Dakota Digital VHX-73C gauge cluster', mfr: 'Dakota Digital' },
  { pn: 'DFSR-8715', q: 'Delmo Speed starter motor', mfr: 'Delmo' },
  { pn: 'QU30048', q: 'Torque King QU30048 transfer case switch', mfr: 'Torque King' },
  { pn: '46CXA3604T', q: 'Kicker CXA360.4 amplifier', mfr: 'Kicker' },
  { pn: '46CSC354', q: 'Kicker CSC354 speaker', mfr: 'Kicker' },
  { pn: '46CSC674', q: 'Kicker CSC674 speaker', mfr: 'Kicker' },
  { pn: '50TCWC104', q: 'Kicker CompC 10 subwoofer', mfr: 'Kicker' },
  { pn: 'LB-M4-116-03-73', q: 'RetroSound Hermosa M4 head unit', mfr: 'RetroSound' },
  { pn: '1011200', q: 'Blue Sea Systems 1011200 12V outlet', mfr: 'Blue Sea' },
  { pn: '1045', q: 'Blue Sea Systems 1045 dual USB', mfr: 'Blue Sea' },
  { pn: '17025', q: 'Bosch 17025 LSU 4.9 O2 sensor', mfr: 'Bosch' },
  { pn: '0332019150', q: 'Bosch 0332019150 relay', mfr: 'Bosch' },
  { pn: '007794301', q: 'Hella 007794301 relay', mfr: 'Hella' },
  { pn: 'CTL7387LED-L', q: 'United Pacific CTL7387LED tail light squarebody', mfr: 'United Pacific' },
  { pn: '36469', q: 'United Pacific 36469 LED 1156', mfr: 'United Pacific' },
  { pn: '110709', q: 'United Pacific 110709 cab light squarebody', mfr: 'United Pacific' },
  { pn: '110711', q: 'United Pacific 110711 license light', mfr: 'United Pacific' },
  { pn: '110706', q: 'United Pacific 110706 park turn light', mfr: 'United Pacific' },
  { pn: '36480A', q: 'United Pacific 36480A LED 1157 amber', mfr: 'United Pacific' },
  { pn: '90652', q: 'United Pacific 90652 LED flasher', mfr: 'United Pacific' },
];

// Try Summit Racing API-like URL for product images
async function trySummitRacing(partNumber) {
  try {
    const url = `https://www.summitracing.com/search/${encodeURIComponent(partNumber)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    // Look for product image in meta tags
    const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
    if (ogMatch) return ogMatch[1];
    // Look for product image in img tags
    const imgMatch = html.match(/class="product-image[^"]*"[^>]*src="([^"]+)"/);
    if (imgMatch) return imgMatch[1];
    return null;
  } catch { return null; }
}

async function main() {
  console.log(`Searching for product images for ${PARTS_TO_SEARCH.length} parts...`);

  const results = {};
  let found = 0;

  for (const part of PARTS_TO_SEARCH) {
    // Try Summit Racing
    const summitUrl = await trySummitRacing(part.pn);
    if (summitUrl) {
      results[part.pn] = summitUrl;
      console.log(`  SUMMIT ${part.pn} → ${summitUrl.slice(0, 80)}`);
      found++;
    } else {
      console.log(`  MISS ${part.pn} (${part.mfr})`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nFound ${found}/${PARTS_TO_SEARCH.length} via Summit Racing`);
  console.log('\nResults JSON:');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
