#!/usr/bin/env node
/**
 * validate-extractions.mjs — Post-hoc validation of v3 forensic extractions
 *
 * Runs code_validation_rules against existing description_discoveries,
 * checking for clone risks, impossible combos, VIN mismatches, known issues.
 *
 * Usage:
 *   dotenvx run -- node scripts/validate-extractions.mjs              # full run
 *   dotenvx run -- node scripts/validate-extractions.mjs --dry-run    # report only, no DB writes
 *   dotenvx run -- node scripts/validate-extractions.mjs --limit 100  # validate first 100
 *   dotenvx run -- node scripts/validate-extractions.mjs --make Ford  # validate Ford only
 */

import pg from 'pg';

const DB_HOST = '54.177.55.191';

async function getDb() {
  const client = new pg.Client({
    host: DB_HOST, port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

// ─── Make → Manufacturer mapping ─────────────────────────────────────────────
const MFG_MAP = {
  'Chevrolet': 'GM', 'Pontiac': 'GM', 'Buick': 'GM', 'Oldsmobile': 'GM',
  'Cadillac': 'GM', 'GMC': 'GM',
  'Ford': 'Ford', 'Lincoln': 'Ford', 'Mercury': 'Ford', 'Shelby': 'Ford',
  'Dodge': 'Mopar', 'Plymouth': 'Mopar', 'Chrysler': 'Mopar',
  'Porsche': 'Porsche', 'BMW': 'BMW', 'Ferrari': 'Ferrari',
  'Mercedes-Benz': 'Mercedes-Benz', 'Toyota': 'Toyota', 'Nissan': 'Nissan',
  'Datsun': 'Nissan', 'AMC': 'AMC', 'Jeep': 'AMC',
};

// ─── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : null;
const makeIdx = args.indexOf('--make');
const MAKE_FILTER = makeIdx >= 0 ? args[makeIdx + 1] : null;

// ─── Normalize extraction format ─────────────────────────────────────────────
// v3 extractions come in two formats:
//   FLAT (majority): { e_type, e_hp, e_code, e_detail, t_type, codes, flags, docs, ... }
//   NESTED (752):    { specs: { engine: { type, hp }, vin }, codes_found, red_flags, ... }

function normalize(raw) {
  if (raw.specs) {
    // Nested format
    const s = raw.specs;
    return {
      vin: s.vin,
      engine_type: s.engine?.type || '',
      engine_detail: s.engine?.claimed || '',
      engine_code: null,
      engine_hp: s.engine?.hp || null,
      engine_ci: s.engine?.displacement_ci || null,
      transmission_type: s.transmission?.type || '',
      transmission_detail: s.transmission?.claimed || '',
      drivetrain: s.drivetrain || '',
      body: s.body_style || '',
      color: s.exterior_color || '',
      matching: raw.matching_numbers,
      docs: (raw.documentation || []).join(' '),
      mods: (raw.modifications || []).join(' '),
      flags: (raw.red_flags || []).map(f => f.flag || f).join(' '),
      codes: raw.codes_found || [],
      equip: (raw.notable_equipment || []).join(' '),
      cond: raw.condition?.grade || '',
      auth: raw.authenticity_score || null,
      price_pos: (raw.price_signals?.positive || []).join(' '),
      price_neg: (raw.price_signals?.negative || []).join(' '),
    };
  }
  // Flat format
  return {
    vin: raw.vin,
    engine_type: raw.e_type || '',
    engine_detail: raw.e_detail || '',
    engine_code: raw.e_code || null,
    engine_hp: raw.e_hp || null,
    engine_ci: raw.e_ci || null,
    transmission_type: raw.t_type || '',
    transmission_detail: raw.t_detail || '',
    drivetrain: raw.drive || '',
    body: raw.body || '',
    color: raw.color || '',
    matching: raw.matching,
    docs: Array.isArray(raw.docs) ? raw.docs.join(' ') : (raw.docs || ''),
    mods: Array.isArray(raw.mods) ? raw.mods.map(m => typeof m === 'string' ? m : JSON.stringify(m)).join(' ') : (raw.mods || ''),
    flags: Array.isArray(raw.flags) ? raw.flags.map(f => typeof f === 'string' ? f : (f.f || f.flag || JSON.stringify(f))).join(' ') : (raw.flags || ''),
    codes: Array.isArray(raw.codes) ? raw.codes : [],
    equip: Array.isArray(raw.equip) ? raw.equip.join(' ') : (raw.equip || ''),
    cond: raw.cond || '',
    auth: raw.auth || null,
    price_pos: Array.isArray(raw.price_pos) ? raw.price_pos.join(' ') : (raw.price_pos || ''),
    price_neg: Array.isArray(raw.price_neg) ? raw.price_neg.join(' ') : (raw.price_neg || ''),
  };
}

// ─── Validation logic ────────────────────────────────────────────────────────

function runVinEngineMap(rule, n, vehicle) {
  // Check if VIN's engine code matches claimed engine
  const vin = n.vin || vehicle.vin;
  if (!vin || vin.length < 8) return null;

  // For pre-1981 vehicles, VIN encoding varies by manufacturer
  // Ford muscle era: 5th character is engine code
  const engineCode = vin.charAt(4); // 5th character (0-indexed 4)
  const claimedEngine = [n.engine_detail, n.engine_code, n.engine_type].filter(Boolean).join(' ');

  if (engineCode.toUpperCase() === rule.code_a.toUpperCase()) {
    // VIN says this engine — check if extraction mentions it
    const expectedEngine = rule.code_b;
    if (claimedEngine && !matchesEngineRef(claimedEngine, expectedEngine)) {
      return {
        type: 'vin_engine_mismatch',
        severity: rule.severity,
        message: `VIN engine code '${engineCode}' indicates ${rule.description}, but extraction claims '${claimedEngine}'`,
        detail: rule.detail,
      };
    }
    // Positive match — VIN confirms engine
    return {
      type: 'vin_engine_confirmed',
      severity: 'info',
      message: `VIN engine code '${engineCode}' matches: ${rule.description}`,
      detail: rule.detail,
    };
  }
  return null;
}

function matchesEngineRef(claimed, expected) {
  // Fuzzy match: does the claimed engine text reference the expected engine?
  const c = claimed.toLowerCase();
  const e = expected.toLowerCase();
  // Check for displacement match
  if (e.includes('302') && c.includes('302')) return true;
  if (e.includes('289') && c.includes('289')) return true;
  if (e.includes('351') && c.includes('351')) return true;
  if (e.includes('428') && c.includes('428')) return true;
  if (e.includes('429') && c.includes('429')) return true;
  if (e.includes('260') && c.includes('260')) return true;
  if (e.includes('boss') && c.includes('boss')) return true;
  if (e.includes('hipo') && (c.includes('hipo') || c.includes('hi-po') || c.includes('high performance'))) return true;
  if (e.includes('cobra jet') && (c.includes('cobra jet') || c.includes('cj'))) return true;
  return c.includes(e) || e.includes(c);
}

function runClonePattern(rule, n, vehicle) {
  // Check if a high-value designation is claimed without documentation
  const codesText = n.codes.map(c => typeof c === 'string' ? c : (c.c || c.code || JSON.stringify(c))).join(' ').toLowerCase();
  const engineAll = [n.engine_type, n.engine_detail, n.engine_code].filter(Boolean).join(' ').toLowerCase();
  const allText = [engineAll, codesText, n.equip, n.flags, n.mods].join(' ').toLowerCase();
  const documentation = n.docs.toLowerCase();
  const title = (vehicle.title || vehicle.model || '').toLowerCase();

  const code = rule.code_a.toLowerCase();

  // Does this vehicle claim to be the special variant?
  let claimed = false;
  if (code.includes('boss302') && (title.includes('boss 302') || title.includes('boss302') || allText.includes('boss 302') || allText.includes('dz302'))) claimed = true;
  if (code.includes('boss429') && (title.includes('boss 429') || title.includes('boss429') || allText.includes('boss 429'))) claimed = true;
  if (code.includes('gt350') && (title.includes('gt350') || title.includes('gt-350') || (title.includes('shelby') && title.includes('350')))) claimed = true;
  if (code.includes('gt500') && (title.includes('gt500') || title.includes('gt-500') || (title.includes('shelby') && title.includes('500')))) claimed = true;
  if (code.includes('scj') && (allText.includes('super cobra jet') || allText.includes('scj'))) claimed = true;
  if (code.includes('hemi') && (allText.includes('hemi') || (allText.includes('426') && engineAll.includes('426')))) claimed = true;
  if (code.includes('6pak') && (allText.includes('six pack') || allText.includes('6-pack') || allText.includes('six-pack') || allText.includes('6 pack'))) claimed = true;

  if (!claimed) return null;

  // Check if VIN itself authenticates (Shelby SFM VINs, Kar Kraft KK VINs)
  const vin = (n.vin || vehicle.vin || '').toUpperCase();
  const vinProves = vin.startsWith('SFM') || vin.includes('KK');

  // Check if it's a known restomod/continuation (not claiming originality)
  const isRestomod = title.includes('continuation') || title.includes('classic recreations')
    || title.includes('gt500cr') || title.includes('tribute') || title.includes('replica')
    || title.includes('restomod');

  if (vinProves || isRestomod) {
    return {
      type: 'clone_verified',
      severity: 'info',
      message: `${vehicle.year} ${vehicle.make} ${rule.code_a} — ${vinProves ? 'VIN authenticates' : 'known restomod/continuation'}`,
      detail: rule.detail,
    };
  }

  // It IS claimed — check for documentation
  const hasDoc = documentation.includes('marti') || documentation.includes('govier')
    || documentation.includes('registry') || documentation.includes('broadcast sheet')
    || documentation.includes('fender tag') || documentation.includes('build sheet')
    || documentation.includes('saac') || documentation.includes('certificate')
    || documentation.includes('shelby american') || documentation.includes('kar kraft')
    || documentation.includes('bill of sale') || documentation.includes('window sticker')
    || documentation.includes('original invoice') || documentation.includes('sales invoice')
    || documentation.includes('shelby documentation');
  const isMatching = n.matching === true || n.matching === 'yes' || String(n.matching).includes('matching');

  if (!hasDoc && !isMatching) {
    return {
      type: 'clone_risk',
      severity: rule.severity,
      message: `${vehicle.year} ${vehicle.make} claims ${rule.code_a} but no authentication documentation found`,
      detail: rule.detail,
    };
  }
  if (hasDoc) {
    return {
      type: 'clone_verified',
      severity: 'info',
      message: `${vehicle.year} ${vehicle.make} ${rule.code_a} — documentation present`,
      detail: rule.detail,
    };
  }
  return null;
}

function runIncompatible(rule, n, vehicle) {
  const codesText = n.codes.map(c => typeof c === 'string' ? c : (c.c || c.code || '')).join(' ').toLowerCase();
  const allText = [n.engine_detail, n.engine_type, n.engine_code, n.transmission_detail,
    n.transmission_type, n.equip, n.mods, codesText, n.flags
  ].join(' ').toLowerCase();

  const matchCode = (code) => {
    const c = code.toLowerCase();
    const readable = c.replace(/_/g, ' ');
    // Match code directly or readable form
    if (allText.includes(c) || allText.includes(readable)) return true;
    // Special cases
    if (c.includes('ac') && (allText.includes('air conditioning') || allText.includes('a/c') || allText.includes('factory air'))) return true;
    if (c.includes('boss302') && (allText.includes('boss 302') || allText.includes('dz302'))) return true;
    if (c.includes('boss429') && allText.includes('boss 429')) return true;
    if (c.includes('a727') && (allText.includes('torqueflite') || allText.includes('a-727'))) return true;
    if (c.includes('hemi') && allText.includes('hemi')) return true;
    return false;
  };

  if (matchCode(rule.code_a) && matchCode(rule.code_b)) {
    return {
      type: 'incompatible_combo',
      severity: rule.severity,
      message: `Incompatible: ${rule.code_a} + ${rule.code_b} — ${rule.description}`,
      detail: rule.detail,
    };
  }
  return null;
}

function runMandatoryPair(rule, n, vehicle) {
  const codesText = n.codes.map(c => typeof c === 'string' ? c : (c.c || c.code || '')).join(' ').toLowerCase();
  const allText = [n.engine_detail, n.engine_type, n.engine_code, n.transmission_detail,
    n.transmission_type, n.drivetrain, n.equip, n.mods, codesText
  ].join(' ').toLowerCase();

  const matchCode = (code) => {
    const c = code.toLowerCase();
    if (allText.includes(c) || allText.includes(c.replace(/_/g, ' '))) return true;
    if (c.includes('dana60') && (allText.includes('dana 60') || allText.includes('dana-60'))) return true;
    if (c.includes('detroitlocker') && (allText.includes('detroit locker') || allText.includes('detroit-locker') || allText.includes('full locking'))) return true;
    if (c.includes('dragpak') && (allText.includes('drag pack') || allText.includes('drag pak'))) return true;
    if (c.includes('hemi') && allText.includes('hemi')) return true;
    if (c.includes('a34') && allText.includes('super track pak')) return true;
    return false;
  };

  if (matchCode(rule.code_a) && !matchCode(rule.code_b)) {
    return {
      type: 'missing_mandatory_pair',
      severity: rule.severity,
      message: `${rule.code_a} requires ${rule.code_b} — ${rule.description}`,
      detail: rule.detail,
    };
  }
  return null;
}

function runHpRange(rule, n, vehicle) {
  const engineAll = [n.engine_type, n.engine_detail, n.engine_code].filter(Boolean).join(' ').toLowerCase();
  const code = rule.code_a.toLowerCase();

  // For known-issue rules (IMS, rod bearings, VANOS, SMG), check if engine/model matches
  if (rule.detail && (rule.detail.includes('IMS') || rule.detail.includes('rod bearing')
    || rule.detail.includes('VANOS') || rule.detail.includes('SMG'))) {
    const year = vehicle.year;
    if (year < rule.year_start || year > rule.year_end) return null;
    if (rule.makes && !rule.makes.includes(vehicle.make)) return null;

    const vModel = (vehicle.model || '').toLowerCase();

    // BMW S65 — V8 M3
    if (code === 's65' && rule.models?.includes('M3') && vModel.includes('m3') &&
        (engineAll.includes('4.0') || engineAll.includes('v8') || engineAll.includes('s65'))) {
      return { type: 'known_issue', severity: rule.severity, message: rule.description, detail: rule.detail };
    }
    // BMW VANOS — any BMW inline-6 in era
    if (code === 'vanos' && vehicle.make === 'BMW' &&
        (engineAll.includes('inline') || engineAll.includes('i6') || engineAll.includes('straight') || engineAll.includes('6-cylinder') || engineAll.includes('vanos'))) {
      return { type: 'known_issue', severity: rule.severity, message: rule.description, detail: rule.detail };
    }
    // BMW SMG
    if (code === 'smg_ii' && (engineAll.includes('smg') || n.transmission_detail.toLowerCase().includes('smg') || n.transmission_type.toLowerCase().includes('smg'))) {
      return { type: 'known_issue', severity: rule.severity, message: rule.description, detail: rule.detail };
    }
    // Porsche M96/M97 — any water-cooled flat-6 Porsche in era
    if ((code === 'm96' || code === 'm97') && vehicle.make === 'Porsche') {
      // Any 911/Boxster/Cayman in the year range with a flat-6 has this engine
      if (vModel.includes('911') || vModel.includes('boxster') || vModel.includes('cayman') ||
          vModel.includes('carrera') || vModel.includes('996') || vModel.includes('997') || vModel.includes('987')) {
        // Exclude GT3/GT2/Turbo (Mezger engine, no IMS)
        if (vModel.includes('gt3') || vModel.includes('gt2') || vModel.includes('turbo')) return null;
        return { type: 'known_issue', severity: rule.severity, message: rule.description, detail: rule.detail };
      }
    }
    // Porsche Mezger (positive flag)
    if (code === 'mezger' && vehicle.make === 'Porsche' &&
        (vModel.includes('gt3') || vModel.includes('gt2') || vModel.includes('turbo'))) {
      return { type: 'known_positive', severity: 'info', message: rule.description, detail: rule.detail };
    }
    return null;
  }

  // Standard HP range check
  const claimedHp = n.engine_hp ? parseInt(n.engine_hp) : null;
  if (!claimedHp) return null;

  const hpMatch = rule.description.match(/(\d+)hp/);
  if (!hpMatch) return null;
  const expectedHp = parseInt(hpMatch[1]);

  if (Math.abs(claimedHp - expectedHp) > expectedHp * 0.25) {
    return {
      type: 'hp_mismatch',
      severity: rule.severity,
      message: `Claimed ${claimedHp}hp but ${rule.code_a} is rated ${expectedHp}hp — ${rule.description}`,
      detail: rule.detail,
    };
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const db = await getDb();
  console.log('Connected to database');

  // Load all validation rules
  const { rows: rules } = await db.query('SELECT * FROM code_validation_rules ORDER BY manufacturer, rule_type');
  console.log(`Loaded ${rules.length} validation rules`);

  // Load all v3 extractions with vehicle data
  let query = `
    SELECT dd.id as dd_id, dd.vehicle_id, dd.raw_extraction,
           v.year, v.make, v.model, v.vin, v.title, v.sale_price
    FROM description_discoveries dd
    JOIN vehicles v ON v.id = dd.vehicle_id
    WHERE dd.prompt_version = 'v3'
  `;
  if (MAKE_FILTER) {
    query += ` AND v.make = '${MAKE_FILTER}'`;
  }
  query += ` ORDER BY v.sale_price DESC NULLS LAST`;
  if (LIMIT) {
    query += ` LIMIT ${LIMIT}`;
  }

  const { rows: extractions } = await db.query(query);
  console.log(`Loaded ${extractions.length} v3 extractions to validate\n`);

  // Stats
  const stats = {
    total: extractions.length,
    validated: 0,
    warnings: 0,
    errors: 0,
    fraud_risks: 0,
    info: 0,
    by_type: {},
    by_make: {},
    findings: [],
  };

  // Process each extraction
  for (const row of extractions) {
    const ext = row.raw_extraction;
    if (!ext || typeof ext !== 'object') continue;

    const vehicle = { year: row.year, make: row.make, model: row.model, vin: row.vin, title: row.title };
    const mfg = MFG_MAP[vehicle.make];
    if (!mfg) { stats.validated++; continue; }

    // Normalize extraction format
    const n = normalize(ext);

    // Get applicable rules for this manufacturer + year
    const applicable = rules.filter(r => {
      if (r.manufacturer !== mfg) return false;
      if (r.year_start && vehicle.year < r.year_start) return false;
      if (r.year_end && vehicle.year > r.year_end) return false;
      if (r.makes && r.makes.length > 0 && !r.makes.includes(vehicle.make)) return false;
      if (r.models && r.models.length > 0) {
        const vModel = (vehicle.model || '').toLowerCase();
        if (!r.models.some(m => vModel.includes(m.toLowerCase()))) return false;
      }
      return true;
    });

    const vehicleFindings = [];

    for (const rule of applicable) {
      let finding = null;
      try {
        switch (rule.rule_type) {
          case 'vin_engine_map': finding = runVinEngineMap(rule, n, vehicle); break;
          case 'clone_pattern': finding = runClonePattern(rule, n, vehicle); break;
          case 'incompatible': finding = runIncompatible(rule, n, vehicle); break;
          case 'mandatory_pair': finding = runMandatoryPair(rule, n, vehicle); break;
          case 'hp_range': finding = runHpRange(rule, n, vehicle); break;
        }
      } catch (e) {
        // Skip rule errors silently
      }
      if (finding) {
        vehicleFindings.push({ ...finding, rule_id: rule.id });
      }
    }

    if (vehicleFindings.length > 0) {
      // Count by severity
      for (const f of vehicleFindings) {
        stats.by_type[f.type] = (stats.by_type[f.type] || 0) + 1;
        stats.by_make[vehicle.make] = (stats.by_make[vehicle.make] || 0) + 1;
        if (f.severity === 'warning') stats.warnings++;
        else if (f.severity === 'error') stats.errors++;
        else if (f.severity === 'fraud_risk') stats.fraud_risks++;
        else stats.info++;
      }

      // Store for report
      if (vehicleFindings.some(f => f.severity !== 'info')) {
        stats.findings.push({
          vehicle_id: row.vehicle_id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          sale_price: row.sale_price,
          findings: vehicleFindings,
        });
      }

      // Write validation results to description_discoveries
      if (!DRY_RUN) {
        const existingExt = { ...ext };
        existingExt._validation = {
          validated_at: new Date().toISOString(),
          rules_checked: applicable.length,
          findings: vehicleFindings,
        };
        await db.query(
          `UPDATE description_discoveries SET raw_extraction = $1 WHERE id = $2`,
          [JSON.stringify(existingExt), row.dd_id]
        );
      }
    }

    stats.validated++;
    if (stats.validated % 500 === 0) {
      console.log(`  Validated ${stats.validated}/${stats.total} — ${stats.warnings} warnings, ${stats.errors} errors, ${stats.fraud_risks} fraud risks`);
    }
  }

  // ─── Report ──────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  VALIDATION REPORT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Vehicles validated: ${stats.validated}`);
  console.log(`  Rules applied: ${rules.length}`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'LIVE (results written to DB)'}`);
  console.log('');
  console.log('  FINDINGS BY SEVERITY:');
  console.log(`    Info:       ${stats.info}`);
  console.log(`    Warnings:   ${stats.warnings}`);
  console.log(`    Errors:     ${stats.errors}`);
  console.log(`    Fraud Risk: ${stats.fraud_risks}`);
  console.log('');
  console.log('  FINDINGS BY TYPE:');
  for (const [type, count] of Object.entries(stats.by_type).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
  console.log('');
  console.log('  FINDINGS BY MAKE:');
  for (const [make, count] of Object.entries(stats.by_make).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${make}: ${count}`);
  }

  // Top fraud risk vehicles
  const fraudRisks = stats.findings.filter(f => f.findings.some(x => x.severity === 'fraud_risk'));
  if (fraudRisks.length > 0) {
    console.log('');
    console.log('  CLONE/FRAUD RISK VEHICLES:');
    for (const v of fraudRisks.slice(0, 20)) {
      const price = v.sale_price ? `$${v.sale_price.toLocaleString()}` : 'no price';
      const risks = v.findings.filter(f => f.severity === 'fraud_risk').map(f => f.message).join('; ');
      console.log(`    ${v.year} ${v.make} ${v.model} (${price}) — ${risks}`);
    }
  }

  // Top error vehicles
  const errorVehicles = stats.findings.filter(f => f.findings.some(x => x.severity === 'error'));
  if (errorVehicles.length > 0) {
    console.log('');
    console.log(`  ERROR-LEVEL FINDINGS (top 20 of ${errorVehicles.length}):`);
    for (const v of errorVehicles.slice(0, 20)) {
      const price = v.sale_price ? `$${v.sale_price.toLocaleString()}` : 'no price';
      const errs = v.findings.filter(f => f.severity === 'error').map(f => f.message).join('; ');
      console.log(`    ${v.year} ${v.make} ${v.model} (${price}) — ${errs}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');

  await db.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
