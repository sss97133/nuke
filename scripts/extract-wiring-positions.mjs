#!/usr/bin/env node
// extract-wiring-positions.mjs — Vision AI position extraction for wiring diagram devices
// Feeds reference images to Claude vision, extracts device positions as x/y percentages,
// fuzzy-matches against vehicle_build_manifest, and writes pos_x_pct / pos_y_pct to DB.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLAUDE_API_KEY = process.env.NUKE_CLAUDE_API || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
const VEHICLE_ID = process.env.VEHICLE_ID || 'e04bf9c5-b488-433b-be9a-3d307861d90b';
const USE_FALLBACK = process.argv.includes('--fallback');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required env vars: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!CLAUDE_API_KEY && !USE_FALLBACK) {
  console.error('Missing NUKE_CLAUDE_API / CLAUDE_API_KEY. Use --fallback to write inferDevicePosition positions instead.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Infer device position (Node.js port of inferDevicePosition from WiringWorkspace.tsx) ──
function inferDevicePositionNode(deviceName, zone) {
  const n = deviceName.toLowerCase();
  zone = zone || 'dash';
  const isLeft = /\bleft\b|\bl\b$|\bdriver\b/i.test(deviceName);
  const isRight = /\bright\b|\br\b$|\bpasseng/i.test(deviceName);
  const sideX = isLeft ? 25 : isRight ? 75 : 50;

  if (zone === 'engine_bay') {
    if (/radiator fan 1/i.test(n)) return { x: 42, y: 7 };
    if (/radiator fan 2/i.test(n)) return { x: 58, y: 7 };
    if (/horn/i.test(n)) return { x: 50, y: 6 };
    if (/water pump/i.test(n)) return { x: 50, y: 8 };
    if (/underhood/i.test(n)) return { x: 50, y: 5 };
    if (/electronic throttle/i.test(n)) return { x: 50, y: 10 };
    if (/fuel injector/i.test(n)) {
      const num = parseInt(n.replace(/\D/g, '')) || 1;
      return { x: num % 2 === 1 ? 40 : 60, y: 11 + Math.floor((num - 1) / 2) * 2 };
    }
    if (/ignition coil/i.test(n)) {
      const num = parseInt(n.replace(/\D/g, '')) || 1;
      return { x: num <= 4 ? 35 : 65, y: 11 + ((num - 1) % 4) * 2 };
    }
    if (/a\/c compressor|ac compressor/i.test(n)) return { x: 72, y: 19 };
    if (/alternator/i.test(n)) return { x: 68, y: 13 };
    if (/starter/i.test(n)) return { x: 62, y: 27 };
    if (/battery disconnect/i.test(n)) return { x: 78, y: 18 };
    if (/battery/i.test(n)) return { x: 76, y: 15 };
    if (/led headlight|headlight/i.test(n)) return { x: sideX, y: 6 };
    if (/parking light/i.test(n)) return { x: sideX, y: 7 };
    if (/turn signal/i.test(n) && !/switch/i.test(n)) return { x: sideX, y: 5 };
    if (/side marker.*front/i.test(n)) return { x: isLeft ? 18 : 82, y: 20 };
    if (/map sensor/i.test(n)) return { x: 50, y: 11 };
    if (/throttle position/i.test(n)) return { x: 52, y: 10 };
    if (/intake air|iat/i.test(n)) return { x: 50, y: 9 };
    if (/oil pressure/i.test(n)) return { x: 45, y: 22 };
    if (/oil temp/i.test(n)) return { x: 47, y: 23 };
    if (/coolant temp/i.test(n)) return { x: 56, y: 9 };
    if (/knock.*1|knock.*bank 1/i.test(n)) return { x: 38, y: 20 };
    if (/knock.*2|knock.*bank 2/i.test(n)) return { x: 62, y: 20 };
    if (/cam.*position/i.test(n)) return { x: 42, y: 14 };
    if (/crank.*position/i.test(n)) return { x: 58, y: 25 };
    if (/fuel pressure/i.test(n)) return { x: 48, y: 13 };
    if (/wideband|lambda|o2 sensor 1/i.test(n)) return { x: 35, y: 26 };
    if (/a\/c.*pressure/i.test(n)) return { x: 70, y: 20 };
    if (/\becu\b/i.test(n)) return { x: 35, y: 29 };
    if (/star ground|ground point/i.test(n)) return { x: 45, y: 28 };
    if (/fuel pump relay/i.test(n)) return { x: 55, y: 30 };
    if (/windshield wiper/i.test(n)) return { x: 48, y: 32 };
    if (/washer pump/i.test(n)) return { x: 43, y: 31 };
    if (/heater blower/i.test(n)) return { x: 65, y: 30 };
    return { x: 50, y: 20 };
  }
  if (zone === 'firewall') {
    if (/booster|ibooster/i.test(n)) return { x: 30, y: 33 };
    return { x: 50, y: 33 };
  }
  if (zone === 'dash' || zone === 'interior') {
    if (/display|gauge|dakota digital/i.test(n)) return { x: 32, y: 37 };
    if (/radio|head unit/i.test(n)) return { x: 50, y: 38 };
    if (/hazard/i.test(n)) return { x: 50, y: 37 };
    if (/cigarette|power outlet/i.test(n)) return { x: 50, y: 42 };
    if (/usb/i.test(n)) return { x: 52, y: 42 };
    if (/headlight.*switch/i.test(n)) return { x: 30, y: 38 };
    if (/turn signal.*switch/i.test(n)) return { x: 32, y: 40 };
    if (/wiper.*switch|washer.*switch/i.test(n)) return { x: 32, y: 41 };
    if (/blower.*switch|blower speed/i.test(n)) return { x: 58, y: 39 };
    if (/a\/c.*switch/i.test(n)) return { x: 58, y: 40 };
    if (/brake light switch/i.test(n)) return { x: 35, y: 43 };
    if (/neutral safety/i.test(n)) return { x: 50, y: 46 };
    if (/transmission control/i.test(n)) return { x: 50, y: 47 };
    if (/power distribution/i.test(n)) return { x: 35, y: 44 };
    if (/flasher/i.test(n)) return { x: 45, y: 42 };
    if (/bosch v4|relay/i.test(n)) return { x: 40, y: 43 };
    if (/amp research.*control/i.test(n)) return { x: 50, y: 48 };
    if (/amp research.*step/i.test(n)) return { x: sideX, y: 46 };
    if (/speaker.*front/i.test(n)) return { x: isLeft ? 20 : 80, y: 45 };
    if (/dome light/i.test(n)) return { x: 50, y: 43 };
    if (/footwell/i.test(n)) return { x: isLeft ? 30 : 70, y: 47 };
    if (/under.*dash.*led|under.*dash.*light/i.test(n)) return { x: 55, y: 44 };
    if (/door switch/i.test(n)) return { x: isLeft ? 18 : 82, y: 45 };
    if (/window switch.*master/i.test(n)) return { x: 18, y: 46 };
    if (/window switch/i.test(n)) return { x: isLeft ? 18 : 82, y: 46 };
    if (/window motor/i.test(n)) return { x: isLeft ? 17 : 83, y: 47 };
    if (/lock switch/i.test(n)) return { x: isLeft ? 18 : 82, y: 48 };
    if (/power lock.*actuator/i.test(n)) return { x: isLeft ? 17 : 83, y: 48 };
    if (/can.*bus|can.*network/i.test(n)) return { x: 55, y: 50 };
    if (/body ground|ground point/i.test(n)) return { x: 60, y: 50 };
    if (/ignition switch/i.test(n)) return { x: 30, y: 39 };
    if (/cab clearance.*left/i.test(n)) return { x: 37, y: 62 };
    if (/cab clearance.*right/i.test(n)) return { x: 55, y: 62 };
    if (/cab clearance.*center/i.test(n)) return { x: 46, y: 62 };
    return { x: 50, y: 45 };
  }
  if (zone === 'doors') {
    if (/speaker.*front/i.test(n)) return { x: isLeft ? 20 : 80, y: 45 };
    if (/window switch.*master/i.test(n)) return { x: 18, y: 46 };
    if (/window switch/i.test(n)) return { x: isLeft ? 18 : 82, y: 46 };
    if (/window motor/i.test(n)) return { x: isLeft ? 17 : 83, y: 47 };
    if (/door switch/i.test(n)) return { x: isLeft ? 18 : 82, y: 45 };
    if (/lock switch/i.test(n)) return { x: isLeft ? 18 : 82, y: 48 };
    if (/power lock.*actuator/i.test(n)) return { x: isLeft ? 17 : 83, y: 48 };
    return { x: isLeft ? 17 : 83, y: 45 };
  }
  if (zone === 'rear') {
    if (/cab clearance|clearance light/i.test(n)) {
      const num = parseInt(n.replace(/\D/g, '')) || 1;
      return { x: 28 + num * 9, y: 62 };
    }
    if (/speaker.*rear/i.test(n)) return { x: isLeft ? 30 : 70, y: 68 };
    if (/amplifier(?! relay)/i.test(n)) return { x: 40, y: 70 };
    if (/amplifier relay/i.test(n)) return { x: 42, y: 72 };
    if (/subwoofer/i.test(n)) return { x: 50, y: 70 };
    if (/parking brake|e-stopp/i.test(n)) return { x: 45, y: 66 };
    if (/cargo/i.test(n)) return { x: 50, y: 74 };
    if (/fuel pump/i.test(n) && !/relay/i.test(n)) return { x: 55, y: 78 };
    if (/fuel level|fuel send/i.test(n)) return { x: 55, y: 80 };
    if (/side marker.*rear/i.test(n)) return { x: isLeft ? 18 : 82, y: 82 };
    if (/backup light|reverse light/i.test(n) && !/switch/i.test(n)) return { x: isLeft ? 25 : 75, y: 88 };
    if (/tail light/i.test(n)) return { x: isLeft ? 22 : 78, y: 90 };
    if (/third brake|3rd brake/i.test(n)) return { x: 50, y: 88 };
    if (/license plate/i.test(n)) return { x: 50, y: 93 };
    if (/rear backup camera|camera/i.test(n)) return { x: 50, y: 94 };
    return { x: 50, y: 75 };
  }
  if (zone === 'underbody') {
    if (/amp research.*control/i.test(n)) return { x: 50, y: 48 };
    if (/amp research.*step/i.test(n)) return { x: sideX, y: 46 };
    if (/neutral safety/i.test(n)) return { x: 50, y: 46 };
    if (/reverse light switch/i.test(n)) return { x: 50, y: 53 };
    if (/vehicle speed/i.test(n)) return { x: 50, y: 52 };
    if (/transfer case/i.test(n)) return { x: 50, y: 50 };
    if (/wideband.*2|o2.*2|o2 sensor 2/i.test(n)) return { x: 50, y: 55 };
    if (/wideband.*1|o2.*1|o2 sensor 1/i.test(n)) return { x: 50, y: 54 };
    return { x: 50, y: 52 };
  }
  return { x: 50, y: 50 };
}

// ── Reference images to process, with zone context ──
const REFERENCE_IMAGES = [
  {
    file: 'docs/wiring/base_layers/engine_6D16D_compartment_wiring_3quarter.png',
    zone: 'engine_bay',
    context: 'Engine compartment wiring diagram, 3/4 view from front-right. Shows engine bay from above looking rearward. Components near the front are at the top of the image. The vehicle centerline runs vertically through the middle.',
  },
  {
    file: 'docs/wiring/base_layers/elec_8_9_onvehicle_headlamp_front_lighting.png',
    zone: 'engine_bay',
    context: 'On-vehicle headlamp and front lighting wiring diagram. Shows the front of the vehicle from above — headlights, parking lights, turn signals, side markers. The view looks down at the front end.',
  },
  {
    file: 'docs/wiring/base_layers/elec_8A14_forward_lamp_wiring_CK_front.png',
    zone: 'engine_bay',
    context: 'Forward lamp wiring diagram for CK trucks. Shows front lighting circuit — headlights, parking lamps, turn signals, and their connectors.',
  },
  {
    file: 'docs/wiring/base_layers/elec_8_12_rear_lighting_CK_all_models.png',
    zone: 'rear',
    context: 'Rear lighting wiring diagram for all CK models. Shows tail lights, backup lights, side markers, license plate light. The view is from behind/above looking at the rear of the vehicle.',
  },
  {
    file: 'docs/wiring/base_layers/elec_8_14_clearance_lamps_light_switch_interior.png',
    zone: 'dash',
    context: 'Clearance lamps, light switch, and interior lighting wiring diagram. Shows dash-mounted switches, clearance lights, dome light, and interior circuits.',
  },
  {
    file: 'docs/wiring/base_layers/elec_8A16_auxiliary_wiring_underbody.png',
    zone: 'underbody',
    context: 'Auxiliary wiring and underbody diagram. Shows fuel pump, sensors, and components along the frame. Plan view from underneath.',
  },
  {
    file: 'docs/wiring/base_layers/elec_8A_onvehicle_service_cab_clearance.png',
    zone: 'rear',
    context: 'On-vehicle service diagram for cab clearance lights. Shows clearance light positions on the cab roof and their wiring routing.',
  },
];

// ── Fuzzy matching ──
function normalize(s) {
  return s.toLowerCase()
    .replace(/[\/\-_()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fuzzyScore(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  // Token overlap
  const tokA = new Set(na.split(' ').filter(t => t.length > 1));
  const tokB = new Set(nb.split(' ').filter(t => t.length > 1));
  const overlap = [...tokA].filter(t => tokB.has(t)).length;
  const maxTokens = Math.max(tokA.size, tokB.size);
  if (maxTokens === 0) return 0;
  const tokenScore = overlap / maxTokens;

  // Partial substring matching for common abbreviations
  const abbrevMap = {
    'temp': 'temperature', 'pos': 'position', 'sw': 'switch', 'lt': 'light',
    'frt': 'front', 'rr': 'rear', 'lh': 'left', 'rh': 'right',
    'batt': 'battery', 'alt': 'alternator', 'str': 'starter',
    'ign': 'ignition', 'inj': 'injector', 'comp': 'compressor',
    'clrnc': 'clearance', 'prkng': 'parking', 'bkup': 'backup',
  };
  let expanded_a = na;
  let expanded_b = nb;
  for (const [abbr, full] of Object.entries(abbrevMap)) {
    expanded_a = expanded_a.replace(new RegExp(`\\b${abbr}\\b`, 'g'), full);
    expanded_b = expanded_b.replace(new RegExp(`\\b${abbr}\\b`, 'g'), full);
  }
  if (expanded_a === expanded_b) return 0.9;
  const tokExpA = new Set(expanded_a.split(' ').filter(t => t.length > 1));
  const tokExpB = new Set(expanded_b.split(' ').filter(t => t.length > 1));
  const overlapExp = [...tokExpA].filter(t => tokExpB.has(t)).length;
  const maxExp = Math.max(tokExpA.size, tokExpB.size);
  const expandedScore = maxExp > 0 ? overlapExp / maxExp : 0;

  return Math.max(tokenScore, expandedScore);
}

function findBestMatch(extractedName, devices) {
  let bestScore = 0;
  let bestDevice = null;
  for (const d of devices) {
    const score = fuzzyScore(extractedName, d.device_name);
    if (score > bestScore) {
      bestScore = score;
      bestDevice = d;
    }
  }
  return bestScore >= 0.5 ? { device: bestDevice, score: bestScore } : null;
}

// ── Vision extraction ──
async function extractPositionsFromImage(imageData) {
  const { file, zone, context } = imageData;
  const imagePath = path.resolve(file);
  if (!fs.existsSync(imagePath)) {
    console.warn(`  Skipping missing image: ${file}`);
    return [];
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = file.endsWith('.gif') ? 'image/gif' : 'image/png';

  const prompt = `This is a wiring diagram from a 1977 Chevrolet K5 Blazer service manual.
${context}

Your task: Identify every electrical device, component, sensor, switch, light, motor, or connector visible in this diagram.

For each component found, return its position as a percentage of the IMAGE dimensions:
- x_pct: 0 = left edge, 100 = right edge
- y_pct: 0 = top edge, 100 = bottom edge

IMPORTANT: These are image-relative coordinates, not vehicle-relative. I will map them to vehicle coordinates separately.

Return a JSON array with this structure (no markdown, no code blocks, just raw JSON):
[
  {
    "name": "Component Name",
    "x_pct": 45.2,
    "y_pct": 23.8,
    "confidence": 0.9,
    "description": "Brief description of what this is"
  }
]

Be thorough — identify ALL visible components including small sensors, grounds, switches, relays, and connectors.
Use standard automotive terminology (e.g., "Alternator" not "generator", "MAP Sensor" not "manifold pressure").`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`  Claude error for ${file}: ${response.status} — ${err}`);
    return [];
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';

  // Parse JSON from response (handle code blocks)
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const components = JSON.parse(cleaned);
    if (!Array.isArray(components)) {
      console.warn(`  Non-array response for ${file}`);
      return [];
    }
    return components.map(c => ({ ...c, sourceImage: file, sourceZone: zone }));
  } catch (e) {
    console.error(`  JSON parse error for ${file}: ${e.message}`);
    console.error(`  Raw: ${text.slice(0, 200)}`);
    return [];
  }
}

// ── Zone-specific coordinate mapping ──
// Maps image-relative coordinates to vehicle top-down coordinates (0-100)
// Each diagram covers a specific region of the vehicle
const ZONE_MAPPING = {
  engine_bay: {
    // Engine bay images show Y 5-30 of vehicle, full width
    xRange: [15, 85],
    yRange: [5, 30],
  },
  firewall: {
    xRange: [25, 75],
    yRange: [29, 33],
  },
  dash: {
    xRange: [20, 80],
    yRange: [34, 55],
  },
  rear: {
    xRange: [20, 80],
    yRange: [60, 95],
  },
  underbody: {
    xRange: [30, 70],
    yRange: [35, 85],
  },
};

function mapToVehicleCoords(imgXPct, imgYPct, zone) {
  const mapping = ZONE_MAPPING[zone] || ZONE_MAPPING.engine_bay;
  const vehicleX = mapping.xRange[0] + (imgXPct / 100) * (mapping.xRange[1] - mapping.xRange[0]);
  const vehicleY = mapping.yRange[0] + (imgYPct / 100) * (mapping.yRange[1] - mapping.yRange[0]);
  return {
    x: Math.round(vehicleX * 10) / 10,
    y: Math.round(vehicleY * 10) / 10,
  };
}

// ── Main ──
async function main() {
  console.log('=== Wiring Position Extraction via Vision AI ===');
  console.log(`Vehicle: ${VEHICLE_ID}`);

  // Load existing manifest devices
  const { data: devices, error } = await supabase
    .from('vehicle_build_manifest')
    .select('id, device_name, location_zone, pos_x_pct, pos_y_pct')
    .eq('vehicle_id', VEHICLE_ID);

  if (error) {
    console.error('Failed to load manifest:', error.message);
    process.exit(1);
  }

  console.log(`Loaded ${devices.length} manifest devices`);

  // ── FALLBACK MODE: use inferDevicePosition logic to set positions ──
  if (USE_FALLBACK) {
    console.log('\n=== FALLBACK MODE: writing inferred positions ===');
    let updated = 0;
    for (const d of devices) {
      const pos = inferDevicePositionNode(d.device_name, d.location_zone);
      const { error: updateErr } = await supabase
        .from('vehicle_build_manifest')
        .update({ pos_x_pct: pos.x, pos_y_pct: pos.y })
        .eq('id', d.id);
      if (!updateErr) {
        updated++;
        console.log(`  ✓ ${d.device_name} → (${pos.x}, ${pos.y})`);
      } else {
        console.error(`  ✗ ${d.device_name}: ${updateErr.message}`);
      }
    }
    console.log(`\nUpdated ${updated}/${devices.length} device positions`);
    return;
  }

  // Track best positions found per device (highest confidence wins)
  const bestPositions = new Map(); // device_id → { x, y, confidence, source }

  // Process each reference image
  for (const img of REFERENCE_IMAGES) {
    console.log(`\nProcessing: ${path.basename(img.file)} (zone: ${img.zone})`);

    const extracted = await extractPositionsFromImage(img);
    console.log(`  Extracted ${extracted.length} components`);

    let matched = 0;
    for (const comp of extracted) {
      const match = findBestMatch(comp.name, devices);
      if (!match) continue;

      matched++;
      const vehicleCoords = mapToVehicleCoords(comp.x_pct, comp.y_pct, img.zone);
      const existing = bestPositions.get(match.device.id);
      const effectiveConfidence = (comp.confidence || 0.5) * match.score;

      if (!existing || effectiveConfidence > existing.confidence) {
        bestPositions.set(match.device.id, {
          x: vehicleCoords.x,
          y: vehicleCoords.y,
          confidence: effectiveConfidence,
          source: path.basename(img.file),
          matchedName: comp.name,
          matchScore: match.score,
        });
        console.log(`  ✓ ${comp.name} → ${match.device.device_name} (${(match.score * 100).toFixed(0)}% match) → (${vehicleCoords.x}, ${vehicleCoords.y})`);
      }
    }
    console.log(`  Matched: ${matched}/${extracted.length}`);
  }

  // Write to DB
  console.log(`\n=== Writing ${bestPositions.size} positions to DB ===`);
  let updated = 0;
  let failed = 0;

  for (const [deviceId, pos] of bestPositions) {
    const { error: updateErr } = await supabase
      .from('vehicle_build_manifest')
      .update({
        pos_x_pct: pos.x,
        pos_y_pct: pos.y,
      })
      .eq('id', deviceId);

    if (updateErr) {
      console.error(`  ✗ Failed ${deviceId}: ${updateErr.message}`);
      failed++;
    } else {
      updated++;
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`  Total devices: ${devices.length}`);
  console.log(`  Positions extracted: ${bestPositions.size}`);
  console.log(`  Written to DB: ${updated}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Still need positions: ${devices.length - bestPositions.size}`);

  // List unmatched devices
  const unmatched = devices.filter(d => !bestPositions.has(d.id));
  if (unmatched.length > 0) {
    console.log(`\n  Unmatched devices (will use inferDevicePosition fallback):`);
    for (const d of unmatched) {
      console.log(`    - ${d.device_name} (${d.location_zone})`);
    }
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
