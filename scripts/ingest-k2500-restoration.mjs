#!/usr/bin/env node
/**
 * Ingest verified restoration data for the 1983 GMC K2500 as vehicle_observations.
 * Only includes data confirmed from photos, messages, and BaT listing.
 * NO fabricated data.
 */

import { createClient } from '@supabase/supabase-js';
import dns from 'dns';

const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses?.length) return origLookup(hostname, options, callback);
    if (options?.all) callback(null, addresses.map(a => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};
const nodeFetch = (await import('node-fetch')).default;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

const VID = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';
const OWNER_SOURCE = '09cc8ecb-d268-4979-9e8d-ab1b680d54a2'; // iphoto source ID (owner-documented)

// Helper to insert observation
async function obs(kind, date, text, data) {
  const { error } = await supabase.from('vehicle_observations').insert({
    vehicle_id: VID,
    kind,
    observed_at: date,
    content_text: text,
    structured_data: data,
    source_id: OWNER_SOURCE,
    confidence: 'high',
    confidence_score: 0.95,
  });
  if (error) console.error(`ERR [${kind}]: ${error.message}`);
  else console.log(`+ ${kind}: ${text.slice(0, 80)}`);
}

// ─── SPECIFICATION ───
await obs('specification', '2023-08-01', '1983 GMC K2500 Sierra Classic — VIN: 1GTGK24M1DJ514592', {
  vin: '1GTGK24M1DJ514592',
  year: 1983,
  make: 'GMC',
  model: 'K2500 Sierra Classic',
  engine: '350ci SBC V8 / Edelbrock 4-bbl / HEI ignition',
  transmission: 'TH400 automatic',
  transfer_case: 'NP205 dual-range',
  drivetrain: '4x4',
  exterior_color: 'Midnight Blue Metallic / Frost White two-tone',
  interior_color: 'Brown Leather',
  odometer: 41000,
  odometer_unit: 'miles',
  odometer_status: 'TMU',
  wheels: '16" steel',
  tires: '315/75R16 BFG KO3 All-Terrain (new)',
  frame_note: 'Alleged 1987 frame — return fuel lines suggest TBI or prior TBI engine history',
  vin_decode_note: 'VIN decodes as C2500 (2WD). Truck has full 4x4 running gear. Titled and sold as K2500.',
  height_inches: 82.5,
  sill_height_inches: 28,
});

// ─── ACQUISITION ───
await obs('ownership', '2023-08-01', 'Acquired in St. George, UT. Three prior owners, Utah registration back to 1992.', {
  direction: 'in',
  acquisition_location: 'St. George, UT',
  prior_owners: 3,
  registration_history: 'Utah back to 1992',
  body_condition: 'Zero rust, zero filler. Metal exceptional.',
  paint_condition: 'Sun-faded',
  chrome_condition: 'Oxidized',
  interior_condition: 'Tired but complete',
  drivetrain_condition: 'Operational',
});

// ─── RESTORATION PHASES ───
// Phase 01: Acquisition & Assessment (Aug-Oct 2023)
await obs('work_record', '2023-08-01', 'Phase 01: Acquisition & Assessment — initial inspection and documentation', {
  phase: 1,
  phase_name: 'Acquisition & Assessment',
  date_range: 'Aug-Oct 2023',
  photo_count: 16,
  description: 'Initial assessment. Body metal exceptional — zero rust, zero filler. Drivetrain operational. Paint sun-faded, chrome oxidized, interior tired but complete.',
});

// Phase 02: Teardown & Strip (Jun-Jul 2024)
await obs('work_record', '2024-06-01', 'Phase 02: Teardown & Strip — full exterior disassembly for paint', {
  phase: 2,
  phase_name: 'Teardown & Strip',
  date_range: 'Jun-Jul 2024',
  photo_count: 28,
  description: 'Full exterior strip for paint. All trim, chrome, side moldings, bumpers, lights, mirror, antenna, door handles, glass seals, bed hardware removed and cataloged. Interior pulled — seats, carpet, dash pad, door panels, headliner.',
  work_items: [
    'Remove all exterior trim and chrome',
    'Remove bumpers, lights, mirrors, antenna',
    'Remove door handles, glass seals',
    'Remove bed hardware',
    'Pull interior — seats, carpet, dash pad, door panels, headliner',
    'Catalog and store all removed parts',
  ],
});

// Phase 03: Body Work & Paint Prep (Aug-Sep 2024)
await obs('work_record', '2024-08-01', 'Phase 03: Body Work & Paint Prep — every panel sanded, blocked, primed', {
  phase: 3,
  phase_name: 'Body Work & Paint Prep',
  date_range: 'Aug-Sep 2024',
  photo_count: 202,
  video_count: 9,
  description: 'Largest work block — 122 items documented in August alone. Every panel stripped, sanded, DA\'d, blocked. Metal so clean very little filler needed. Full prime, guide coat, block sand, re-prime. Two-tone masking layout designed and test-fit.',
  work_items: [
    'Strip all panels to bare metal',
    'Sand and DA every panel',
    'Block sand all surfaces',
    'Apply filler where needed (minimal — metal very clean)',
    'Full prime coat',
    'Guide coat and wet sand',
    'Re-prime',
    'Design and test-fit two-tone masking layout',
  ],
});

// Phase 04: Final Prep & Booth Setup (Oct-Dec 2024)
await obs('work_record', '2024-10-01', 'Phase 04: Final Prep & Booth Setup — three months of final blocking', {
  phase: 4,
  phase_name: 'Final Prep & Booth Setup',
  date_range: 'Oct-Dec 2024',
  photo_count: 101,
  description: 'Three months of final blocking and prep. Midnight Blue Metallic is extremely unforgiving — any wave or sand scratch shows. Multiple rounds of guide coat, wet sand, re-prime until every panel dead flat. Booth draped and prepped.',
  work_items: [
    'Multiple rounds of guide coat',
    'Wet sand between coats',
    'Re-prime until dead flat',
    'Booth prep — drape and mask',
  ],
});

// Phase 05: Paint (Feb 13-14, 2025)
await obs('work_record', '2025-02-13', 'Phase 05: Paint — two-day spray. Frost White lower, Midnight Blue Metallic upper, full clear.', {
  phase: 5,
  phase_name: 'Paint — Two-Day Spray',
  date_range: 'Feb 13-14, 2025',
  photo_count: 11,
  video_count: 63,
  description: 'Day 1: Frost White lower body — rocker panels, lower doors, lower tailgate. Full mask the white. Day 2: Midnight Blue Metallic upper body, cab, hood, fenders, bed sides. 3 coats base, 2 coats clear, full truck.',
  work_items: [
    'Day 1: Spray Frost White on lower body (rockers, lower doors, lower tailgate)',
    'Mask off white for upper color',
    'Day 2: Spray Midnight Blue Metallic on upper body (cab, hood, fenders, bed sides)',
    '3 coats base color',
    '2 coats clear coat, full truck',
  ],
  materials: [
    'Frost White base coat',
    'Midnight Blue Metallic base coat',
    'Clear coat',
    '3M masking tape — yellow and green, 1/2" and 1"',
    'Masking paper/plastic',
  ],
});

// Phase 06: Unmask & Color Reveal (Feb 18, 2025)
await obs('work_record', '2025-02-18', 'Phase 06: Unmask & Color Reveal — nine timelapse cameras, tape pull, two-tone line revealed', {
  phase: 6,
  phase_name: 'Unmask & Color Reveal',
  date_range: 'Feb 18, 2025',
  video_count: 17,
  timelapse_count: 9,
  description: 'Nine timelapse cameras set up for the unmask. 3M tape pulled to reveal the two-tone line. Clean edge. Initial color sand started same day.',
});

// Phase 07: Cut & Buff (Feb 21-25, 2025)
await obs('work_record', '2025-02-21', 'Phase 07: Cut & Buff — wet sand, compound, polish to mirror finish', {
  phase: 7,
  phase_name: 'Cut & Buff',
  date_range: 'Feb 21-25, 2025',
  video_count: 20,
  description: '1500-grit wet sand, 2000-grit, 3000-grit. Compound, polish, final buff. Multiple stages to achieve wet mirror finish.',
  work_items: [
    '1500-grit wet sand',
    '2000-grit wet sand',
    '3000-grit wet sand',
    'Compound',
    'Polish',
    'Final buff to mirror finish',
  ],
});

// Phase 08: Reassembly — Trim & Chrome (Mar 2025)
await obs('work_record', '2025-03-01', 'Phase 08: Reassembly — all-new trim, badges, emblems, mirrors, door handles, weatherstrip', {
  phase: 8,
  phase_name: 'Reassembly — Trim & Chrome',
  date_range: 'Mar 2025',
  photo_count: 66,
  video_count: 6,
  description: 'All-new trim, badges, emblems, mirrors, door handles, weatherstrip seals, window felts, antenna, bumper bolts. Chrome re-installed with fresh hardware.',
  work_items: [
    'New trim and side moldings',
    'New badges and emblems',
    'New mirrors',
    'New door handles',
    'New weatherstrip seals',
    'New window felts',
    'New antenna',
    'New bumper bolts and hardware',
    'Re-install all chrome with fresh hardware',
  ],
});

// Phase 09: Interior (Apr 2025)
await obs('work_record', '2025-04-01', 'Phase 09: Interior — leather bench, new carpet, Bluetooth retro stereo, power windows', {
  phase: 9,
  phase_name: 'Interior',
  date_range: 'Apr 2025',
  photo_count: 125,
  video_count: 2,
  description: 'Brown leather bench seat installed. New carpet and insulation. Bluetooth retro-style stereo (period-correct look, modern function). Power window motors adjusted. Custom speaker boxes mounted. Door panels reinstalled with new clips.',
  work_items: [
    'Install brown leather bench seat',
    'New carpet and insulation',
    'Install Bluetooth retro-style stereo',
    'Adjust power window motors',
    'Mount custom speaker boxes',
    'Reinstall door panels with new clips',
  ],
});

// Phase 10: Mechanical & Undercarriage (Sep 2025)
await obs('work_record', '2025-09-01', 'Phase 10: Mechanical & Undercarriage — fuel tank valve, UC power wash + repaint, new tires', {
  phase: 10,
  phase_name: 'Mechanical & Undercarriage',
  date_range: 'Sep 2025',
  photo_count: 45,
  video_count: 7,
  description: 'New fuel tank selector valve — both tanks verified working. Undercarriage power washed on lift, then repainted with zero-rust paint. Masking with 3M tape. New BFG KO3 tires from Discount Tire.',
  work_items: [
    'New fuel tank selector valve (both tanks verified)',
    'Power wash undercarriage on lift',
    'Mask undercarriage with 3M yellow and green tape (1/2" and 1")',
    'Repaint undercarriage with zero-rust paint (multiple coats)',
    'New 315/75R16 BFG KO3 All-Terrain tires from Discount Tire (~Feb/Mar 2025)',
  ],
  materials: [
    'Fuel tank selector valve',
    'Zero-rust paint (undercarriage)',
    '3M masking tape — yellow and green, 1/2" and 1"',
    'Spray equipment',
    '315/75R16 BFG KO3 All-Terrain tires (4) — Discount Tire',
  ],
});

// Phase 11: Final Assembly & QC (Oct-Nov 2025)
await obs('work_record', '2025-10-01', 'Phase 11: Final Assembly & QC — final fit, walkaround, detail photography', {
  phase: 11,
  phase_name: 'Final Assembly & QC',
  date_range: 'Oct-Nov 2025',
  photo_count: 234,
  video_count: 34,
  description: 'Final fit and finish. Oct 12: 28-video walkaround documenting every angle. Oct 18: 81-photo detail session. Nov 4: 104-photo final documentation set.',
});

// ─── SALE ───
await obs('sale_result', '2026-02-22', 'Sold on Bring a Trailer, no reserve. $31,000. Lot #230982.', {
  platform: 'Bring a Trailer',
  lot_number: 230982,
  sale_price: 31000,
  reserve: 'no_reserve',
  bid_count: 42,
  comment_count: 67,
  view_count: 6282,
  watcher_count: 695,
  buyer_name: 'Dave Granholm',
  buyer_location: 'NJ',
  listing_url: 'https://bringatrailer.com/listing/1983-gmc-k2500-sierra-classic-4/',
});

// ─── POST-SALE WORK ───
await obs('work_record', '2026-02-25', 'Post-sale: Bilstein 5100 shocks (4) ordered — replacing leaking Pro Comp', {
  phase: 'post-sale',
  category: 'suspension',
  item: 'Bilstein 5100 Shocks',
  quantity: 4,
  cost: 415,
  status: 'ordered',
  reason: 'One Pro Comp shock leaked. All four replaced.',
});

await obs('work_record', '2026-02-25', 'Post-sale: Shock + window motor install scheduled — $400 labor', {
  phase: 'post-sale',
  category: 'labor',
  item: 'Shock install + window motor repair',
  labor_cost: 400,
  status: 'scheduled',
});

await obs('work_record', '2026-02-25', 'Post-sale: Hood heat shield ordered — Summit RP22000', {
  phase: 'post-sale',
  category: 'heat_shield',
  item: 'Hood Heat Shield',
  part_number: 'Summit RP22000',
  status: 'ordered',
});

await obs('work_record', '2026-02-25', 'Post-sale: Speedometer repair in progress', {
  phase: 'post-sale', category: 'electrical', item: 'Speedometer', status: 'wip',
});

await obs('work_record', '2026-02-25', 'Post-sale: Brake light repair in progress', {
  phase: 'post-sale', category: 'electrical', item: 'Brake Light', status: 'wip',
});

await obs('work_record', '2026-02-25', 'Post-sale: Touch-up paint — scratch identified pre-delivery', {
  phase: 'post-sale', category: 'paint', item: 'Touch-Up Paint', status: 'wip',
  note: 'Surface scratch identified pre-delivery',
});

// ─── DISCLOSURES ───
await obs('provenance', '2026-02-22', 'Disclosures: VIN decodes C2500, frame alleged 1987, odometer TMU, clean NV title', {
  disclosures: [
    { type: 'vin', text: 'VIN decodes C2500 (2WD). Truck has full 4x4 running gear. Titled/sold as K2500.' },
    { type: 'frame', text: 'Frame alleged 1987 based on return fuel lines suggesting TBI history.' },
    { type: 'odometer', text: 'TMU. Five-digit odometer reads approximately 41,000 miles.' },
    { type: 'title', text: 'Clean Nevada title. Mailing to buyer\'s lender.' },
    { type: 'suspension', text: 'One Pro Comp shock leaked post-sale. All four replaced with Bilstein 5100.' },
    { type: 'paint', text: 'Surface scratch identified pre-delivery. Touch-up before ship.' },
  ],
});

console.log('\nDone — all restoration observations ingested.');
