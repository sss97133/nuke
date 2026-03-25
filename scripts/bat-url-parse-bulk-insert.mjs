#!/usr/bin/env node
/**
 * bat-url-parse-bulk-insert.mjs
 *
 * PHASE 1: Parse 42K+ BaT URLs from bat_extraction_queue → create vehicle records
 * PHASE 2: Queue them into import_queue for deep extraction
 *
 * URL pattern: /listing/YEAR-MAKE-MODEL(-VARIANT)?(-NUMBER)?/
 * Filters out: motorcycles, boats, trailers, parts, signs, memorabilia, ATVs, scooters
 *
 * Usage: node scripts/bat-url-parse-bulk-insert.mjs [--dry-run] [--limit N]
 */

import pg from 'pg';
const { Client } = pg;

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG >= 0 ? parseInt(process.argv[LIMIT_ARG + 1]) : null;
const BATCH_SIZE = 1000;
const SLEEP_MS = 300; // pg_sleep(0.3) between batches

// ─── Motorcycle makes (entire make is motorcycle-only) ───
const MOTORCYCLE_MAKES = new Set([
  'ducati', 'harley-davidson', 'yamaha', 'kawasaki', 'indian',
  'norton', 'bsa', 'vespa', 'moto-guzzi', 'husqvarna', 'ktm',
  'aprilia', 'mv-agusta', 'bimota', 'bimoto', 'laverda', 'benelli',
  'royal-enfield', 'buell', 'erik-buell', 'can-am', 'ural',
  'moto-morini', 'velocette', 'matchless', 'ariel', 'ajs',
  'vincent', 'greeves', 'rickman', 'montesa', 'bultaco', 'ossa',
  'maico', 'cz', 'jawa', 'puch', 'sachs', 'hodaka', 'rokon',
  'piaggio', 'lambretta', 'cushman', 'tomos', 'derbi', 'gas-gas',
  'beta', 'sherco', 'tm-racing', 'swm', 'fantic', 'cagiva',
  'hyosung', 'sym', 'kymco', 'cfmoto', 'zero-motorcycles',
  'energica', 'livewire', 'surron', 'sur-ron', 'cake',
]);

// ─── Honda motorcycle model prefixes (Honda makes both cars and motorcycles) ───
const HONDA_MOTO_PREFIXES = [
  'cb', 'cl', 'ct', 'sl', 'xl', 'xr', 'crf', 'cr-', 'cr1', 'cr2', 'cr5',
  'gl', 'cx', 'vf', 'vt', 'cbr', 'rc', 'st', 'nt', 'cm', 'mt',
  'z50', 'z100', 'monkey', 'trail', 'scrambler', 'elsinore', 'dream',
  'super-cub', 'passport', 'hawk', 'nighthawk', 'shadow', 'magna',
  'valkyrie', 'goldwing', 'gold-wing', 'rebel', 'fury', 'vtx',
  'africa', 'nc7', 'atc', 'trx', 'fourtrax', 'rancher', 'foreman',
  'pioneer', 'talon', 'rincon', 'recon', 'rubicon', 'fl',
  'c70', 'c90', 'c100', 'c110', 'pc50', 'qa50', 'mr50', 'mr175',
  'xr75', 'xr80', 'xr100', 'xr200', 'xr250', 'xr400', 'xr600', 'xr650',
  'crf50', 'crf70', 'crf80', 'crf100', 'crf150', 'crf250', 'crf450',
  'cbx', 'cb350', 'cb360', 'cb400', 'cb450', 'cb500', 'cb550',
  'cb650', 'cb750', 'cb900', 'cb1000', 'cb1100',
];

// ─── BMW motorcycle model prefixes ───
const BMW_MOTO_PREFIXES = [
  'r50', 'r60', 'r65', 'r67', 'r68', 'r69', 'r71', 'r75', 'r80',
  'r90', 'r100', 'r850', 'r1100', 'r1150', 'r1200', 'r1250', 'rninet',
  'r-ninet', 'r-nine', 'k75', 'k100', 'k1100', 'k1200', 'k1300',
  'k1600', 'f650', 'f700', 'f750', 'f800', 'f850', 'f900',
  'g310', 'g450', 'g650', 's1000', 'hp2', 'hp4', 'ce-04',
  'c400', 'c650', 'c-evolution',
];

// ─── Triumph motorcycle model keywords ───
const TRIUMPH_MOTO_KEYWORDS = [
  'bonneville', 'thruxton', 'scrambler', 'speed-triple', 'speed-twin',
  'street-triple', 'street-twin', 'tiger', 'rocket', 'thunderbird',
  'daytona', 'trophy', 'sprint', 'trident', 'adventurer',
  'america', 'speedmaster', 'bobber',
  't100', 't110', 't120', 't140', 't150', 't160', 't595', 't509',
  'tr5', 'tr6c', 'tr6r', 'tr7v', 'tr25', 'x75', 'hurricane',
  'cub', 'tiger-cub', 'terrier', 'twenty-one',
];

// ─── Suzuki motorcycle model prefixes ───
const SUZUKI_MOTO_PREFIXES = [
  'gs', 'gsx', 'gsxr', 'gsx-r', 'dr', 'rm', 'rmz', 'rm-z',
  'sv', 'tl', 'dl', 'v-strom', 'vstrom', 'hayabusa', 'katana',
  'bandit', 'boulevard', 'intruder', 'marauder', 'savage', 'volusia',
  'burgman', 'tu', 'gt', 'tc', 'ts', 're5', 'sp', 'pe',
  'lt', 'ltr', 'ltz', 'quadracer', 'quadsport', 'ozark', 'eiger',
  'king-quad', 'kingquad',
];

// ─── Non-vehicle slug keywords ───
const NON_VEHICLE_KEYWORDS = [
  'parts', 'sign', 'memorabilia', 'scale-model', 'display-model',
  'go-kart', 'gokart', 'arcade', 'pinball', 'jukebox', 'neon',
  'pedal-car', 'pedal-plane', 'slot-car', 'slot-machine',
  'fuchs', 'accessories', 'wheel-set', 'tool-kit', 'tool-set',
  'helmet', 'luggage', 'clock', 'poster', 'print', 'artwork',
  'sculpture', 'model-car', 'diecast', 'die-cast', 'literature',
  'brochure', 'manual', 'book', 'magazine', 'jacket', 'suit',
  'cool-wheels', 'engine-only', 'motor-only', 'drivetrain-only',
];

// ─── Non-vehicle slug patterns (trailers, boats, RVs, etc.) ───
const NON_VEHICLE_SLUG_PATTERNS = [
  /trailer/i, /airstream/i, /winnebago/i, /fleetwood-(?!cadillac)/i,
  /-rv-/i, /rv-conversion/i, /camper/i, /motorhome/i,
  /boat/i, /yacht/i, /skiff/i, /runabout/i, /sailboat/i,
  /jet-ski/i, /sea-doo/i, /waverunner/i, /pwc/i,
  /snowmobile/i, /ski-doo/i, /arctic-cat/i, /polaris-(?!slingshot)/i,
  /travel-trailer/i, /fifth-wheel/i, /toy-hauler/i,
  /trike(?!ycle)/i,  // trikes but not tricycle (which shouldn't be here anyway)
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Normalize a BaT URL to a clean listing URL
 * Strips /contact suffix, query params, fragments, trailing whitespace
 */
function normalizeUrl(url) {
  let clean = url.trim();
  // Remove /contact suffix
  clean = clean.replace(/\/contact\/?$/, '');
  // Remove fragment
  clean = clean.replace(/#.*$/, '');
  // Remove query params
  clean = clean.replace(/\?.*$/, '');
  // Remove trailing spaces encoded as %20
  clean = clean.replace(/%20.*$/, '');
  // Ensure trailing slash
  if (!clean.endsWith('/')) clean += '/';
  return clean;
}

/**
 * Extract the slug from a BaT listing URL
 * e.g., "https://bringatrailer.com/listing/1973-dodge-challenger-34/" → "1973-dodge-challenger-34"
 */
function extractSlug(url) {
  const match = url.match(/\/listing\/([^\/\?#]+)/);
  return match ? match[1] : null;
}

/**
 * Parse year/make/model from a BaT URL slug
 * Returns { year, make, model, raw_slug } or null if unparseable/non-vehicle
 */
function parseSlug(slug) {
  if (!slug) return null;

  // Must start with a 4-digit year
  const yearMatch = slug.match(/^(\d{4})-(.+)$/);
  if (!yearMatch) return null;

  const year = parseInt(yearMatch[1]);
  const rest = yearMatch[2];

  // Sanity check year
  if (year < 1885 || year > 2027) return null;

  // Split remaining parts on hyphens
  const parts = rest.split('-');
  if (parts.length < 2) return null; // need at least make + model

  // The make is the first part (or first two parts for compound makes)
  let make, modelParts;

  // Handle compound makes
  const compoundMakes = {
    'alfa-romeo': 'Alfa Romeo',
    'aston-martin': 'Aston Martin',
    'austin-healey': 'Austin-Healey',
    'de-tomaso': 'De Tomaso',
    'land-rover': 'Land Rover',
    'range-rover': 'Range Rover',
    'rolls-royce': 'Rolls-Royce',
    'mercedes-benz': 'Mercedes-Benz',
    'mercedes-amg': 'Mercedes-AMG',
    'harley-davidson': 'Harley-Davidson',
    'moto-guzzi': 'Moto Guzzi',
    'mv-agusta': 'MV Agusta',
    'royal-enfield': 'Royal Enfield',
    'erik-buell': 'Erik Buell',
    'can-am': 'Can-Am',
    'sur-ron': 'Sur-Ron',
    'gas-gas': 'Gas Gas',
    'van-hool': 'Van Hool',
    'am-general': 'AM General',
    'el-camino': null, // This is a model (Chevrolet El Camino), not a make
    'sea-doo': 'Sea-Doo',
    'ski-doo': 'Ski-Doo',
    'arctic-cat': 'Arctic Cat',
    'tm-racing': 'TM Racing',
    'zero-motorcycles': 'Zero Motorcycles',
    'de-dion': 'De Dion',
    'de-dion-bouton': 'De Dion-Bouton',
    'iso-rivolta': 'Iso Rivolta',
    'bitter-cars': 'Bitter',
    'ac-cobra': null, // AC is make, Cobra is model
    'shelby-cobra': null, // Shelby is make, Cobra is model
    'morgan-plus': null, // Morgan is make
    'grand-prix': null,
  };

  // Try compound makes (2 words)
  const twoWord = `${parts[0]}-${parts[1]}`;
  if (compoundMakes[twoWord] !== undefined) {
    if (compoundMakes[twoWord] === null) {
      // Not actually a compound make; use single word
      make = capitalize(parts[0]);
      modelParts = parts.slice(1);
    } else {
      make = compoundMakes[twoWord];
      modelParts = parts.slice(2);
    }
  } else {
    make = capitalize(parts[0]);
    modelParts = parts.slice(1);
  }

  // Strip trailing number suffix (BaT dedup suffix like "-34", "-2", etc.)
  // But only if the last part is purely numeric AND there are model parts before it
  if (modelParts.length > 1) {
    const lastPart = modelParts[modelParts.length - 1];
    if (/^\d+$/.test(lastPart)) {
      modelParts = modelParts.slice(0, -1);
    }
  }

  if (modelParts.length === 0) return null;

  // Strip leading duplicate make from model (BaT sometimes repeats: "honda-honda-trail")
  const makeSingle = make.toLowerCase().replace(/\s+/g, '-').replace(/-/g, '-');
  if (modelParts.length > 1 && modelParts[0].toLowerCase() === parts[0].toLowerCase()) {
    modelParts = modelParts.slice(1);
  }
  if (modelParts.length === 0) return null;

  // Build model string
  const model = modelParts.map(capitalize).join(' ');

  return { year, make, model, raw_slug: slug };
}

function capitalize(str) {
  if (!str) return str;
  // Special cases for car nomenclature
  const upperCases = {
    // Makes
    'bmw': 'BMW', 'gmc': 'GMC', 'mg': 'MG', 'tvr': 'TVR', 'ac': 'AC',
    'dmc': 'DMC', 'vw': 'VW', 'ram': 'RAM', 'srt': 'SRT',
    'amg': 'AMG', 'amc': 'AMC',
    // Model codes
    'gt': 'GT', 'gts': 'GTS', 'gtr': 'GTR', 'gto': 'GTO',
    'gt3': 'GT3', 'gt4': 'GT4', 'gt2': 'GT2', 'gt40': 'GT40',
    'rs': 'RS', 'ss': 'SS', 'rt': 'RT',
    'zr1': 'ZR1', 'zr2': 'ZR2', 'z06': 'Z06', 'z07': 'Z07', 'z28': 'Z28',
    'svt': 'SVT', 'sti': 'STI', 'wrx': 'WRX', 'gti': 'GTI', 'tdi': 'TDI',
    'amx': 'AMX', 'ssc': 'SSC', 'xke': 'XKE', 'xk': 'XK',
    'xjs': 'XJS', 'xjr': 'XJR', 'xj6': 'XJ6', 'xj12': 'XJ12', 'xf': 'XF',
    'db5': 'DB5', 'db6': 'DB6', 'db7': 'DB7', 'db9': 'DB9', 'db11': 'DB11',
    'dbs': 'DBS', 'db': 'DB',
    'mga': 'MGA', 'mgb': 'MGB', 'mgc': 'MGC', 'mgtd': 'MGTD', 'mgtf': 'MGTF',
    'ltd': 'LTD', 'tpi': 'TPI', 'ls': 'LS', 'lt': 'LT', 'ltz': 'LTZ',
    'rst': 'RST', 'at4': 'AT4', 'svj': 'SVJ', 'sv': 'SV', 'lp': 'LP',
    'evo': 'EVO', 'ff': 'FF', 'sf90': 'SF90', 'f40': 'F40', 'f50': 'F50',
    'crv': 'CR-V', 'hrv': 'HR-V', 'brz': 'BRZ', 'rav4': 'RAV4',
    'fj': 'FJ', 'suv': 'SUV', '4wd': '4WD', '4x4': '4x4', 'awd': 'AWD',
    'ii': 'II', 'iii': 'III', 'iv': 'IV', 'vi': 'VI', 'vii': 'VII',
    'viii': 'VIII', 'ix': 'IX', 'xi': 'XI', 'xii': 'XII',
    'iia': 'IIA', 'iib': 'IIB',
    'se': 'SE', 'le': 'LE', 'ce': 'CE', 'dx': 'DX', 'lx': 'LX',
    'ex': 'EX', 'si': 'Si', 'sr': 'SR', 'sl': 'SL', 'slk': 'SLK',
    'slc': 'SLC', 'sls': 'SLS', 'cls': 'CLS', 'clk': 'CLK',
    'glk': 'GLK', 'gle': 'GLE', 'gla': 'GLA', 'glb': 'GLB',
    'glc': 'GLC', 'gls': 'GLS', 'cla': 'CLA', 'eqs': 'EQS', 'eqe': 'EQE',
    'e30': 'E30', 'e36': 'E36', 'e46': 'E46', 'e90': 'E90', 'e92': 'E92',
    'f80': 'F80', 'f82': 'F82', 'g80': 'G80', 'g82': 'G82',
    'trd': 'TRD', 'xle': 'XLE', 'xse': 'XSE',
    'v8': 'V8', 'v10': 'V10', 'v12': 'V12', 'v6': 'V6', 'i4': 'I4',
    'np01': 'NP01', 'p1': 'P1', 'f1': 'F1',
    'cj': 'CJ', 'yj': 'YJ', 'tj': 'TJ', 'jk': 'JK', 'jl': 'JL',
    'sj': 'SJ', 'zj': 'ZJ', 'wj': 'WJ', 'wk': 'WK', 'xj': 'XJ',
    'kj': 'KJ', 'kl': 'KL', 'mj': 'MJ',
    'cpo': 'CPO', 'msrp': 'MSRP',
    'dohc': 'DOHC', 'sohc': 'SOHC', 'ohv': 'OHV', 'ohc': 'OHC',
    'tfc': 'TFC', 'hpe': 'HPE', 'z3': 'Z3', 'z4': 'Z4', 'z8': 'Z8',
    'x1': 'X1', 'x2': 'X2', 'x3': 'X3', 'x4': 'X4', 'x5': 'X5',
    'x6': 'X6', 'x7': 'X7', 'xm': 'XM',
    'm3': 'M3', 'm4': 'M4', 'm5': 'M5', 'm6': 'M6', 'm8': 'M8',
    'i3': 'i3', 'i4': 'i4', 'i8': 'i8', 'ix': 'iX',
    's2000': 'S2000', 'nsx': 'NSX', 'crx': 'CRX', 'del-sol': 'del Sol',
    'f12berlinetta': 'F12berlinetta', 'f12': 'F12',
    '911t': '911T', '911s': '911S', '911e': '911E', '911l': '911L',
    '911sc': '911SC', '911rs': '911RS',
    'suv': 'SUV', 'mpv': 'MPV', 'cuv': 'CUV',
  };
  const lower = str.toLowerCase();
  if (upperCases[lower]) return upperCases[lower];
  // If it's a number/letter combo like "911", "350z", "240sx", keep as-is
  if (/^\d/.test(str)) return str.toUpperCase();
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Check if a parsed vehicle is actually a motorcycle, boat, trailer, etc.
 */
function isNonVehicle(slug, make, model) {
  const slugLower = slug.toLowerCase();
  const makeLower = make.toLowerCase().replace(/\s+/g, '-');
  const modelLower = model.toLowerCase();

  // 1. Pure motorcycle makes
  if (MOTORCYCLE_MAKES.has(makeLower)) return true;

  // 2. Honda motorcycles (check model prefix OR any word in model)
  if (makeLower === 'honda') {
    const modelSlug = modelLower.replace(/\s+/g, '-');
    const modelWords = modelLower.split(/\s+/);
    for (const prefix of HONDA_MOTO_PREFIXES) {
      if (modelSlug.startsWith(prefix)) return true;
      // Also check if any individual word starts with a moto prefix
      for (const word of modelWords) {
        if (word.startsWith(prefix)) return true;
      }
    }
  }

  // 3. BMW motorcycles (R-series, K-series, etc.)
  if (makeLower === 'bmw') {
    const modelSlug = modelLower.replace(/\s+/g, '-');
    for (const prefix of BMW_MOTO_PREFIXES) {
      if (modelSlug.startsWith(prefix)) return true;
    }
  }

  // 4. Triumph motorcycles vs cars
  if (makeLower === 'triumph') {
    const modelSlug = modelLower.replace(/\s+/g, '-');
    for (const kw of TRIUMPH_MOTO_KEYWORDS) {
      if (modelSlug.includes(kw)) return true;
    }
  }

  // 5. Suzuki motorcycles/ATVs
  if (makeLower === 'suzuki') {
    const modelSlug = modelLower.replace(/\s+/g, '-');
    for (const prefix of SUZUKI_MOTO_PREFIXES) {
      if (modelSlug.startsWith(prefix)) return true;
    }
  }

  // 6. Non-vehicle keywords in slug
  for (const kw of NON_VEHICLE_KEYWORDS) {
    if (slugLower.includes(kw)) return true;
  }

  // 7. Non-vehicle patterns
  for (const pat of NON_VEHICLE_SLUG_PATTERNS) {
    if (pat.test(slugLower)) return true;
  }

  return false;
}


async function main() {
  const client = new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: 'RbzKq32A0uhqvJMQ',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to database');

  // ─── PHASE 1: Fetch all pending URLs ───
  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : '';
  const { rows } = await client.query(
    `SELECT id, bat_url FROM bat_extraction_queue WHERE status = 'pending' ORDER BY created_at ${limitClause}`
  );
  console.log(`Fetched ${rows.length} pending URLs from bat_extraction_queue`);

  // ─── Parse URLs ───
  const parsed = [];
  const skipped = { no_slug: 0, no_year: 0, no_parse: 0, non_vehicle: 0, bad_url: 0 };
  const nonVehicleExamples = [];
  const skipExamples = [];

  for (const row of rows) {
    const url = normalizeUrl(row.bat_url);
    const slug = extractSlug(url);

    if (!slug) {
      skipped.no_slug++;
      if (skipExamples.length < 5) skipExamples.push({ reason: 'no_slug', url: row.bat_url });
      continue;
    }

    const result = parseSlug(slug);
    if (!result) {
      skipped.no_parse++;
      if (skipExamples.length < 5) skipExamples.push({ reason: 'no_parse', slug });
      continue;
    }

    if (isNonVehicle(slug, result.make, result.model)) {
      skipped.non_vehicle++;
      if (nonVehicleExamples.length < 20) {
        nonVehicleExamples.push({ slug, make: result.make, model: result.model });
      }
      continue;
    }

    parsed.push({
      queue_id: row.id,
      url: url,
      original_url: row.bat_url,
      bat_url_no_slash: url.replace(/\/$/, ''),
      year: result.year,
      make: result.make,
      model: result.model,
    });
  }

  console.log(`\n── Parse Results ──`);
  console.log(`  Valid vehicles: ${parsed.length}`);
  console.log(`  Skipped:`, skipped);
  console.log(`  Non-vehicle examples:`, nonVehicleExamples.slice(0, 10));
  if (skipExamples.length > 0) console.log(`  Skip examples:`, skipExamples);

  // Show some parsed examples
  console.log(`\n── Sample Parsed Vehicles ──`);
  for (const v of parsed.slice(0, 15)) {
    console.log(`  ${v.year} ${v.make} ${v.model} ← ${v.url}`);
  }

  if (DRY_RUN) {
    console.log(`\n── DRY RUN: Would insert ${parsed.length} vehicles ──`);
    await client.end();
    return;
  }

  // ─── Check for active queries on vehicles table ───
  const { rows: activeQueries } = await client.query(`
    SELECT count(*) as cnt FROM pg_stat_activity
    WHERE state='active' AND query ILIKE '%vehicles%' AND pid != pg_backend_pid()
  `);
  console.log(`Active queries on vehicles: ${activeQueries[0].cnt}`);
  if (parseInt(activeQueries[0].cnt) > 5) {
    console.log('WARNING: Many active queries on vehicles table. Proceeding with caution.');
  }

  // ─── PHASE 1: Disable heavy AFTER INSERT triggers temporarily ───
  const triggersToDisable = [
    'trigger_auto_extract_bat_data',      // Would insert BACK into bat_extraction_queue (circular)
    'trigger_auto_detect_duplicates',     // Expensive duplicate detection per row
    'trigger_auto_duplicate_detection',   // Another duplicate detector
    'vehicle_auto_services_trigger',      // Queues services per row
    'trigger_check_vehicle_images_on_insert', // Checks images per row
    'trigger_validate_vehicle_origin',    // Validates origin per row
    'trigger_create_vehicle_mailbox',     // Creates mailbox per vehicle
    'trg_suggest_assignments_on_vehicle_create', // Suggests assignments
    'trg_auto_link_vehicle_library',      // Links to library
    'trg_auto_populate_vehicle_specs',    // Populates specs
    'trigger_vehicles_feed_refresh',      // Refreshes materialized view PER STATEMENT
  ];

  console.log(`\n── Disabling ${triggersToDisable.length} heavy triggers ──`);
  for (const trig of triggersToDisable) {
    try {
      await client.query(`ALTER TABLE vehicles DISABLE TRIGGER ${trig}`);
      console.log(`  Disabled: ${trig}`);
    } catch (e) {
      console.log(`  Skip (not found): ${trig}`);
    }
  }

  // ─── Batch insert vehicles ───
  let insertedCount = 0;
  let conflictCount = 0;
  let errorCount = 0;
  const insertedIds = [];

  console.log(`\n── Inserting ${parsed.length} vehicles in batches of ${BATCH_SIZE} ──`);

  for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
    const batch = parsed.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(parsed.length / BATCH_SIZE);

    try {
      // Build multi-row INSERT with values
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const v of batch) {
        values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, 'bat', 'bat')`);
        params.push(v.url, v.bat_url_no_slash, v.year, v.make, v.model);
        paramIdx += 5;
      }

      const sql = `
        INSERT INTO vehicles (listing_url, bat_auction_url, year, make, model, source, auction_source)
        VALUES ${values.join(',\n')}
        ON CONFLICT (listing_url) WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url != ''
        DO NOTHING
        RETURNING id, listing_url
      `;

      const result = await client.query(sql, params);
      const inserted = result.rows.length;
      const conflicts = batch.length - inserted;
      insertedCount += inserted;
      conflictCount += conflicts;

      for (const row of result.rows) {
        insertedIds.push(row.id);
      }

      console.log(`  Batch ${batchNum}/${totalBatches}: +${inserted} inserted, ${conflicts} existing (total: ${insertedCount})`);

      // Check locks
      const { rows: lockRows } = await client.query(
        `SELECT count(*) as cnt FROM pg_stat_activity WHERE wait_event_type='Lock'`
      );
      if (parseInt(lockRows[0].cnt) > 0) {
        console.log(`  ⚠ Lock detected (${lockRows[0].cnt} waiters) - adding extra sleep`);
        await sleep(1000);
      }

      // Sleep between batches
      await sleep(SLEEP_MS);
    } catch (e) {
      console.error(`  ERROR in batch ${batchNum}: ${e.message}`);
      errorCount += batch.length;
      // Continue with next batch
    }
  }

  // ─── Re-enable triggers ───
  console.log(`\n── Re-enabling triggers ──`);
  for (const trig of triggersToDisable) {
    try {
      await client.query(`ALTER TABLE vehicles ENABLE TRIGGER ${trig}`);
      console.log(`  Enabled: ${trig}`);
    } catch (e) {
      console.log(`  Skip (not found): ${trig}`);
    }
  }

  // ─── Refresh feed view once (instead of per-statement trigger) ───
  console.log(`\n── Refreshing feed materialized view ──`);
  try {
    await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY feed_items_view`);
    console.log(`  Done`);
  } catch (e) {
    console.log(`  Skip: ${e.message}`);
  }

  console.log(`\n══ PHASE 1 RESULTS ══`);
  console.log(`  Inserted:  ${insertedCount} new vehicles`);
  console.log(`  Existing:  ${conflictCount} (already in DB)`);
  console.log(`  Errors:    ${errorCount}`);
  console.log(`  Skipped:   ${Object.values(skipped).reduce((a, b) => a + b, 0)} non-vehicles/unparseable`);

  // ─── Update bat_extraction_queue: link vehicle_id for newly created vehicles ───
  console.log(`\n── Linking bat_extraction_queue to new vehicle records ──`);
  let linkedCount = 0;
  for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
    const batch = parsed.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    try {
      // Use bat_auction_url (no trailing slash) to match
      const result = await client.query(`
        UPDATE bat_extraction_queue beq
        SET vehicle_id = v.id, updated_at = now()
        FROM vehicles v
        WHERE beq.vehicle_id IS NULL
          AND beq.id = ANY($1::uuid[])
          AND v.bat_auction_url = beq.bat_url
      `, [batch.map(b => b.queue_id)]);
      linkedCount += result.rowCount;

      // Also try with trailing slash stripped from bat_url
      const result2 = await client.query(`
        UPDATE bat_extraction_queue beq
        SET vehicle_id = v.id, updated_at = now()
        FROM vehicles v
        WHERE beq.vehicle_id IS NULL
          AND beq.id = ANY($1::uuid[])
          AND v.bat_auction_url = regexp_replace(beq.bat_url, '/$', '')
      `, [batch.map(b => b.queue_id)]);
      linkedCount += result2.rowCount;

      // Also try listing_url match
      const result3 = await client.query(`
        UPDATE bat_extraction_queue beq
        SET vehicle_id = v.id, updated_at = now()
        FROM vehicles v
        WHERE beq.vehicle_id IS NULL
          AND beq.id = ANY($1::uuid[])
          AND (v.listing_url = beq.bat_url OR v.listing_url = beq.bat_url || '/')
      `, [batch.map(b => b.queue_id)]);
      linkedCount += result3.rowCount;
    } catch (e) {
      // Likely unique constraint violation -- some queue entries may already be linked
      if (!e.message.includes('duplicate key')) {
        console.log(`  Link batch ${batchNum} error: ${e.message}`);
      }
    }
    await sleep(100);
  }
  console.log(`  Linked ${linkedCount} queue entries to vehicle records`);

  // ─── PHASE 2: Queue into import_queue for deep extraction ───
  console.log(`\n══ PHASE 2: Queuing ${parsed.length} URLs into import_queue ══`);

  let queuedCount = 0;
  let queueConflicts = 0;

  for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
    const batch = parsed.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(parsed.length / BATCH_SIZE);

    try {
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const v of batch) {
        values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, 'pending', 'bat')`);
        params.push(v.url, v.year, v.make, v.model, `${v.year} ${v.make} ${v.model}`);
        paramIdx += 5;
      }

      const sql = `
        INSERT INTO import_queue (listing_url, listing_year, listing_make, listing_model, listing_title, status, extractor_version)
        VALUES ${values.join(',\n')}
        ON CONFLICT (listing_url) DO NOTHING
        RETURNING id
      `;

      const result = await client.query(sql, params);
      const inserted = result.rows.length;
      queuedCount += inserted;
      queueConflicts += batch.length - inserted;

      if (batchNum % 5 === 0 || batchNum === totalBatches) {
        console.log(`  Batch ${batchNum}/${totalBatches}: +${inserted} queued (total: ${queuedCount})`);
      }

      await sleep(100);
    } catch (e) {
      console.error(`  Queue batch ${batchNum} error: ${e.message}`);
    }
  }

  console.log(`\n══ PHASE 2 RESULTS ══`);
  console.log(`  Queued:    ${queuedCount} URLs into import_queue`);
  console.log(`  Existing:  ${queueConflicts} (already queued)`);

  // ─── PHASE 2B: Check how many have snapshots for immediate extraction ───
  console.log(`\n── Checking snapshot availability for batch extraction ──`);
  try {
    const { rows: snapRows } = await client.query(`
      SELECT count(*) as cnt
      FROM bat_extraction_queue beq
      JOIN listing_page_snapshots lps ON (
        lps.listing_url = beq.bat_url
        OR lps.listing_url = beq.bat_url || '/'
        OR lps.listing_url = regexp_replace(beq.bat_url, '/$', '')
      )
      WHERE beq.status = 'pending'
    `);
    console.log(`  URLs with existing snapshots: ${snapRows[0].cnt}`);
    if (parseInt(snapRows[0].cnt) > 0) {
      console.log(`  These can be batch-extracted immediately via batch-extract-snapshots`);
    }
  } catch (e) {
    console.log(`  Snapshot check error: ${e.message}`);
  }

  // ─── Final summary ───
  console.log(`\n══════════════════════════════════════`);
  console.log(`  PHASE 1: ${insertedCount} new vehicles created from URL parsing`);
  console.log(`  PHASE 2: ${queuedCount} URLs queued for deep extraction`);
  console.log(`  Total skipped: ${Object.values(skipped).reduce((a, b) => a + b, 0)}`);
  console.log(`══════════════════════════════════════`);

  // Check lock impact
  const { rows: finalLocks } = await client.query(
    `SELECT count(*) as cnt FROM pg_stat_activity WHERE wait_event_type='Lock'`
  );
  console.log(`Final lock check: ${finalLocks[0].cnt} waiters`);

  await client.end();
  console.log('Done.');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
