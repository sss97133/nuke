#!/usr/bin/env npx tsx
/**
 * DEEP DATA CLEANUP
 *
 * 1. Delete garbage entries (dealership pages, category pages)
 * 2. Infer makes from model patterns
 * 3. Flag suspicious items for review
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const dryRun = !process.argv.includes('--execute');

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// Patterns that indicate garbage data (not vehicles)
const GARBAGE_PATTERNS = [
  'dealership',
  'vehicles for sale',
  'view inventory',
  'concierge service',
  'motorcars int',
  'contact us',
  'about us',
  'our team',
  'financing',
  'sell your',
  'we buy',
  'trade in',
  'service center',
  'parts department',
];

// More model → make mappings
const MODEL_PATTERNS: [RegExp, string][] = [
  // Ferrari
  [/\b(f12|f8|812|296|sf90|488|458|430|360|355|348|328|308|275|250|365|512|testarossa|roma|portofino|california|ff|gtc4|laferrari|enzo)\b/i, 'Ferrari'],

  // Porsche
  [/\b(991|992|997|996|993|964|930|911|912|914|924|928|944|959|boxster|cayman|cayenne|panamera|taycan|macan|918|carrera)\b/i, 'Porsche'],

  // Lamborghini
  [/\b(hurac[aá]n|aventador|gallardo|murcielago|diablo|countach|urus|revuelto)\b/i, 'Lamborghini'],

  // McLaren
  [/\b(675lt|650s|570s|600lt|720s|765lt|artura|p1|senna|speedtail|elva)\b/i, 'McLaren'],

  // Mercedes
  [/\b(300\s*sl|280\s*sl|560\s*sec|amg|classe\s*s|g-?wagon|maybach)\b/i, 'Mercedes-Benz'],

  // Bentley
  [/\b(bentayga|continental|flying\s*spur|mulsanne)\b/i, 'Bentley'],

  // Rolls-Royce
  [/\b(ghost|phantom|wraith|dawn|cullinan)\b/i, 'Rolls-Royce'],

  // Aston Martin
  [/\b(db[5-9]|db1[0-2]|vantage|vanquish|dbs|rapide|valkyrie|cygnet|stelvio\s*zagato)\b/i, 'Aston Martin'],

  // Lotus
  [/\b(elise|exige|evora|emira|esprit)\b/i, 'Lotus'],

  // Alpine
  [/\b(a110)\b/i, 'Alpine'],

  // Audi
  [/\b(rs[3-8]|r8|e-?tron|tt\s*rs|s[3-8])\b/i, 'Audi'],

  // BMW/Alpina
  [/\b(b3|b5|b7|alpina)\b/i, 'BMW Alpina'],

  // Jaguar
  [/\b(f-?type|e-?type|xj|xk)\b/i, 'Jaguar'],

  // Citroën
  [/\b(sm\b.*maserati)\b/i, 'Citroën'],
];

async function cleanGarbage() {
  log('=== CLEANING GARBAGE ENTRIES ===\n');

  // Build OR clause for garbage patterns
  const orClauses = GARBAGE_PATTERNS.map(p => `model.ilike.%${p}%`).join(',');

  const { data: garbage, count } = await supabase
    .from('vehicles')
    .select('id, year, make, model', { count: 'exact' })
    .or(orClauses)
    .limit(500);

  log(`Found ${count} garbage entries\n`);

  for (const v of garbage || []) {
    log(`  DELETE: "${v.model}" (${v.id})`);

    if (!dryRun) {
      // Delete related data first
      await supabase.from('vehicle_images').delete().eq('vehicle_id', v.id);
      await supabase.from('vehicle_status_metadata').delete().eq('vehicle_id', v.id);
      await supabase.from('vehicle_mailboxes').delete().eq('vehicle_id', v.id);
      await supabase.from('vehicles').delete().eq('id', v.id);
    }
  }

  return garbage?.length || 0;
}

async function inferMakesDeep() {
  log('\n=== INFERRING MAKES (DEEP PATTERNS) ===\n');

  // Get vehicles with no make
  const { data: noMake } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .or('make.is.null,make.eq.')
    .limit(5000);

  log(`Found ${noMake?.length || 0} vehicles missing make`);

  const updates: { id: string; make: string; model: string }[] = [];
  const unmatched: any[] = [];

  for (const v of noMake || []) {
    const model = v.model || '';
    let matched = false;

    for (const [pattern, make] of MODEL_PATTERNS) {
      if (pattern.test(model)) {
        updates.push({ id: v.id, make, model });
        matched = true;
        break;
      }
    }

    if (!matched && model.length > 3) {
      unmatched.push(v);
    }
  }

  // Group updates by make
  const byMake = new Map<string, number>();
  for (const u of updates) {
    byMake.set(u.make, (byMake.get(u.make) || 0) + 1);
  }

  log('\nInferred makes:');
  for (const [make, count] of [...byMake.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${make}: ${count}`);
  }

  log(`\nUnmatched (need manual review): ${unmatched.length}`);
  for (const v of unmatched.slice(0, 20)) {
    log(`  ? "${v.model}"`);
  }

  if (!dryRun) {
    log('\nApplying updates...');
    let updated = 0;
    for (const u of updates) {
      const { error } = await supabase
        .from('vehicles')
        .update({ make: u.make })
        .eq('id', u.id);
      if (!error) updated++;
    }
    log(`Updated ${updated} vehicles`);
  }

  return updates.length;
}

async function findMoreGarbage() {
  log('\n=== SCANNING FOR MORE GARBAGE ===\n');

  // Items with very short or null models
  const { data: shortModel } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .or('model.is.null,model.eq.')
    .limit(100);

  log(`Items with null/empty model: ${shortModel?.length || 0}`);
  for (const v of (shortModel || []).slice(0, 10)) {
    log(`  ${v.year || '?'} ${v.make || '[no make]'} [no model] - ${v.id}`);
  }

  // Items where model looks like a URL or page title
  const { data: urlLike } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .or('model.ilike.%http%,model.ilike.%www.%,model.ilike.%|%,model.ilike.% - %')
    .limit(100);

  log(`\nItems with URL-like models: ${urlLike?.length || 0}`);
  for (const v of (urlLike || []).slice(0, 10)) {
    log(`  "${v.model}" - ${v.id}`);
  }
}

async function main() {
  log(`Deep data cleanup - Dry run: ${dryRun}`);
  log('─'.repeat(60));

  const deleted = await cleanGarbage();
  const inferred = await inferMakesDeep();
  await findMoreGarbage();

  log('\n' + '─'.repeat(60));
  log(`SUMMARY: ${deleted} deleted, ${inferred} makes inferred`);

  if (dryRun) {
    log('\n[DRY RUN] Run with --execute to apply changes');
  }
}

main().catch(console.error);
