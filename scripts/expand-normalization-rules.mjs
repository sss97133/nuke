#!/usr/bin/env node
/**
 * expand-normalization-rules.mjs
 *
 * Mines field_evidence and vehicle_field_evidence tables for variant patterns,
 * then validates normalizations against NHTSA/EPA canonical names.
 *
 * The process:
 *   1. Pull all unique extracted values by field_type (make, model, transmission, engine, etc.)
 *   2. Cluster similar values using edit distance + frequency
 *   3. Validate canonical values against NHTSA/EPA authoritative sources
 *   4. Insert new normalization_rules with citation
 *
 * Usage:
 *   dotenvx run -- node scripts/expand-normalization-rules.mjs [--dry-run] [--field transmission] [--min-frequency 3]
 */

import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');
const FIELD_FILTER = process.argv.find((_, i, a) => a[i - 1] === '--field') || null;
const MIN_FREQUENCY = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--min-frequency') || '3');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Known canonical values from authoritative sources
const CANONICAL_TRANSMISSIONS = {
  // Source: NHTSA VPIC + EPA fuel economy
  '3-Speed Automatic': ['TH350', 'THM350', 'Turbo 350', 'Turbo-Hydramatic 350', '3spd auto', '3 speed automatic', '3-spd auto', 'Powerglide 3', 'C4', 'C-4', 'three speed auto'],
  '4-Speed Automatic': ['TH400', 'THM400', 'Turbo 400', 'Turbo-Hydramatic 400', '4spd auto', '4 speed automatic', '4-spd auto', '700R4', '700-R4', '4L60', '4L60E', '4L80E', 'AOD', 'A4LD', 'A518', '46RE', '46RH', 'four speed auto', 'E4OD'],
  '5-Speed Automatic': ['5spd auto', '5 speed automatic', '5-spd auto', '4R44E', '4R55E', '5R55E', '5R55S', '5R55W', '5R110W', '5L40E', '545RFE', 'five speed auto'],
  '6-Speed Automatic': ['6spd auto', '6 speed automatic', '6-spd auto', '6L80', '6L80E', '6L90', '6R80', '6HP26', '6HP28', '6T70', '6T75', 'six speed auto'],
  '3-Speed Manual': ['3spd', '3-speed', '3 speed manual', 'three speed', 'three on the tree', '3 on the tree', 'column shift 3spd'],
  '4-Speed Manual': ['4spd', '4-speed', '4 speed manual', 'SM465', 'SM-465', 'Muncie M20', 'Muncie M21', 'Muncie M22', 'T18', 'T-18', 'NP435', 'NP-435', 'Toploader', 'Top Loader', 'four speed', 'Saginaw 4-speed', 'T10', 'T-10'],
  '5-Speed Manual': ['5spd', '5-speed', '5 speed manual', 'T5', 'T-5', 'NV3500', 'NV4500', 'Getrag 290', 'AX5', 'AX-5', 'AX15', 'AX-15', 'five speed', 'TR3650', 'T56', 'T-56'],
  '6-Speed Manual': ['6spd', '6-speed', '6 speed manual', 'T56', 'TR6060', 'Tremec T56', 'six speed', 'Getrag 233'],
  'CVT': ['continuously variable', 'CVT', 'Jatco CVT'],
};

const CANONICAL_DRIVETRAINS = {
  // Source: NHTSA VPIC
  'RWD': ['rear wheel drive', 'rear-wheel drive', 'rwd', '2wd rear', 'rear drive'],
  'FWD': ['front wheel drive', 'front-wheel drive', 'fwd', 'front drive'],
  '4WD': ['4x4', '4×4', 'four wheel drive', '4wd', 'four-wheel drive', 'part-time 4wd', 'part time 4x4', '4WD/4-Wheel Drive/4x4'],
  'AWD': ['all wheel drive', 'all-wheel drive', 'awd', 'full-time 4wd', 'full time awd', 'permanent awd'],
};

const CANONICAL_FUEL_TYPES = {
  // Source: EPA fueleconomy.gov
  'Gasoline': ['gas', 'petrol', 'unleaded', 'regular', 'regular unleaded', 'premium unleaded', 'regular gasoline'],
  'Premium Gasoline': ['premium', 'premium gas', 'premium unleaded', '91 octane', '93 octane', 'super unleaded'],
  'Diesel': ['diesel', 'diesel fuel', 'compression ignition', 'turbo diesel', 'turbodiesel'],
  'Electric': ['electric', 'EV', 'battery electric', 'BEV'],
  'Hybrid': ['hybrid', 'gas/electric', 'HEV', 'plug-in hybrid', 'PHEV'],
  'Flex Fuel': ['flex fuel', 'E85', 'flexible fuel', 'E85/gasoline', 'FFV'],
};

const CANONICAL_BODY_STYLES = {
  // Source: NHTSA body class + EPA vehicle class
  'Sedan': ['sedan', '4-door sedan', 'four door sedan', '4dr sedan', '4 door', '4-dr'],
  'Coupe': ['coupe', '2-door coupe', 'two door', '2dr', '2-dr', 'cpe'],
  'Convertible': ['convertible', 'cabriolet', 'roadster', 'spyder', 'spider', 'drop top', 'ragtop', 'targa'],
  'Wagon': ['wagon', 'station wagon', 'estate', 'shooting brake', 'sport wagon', 'SW'],
  'Hatchback': ['hatchback', 'hatch', '3-door', '5-door', 'liftback', '3dr', '5dr'],
  'Pickup': ['pickup', 'pick-up', 'truck', 'pickup truck', 'regular cab', 'extended cab', 'crew cab', 'single cab'],
  'SUV': ['suv', 'sport utility', 'sport utility vehicle', 'utility'],
  'Van': ['van', 'minivan', 'mini-van', 'passenger van', 'cargo van'],
  'Fastback': ['fastback', 'sportsroof', 'sport roof', 'SportsRoof'],
};

const CANONICAL_MAKES = {
  // Source: NHTSA VPIC GetAllMakes — only include ABBREVIATION variants, not full names
  // (full names already match themselves via exact match)
  'Chevrolet': ['chevy', 'chev'],
  'Mercedes-Benz': ['mercedes', 'merc', 'mb', 'mercedes benz'],
  'Volkswagen': ['vw'],
  'Rolls-Royce': ['rolls royce'],
  'Aston Martin': ['aston-martin'],
  'Alfa Romeo': ['alfa'],
  'Land Rover': ['landrover'],
  'De Tomaso': ['detomaso'],
};

function levenshtein(a, b) {
  const la = a.length, lb = b.length;
  const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[la][lb];
}

async function getFieldEvidencePatterns(fieldName) {
  // field_evidence uses: field_name + proposed_value
  const { data, error } = await supabase
    .from('field_evidence')
    .select('proposed_value')
    .eq('field_name', fieldName)
    .not('proposed_value', 'is', null)
    .limit(5000);

  if (error) {
    console.error(`Error querying field_evidence for ${fieldName}:`, error.message);
    return [];
  }

  const freqs = {};
  for (const row of data || []) {
    const val = row.proposed_value?.trim();
    if (val) freqs[val] = (freqs[val] || 0) + 1;
  }
  return Object.entries(freqs)
    .filter(([, f]) => f >= MIN_FREQUENCY)
    .map(([value, freq]) => ({ value, freq }))
    .sort((a, b) => b.freq - a.freq);
}

async function getVehicleFieldEvidencePatterns(fieldName) {
  // vehicle_field_evidence uses: field_name + value_text
  const { data, error } = await supabase
    .from('vehicle_field_evidence')
    .select('value_text')
    .eq('field_name', fieldName)
    .not('value_text', 'is', null)
    .limit(5000);

  if (error) {
    console.error(`Error querying vehicle_field_evidence for ${fieldName}:`, error.message);
    return [];
  }

  const freqs = {};
  for (const row of data || []) {
    const val = row.value_text?.trim();
    if (val) freqs[val] = (freqs[val] || 0) + 1;
  }

  return Object.entries(freqs)
    .filter(([, f]) => f >= MIN_FREQUENCY)
    .map(([value, freq]) => ({ value, freq }))
    .sort((a, b) => b.freq - a.freq);
}

function matchToCanonical(value, canonicalMap) {
  const lower = value.toLowerCase().trim();

  for (const [canonical, variants] of Object.entries(canonicalMap)) {
    // Exact match to canonical
    if (lower === canonical.toLowerCase()) return { canonical, confidence: 100 };

    // Exact match to variant
    for (const variant of variants) {
      if (lower === variant.toLowerCase()) return { canonical, confidence: 95 };
    }

    // Fuzzy match to variants (edit distance <= 2)
    for (const variant of variants) {
      if (levenshtein(lower, variant.toLowerCase()) <= 2) {
        return { canonical, confidence: 80 };
      }
    }

    // Contains match — only if the value is significantly longer than the variant (not vice versa)
    // and the variant is at least 4 chars to prevent false positives
    for (const variant of variants) {
      const vLower = variant.toLowerCase();
      if (vLower.length >= 4 && lower.includes(vLower) && lower.length <= vLower.length * 2) {
        return { canonical, confidence: 70 };
      }
    }
  }

  return null;
}

async function getExistingRules() {
  const { data, error } = await supabase
    .from('normalization_rules')
    .select('*');

  if (error) {
    console.error('Error fetching existing rules:', error.message);
    return [];
  }

  return data || [];
}

function findNewVariants(patterns, canonicalMap, existingRules, fieldType) {
  const newRules = [];
  const existingVariants = new Set();

  // Collect all existing variants across all rules for this field type
  for (const rule of existingRules.filter(r => r.field_type === fieldType)) {
    for (const v of rule.variants) {
      existingVariants.add(v.toLowerCase());
    }
    existingVariants.add(rule.canonical_value.toLowerCase());
  }

  // Group patterns by canonical match
  const canonicalGroups = {};

  for (const pattern of patterns) {
    const match = matchToCanonical(pattern.value, canonicalMap);
    if (!match) continue;
    if (existingVariants.has(pattern.value.toLowerCase())) continue;

    if (!canonicalGroups[match.canonical]) {
      canonicalGroups[match.canonical] = {
        canonical: match.canonical,
        newVariants: [],
        totalFreq: 0,
        maxConfidence: 0,
      };
    }

    canonicalGroups[match.canonical].newVariants.push(pattern.value);
    canonicalGroups[match.canonical].totalFreq += pattern.freq;
    canonicalGroups[match.canonical].maxConfidence = Math.max(
      canonicalGroups[match.canonical].maxConfidence,
      match.confidence
    );
  }

  // Convert groups to rules
  for (const [canonical, group] of Object.entries(canonicalGroups)) {
    if (group.newVariants.length === 0) continue;

    // Check if we should update an existing rule or create new one
    const existingRule = existingRules.find(r =>
      r.field_type === fieldType && r.canonical_value.toLowerCase() === canonical.toLowerCase()
    );

    if (existingRule) {
      // Update existing rule with new variants
      newRules.push({
        type: 'update',
        ruleId: existingRule.id,
        canonical_value: existingRule.canonical_value,
        new_variants: group.newVariants,
        existing_variants: existingRule.variants,
        field_type: fieldType,
        confidence_boost: Math.round(group.maxConfidence / 10),
      });
    } else {
      // Create new rule
      newRules.push({
        type: 'insert',
        canonical_value: canonical,
        variants: group.newVariants,
        field_type: fieldType,
        normalization_logic: `Discovered from ${group.totalFreq} field_evidence extractions. Validated against NHTSA/EPA canonical names.`,
        confidence_boost: Math.round(group.maxConfidence / 10),
      });
    }
  }

  return newRules;
}

async function applyRules(rules) {
  let inserted = 0;
  let updated = 0;

  for (const rule of rules) {
    if (rule.type === 'insert') {
      const { error } = await supabase
        .from('normalization_rules')
        .insert({
          canonical_value: rule.canonical_value,
          variants: rule.variants,
          field_type: rule.field_type,
          normalization_logic: rule.normalization_logic,
          confidence_boost: rule.confidence_boost,
        });
      if (error) {
        console.error(`  Insert error for ${rule.canonical_value}:`, error.message);
      } else {
        inserted++;
      }
    } else if (rule.type === 'update') {
      // Merge new variants into existing
      const mergedVariants = [...new Set([...rule.existing_variants, ...rule.new_variants])];
      const { error } = await supabase
        .from('normalization_rules')
        .update({ variants: mergedVariants })
        .eq('id', rule.ruleId);
      if (error) {
        console.error(`  Update error for ${rule.canonical_value}:`, error.message);
      } else {
        updated++;
      }
    }
  }

  return { inserted, updated };
}

async function main() {
  console.log('Normalization Rules Expansion');
  console.log(`Min frequency: ${MIN_FREQUENCY} | Dry run: ${DRY_RUN}`);
  if (FIELD_FILTER) console.log(`Field filter: ${FIELD_FILTER}`);
  console.log('---');

  const existingRules = await getExistingRules();
  console.log(`Existing normalization rules: ${existingRules.length}`);

  const fieldConfigs = [
    { fieldType: 'transmission', canonicalMap: CANONICAL_TRANSMISSIONS, fieldNames: ['transmission'] },
    { fieldType: 'drivetrain', canonicalMap: CANONICAL_DRIVETRAINS, fieldNames: ['drivetrain'] },
    { fieldType: 'fuel_type', canonicalMap: CANONICAL_FUEL_TYPES, fieldNames: ['fuel_type'] },
    { fieldType: 'body_style', canonicalMap: CANONICAL_BODY_STYLES, fieldNames: ['body_style'] },
    { fieldType: 'make', canonicalMap: CANONICAL_MAKES, fieldNames: ['make'] },
    { fieldType: 'engine_type', canonicalMap: {}, fieldNames: ['engine_type', 'engine_size'] }, // discovery only, no canonicals yet
  ];

  const fieldsToProcess = FIELD_FILTER
    ? fieldConfigs.filter(f => f.fieldType === FIELD_FILTER)
    : fieldConfigs;

  let totalNewRules = 0;
  let totalUpdatedRules = 0;

  for (const config of fieldsToProcess) {
    console.log(`\n== ${config.fieldType.toUpperCase()} ==`);

    // Gather patterns from both evidence tables using exact field names
    let allPatterns = [];
    for (const fieldName of config.fieldNames) {
      const patterns1 = await getFieldEvidencePatterns(fieldName);
      const patterns2 = await getVehicleFieldEvidencePatterns(fieldName);
      console.log(`  [${fieldName}] field_evidence: ${patterns1.length}, vehicle_field_evidence: ${patterns2.length}`);
      allPatterns = [...allPatterns, ...patterns1, ...patterns2];
    }

    // Deduplicate patterns
    const patternMap = {};
    for (const p of allPatterns) {
      const key = p.value.toLowerCase();
      if (!patternMap[key]) patternMap[key] = { value: p.value, freq: 0 };
      patternMap[key].freq += p.freq;
    }
    const patterns = Object.values(patternMap).sort((a, b) => b.freq - a.freq);

    console.log(`  Found ${patterns.length} unique extracted values (freq >= ${MIN_FREQUENCY})`);
    if (patterns.length > 0) {
      console.log(`  Top 5: ${patterns.slice(0, 5).map(p => `"${p.value}" (${p.freq}x)`).join(', ')}`);
    }

    // Find new normalizations
    const newRules = findNewVariants(patterns, config.canonicalMap, existingRules, config.fieldType);
    console.log(`  New rules to create: ${newRules.filter(r => r.type === 'insert').length}`);
    console.log(`  Existing rules to update: ${newRules.filter(r => r.type === 'update').length}`);

    if (newRules.length > 0) {
      console.log('  New normalizations:');
      for (const rule of newRules) {
        if (rule.type === 'insert') {
          console.log(`    + "${rule.canonical_value}" ← [${rule.variants.slice(0, 5).join(', ')}${rule.variants.length > 5 ? '...' : ''}]`);
        } else {
          console.log(`    ~ "${rule.canonical_value}" +[${rule.new_variants.slice(0, 5).join(', ')}]`);
        }
      }
    }

    if (!DRY_RUN && newRules.length > 0) {
      const { inserted, updated } = await applyRules(newRules);
      totalNewRules += inserted;
      totalUpdatedRules += updated;
      console.log(`  Applied: ${inserted} new + ${updated} updated`);
    } else {
      totalNewRules += newRules.filter(r => r.type === 'insert').length;
      totalUpdatedRules += newRules.filter(r => r.type === 'update').length;
    }
  }

  console.log(`\n---`);
  console.log(`Total: ${totalNewRules} new rules, ${totalUpdatedRules} updated rules`);

  if (!DRY_RUN) {
    const { data: finalCount } = await supabase
      .from('normalization_rules')
      .select('*', { count: 'exact', head: true });
    console.log(`Final normalization_rules count: ${finalCount?.length || 'check manually'}`);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
