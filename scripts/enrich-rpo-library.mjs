#!/usr/bin/env node
/**
 * enrich-rpo-library.mjs — Enrich gm_rpo_library with human-readable descriptions
 * and improved categorization from nastyz28.com RPO directory data.
 *
 * What this does:
 *   1. Reads all gm_rpo_library entries
 *   2. Matches them against scraped RPO reference data (nastyz28.com GM RPO directory)
 *   3. Updates rows that have:
 *      - Short/cryptic descriptions (< 30 chars or ALL-CAPS abbreviated)
 *      - 'uncategorized' category
 *   4. Inserts new RPO codes not already in the library
 *   5. Reports enrichment stats
 *
 * Usage:
 *   dotenvx run -- node scripts/enrich-rpo-library.mjs
 *   dotenvx run -- node scripts/enrich-rpo-library.mjs --dry-run    # preview only
 *   dotenvx run -- node scripts/enrich-rpo-library.mjs --stats      # just show stats
 *
 * Source: nastyz28.com GM RPO Code Directory + Camaro RPO list
 */

import pg from 'pg';
const { Pool } = pg;

// ─── CLI flags ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const STATS_ONLY = args.includes('--stats');

// ─── Database connection ────────────────────────────────────────────────────
const pool = new Pool({
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 6543,
  user: 'postgres.qkgaybvrernstplzjaam',
  password: 'RbzKq32A0uhqvJMQ',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  max: 3,
});

// ─── Scraped RPO reference data from nastyz28.com ───────────────────────────
// Format: CODE -> { description, category }
// Sourced from https://www.nastyz28.com/gm-rpo-codes/ (all letter pages A-Z, 1)
// and https://www.nastyz28.com/faq/rpo-list.html (Camaro-specific with cleaner descriptions)

const NASTYZ28_RPO_DATA = {
  // ═══════════════════════════════════════════════════════════════════════════
  // A CODES — Seating, Glass, Restraints, Locks
  // ═══════════════════════════════════════════════════════════════════════════
  'AA3': { description: 'Glass, Deep Tint', category: 'glass' },
  'AB1': { description: 'Window, Rear Quarter with Ornamental Illumination', category: 'glass' },
  'AB2': { description: 'Glass, Left Side Fixed', category: 'glass' },
  'AB3': { description: 'Seating Arrangement, Six Passenger', category: 'seating' },
  'AB5': { description: 'Lock, Side Door Electric (Key Activated)', category: 'locks' },
  'AC1': { description: 'Adjuster, 6-Way Power Passenger Seat', category: 'seating' },
  'AC3': { description: 'Adjuster, 6-Way Power Bucket Driver Seat', category: 'seating' },
  'AC6': { description: 'Adjuster, 6-Way Power Bucket Passenger Seat', category: 'seating' },
  'AD2': { description: 'Prop, Hold Open Rear Compartment Floor', category: 'interior_trim' },
  'AD3': { description: 'Glass, Hinged Roof Window', category: 'glass' },
  'AD9': { description: 'Adjuster, 2-Way Power Driver Seat', category: 'seating' },
  'AE1': { description: 'Glass, Roof Panel Removable', category: 'glass' },
  'AE7': { description: 'Seat, Front Split Easy Entry', category: 'seating' },
  'AF1': { description: 'Adjuster, 2-Way Power Passenger Seat', category: 'seating' },
  'AF4': { description: 'Adjuster, 6-Way Manual Driver & Passenger', category: 'seating' },
  'AF6': { description: 'Seat Assembly, Front Bench 2-Passenger', category: 'seating' },
  'AF9': { description: 'Seat Assembly, Reclining Bucket Passenger & Driver', category: 'seating' },
  'AG1': { description: 'Adjuster, 6-Way Power Driver Seat (60-40)', category: 'seating' },
  'AG2': { description: 'Adjuster, 6-Way Power Passenger Seat (60-40)', category: 'seating' },
  'AG3': { description: 'Adjuster, 6-Way Power 2-Position Memory', category: 'seating' },
  'AG4': { description: 'Adjuster, Front Seat Height', category: 'seating' },
  'AG6': { description: 'Adjuster, 2-Way Manual Passenger Seat', category: 'seating' },
  'AG8': { description: 'Adjuster, 2-Way Manual Driver Seat', category: 'seating' },
  'AG9': { description: 'Adjuster, 6-Way Power Seat', category: 'seating' },
  'AH3': { description: 'Adjuster, 4-Way Manual Driver Seat', category: 'seating' },
  'AJ1': { description: 'Window, Deep Tint Glass', category: 'glass' },
  'AK1': { description: 'Belts, Front Center Rear Seat & Front Shoulder (Deluxe)', category: 'restraint_system' },
  'AL4': { description: 'Seat, Rear Bucket', category: 'seating' },
  'AL7': { description: 'Seat Assembly, Front Split 8-Way Adjustable 2-Way Lumbar', category: 'seating' },
  'AM3': { description: 'Seat Assembly, Front Bench Full Back with Center Armrest', category: 'seating' },
  'AM6': { description: 'Seat Assembly, Front Split with Center Armrest (60-40)', category: 'seating' },
  'AM7': { description: 'Seat Assembly, Rear Folding', category: 'seating' },
  'AM9': { description: 'Seat Assembly, Rear Split Back Fold Down', category: 'seating' },
  'AN3': { description: 'Seat Assembly, Front Bucket with Electric Body Support Control', category: 'seating' },
  'AN5': { description: 'Seat Assembly, Front Split Passenger Recline (40-40)', category: 'seating' },
  'AN6': { description: 'Adjuster, Seat Back Driver Side', category: 'seating' },
  'AN7': { description: 'Seat Assembly, Front Bucket (Swivel)', category: 'seating' },
  'AP1': { description: 'Restraint, Cargo Provisions', category: 'cargo' },
  'AQ3': { description: 'Seat Assembly, Center Rear', category: 'seating' },
  'AQ9': { description: 'Seat Assembly, Front Reclining Bucket', category: 'seating' },
  'AR3': { description: 'Air Cushion Restraint System (Airbag)', category: 'restraint_system' },
  'AR4': { description: 'Restraint System, Seat Belt & Shoulder Harness / Automatic Passive', category: 'restraint_system' },
  'AR5': { description: 'Seat Assembly, Front Bucket with Recliner', category: 'seating' },
  'AR7': { description: 'Seat Assembly, Bucket', category: 'seating' },
  'AR9': { description: 'Seat Assembly, Front Bucket Reclining (European Style)', category: 'seating' },
  'AS1': { description: 'Seat Assembly, High Back Bucket Driver', category: 'seating' },
  'AS2': { description: 'Seat Assembly, High Back Bucket Passenger', category: 'seating' },
  'AS5': { description: 'Seat Assembly, Front Bucket Deluxe', category: 'seating' },
  'AS7': { description: 'Seat Assembly, Front Split (45-45)', category: 'seating' },
  'AS8': { description: 'Restraint System, Manual Active / Belts with Retractor', category: 'restraint_system' },
  'AT5': { description: 'Seat Assembly, Center Folding (Suburban)', category: 'seating' },
  'AT6': { description: 'Adjuster, Seat Back Manual Recliner Passenger', category: 'seating' },
  'AT8': { description: 'Seat Assembly, Front Split Adjustable Reclining (50-50)', category: 'seating' },
  'AU2': { description: 'Lock, Cargo Door', category: 'locks' },
  'AU3': { description: 'Power Door Locks, Side Door Electric', category: 'locks' },
  'AU4': { description: 'Lock, Side Door Auto Electric', category: 'locks' },
  'AU6': { description: 'Lock, Tailgate Release Electric', category: 'locks' },
  'AV2': { description: 'Camper Hold Down Equipment', category: 'cargo' },
  'AV3': { description: 'Fastener, Cargo Tie Down', category: 'cargo' },
  'AW9': { description: 'Security Group, Quarter Stow & Luggage Compartment', category: 'locks' },
  'AX3': { description: 'Keyless Entry System', category: 'locks' },
  'AY9': { description: 'Adjuster, 6-Way Power Split Seat', category: 'seating' },
  'A01': { description: 'Soft Ray Tinted Glass, All Windows', category: 'glass' },
  'A02': { description: 'Windshield Tinted Glass, Shaded Upper Area', category: 'glass' },
  'A04': { description: 'Window, Tinted Side & Rear Glass', category: 'glass' },
  'A28': { description: 'Window, Rear Sliding Glass', category: 'glass' },
  'A31': { description: 'Power Windows, Electric Control', category: 'power_features' },
  'A32': { description: 'Window, Electric Operated Front Door', category: 'power_features' },
  'A33': { description: 'Window, Electric Control Tailgate or Back Door', category: 'power_features' },
  'A42': { description: 'Adjuster, 6-Way Power Seat (Bench)', category: 'seating' },
  'A43': { description: 'Adjuster, Driver Seat Memory Power (Including Mirror)', category: 'seating' },
  'A50': { description: 'Seat, Front Bucket', category: 'seating' },
  'A51': { description: 'Seat Assembly, Front Bucket (Strato)', category: 'seating' },
  'A52': { description: 'Seat Assembly, Front Bench', category: 'seating' },
  'A65': { description: 'Seat, Front Bench Split Back with Center Armrest', category: 'seating' },
  'A77': { description: 'Auto Seat Belt Restraint System (3 Point)', category: 'restraint_system' },
  'A78': { description: 'Back, Recliner Passenger Seat & Driver Seat Manual', category: 'seating' },
  'A79': { description: 'Adjuster, Driver Seat Back Manual Recliner', category: 'seating' },
  'A80': { description: 'Adjuster, Driver Seat Back Electric Recliner', category: 'seating' },
  'A81': { description: 'Adjuster, Passenger Seat Back Electric Recliner', category: 'seating' },
  'A82': { description: 'Restraint System, Head', category: 'restraint_system' },
  'A87': { description: 'Seat, Rear with Center Armrest', category: 'seating' },
  'A90': { description: 'Lock, Rear Compartment Lid Remote Control Electric Release', category: 'locks' },
  'A91': { description: 'Pulldown, Rear Compartment Lid', category: 'interior_trim' },
  'A94': { description: 'Lock, Door (Bright Cylinder)', category: 'locks' },
  'A95': { description: 'Seat Assembly, Front Bucket High Back Reclining Driver & Passenger', category: 'seating' },
  'A99': { description: 'Lock, Instrument Panel Compartment', category: 'locks' },

  // ═══════════════════════════════════════════════════════════════════════════
  // B CODES — Ornamentation, Moldings, Trim, Packages
  // ═══════════════════════════════════════════════════════════════════════════
  'BA5': { description: 'Ornamentation, Exterior (Custom)', category: 'appearance' },
  'BA6': { description: 'Compartment, Rear Shelf Package Stowage', category: 'cargo' },
  'BB2': { description: 'Lining, Luggage Compartment (Delete)', category: 'interior_trim' },
  'BC1': { description: 'Panel, Instrument Special / Ornamentation Interior', category: 'interior_trim' },
  'BC3': { description: 'Panel, Instrument (Deluxe)', category: 'interior_trim' },
  'BC4': { description: 'Coat Hanger, Retractable', category: 'interior_trim' },
  'BD1': { description: 'Molding, Rocker Panel (Delete)', category: 'molding' },
  'BF2': { description: 'Carpet, Deluxe', category: 'interior_trim' },
  'BF4': { description: 'Carpet, Custom', category: 'interior_trim' },
  'BG9': { description: 'Mat, Rubber Front & Rear / Floor Covering Rubber', category: 'interior_trim' },
  'BS1': { description: 'Insulation, Acoustical Body', category: 'interior_trim' },
  'BS2': { description: 'Insulation, Acoustical (Special)', category: 'interior_trim' },
  'BT1': { description: 'Police Car Equipment', category: 'special_package' },
  'BV8': { description: 'Ornamentation, Exterior Door Handle Deluxe', category: 'appearance' },
  'BV9': { description: 'Molding, Side (Deluxe) / Ornamentation Exterior Woodgrain', category: 'molding' },
  'BW1': { description: 'Ornamentation, Exterior Rear End', category: 'appearance' },
  'BW2': { description: 'Ornamentation, Exterior Body Side Molding (Deluxe)', category: 'molding' },
  'BW6': { description: 'Ornamentation, Exterior Body Side Decor', category: 'appearance' },
  'BX3': { description: 'Ornamentation, Exterior Woodgrain Side Panel', category: 'appearance' },
  'BX4': { description: 'Molding, Body Side', category: 'molding' },
  'B07': { description: 'Special Body, Police Car (Variation 2)', category: 'special_package' },
  'B09': { description: 'Police Group, Freeway Enforcer', category: 'special_package' },
  'B18': { description: 'Ornamentation, Interior Deluxe', category: 'interior_trim' },
  'B19': { description: 'Ornamentation, Interior Custom', category: 'interior_trim' },
  'B20': { description: 'Ornamentation, Interior Luxury', category: 'interior_trim' },
  'B28': { description: 'Mat, Front & Rear Floor', category: 'interior_trim' },
  'B30': { description: 'Carpet, Floor & Wheelhouse', category: 'interior_trim' },
  'B32': { description: 'Mat, Front Floor', category: 'interior_trim' },
  'B33': { description: 'Mat, Rear Floor', category: 'interior_trim' },
  'B34': { description: 'Mats, Front Floor (Carpet Insert)', category: 'interior_trim' },
  'B35': { description: 'Mats, Rear Floor (Carpet Insert)', category: 'interior_trim' },
  'B37': { description: 'Floor Mats, Color-Keyed Front and Rear', category: 'interior_trim' },
  'B39': { description: 'Carpet, Load Floor', category: 'interior_trim' },
  'B42': { description: 'Mat, Luggage Compartment Floor Cover', category: 'interior_trim' },
  'B46': { description: 'Trim, Special Order Equipment', category: 'interior_trim' },
  'B49': { description: 'Covering, Front & Rear Floor Deluxe Carpet', category: 'interior_trim' },
  'B57': { description: 'Trim, Exterior Deluxe', category: 'appearance' },
  'B68': { description: 'Adjuster, Lumbar Power', category: 'seating' },
  'B75': { description: 'Lining, Luggage Compartment', category: 'interior_trim' },
  'B77': { description: 'Molding, Windshield Reveal', category: 'molding' },
  'B80': { description: 'Molding, Roof Drip', category: 'molding' },
  'B81': { description: 'Molding, Body Side (Delete)', category: 'molding' },
  'B82': { description: 'Emblem, Body (Delete)', category: 'appearance' },
  'B83': { description: 'Molding, Rocker Panel', category: 'molding' },
  'B84': { description: 'Molding, Body Side (Black)', category: 'molding' },
  'B85': { description: 'Molding, Body Side Light Truck (Bright) / Belt Reveal', category: 'molding' },
  'B86': { description: 'Molding, Body Rear', category: 'molding' },
  'B87': { description: 'Emblem, Fender (Delete)', category: 'appearance' },
  'B88': { description: 'Molding, Body Side (Custom)', category: 'molding' },
  'B89': { description: 'Molding, Back Window Reveal', category: 'molding' },
  'B90': { description: 'Molding, Side Window Reveal', category: 'molding' },
  'B93': { description: 'Molding, Door Edge Guard', category: 'molding' },
  'B94': { description: 'Emblem, Body Exterior', category: 'appearance' },
  'B96': { description: 'Molding, Wheel Opening (Bright)', category: 'molding' },
  'B97': { description: 'Spoiler, Rear Fender / Molding Exterior Lower Accent', category: 'appearance' },
  'B99': { description: 'Molding, Wheel Opening (Delete)', category: 'molding' },

  // ═══════════════════════════════════════════════════════════════════════════
  // C CODES — Roof, HVAC, Lamps, Wipers
  // ═══════════════════════════════════════════════════════════════════════════
  'CA1': { description: 'Roof, Steel Sliding Sun Electric with Electric Sunroof', category: 'roof' },
  'CB5': { description: 'Roof, Vinyl Padded Full Top', category: 'roof' },
  'CB8': { description: 'Top, Removable', category: 'roof' },
  'CC1': { description: 'Hatch Roof, Removable Glass Panels (T-Tops)', category: 'roof' },
  'CC3': { description: 'Roof, Removable Panel (Transparent Plastic)', category: 'roof' },
  'CD4': { description: 'Windshield Wipers, Intermittent Pulse', category: 'wipers' },
  'CF4': { description: 'Roof, Glass Sliding Sunroof Manual', category: 'roof' },
  'CF5': { description: 'Roof, Glass Sliding Electric Sunroof', category: 'roof' },
  'CF7': { description: 'Roof, Sunroof Removable (Non-Transparent)', category: 'roof' },
  'C05': { description: 'Top, Convertible Folding', category: 'roof' },
  'C08': { description: 'Vinyl Roof Cover', category: 'roof' },
  'C24': { description: 'Windshield Wipers, Hide-Away', category: 'wipers' },
  'C25': { description: 'Washer & Wiper, Rear Window', category: 'wipers' },
  'C36': { description: 'Heater, Auxiliary', category: 'heater_ac' },
  'C40': { description: 'Heater, Standard Electronic', category: 'heater_ac' },
  'C41': { description: 'Heater with Defrost, Outside Air', category: 'heater_ac' },
  'C42': { description: 'Heater with Defrost, Heavy Duty', category: 'heater_ac' },
  'C49': { description: 'Defogger, Rear Window Electric (Grid Type)', category: 'heater_ac' },
  'C50': { description: 'Defroster, Rear Window (Forced Air)', category: 'heater_ac' },
  'C55': { description: 'Ventilator, Roof', category: 'heater_ac' },
  'C60': { description: 'Air Conditioning, Manual Control', category: 'heater_ac' },
  'C61': { description: 'Air Conditioning, Automatic Temperature Control', category: 'heater_ac' },
  'C65': { description: 'Air Conditioning, Tempmatic Control', category: 'heater_ac' },
  'C67': { description: 'Air Conditioning, All Weather (Electronic)', category: 'heater_ac' },
  'C68': { description: 'Air Conditioning, Electric Climate Control', category: 'heater_ac' },
  'C69': { description: 'Air Conditioning, Overhead System', category: 'heater_ac' },
  'C75': { description: 'Lamp, Interior Front Header Courtesy & Dual Reading', category: 'lighting' },
  'C88': { description: 'Lamp, Rear Compartment Courtesy', category: 'lighting' },
  'C89': { description: 'Lamp, Reading', category: 'lighting' },
  'C91': { description: 'Lamp, Dome', category: 'lighting' },
  'C94': { description: 'Lamp, Delayed Dome', category: 'lighting' },
  'C95': { description: 'Lamp Assembly, Dome & Reading', category: 'lighting' },

  // ═══════════════════════════════════════════════════════════════════════════
  // D CODES — Mirrors, Consoles, Stripes, Paint
  // ═══════════════════════════════════════════════════════════════════════════
  'DD3': { description: 'Mirror, Outside Remote Control Breakaway', category: 'mirror' },
  'DD4': { description: 'Mirror, Outside Rear View Electric Remote Passenger Side', category: 'mirror' },
  'DD5': { description: 'Mirror, Outside Rear View Electric Remote Driver Side', category: 'mirror' },
  'DD7': { description: 'Mirror, Heated Outside Rear View Electric Remote', category: 'mirror' },
  'DD8': { description: 'Mirror, Inside Rear View Day/Night Auto', category: 'mirror' },
  'DE9': { description: 'Console, Front Compartment Non-Shifting', category: 'interior_trim' },
  'DG2': { description: 'Mirror, Outside Rear View Electric Remote', category: 'mirror' },
  'DG7': { description: 'Mirror, Outside Rear View Electric Remote (Sport)', category: 'mirror' },
  'DH6': { description: 'Mirror, Visor Vanity Driver & Passenger', category: 'mirror' },
  'DK4': { description: 'Console, Front Compartment Floor (Mini)', category: 'interior_trim' },
  'DK6': { description: 'Console, Interior Roof', category: 'interior_trim' },
  'DL1': { description: 'Decals & Stripes', category: 'appearance' },
  'DL8': { description: 'Mirror, Outside Rear View Electric Control (Heated Element)', category: 'mirror' },
  'D05': { description: 'Handle, Inside Door', category: 'interior_trim' },
  'D07': { description: 'Console, Front Floor (Custom)', category: 'interior_trim' },
  'D22': { description: 'Mirror, Outside Stainless Below Eyeline Aerodynamic', category: 'mirror' },
  'D25': { description: 'Mirror, Outside Painted Below Eyeline Aerodynamic', category: 'mirror' },
  'D28': { description: 'Mirror, Outside Rear View (Delete)', category: 'mirror' },
  'D31': { description: 'Mirror, Inside Rear View Tilt', category: 'mirror' },
  'D33': { description: 'Mirror, Outside Rear View Remote Control Left', category: 'mirror' },
  'D34': { description: 'Mirror, Visor Vanity', category: 'mirror' },
  'D35': { description: 'Mirrors, Sport Right and Left Remote Exterior', category: 'mirror' },
  'D47': { description: 'Console, Front Compartment Floor', category: 'interior_trim' },
  'D52': { description: 'Spoiler, Rear End', category: 'appearance' },
  'D55': { description: 'Console, Front Compartment Floor (Variation 1)', category: 'interior_trim' },
  'D57': { description: 'Paint, Special Two-Tone', category: 'paint' },
  'D73': { description: 'Rail, Hand (Pickup Box)', category: 'cargo' },
  'D75': { description: 'Deflector, Front Air', category: 'appearance' },
  'D80': { description: 'Spoiler, Deck Lid Rear', category: 'appearance' },
  'D81': { description: 'Spoiler, Rear Aero Wing', category: 'appearance' },
  'D82': { description: 'Paint, Special', category: 'paint' },
  'D84': { description: 'Paint, Two-Tone (Custom)', category: 'paint' },
  'D86': { description: 'Paint, Two-Tone (Deluxe)', category: 'paint' },
  'D88': { description: 'Stripe, Hood & Deck Lid', category: 'appearance' },
  'D89': { description: 'Paint, Two-Tone Special Decor', category: 'paint' },
  'D91': { description: 'Paint, Two-Tone Special', category: 'paint' },
  'D98': { description: 'Stripe, Accent Rally', category: 'appearance' },
  'D99': { description: 'Paint, Two-Tone (Special Order)', category: 'paint' },

  // ═══════════════════════════════════════════════════════════════════════════
  // E CODES — Body Equipment
  // ═══════════════════════════════════════════════════════════════════════════
  'E50': { description: 'Roll Bar', category: 'special_equipment' },
  'E62': { description: 'Body Equipment, Stepside Pickup Box', category: 'body' },
  'E63': { description: 'Body Equipment, Fleetside Pickup Box', category: 'body' },
  'E80': { description: 'Lid, Rear Compartment (Delete)', category: 'body' },
  'E86': { description: 'Cover, Tonneau Cargo Box (Snap-On)', category: 'cargo' },
  'E94': { description: 'Beauville Equipment (Chevrolet) / Rally STX Equipment (GMC)', category: 'special_package' },

  // ═══════════════════════════════════════════════════════════════════════════
  // F CODES — Suspension, Front Axle
  // ═══════════════════════════════════════════════════════════════════════════
  'FE1': { description: 'Suspension System, Soft Ride / Rally Suspension Package', category: 'ride_control' },
  'FE2': { description: 'Suspension System, Touring Ride & Handling / Rally Suspension', category: 'ride_control' },
  'FE3': { description: 'Suspension System, Sport Performance', category: 'ride_control' },
  'FE7': { description: 'Suspension, Front and Rear Heavy Duty', category: 'ride_control' },
  'FG3': { description: 'Absorber, Front & Rear Shock Gas Preloaded', category: 'ride_control' },
  'FX3': { description: 'Suspension Control, Electronic Driver Select Firm', category: 'ride_control' },
  'F01': { description: 'Frame, Heavy Duty', category: 'chassis' },
  'F40': { description: 'Suspension, Heavy Duty Front & Rear', category: 'ride_control' },
  'F41': { description: 'Suspension, Special Heavy Duty Front & Rear (Performance)', category: 'ride_control' },
  'F42': { description: 'Suspension, Heavy Duty Front', category: 'ride_control' },
  'F44': { description: 'Chassis Equipment, Heavy Duty', category: 'chassis' },
  'F51': { description: 'Absorber, Heavy Duty Shock', category: 'ride_control' },
  'F58': { description: 'Shaft, Heavy Duty Front Stabilizer', category: 'ride_control' },
  'F59': { description: 'Stabilizer, Front', category: 'ride_control' },
  'F60': { description: 'Spring, Heavy Duty Front', category: 'ride_control' },
  'F61': { description: 'Shaft, Stabilizer Rear', category: 'ride_control' },

  // ═══════════════════════════════════════════════════════════════════════════
  // G CODES — Rear Axle, Springs
  // ═══════════════════════════════════════════════════════════════════════════
  'GU2': { description: 'Rear Axle, 2.73 Ratio', category: 'rear_axle' },
  'GU4': { description: 'Rear Axle, 3.08 Ratio', category: 'rear_axle' },
  'GU5': { description: 'Rear Axle, 3.23 Ratio', category: 'rear_axle' },
  'GU6': { description: 'Rear Axle, 3.42 Ratio', category: 'rear_axle' },
  'GT4': { description: 'Rear Axle, 3.73 Ratio', category: 'rear_axle' },
  'GT5': { description: 'Rear Axle, 4.10 Ratio', category: 'rear_axle' },
  'G50': { description: 'Spring, Heavy Duty Rear (Variation 1)', category: 'ride_control' },
  'G51': { description: 'Spring, Special Heavy Duty Rear (Variation 2)', category: 'ride_control' },
  'G52': { description: 'Spring, Extra Capacity Rear', category: 'ride_control' },
  'G60': { description: 'Spring, Auxiliary', category: 'ride_control' },
  'G67': { description: 'Absorber, Automatic Level Control Shock System / Electronic', category: 'ride_control' },
  'G80': { description: 'Rear Axle, Positraction Limited Slip Differential', category: 'rear_axle' },
  'G92': { description: 'Rear Axle, Performance Ratio', category: 'rear_axle' },
  'G95': { description: 'Rear Axle, Economy Ratio', category: 'rear_axle' },

  // ═══════════════════════════════════════════════════════════════════════════
  // J CODES — Brakes
  // ═══════════════════════════════════════════════════════════════════════════
  'JA1': { description: 'Brake System, Power Light Duty', category: 'brakes' },
  'JA2': { description: 'Brake System, Power Heavy Duty', category: 'brakes' },
  'JA4': { description: 'Brake System, Disc/Drum', category: 'brakes' },
  'JB2': { description: 'Brake System, Disc/Drum', category: 'brakes' },
  'JB5': { description: 'Brake System, Vacuum Power Disc/Drum', category: 'brakes' },
  'JC4': { description: 'Brake, Front Vented Rotor', category: 'brakes' },
  'JF9': { description: 'Brake System, Hydraulic Power 4-Wheel Disc', category: 'brakes' },
  'JL2': { description: 'Brake System, Front Power Disc', category: 'brakes' },
  'JL5': { description: 'Brake, Front Solid Disc', category: 'brakes' },
  'JL6': { description: 'Brake System, Manual Front Disc Rear Drum (Cast Iron)', category: 'brakes' },
  'JL9': { description: 'Brake System, Power Front & Rear Disc Antilock (ABS)', category: 'brakes' },
  'JM4': { description: 'Brake System, Power Antilock (Cast Iron)', category: 'brakes' },
  'JM8': { description: 'Brake System, Power Antilock (Aluminum)', category: 'brakes' },
  'J41': { description: 'Brake System, Power Front Disc Rear Drum (Cast Iron)', category: 'brakes' },
  'J50': { description: 'Brake System, Vacuum Power', category: 'brakes' },
  'J55': { description: 'Brake System, Heavy Duty Power (Variation 1)', category: 'brakes' },
  'J65': { description: 'Brake System, Power Front & Rear Disc', category: 'brakes' },

  // ═══════════════════════════════════════════════════════════════════════════
  // K CODES — Generators, Emission, Cruise, Engine Accessories
  // ═══════════════════════════════════════════════════════════════════════════
  'KC4': { description: 'Cooler, Engine Oil', category: 'engine' },
  'KD2': { description: 'Pump, Fuel Injection (Stanadyne)', category: 'engine' },
  'KE1': { description: 'Electronic Spark Selection', category: 'engine' },
  'KF3': { description: 'Electronic Fuel Injection', category: 'engine' },
  'KL7': { description: 'LP Gas Preparation', category: 'engine' },
  'K05': { description: 'Heater, Engine Block', category: 'engine' },
  'K09': { description: 'Generator, 120 Amp', category: 'electrical' },
  'K19': { description: 'Air Injection Reactor System (Emissions)', category: 'emissions' },
  'K30': { description: 'Cruise Control, Speed & Cruise (Automatic)', category: 'convenience' },
  'K34': { description: 'Cruise Control, Speed & Cruise (Integrated Computer)', category: 'convenience' },
  'K35': { description: 'Cruise Control, with Resume Speed & Cruise', category: 'convenience' },
  'K60': { description: 'Generator, 100 Amp', category: 'electrical' },
  'K68': { description: 'Generator, 105 Amp', category: 'electrical' },
  'K71': { description: 'Emission Control, Not Certified (Export)', category: 'emissions' },
  'K76': { description: 'Generator, 61 Amp Alternator', category: 'electrical' },
  'K77': { description: 'Generator, 55 Amp Alternator', category: 'electrical' },
  'K82': { description: 'Generator, 75 Amp', category: 'electrical' },

  // ═══════════════════════════════════════════════════════════════════════════
  // L CODES — Engines
  // ═══════════════════════════════════════════════════════════════════════════
  'LA5': { description: 'Engine, 1.8L L4', category: 'engine' },
  'LB1': { description: 'Engine, 4.3L V6', category: 'engine' },
  'LB4': { description: 'Engine, 4.3L V6', category: 'engine' },
  'LB6': { description: 'Engine, 2.8L V6 High Output', category: 'engine' },
  'LB9': { description: 'Engine, 5.0L V8 (305 TPI)', category: 'engine' },
  'LC2': { description: 'Engine, 3.8L V6 Turbo', category: 'engine' },
  'LC3': { description: 'Engine, 229 CID V6 (3.8L 2BBL)', category: 'engine' },
  'LD4': { description: 'Engine, 250 CID Standard Inline 6-Cylinder', category: 'engine' },
  'LD5': { description: 'Engine, 231 CID V6 (3.8L 2BBL)', category: 'engine' },
  'LE2': { description: 'Engine, 2.8L V6', category: 'engine' },
  'LE3': { description: 'Engine, 250 CID L6', category: 'engine' },
  'LE4': { description: 'Engine, 400 CID V8', category: 'engine' },
  'LE8': { description: 'Engine, 454 CID V8', category: 'engine' },
  'LE9': { description: 'Engine, 305 CID V8', category: 'engine' },
  'LF3': { description: 'Engine, 305 CID V8', category: 'engine' },
  'LF4': { description: 'Engine, 400 CID V8', category: 'engine' },
  'LF5': { description: 'Engine, 350 CID V8', category: 'engine' },
  'LF7': { description: 'Engine, 260 CID Diesel V8', category: 'engine' },
  'LF8': { description: 'Engine, 454 CID V8', category: 'engine' },
  'LF9': { description: 'Engine, 350 CID Diesel V8', category: 'engine' },
  'LG2': { description: 'Engine, 3.8L V6', category: 'engine' },
  'LG3': { description: 'Engine, 305 CID V8 (145hp 2BBL)', category: 'engine' },
  'LG4': { description: 'Engine, 305 CID V8 (155hp 4BBL)', category: 'engine' },
  'LG8': { description: 'Engine, 5.0L V8 High Output', category: 'engine' },
  'LH6': { description: 'Engine, 6.2L Diesel V8', category: 'engine' },
  'LM1': { description: 'Engine, 350 CID V8 (5.7L)', category: 'engine' },
  'LN3': { description: 'Engine, 3.8L V6', category: 'engine' },
  'LN8': { description: 'Engine, 2.5L L4 (Iron Duke)', category: 'engine' },
  'LP9': { description: 'Engine, 5.7L V8', category: 'engine' },
  'LQ9': { description: 'Engine, 2.5L L4', category: 'engine' },
  'LS2': { description: 'Engine, 4.3L Diesel V6', category: 'engine' },
  'LS6': { description: 'Engine, 151 CID L4', category: 'engine' },
  'LS9': { description: 'Engine, 350 CID V8', category: 'engine' },
  'LT1': { description: 'Engine, 350 CID V8 High Performance (255-360hp)', category: 'engine' },
  'LT8': { description: 'Engine, 4.1L V8', category: 'engine' },
  'LU5': { description: 'Engine, 5.0L V8', category: 'engine' },
  'LV2': { description: 'Engine, 307 CID V8', category: 'engine' },
  'L22': { description: 'Engine, 250 CID Inline 6-Cylinder', category: 'engine' },
  'L25': { description: 'Engine, 292 CID Inline 6-Cylinder', category: 'engine' },
  'L26': { description: 'Engine, 200 CID V6', category: 'engine' },
  'L27': { description: 'Engine, 301 CID V8', category: 'engine' },
  'L32': { description: 'Engine, 350 CID V8', category: 'engine' },
  'L34': { description: 'Engine, 350 CID V8 / 396 CID 350hp V8', category: 'engine' },
  'L35': { description: 'Engine, 425 CID V8 EFI', category: 'engine' },
  'L39': { description: 'Engine, 267 CID V8 (4.4L)', category: 'engine' },
  'L44': { description: 'Engine, 2.8L V6 High Output', category: 'engine' },
  'L48': { description: 'Engine, 350 CID V8 (Small Block)', category: 'engine' },
  'L49': { description: 'Engine, 350 CID V8', category: 'engine' },
  'L65': { description: 'Engine, 350 CID V8 (245hp Turbo-Fire)', category: 'engine' },
  'L69': { description: 'Engine, 5.0L V8 High Output (L69 HO)', category: 'engine' },
  'L76': { description: 'Engine, 350 CID V8', category: 'engine' },
  'L77': { description: 'Engine, 350 CID V8', category: 'engine' },
  'L78': { description: 'Engine, 400 CID V8 / 396 CID 375hp V8', category: 'engine' },
  'L80': { description: 'Engine, 403 CID V8', category: 'engine' },
  'L82': { description: 'Engine, 350 CID V8 Special High Performance (245hp)', category: 'engine' },
  'L83': { description: 'Engine, 5.7L V8 (Cross-Fire Injection)', category: 'engine' },
  'L98': { description: 'Engine, 5.7L V8 (Tuned Port Injection)', category: 'engine' },

  // ═══════════════════════════════════════════════════════════════════════════
  // M CODES — Transmissions
  // ═══════════════════════════════════════════════════════════════════════════
  'MB1': { description: 'Transmission, 5-Speed Manual (Borg-Warner)', category: 'transmission' },
  'MC1': { description: 'Transmission, Heavy Duty 3-Speed Manual', category: 'transmission' },
  'MC5': { description: 'Transmission, 5-Speed Manual', category: 'transmission' },
  'MD2': { description: 'Transmission, 3-Speed Automatic (THM180C)', category: 'transmission' },
  'MD8': { description: 'Transmission, 4-Speed Automatic (THM700R4)', category: 'transmission' },
  'MD9': { description: 'Transmission, 3-Speed Automatic (THM125C)', category: 'transmission' },
  'ME9': { description: 'Transmission, 4-Speed Automatic (THM440-T4)', category: 'transmission' },
  'MF4': { description: 'Transfer Case NP-205 (1.96 Low Range)', category: 'drivetrain' },
  'MV4': { description: 'Transmission, 3-Speed Automatic (THM350C)', category: 'transmission' },
  'MV9': { description: 'Transmission, 3-Speed Automatic (THM200C)', category: 'transmission' },
  'MW9': { description: 'Transmission, 4-Speed Automatic (THM200-4R)', category: 'transmission' },
  'MX2': { description: 'Transmission, 3-Speed Automatic (THM350C)', category: 'transmission' },
  'M11': { description: 'Shift, Floor Mounted', category: 'transmission' },
  'M15': { description: 'Transmission, 3-Speed Manual (Standard)', category: 'transmission' },
  'M17': { description: 'Transmission, 4-Speed Manual (Muncie)', category: 'transmission' },
  'M19': { description: 'Transmission, 4-Speed Manual (Muncie)', category: 'transmission' },
  'M20': { description: 'Transmission, 4-Speed Manual Wide Ratio (Muncie)', category: 'transmission' },
  'M21': { description: 'Transmission, 4-Speed Manual Close Ratio', category: 'transmission' },
  'M22': { description: 'Transmission, 4-Speed Manual Heavy Duty Close Ratio (Rock Crusher)', category: 'transmission' },
  'M29': { description: 'Transmission, 3-Speed Automatic (THM200)', category: 'transmission' },
  'M33': { description: 'Transmission, 3-Speed Automatic (THM350)', category: 'transmission' },
  'M34': { description: 'Transmission, 3-Speed Automatic (THM125)', category: 'transmission' },
  'M38': { description: 'Transmission, 3-Speed Automatic (THM350)', category: 'transmission' },
  'M40': { description: 'Transmission, 3-Speed Automatic Turbo Hydra-Matic (THM400)', category: 'transmission' },
  'M51': { description: 'Steering System, Manual', category: 'steering_column' },
  'M62': { description: 'Transmission, 3-Speed Manual (Muncie)', category: 'transmission' },

  // ═══════════════════════════════════════════════════════════════════════════
  // N CODES — Emissions, Fuel Tanks, Steering, Wheels
  // ═══════════════════════════════════════════════════════════════════════════
  'NA5': { description: 'Emission System, Federal Requirements', category: 'emissions' },
  'NA6': { description: 'Emission Control, High Altitude / Alternative Requirements', category: 'emissions' },
  'NA9': { description: 'Emission Control, Evaporative / California Required', category: 'emissions' },
  'NB2': { description: 'Emission System, California Requirements', category: 'emissions' },
  'NB5': { description: 'Exhaust System, Single', category: 'exhaust' },
  'NK2': { description: 'Fuel Tank, 79 Liter / Steering Wheel Custom Black', category: 'steering_column' },
  'NK3': { description: 'Steering Wheel, Formula/Sport Soft Rim Simulated Leather', category: 'steering_column' },
  'NK4': { description: 'Steering Wheel, Sport Leather', category: 'steering_column' },
  'NP5': { description: 'Steering Wheel, Leather Wrapped', category: 'steering_column' },
  'NP6': { description: 'Steering Wheel, Wood', category: 'steering_column' },
  'N04': { description: 'Lock, Gas Cap Remote Control', category: 'locks' },
  'N10': { description: 'Exhaust System, Dual', category: 'exhaust' },
  'N24': { description: 'Wheel, 15x7 Cast Aluminum', category: 'wheel' },
  'N30': { description: 'Steering Wheel, Deluxe', category: 'steering_column' },
  'N33': { description: 'Steering Column, Tilt Type', category: 'steering_column' },
  'N34': { description: 'Steering Wheel, Custom Sport', category: 'steering_column' },
  'N36': { description: 'Steering Wheel, Sport', category: 'steering_column' },
  'N37': { description: 'Steering Column, Tilt & Telescopic', category: 'steering_column' },
  'N40': { description: 'Power Steering, Hydraulic (Non-Variable)', category: 'steering_column' },
  'N41': { description: 'Power Steering, Hydraulic (Variable Ratio)', category: 'steering_column' },
  'N60': { description: 'Wheel, Aluminum', category: 'wheel' },
  'N65': { description: 'Spare Tire, Space-Saver Stowaway', category: 'wheel' },
  'N66': { description: 'Wheel, Rally Type (Variation 1)', category: 'wheel' },
  'N67': { description: 'Wheel, Rally Type (Variation 2)', category: 'wheel' },
  'N78': { description: 'Wheel, 14x6 Cast Aluminum', category: 'wheel' },
  'N84': { description: 'Spare Tire (Delete)', category: 'wheel' },
  'N89': { description: 'Wheel, Turbo Aluminum', category: 'wheel' },
  'N90': { description: 'Wheel, 15x7 Cast Aluminum', category: 'wheel' },
  'N96': { description: 'Wheel, 16x8 Cast Aluminum / Simulated Chrome Wheel Cover 15"', category: 'wheel' },
  'N98': { description: 'Wheel, Rally II Road (Chrome)', category: 'wheel' },

  // ═══════════════════════════════════════════════════════════════════════════
  // P CODES — Wheels, Wheel Covers
  // ═══════════════════════════════════════════════════════════════════════════
  'PA1': { description: 'Cover, Wheel Trim Deluxe 15"', category: 'wheel' },
  'PA3': { description: 'Cover, Deluxe Wheel Trim (13/14/15")', category: 'wheel' },
  'PB7': { description: 'Wheel, 14x6 Painted Styled', category: 'wheel' },
  'PC1': { description: 'Wheel, 14x6 Color Coded Steel', category: 'wheel' },
  'PC5': { description: 'Wheel, 15x7 Styled Steel (Rally II)', category: 'wheel' },
  'PE1': { description: 'Wheel, 14x7 Polycast / Styled Aluminum', category: 'wheel' },
  'PF2': { description: 'Wheel, 15x7 Aluminum', category: 'wheel' },
  'PF4': { description: 'Wheel, 16x7 Aluminum', category: 'wheel' },
  'PH7': { description: 'Wheel, 15x7 Forged Aluminum', category: 'wheel' },
  'PH8': { description: 'Wheel, Wire', category: 'wheel' },
  'PW7': { description: 'Wheel, 16x8 Styled Aluminum (Superlight)', category: 'wheel' },
  'P01': { description: 'Cover, Deluxe Wheel Trim / Bright Metal', category: 'wheel' },
  'P05': { description: 'Wheel, Honeycomb (Pontiac) / Chrome (Buick)', category: 'wheel' },
  'P06': { description: 'Ring, Wheel Trim (Standard on Z28)', category: 'wheel' },

  // ═══════════════════════════════════════════════════════════════════════════
  // T CODES — Lamps, Headlamps, Battery, Grille
  // ═══════════════════════════════════════════════════════════════════════════
  'TL1': { description: 'Grille, Special', category: 'appearance' },
  'TL4': { description: 'Grille, Custom / Painted', category: 'appearance' },
  'TL6': { description: 'Grille, Black', category: 'appearance' },
  'TP1': { description: 'Battery, High Capacity', category: 'battery' },
  'TP2': { description: 'Battery, Auxiliary Camper', category: 'battery' },
  'TR9': { description: 'Lamp Group, Auxiliary Lighting', category: 'lighting' },
  'TS6': { description: 'Lamp, Stop High Level (Third Brake Light)', category: 'lighting' },
  'TT4': { description: 'Headlamps, Tungsten Quartz Halogen', category: 'lighting' },
  'T37': { description: 'Lamp, Fog (Deluxe)', category: 'lighting' },
  'T44': { description: 'Hood, Plastic / Lock Interior Operated Hood', category: 'body' },
  'T45': { description: 'Hood, Aluminum', category: 'body' },
  'T48': { description: 'Hood, Ram Air Shaker / Sport Steel', category: 'body' },
  'T63': { description: 'Buzzer, Headlamp On Warning System', category: 'electrical' },
  'T76': { description: 'Headlamps, Replaceable Bulb Type', category: 'lighting' },
  'T80': { description: 'Headlamps, Automatic Beam Control', category: 'lighting' },
  'T82': { description: 'Sentinel, Twilight (Auto Headlamps)', category: 'lighting' },
  'T87': { description: 'Lamp, Cornering', category: 'lighting' },
  'T93': { description: 'Lamp, Tail & Stop (Special)', category: 'lighting' },
  'T96': { description: 'Lamps, Front Fog', category: 'lighting' },

  // ═══════════════════════════════════════════════════════════════════════════
  // U CODES — Radio, Audio, Instruments, Electrical
  // ═══════════════════════════════════════════════════════════════════════════
  'UA1': { description: 'Battery, Heavy Duty', category: 'battery' },
  'UA6': { description: 'Deterrent System, Theft', category: 'security' },
  'UC3': { description: 'Compass, Electronic', category: 'instruments' },
  'UD8': { description: 'Clock, Vacuum Fluorescent Digital', category: 'instruments' },
  'UE8': { description: 'Clock, Electric Digital', category: 'instruments' },
  'UF2': { description: 'Lamp, Cargo Area', category: 'lighting' },
  'UH1': { description: 'Electronic Lamp Monitoring System', category: 'electrical' },
  'UK3': { description: 'Electronic System, Accessory Control', category: 'electrical' },
  'UK4': { description: 'Radio, AM/FM Stereo Seek & Scan ETR', category: 'radio_audio' },
  'UK5': { description: 'Radio, AM/FM Seek & Scan Auto Reverse Cassette ETR', category: 'radio_audio' },
  'UL1': { description: 'Radio, AM/FM Stereo (without Seek/Scan)', category: 'radio_audio' },
  'UL5': { description: 'Radio, Delete', category: 'radio_audio' },
  'UL6': { description: 'Radio, AM Pushbutton with Clock', category: 'radio_audio' },
  'UL7': { description: 'Radio, AM/FM Pushbutton with Digital Clock', category: 'radio_audio' },
  'UL9': { description: 'Radio, AM/FM Stereo Cassette with Digital Clock', category: 'radio_audio' },
  'UM1': { description: 'Radio, AM Pushbutton with Stereo Tape', category: 'radio_audio' },
  'UM2': { description: 'Radio, AM/FM Stereo Pushbutton with Tape', category: 'radio_audio' },
  'UN3': { description: 'Radio, AM/FM Stereo Cassette (without Clock)', category: 'radio_audio' },
  'UN6': { description: 'Radio, AM/FM Stereo Cassette ETR with Clock', category: 'radio_audio' },
  'UN9': { description: 'Radio Suppression Equipment', category: 'radio_audio' },
  'UP2': { description: 'Radio, AM/FM Stereo ETR', category: 'radio_audio' },
  'UQ3': { description: 'Audio Power Booster / Amplifier', category: 'radio_audio' },
  'UQ4': { description: 'Speaker System, Bose 4-Speaker with Amplifiers', category: 'radio_audio' },
  'US7': { description: 'Antenna, Power (Black)', category: 'radio_audio' },
  'UT6': { description: 'Radio, AM/FM Stereo with Graphic Equalizer', category: 'radio_audio' },
  'UU8': { description: 'Radio, AM/FM Stereo Cassette ETR (Dolby)', category: 'radio_audio' },
  'UV1': { description: 'Reminder, Voice Synthesis', category: 'convenience' },
  'UW9': { description: 'Opener, Garage Door Remote Control (Homelink)', category: 'convenience' },
  'UX1': { description: 'Radio, AM Stereo/FM Stereo with Equalizer Clock ETR', category: 'radio_audio' },
  'U04': { description: 'Horn, Low Note', category: 'electrical' },
  'U05': { description: 'Horns, Dual A Note', category: 'electrical' },
  'U14': { description: 'Gauges, Instrument Panel (Oil, Coolant Temp, Volts)', category: 'instruments' },
  'U16': { description: 'Tachometer', category: 'instruments' },
  'U21': { description: 'Cluster, Instrument Panel (Coolant Temp, Volts, Tach)', category: 'instruments' },
  'U23': { description: 'Speedometer with Trip Odometer', category: 'instruments' },
  'U25': { description: 'Lamp, Luggage Compartment', category: 'lighting' },
  'U26': { description: 'Lamp, Under Hood / Engine Compartment', category: 'lighting' },
  'U27': { description: 'Lamp, Instrument Panel Compartment', category: 'lighting' },
  'U35': { description: 'Clock, Electric (Non-Digital)', category: 'instruments' },
  'U37': { description: 'Lighter, Cigarette', category: 'convenience' },
  'U40': { description: 'Trip Monitor, Digital Read Out', category: 'instruments' },
  'U52': { description: 'Cluster, Instrument Panel Electronic', category: 'instruments' },
  'U57': { description: 'Player, 8-Track Tape', category: 'radio_audio' },
  'U58': { description: 'Radio, AM/FM Stereo Pushbutton', category: 'radio_audio' },
  'U63': { description: 'Radio, AM Pushbutton', category: 'radio_audio' },
  'U68': { description: 'Display, Driver Information Center', category: 'instruments' },
  'U69': { description: 'Radio, AM/FM Mono Pushbutton', category: 'radio_audio' },
  'U71': { description: 'Antenna, Roof Mount', category: 'radio_audio' },
  'U72': { description: 'Antenna, Automatic Power', category: 'radio_audio' },
  'U73': { description: 'Antenna, Fixed Mast', category: 'radio_audio' },
  'U75': { description: 'Antenna, Power (Chrome)', category: 'radio_audio' },
  'U76': { description: 'Antenna, Windshield Embedded', category: 'radio_audio' },
  'U80': { description: 'Speaker, Rear Auxiliary', category: 'radio_audio' },
  'U89': { description: 'Harness, 5-Wire Trailer Wiring', category: 'towing' },

  // ═══════════════════════════════════════════════════════════════════════════
  // V CODES — Bumpers, Cooling, Trailer, Export
  // ═══════════════════════════════════════════════════════════════════════════
  'VF6': { description: 'Bumper, Rear Step', category: 'appearance' },
  'VK3': { description: 'Mounting, Front License Plate', category: 'appearance' },
  'VR2': { description: 'Hitch, Trailer (Dead Weight)', category: 'towing' },
  'VR4': { description: 'Hitch, Trailer (Weight Distributing Platform)', category: 'towing' },
  'V01': { description: 'Radiator, Heavy Duty', category: 'cooling' },
  'V02': { description: 'Radiator, Heavy Duty with HD Transmission Oil Cooler', category: 'cooling' },
  'V03': { description: 'Radiator, Extra Capacity Cooling', category: 'cooling' },
  'V05': { description: 'Cooling, Heavy Duty', category: 'cooling' },
  'V08': { description: 'Radiator, Heavy Duty Cooling', category: 'cooling' },
  'V10': { description: 'Cold Climate Package', category: 'special_package' },
  'V22': { description: 'Grille, Radiator (Chrome)', category: 'appearance' },
  'V27': { description: 'Guards, Bumper Front', category: 'appearance' },
  'V30': { description: 'Guards, Bumper Front & Rear', category: 'appearance' },
  'V37': { description: 'Bumper, Front & Rear (Chrome)', category: 'appearance' },
  'V42': { description: 'Bumper, Rear Step (Chrome)', category: 'appearance' },
  'V43': { description: 'Bumper, Rear Step (Painted)', category: 'appearance' },
  'V46': { description: 'Bumper, Front (Chrome)', category: 'appearance' },
  'V69': { description: 'Trailer Provisions', category: 'towing' },
  'V76': { description: 'Hook, Front Tow', category: 'chassis' },
  'V81': { description: 'Trailer Provisions', category: 'towing' },
  'V82': { description: 'Trailer Provisions, Class 2 (2000-3500 lbs)', category: 'towing' },
  'V83': { description: 'Trailer Provisions, Class 3 (3500-5000 lbs)', category: 'towing' },

  // ═══════════════════════════════════════════════════════════════════════════
  // W CODES — Packages (Division-Specific)
  // ═══════════════════════════════════════════════════════════════════════════
  'WE2': { description: 'Grand National Package (Buick)', category: 'special_package' },
  'WJ7': { description: 'Trim, Interior Leather', category: 'interior_trim' },
  'WM2': { description: 'Trim, Leather', category: 'interior_trim' },
  'WS4': { description: 'Trans Am Option (Pontiac)', category: 'special_package' },
  'WS6': { description: 'Performance Package, Special (WS6)', category: 'special_package' },
  'WS7': { description: 'Handling Package, Special', category: 'special_package' },
  'W10': { description: 'Park Avenue Option (Buick)', category: 'special_package' },
  'W11': { description: 'Regal Sport Coupe / Regal T-Type (Buick)', category: 'special_package' },
  'W29': { description: '442 Appearance Package (Oldsmobile)', category: 'special_package' },
  'W30': { description: 'Hurst/Olds Package (Oldsmobile)', category: 'special_package' },
  'W42': { description: 'Cutlass 442 Package (Oldsmobile)', category: 'special_package' },
  'W62': { description: 'Luxury Appointment Group / Aero Package', category: 'special_package' },
  'W66': { description: 'Formula Option Group (Pontiac)', category: 'special_package' },
  'W72': { description: 'Performance Package', category: 'special_package' },

  // ═══════════════════════════════════════════════════════════════════════════
  // Y CODES — Packages, Trim Levels
  // ═══════════════════════════════════════════════════════════════════════════
  'YC1': { description: 'Comfort & Convenience Package #1 / Durango Equipment (Mid-Level)', category: 'special_package' },
  'YC2': { description: 'Comfort & Convenience Package #2 / Tahoe Equipment (Luxury)', category: 'special_package' },
  'YC3': { description: 'Comfort & Convenience Package #3 / Sport Equipment', category: 'special_package' },
  'YD1': { description: 'Trailer Package, Heavy Duty', category: 'towing' },
  'YE9': { description: 'Silverado / Sierra Classic Equipment', category: 'special_package' },
  'YF3': { description: 'Sport Package', category: 'special_package' },
  'YG5': { description: 'SS Sport Modification Package', category: 'special_package' },
  'YJ8': { description: 'Wheel, Cast Aluminum', category: 'wheel' },
  'YP4': { description: 'Elegante Option (Cadillac)', category: 'special_package' },
  'Y40': { description: 'Cooling, Heavy Duty / LeSabre T-Type', category: 'cooling' },
  'Y56': { description: 'Performance Package', category: 'special_package' },
  'Y80': { description: 'Exterior Custom / SE Package', category: 'special_package' },
  'Y82': { description: 'Limited Edition Option', category: 'special_package' },
  'Y83': { description: 'Grand Prix LJ Luxury Appointments Option', category: 'special_package' },
  'Y84': { description: 'Trans Am Special Edition / GTA Option (Pontiac)', category: 'special_package' },
  'Y87': { description: 'Brougham Option', category: 'special_package' },
  'Y88': { description: 'Trans Am Special Edition Gold / 6000 STE Touring', category: 'special_package' },
  'Y89': { description: 'Trans Am Silver Anniversary / Landau Option Brougham', category: 'special_package' },
  'Y91': { description: 'LE Option, Luxury Edition', category: 'special_package' },
  'Y92': { description: 'SE Option, Special Edition', category: 'special_package' },
  'Y93': { description: 'GT Option', category: 'special_package' },
  'Y97': { description: 'SE/SJ Option / 2+2 Option', category: 'special_package' },
  'Y98': { description: 'Ride Control System, Electronic', category: 'ride_control' },
  'Y99': { description: 'Handling Package', category: 'ride_control' },

  // ═══════════════════════════════════════════════════════════════════════════
  // Z CODES — Performance & Appearance Packages
  // ═══════════════════════════════════════════════════════════════════════════
  'ZJ1': { description: 'Interior, Two-Tone Custom', category: 'interior_trim' },
  'ZL9': { description: 'Interior, Luxury', category: 'interior_trim' },
  'ZM1': { description: 'Caravan Package', category: 'special_package' },
  'ZN1': { description: 'Trailering Package', category: 'towing' },
  'ZN5': { description: 'Wheel, Rally Painted Body Color / Sport Package', category: 'wheel' },
  'ZQ2': { description: 'Operating Convenience Group', category: 'convenience' },
  'ZQ8': { description: 'Sport Chassis Package (Lowered Suspension)', category: 'special_package' },
  'ZV8': { description: 'Eurosport Package', category: 'special_package' },
  'ZX5': { description: 'Appearance Package, Value', category: 'appearance' },
  'ZX6': { description: 'Chassis, Heavy Duty', category: 'chassis' },
  'Z02': { description: 'Turbo Performance Package / Monza Spyder Appearance', category: 'special_package' },
  'Z05': { description: 'Comfort & Convenience Package', category: 'convenience' },
  'Z06': { description: 'Interior, Luxury / Special Performance Package (Corvette)', category: 'special_package' },
  'Z09': { description: 'Sport Coupe LS', category: 'special_package' },
  'Z10': { description: 'Interior, Sport', category: 'interior_trim' },
  'Z11': { description: 'Corsica LT Package / Cadet Option', category: 'special_package' },
  'Z15': { description: 'Sport Equipment, Special SS Package', category: 'special_package' },
  'Z16': { description: 'Sport Decor (Black Knight / Royal Knight / Aerocoupe SS)', category: 'special_package' },
  'Z21': { description: 'GT Package / Style Trim Group', category: 'special_package' },
  'Z22': { description: 'Rally Sport Package (RS)', category: 'special_package' },
  'Z24': { description: 'Sport Coupe Package', category: 'special_package' },
  'Z26': { description: 'Nova Rally', category: 'special_package' },
  'Z27': { description: 'Super Sport Package (SS)', category: 'special_package' },
  'Z28': { description: 'Special Performance Package (Z28 Camaro)', category: 'special_package' },
  'Z49': { description: 'Canadian Equipment / Mandatory Base Equipment Modifications', category: 'special_package' },
  'Z51': { description: 'Performance Handling Package (Corvette/Camaro)', category: 'special_package' },
  'Z52': { description: 'Sport Handling Package', category: 'special_package' },
  'Z54': { description: 'Interior Decor & Quiet Sound Package', category: 'interior_trim' },
  'Z62': { description: 'Scottsdale / Sierra Option', category: 'special_package' },
  'Z65': { description: 'Sport Package (Merchandising Option)', category: 'special_package' },
  'Z71': { description: 'Off Road Chassis Package (Z71)', category: 'special_package' },
  'Z72': { description: 'Trailering Package, Light Duty', category: 'towing' },
  'Z77': { description: 'Chevy Sport / GMC Street Coupe', category: 'special_package' },
  'Z82': { description: 'Trailering Package, Special', category: 'towing' },
  'Z84': { description: 'Cheyenne / High Sierra Equipment', category: 'special_package' },
  'Z85': { description: 'Sport Package / Rally Sport Tape & Paint', category: 'special_package' },
  'Z87': { description: 'Custom Interior / Flexible Front End Fascia', category: 'appearance' },
  'Z90': { description: 'Diesel Package', category: 'special_package' },

  // ═══════════════════════════════════════════════════════════════════════════
  // 1 CODES — Component Packages
  // ═══════════════════════════════════════════════════════════════════════════
  '1LE': { description: 'Components of Z28 Performance Package (Competition/Track)', category: 'special_package' },
  '1LJ': { description: 'Components of SS Package', category: 'special_package' },
  '1SV': { description: 'Components, Special Vehicle', category: 'special_package' },
};

// ─── Category inference from description keywords ───────────────────────────
function inferCategory(code, description) {
  const d = description.toUpperCase();

  // Engine patterns
  if (/\bENGINE\b/.test(d) || /\b\d+\s*C\.?I\.?D\.?\b/.test(d) || /\b\d+\.\d+L\b/.test(d)) return 'engine';
  if (/\bTRANSMISSION\b|\bTRANS\b.*\b(AUTO|MAN|SPD)\b/.test(d)) return 'transmission';
  if (/\bTRANSFER CASE\b/.test(d)) return 'drivetrain';
  if (/\bAXLE,?\s*R(R|EAR)\b/.test(d)) return 'rear_axle';
  if (/\bAXLE,?\s*F(RT|RONT)\b/.test(d)) return 'front_axle';
  if (/\bBRAKE\b/.test(d)) return 'brakes';

  // Suspension/Ride
  if (/\bSUSPENSION\b|\bSPRING\b|\bSHOCK\b|\bABSORBER\b|\bSTABILIZER\b/.test(d)) return 'ride_control';

  // Steering
  if (/\bSTEERING\b|\bSTRG\b/.test(d)) return 'steering_column';

  // Wheel/Tire
  if (/\bWHEEL\b|\bWHL\b/.test(d) && !/\bSTRG\b/.test(d)) return 'wheel';
  if (/\bTIRE\b/.test(d)) return 'tire';

  // Radio/Audio
  if (/\bRADIO\b|\bSPEAKER\b|\bANTENNA\b|\bCASS(ETTE)?\b|\bSTEREO\b|\bTAPE\b/.test(d)) return 'radio_audio';

  // HVAC
  if (/\bAIR COND(ITIONER|ITIONING)?\b|\bHEATER\b|\bDEFOG(GER)?\b|\bDEFROST(ER)?\b/.test(d)) return 'heater_ac';

  // Exterior/Appearance
  if (/\bPAINT\b/.test(d)) return 'paint';
  if (/\bMOLDING\b|\bMLDG\b|\bMOLDG\b/.test(d)) return 'molding';
  if (/\bBUMPER\b|\bBPR\b/.test(d)) return 'appearance';
  if (/\bGRILLE\b|\bGRL\b/.test(d)) return 'appearance';
  if (/\bSPOILER\b/.test(d)) return 'appearance';
  if (/\bSTRIPE\b|\bDECAL\b/.test(d)) return 'appearance';
  if (/\bORNAMENT(ATION)?\b|\bEMBLEM\b/.test(d)) return 'appearance';

  // Interior
  if (/\bSEAT\b|\bADJUSTER\b.*\bST\b|\bBUCKET\b|\bBENCH\b|\bRECLIN\b/.test(d)) return 'seating';
  if (/\bTRIM\b|\bCARPET\b|\bMAT\b|\bFLR\b.*\bCVR\b|\bCONSOLE\b|\bHEADLINER\b/.test(d)) return 'interior_trim';
  if (/\bINTERIOR\b.*\b(DLX|CUST|LUX)\b/.test(d)) return 'interior_trim';

  // Glass/Roof
  if (/\bGLASS\b|\bWINDOW\b|\bWDO\b|\bTINT\b/.test(d)) return 'glass';
  if (/\bROOF\b|\bTOP\b.*\b(VINYL|CONVERT|REMOV|SUN)\b/.test(d)) return 'roof';

  // Mirror
  if (/\bMIRROR\b/.test(d)) return 'mirror';

  // Lighting
  if (/\bLAMP\b|\bHEADLAMP\b|\bHEADLIGHT\b|\bLIGHT\b.*\bGROUP\b/.test(d)) return 'lighting';

  // Locks/Security
  if (/\bLOCK\b/.test(d)) return 'locks';
  if (/\bTHEFT\b|\bSECURITY\b|\bALARM\b/.test(d)) return 'security';

  // Restraints
  if (/\bBELT\b|\bRESTRAINT\b|\bAIR\s*BAG\b|\bAIR\s*CUSHION\b/.test(d)) return 'restraint_system';

  // Electrical
  if (/\bGENERATOR\b|\bALTERNATOR\b|\bBATTERY\b/.test(d)) return 'electrical';
  if (/\bBATTERY\b/.test(d)) return 'battery';

  // Instruments
  if (/\bCLUSTER\b|\bGAGE\b|\bGAUGE\b|\bSPEEDO\b|\bTACH(OMETER)?\b|\bCLOCK\b|\bODOM\b/.test(d)) return 'instruments';

  // Exhaust/Emissions
  if (/\bEXHAUST\b|\bMUFFLER\b|\bTAILPIPE\b/.test(d)) return 'exhaust';
  if (/\bEMISSION\b|\bSMOG\b|\bEGR\b|\bCATALYTIC\b/.test(d)) return 'emissions';

  // Cooling
  if (/\bRADIATOR\b|\bCOOLING\b|\bCOOLER\b/.test(d) && !/\bAIR COND/.test(d)) return 'cooling';

  // Towing
  if (/\bTRAILER\b|\bTOW(ING)?\b|\bHITCH\b/.test(d)) return 'towing';

  // Convenience
  if (/\bCRUISE\b|\bSPEED\s*CONT\b/.test(d)) return 'convenience';
  if (/\bWIPER\b|\bWASHER\b/.test(d)) return 'wipers';

  // Special packages
  if (/\bPACKAGE\b|\bPKG\b|\bOPTION\b|\bGROUP\b|\bEQUIPMENT\b/.test(d)) return 'special_package';
  if (/\bPOLICE\b/.test(d)) return 'special_package';

  // Color codes based on first letter ranges
  if (code.match(/^\d\d[ULCD]$/)) return null; // leave these alone (paint/color codes)

  return null; // can't determine
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   RPO Library Enrichment — nastyz28.com reference data      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  if (DRY_RUN) console.log('  [DRY RUN MODE — no changes will be made]\n');

  const client = await pool.connect();

  try {
    // ─── Step 1: Read current library ─────────────────────────────────────
    console.log('Step 1: Reading current gm_rpo_library...');
    const { rows: existingRows } = await client.query(
      'SELECT id, rpo_code, description, category, source FROM gm_rpo_library ORDER BY rpo_code'
    );
    console.log(`  Found ${existingRows.length} rows, ${new Set(existingRows.map(r => r.rpo_code)).size} distinct codes`);

    // Build lookup: code -> array of rows
    const existingByCode = {};
    for (const row of existingRows) {
      if (!existingByCode[row.rpo_code]) existingByCode[row.rpo_code] = [];
      existingByCode[row.rpo_code].push(row);
    }

    // ─── Step 2: Stats ────────────────────────────────────────────────────
    const uncategorizedCount = existingRows.filter(r => r.category === 'uncategorized').length;
    const shortDescCount = existingRows.filter(r => r.description.length < 20).length;
    const allCapsCount = existingRows.filter(r => r.description === r.description.toUpperCase() && r.description.length > 5).length;

    console.log(`\n  Stats:`);
    console.log(`    Uncategorized:        ${uncategorizedCount}`);
    console.log(`    Short descriptions:   ${shortDescCount} (< 20 chars)`);
    console.log(`    ALL-CAPS descriptions: ${allCapsCount}`);
    console.log(`    Reference data codes: ${Object.keys(NASTYZ28_RPO_DATA).length}`);

    if (STATS_ONLY) {
      console.log('\n  [--stats mode, exiting]');
      return;
    }

    // ─── Step 3: Enrich descriptions ──────────────────────────────────────
    console.log('\nStep 2: Enriching descriptions and categories...');
    let descUpdated = 0;
    let catUpdated = 0;
    let catInferred = 0;
    let newInserted = 0;
    let skipped = 0;

    // 3a: Update existing rows with better descriptions from reference
    for (const [code, refData] of Object.entries(NASTYZ28_RPO_DATA)) {
      const existing = existingByCode[code];

      if (!existing || existing.length === 0) {
        // New code not in library at all — insert it
        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO gm_rpo_library (rpo_code, description, category, source)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [code, refData.description, refData.category, 'nastyz28_enrichment']
          );
        }
        newInserted++;
        continue;
      }

      // For each existing row with this code:
      for (const row of existing) {
        const updates = [];
        const params = [];
        let paramIdx = 1;

        // Should we update the description?
        // Yes if: current is ALL-CAPS abbreviated, or shorter than reference, or generic
        const currentDesc = row.description;
        const refDesc = refData.description;
        const isAllCaps = currentDesc === currentDesc.toUpperCase() && currentDesc.length > 5;
        const isShort = currentDesc.length < 25;
        const isGeneric = /^-?\s*(DELETE|HEAVY DUTY|SPORT|SPECIAL|BLACK)\s*$/.test(currentDesc.trim());
        const refIsBetter = refDesc.length > currentDesc.length * 0.8 && refDesc !== currentDesc;

        if ((isAllCaps || isShort || isGeneric) && refIsBetter) {
          updates.push(`description = $${paramIdx}`);
          params.push(refDesc);
          paramIdx++;
          descUpdated++;
        }

        // Should we update category?
        if (row.category === 'uncategorized' && refData.category) {
          updates.push(`category = $${paramIdx}`);
          params.push(refData.category);
          paramIdx++;
          catUpdated++;
        }

        if (updates.length > 0) {
          updates.push(`source = $${paramIdx}`);
          params.push(row.source + '+nastyz28');
          paramIdx++;

          updates.push(`updated_at = now()`);

          params.push(row.id);
          const sql = `UPDATE gm_rpo_library SET ${updates.join(', ')} WHERE id = $${paramIdx}`;

          if (!DRY_RUN) {
            await client.query(sql, params);
          }
        } else {
          skipped++;
        }
      }
    }

    // 3b: For remaining uncategorized rows, try to infer category from description
    console.log('\nStep 3: Inferring categories from descriptions...');
    const { rows: stillUncategorized } = await client.query(
      `SELECT id, rpo_code, description, category FROM gm_rpo_library
       WHERE category = 'uncategorized'`
    );

    for (const row of stillUncategorized) {
      const inferred = inferCategory(row.rpo_code, row.description);
      if (inferred) {
        if (!DRY_RUN) {
          await client.query(
            `UPDATE gm_rpo_library SET category = $1, updated_at = now() WHERE id = $2`,
            [inferred, row.id]
          );
        }
        catInferred++;
      }
    }

    // ─── Step 4: Report ───────────────────────────────────────────────────
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║   ENRICHMENT REPORT                                         ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Descriptions updated (from reference):  ${String(descUpdated).padStart(6)}            ║`);
    console.log(`║  Categories updated (from reference):    ${String(catUpdated).padStart(6)}            ║`);
    console.log(`║  Categories inferred (from description): ${String(catInferred).padStart(6)}            ║`);
    console.log(`║  New codes inserted:                     ${String(newInserted).padStart(6)}            ║`);
    console.log(`║  Skipped (already good):                 ${String(skipped).padStart(6)}            ║`);
    console.log(`║  Total enriched:                         ${String(descUpdated + catUpdated + catInferred + newInserted).padStart(6)}            ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');

    if (DRY_RUN) {
      console.log('\n  [DRY RUN — no changes were made. Remove --dry-run to apply.]');
    }

    // ─── Post-enrichment stats ──────────────────────────────────────────
    if (!DRY_RUN) {
      const { rows: postStats } = await client.query(`
        SELECT
          count(*) as total,
          count(*) FILTER (WHERE category = 'uncategorized') as still_uncategorized,
          count(DISTINCT category) as distinct_categories,
          count(DISTINCT rpo_code) as distinct_codes
        FROM gm_rpo_library
      `);
      const s = postStats[0];
      console.log(`\n  Post-enrichment: ${s.total} rows, ${s.distinct_codes} codes, ${s.distinct_categories} categories, ${s.still_uncategorized} still uncategorized`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
