#!/usr/bin/env node
/**
 * Craigslist Data Cleanup
 *
 * Problem: CL listings expire, can't re-scrape. Data is in wrong fields:
 * - model field contains full title with price, mileage, emojis, location
 * - make often missing
 * - URL slug often contains the real make/model
 *
 * Strategy:
 * 1. Parse URL slug for make/model hints
 * 2. Extract clean model from junk title
 * 3. Infer make from model (Soul → Kia, Mustang → Ford, etc.)
 * 4. Update vehicles with cleaned data
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Known model → make mappings
const MODEL_TO_MAKE = {
  // Japanese
  'soul': 'Kia',
  'optima': 'Kia',
  'sorento': 'Kia',
  'sportage': 'Kia',
  'accord': 'Honda',
  'civic': 'Honda',
  'crv': 'Honda',
  'cr-v': 'Honda',
  'pilot': 'Honda',
  'odyssey': 'Honda',
  'fit': 'Honda',
  'camry': 'Toyota',
  'corolla': 'Toyota',
  'rav4': 'Toyota',
  'tacoma': 'Toyota',
  'tundra': 'Toyota',
  'prius': 'Toyota',
  'highlander': 'Toyota',
  '4runner': 'Toyota',
  'altima': 'Nissan',
  'maxima': 'Nissan',
  'sentra': 'Nissan',
  'rogue': 'Nissan',
  'pathfinder': 'Nissan',
  'frontier': 'Nissan',
  '350z': 'Nissan',
  '370z': 'Nissan',
  'mazda3': 'Mazda',
  'mazda6': 'Mazda',
  'cx-5': 'Mazda',
  'miata': 'Mazda',
  'mx-5': 'Mazda',
  'rx-7': 'Mazda',
  'rx7': 'Mazda',
  'rx-8': 'Mazda',
  'outback': 'Subaru',
  'forester': 'Subaru',
  'impreza': 'Subaru',
  'wrx': 'Subaru',
  'legacy': 'Subaru',
  'crosstrek': 'Subaru',
  'elantra': 'Hyundai',
  'sonata': 'Hyundai',
  'tucson': 'Hyundai',
  'santa fe': 'Hyundai',
  'genesis': 'Hyundai',

  // American
  'mustang': 'Ford',
  'f-150': 'Ford',
  'f150': 'Ford',
  'f-250': 'Ford',
  'f250': 'Ford',
  'bronco': 'Ford',
  'explorer': 'Ford',
  'escape': 'Ford',
  'ranger': 'Ford',
  'focus': 'Ford',
  'fusion': 'Ford',
  'thunderbird': 'Ford',
  'camaro': 'Chevrolet',
  'corvette': 'Chevrolet',
  'silverado': 'Chevrolet',
  'tahoe': 'Chevrolet',
  'suburban': 'Chevrolet',
  'impala': 'Chevrolet',
  'malibu': 'Chevrolet',
  'equinox': 'Chevrolet',
  'blazer': 'Chevrolet',
  'challenger': 'Dodge',
  'charger': 'Dodge',
  'ram': 'Dodge',
  'durango': 'Dodge',
  'caravan': 'Dodge',
  'wrangler': 'Jeep',
  'cherokee': 'Jeep',
  'grand cherokee': 'Jeep',
  'compass': 'Jeep',
  'firebird': 'Pontiac',
  'gto': 'Pontiac',
  'trans am': 'Pontiac',

  // German
  '911': 'Porsche',
  'cayenne': 'Porsche',
  'boxster': 'Porsche',
  'cayman': 'Porsche',
  'panamera': 'Porsche',
  '3 series': 'BMW',
  '5 series': 'BMW',
  'm3': 'BMW',
  'm5': 'BMW',
  'x3': 'BMW',
  'x5': 'BMW',
  'a4': 'Audi',
  'a6': 'Audi',
  'q5': 'Audi',
  'tt': 'Audi',
  'golf': 'Volkswagen',
  'jetta': 'Volkswagen',
  'passat': 'Volkswagen',
  'beetle': 'Volkswagen',
  'gti': 'Volkswagen',
  'c-class': 'Mercedes-Benz',
  'e-class': 'Mercedes-Benz',
  's-class': 'Mercedes-Benz',
  'clk': 'Mercedes-Benz',
  'sl': 'Mercedes-Benz',
  'ml': 'Mercedes-Benz',
  'gle': 'Mercedes-Benz',

  // Classic
  '510': 'Datsun',
  '240z': 'Datsun',
  '280z': 'Datsun',
  'roadrunner': 'Plymouth',
  'road runner': 'Plymouth',
  'barracuda': 'Plymouth',
  'cuda': 'Plymouth',
  'chevelle': 'Chevrolet',
  'nova': 'Chevrolet',
  'el camino': 'Chevrolet',
  'bel air': 'Chevrolet',

  // Other
  'mini': 'MINI',
  'clubman': 'MINI',
  'countryman': 'MINI',
  'model 3': 'Tesla',
  'model s': 'Tesla',
  'model x': 'Tesla',
  'model y': 'Tesla',
};

function parseUrlSlug(url) {
  if (!url) return {};

  // Extract the slug part: /d/slug-here/
  const match = url.match(/\/d\/([^/]+)\//);
  if (!match) return {};

  const slug = match[1].toLowerCase();
  const parts = slug.split('-');

  // Look for year at start
  let year = null;
  let startIdx = 0;
  if (parts[0] && /^\d{4}$/.test(parts[0])) {
    year = parseInt(parts[0]);
    startIdx = 1;
  }
  // Sometimes location is first
  if (parts[1] && /^\d{4}$/.test(parts[1])) {
    year = parseInt(parts[1]);
    startIdx = 2;
  }

  // Look for known makes in the slug
  const knownMakes = ['ford', 'chevrolet', 'chevy', 'dodge', 'jeep', 'toyota', 'honda', 'nissan', 'mazda', 'subaru', 'hyundai', 'kia', 'bmw', 'mercedes', 'audi', 'volkswagen', 'vw', 'porsche', 'pontiac', 'plymouth', 'datsun', 'mini', 'tesla', 'gmc', 'cadillac', 'buick', 'lincoln', 'lexus', 'infiniti', 'acura'];

  let make = null;
  let modelStart = startIdx;

  for (let i = startIdx; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    if (knownMakes.includes(part)) {
      make = part;
      modelStart = i + 1;
      break;
    }
    // Handle "chevy" → "Chevrolet"
    if (part === 'chevy') {
      make = 'chevrolet';
      modelStart = i + 1;
      break;
    }
    if (part === 'vw') {
      make = 'volkswagen';
      modelStart = i + 1;
      break;
    }
  }

  // Extract potential model (next 1-3 parts after make)
  let model = null;
  if (modelStart < parts.length) {
    // Take parts until we hit junk words
    const junkWords = ['with', 'only', 'low', 'miles', 'original', 'owner', 'clean', 'runs', 'great', 'excellent', 'mint', 'rare', 'classic', 'restored', 'project'];
    const modelParts = [];
    for (let i = modelStart; i < Math.min(modelStart + 3, parts.length); i++) {
      if (junkWords.includes(parts[i].toLowerCase())) break;
      if (/^\d+k?$/.test(parts[i])) break; // Skip numbers like "75k"
      modelParts.push(parts[i]);
    }
    if (modelParts.length > 0) {
      model = modelParts.join(' ');
    }
  }

  return { year, make, model };
}

function cleanModelField(rawModel) {
  if (!rawModel) return null;

  let cleaned = rawModel;

  // Extract model from concatenated patterns like "Escape80k Milespassed" → "Escape"
  const concatMatch = cleaned.match(/^([A-Za-z][-A-Za-z0-9]*?)\d+k?\s*miles/i);
  if (concatMatch && concatMatch[1].length >= 2) {
    cleaned = concatMatch[1];
  }

  // Remove price patterns
  cleaned = cleaned.replace(/\$[\d,]+/g, '');
  cleaned = cleaned.replace(/\d{1,3}k\s*miles?/gi, '');
  cleaned = cleaned.replace(/[\d,]+\s*miles?/gi, '');

  // Remove common junk
  cleaned = cleaned.replace(/🔷|🔥|🎀|⭐|✨|💎|🚗|🏎️/g, '');
  cleaned = cleaned.replace(/\([^)]+\)/g, ''); // Remove parenthetical
  cleaned = cleaned.replace(/one owner/gi, '');
  cleaned = cleaned.replace(/passed smog/gi, '');
  cleaned = cleaned.replace(/drive excel/gi, '');
  cleaned = cleaned.replace(/runs great/gi, '');
  cleaned = cleaned.replace(/clean title/gi, '');
  cleaned = cleaned.replace(/low\s*miles?/gi, '');
  cleaned = cleaned.replace(/\bno\s*miles\b/gi, '');
  cleaned = cleaned.replace(/only \d+/gi, '');
  cleaned = cleaned.replace(/with only/gi, '');
  cleaned = cleaned.replace(/original/gi, '');
  cleaned = cleaned.replace(/survivor/gi, '');
  cleaned = cleaned.replace(/family owned/gi, '');
  cleaned = cleaned.replace(/hot deals?/gi, '');
  cleaned = cleaned.replace(/super cheap/gi, '');
  cleaned = cleaned.replace(/anniversary/gi, '');

  // Remove dates like 12/29, 1/18
  cleaned = cleaned.replace(/\d{1,2}\/\d{1,2}/g, '');

  // Remove trailing/leading junk
  cleaned = cleaned.replace(/[-–—]+\s*$/g, '');
  cleaned = cleaned.replace(/^\s*[-–—]+/g, '');

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned || null;
}

function inferMake(model) {
  if (!model) return null;

  const modelLower = model.toLowerCase();

  // Direct lookup
  for (const [key, make] of Object.entries(MODEL_TO_MAKE)) {
    if (modelLower.includes(key)) {
      return make;
    }
  }

  return null;
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

async function fixVehicle(vehicle) {
  const updates = {};
  let changes = [];

  // Parse URL for hints
  const urlData = parseUrlSlug(vehicle.discovery_url);

  // Clean the model field
  const cleanedModel = cleanModelField(vehicle.model);

  // Determine best make
  let make = vehicle.make;
  if (!make || make === '?') {
    // Try URL first
    if (urlData.make) {
      make = capitalizeFirst(urlData.make);
      changes.push(`make from URL: ${make}`);
    }
    // Try inferring from model
    else if (cleanedModel) {
      make = inferMake(cleanedModel);
      if (make) changes.push(`make inferred: ${make}`);
    }
    else if (urlData.model) {
      make = inferMake(urlData.model);
      if (make) changes.push(`make inferred from URL model: ${make}`);
    }

    if (make) {
      updates.make = make;
      updates.make_source = 'craigslist_cleanup_v1';
    }
  }

  // Determine best model
  let model = vehicle.model;
  // Broader junk detection: $, any "miles" mention, mileage patterns, concatenated words
  const hasJunk = model && (
    model.includes('$') ||
    /miles/i.test(model) ||  // any mention of miles
    /\d+k\b/i.test(model) ||  // 130k, 80k patterns
    /[a-z]\d+[a-z]/i.test(model)  // concatenated like "Escape80kMiles"
  );

  if (hasJunk) {
    // Try URL model first, but clean it too
    if (urlData.model) {
      let urlModel = cleanModelField(urlData.model);
      if (urlModel && urlModel.length >= 2 && urlModel.length < 40) {
        model = urlModel
          .split(' ')
          .map(w => capitalizeFirst(w))
          .join(' ');
        changes.push(`model from URL: ${model}`);
      }
    }
    // Fallback to cleaning original model field
    if (model === vehicle.model && cleanedModel && cleanedModel.length >= 2 && cleanedModel.length < 50) {
      model = cleanedModel;
      changes.push(`model cleaned: ${model}`);
    }

    if (model && model !== vehicle.model) {
      updates.model = model;
    }
  }

  return { updates, changes };
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 100;
  const dryRun = process.argv.includes('--dry-run');

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  CRAIGSLIST DATA CLEANUP                                   ║');
  console.log(`║  Batch: ${batchSize} | Dry run: ${dryRun}                              ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Get CL vehicles with junk in model field
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?auction_source=eq.Craigslist&or=(model.ilike.*$*,model.ilike.*miles*)&select=id,year,make,model,discovery_url&limit=${batchSize}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const vehicles = await res.json();

  console.log(`Found ${vehicles.length} vehicles to process\n`);

  let fixed = 0;
  let skipped = 0;

  for (const v of vehicles) {
    const { updates, changes } = await fixVehicle(v);

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    console.log(`[${v.id.slice(0, 8)}] ${v.year} ${v.make || '?'} ${v.model?.slice(0, 40)}...`);
    console.log(`  → ${changes.join(', ')}`);

    if (!dryRun) {
      await fetch(`${SUPABASE_URL}/rest/v1/vehicles?id=eq.${v.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });
    }

    fixed++;
  }

  console.log(`\n✅ Fixed: ${fixed}, Skipped: ${skipped}`);

  if (dryRun) {
    console.log('\n(Dry run - no changes made. Remove --dry-run to apply.)');
  }
}

main().catch(console.error);
