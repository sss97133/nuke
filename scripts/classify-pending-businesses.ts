#!/usr/bin/env npx tsx
/**
 * Classify pending businesses
 *
 * Loads all businesses that are "Pending classification" (no business_type or not one of the
 * five display types), assigns a type using name/description/website heuristics, and writes
 * updates back to the database (or outputs CSV/SQL for manual apply).
 *
 * Allowed types: Dealers, Garages, Auction houses, Restoration shops, Performance shops
 * DB values: dealer, garage, auction_house, restoration_shop, performance_shop
 * (dealership is also valid for Dealers; we use 'dealer' for consistency with existing counts.)
 *
 * Run:
 *   npx tsx scripts/classify-pending-businesses.ts --dry-run   # classify in memory, no writes
 *   npx tsx scripts/classify-pending-businesses.ts --csv        # write scripts/data/business-classification-updates.csv
 *   npx tsx scripts/classify-pending-businesses.ts --sql       # write scripts/data/business-classification-updates.sql
 *   npx tsx scripts/classify-pending-businesses.ts             # apply updates to DB (batch of 100)
 * Env: SUPABASE_URL or VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (e.g. from .env in repo root)
 *
 * Edge cases (heuristic defaults):
 * - No name/description/website → classified as dealer (broadest).
 * - Ambiguous terms (e.g. "performance garage") → first matching rule wins (auction > restoration > performance > garage > dealer).
 * - Non-English or minimal text → often default to dealer; reclassify manually if needed.
 * - Already classified (234) → never modified; only rows with null/empty/other business_type are updated.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Load .env from repo root
try {
  const path = join(root, '.env');
  if (existsSync(path)) {
    const env = readFileSync(path, 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
} catch {
  // ignore
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// All types the schema supports (including expanded non-automotive from analyze-other-businesses)
const CLASSIFIED_TYPES = new Set([
  'dealer', 'dealership', 'garage', 'auction_house', 'restoration_shop', 'performance_shop',
  'body_shop', 'detailing', 'marketplace', 'collection', 'specialty_shop', 'builder',
  'fabrication', 'club', 'media', 'motorsport_event', 'rally_event', 'concours', 'automotive_expo',
  'registry',
  'villa_rental', 'event_company', 'restaurant_food', 'hotel_lodging', 'property_management',
  'travel_tourism', 'art_creative', 'retail_other', 'health_medical', 'professional_services',
  'sport_recreation', 'marine_nautical', 'education', 'construction_services', 'car_rental',
  'other',
]);

type AssignedType =
  | 'dealer' | 'dealership' | 'garage' | 'auction_house' | 'restoration_shop' | 'performance_shop'
  | 'body_shop' | 'detailing' | 'marketplace' | 'collection' | 'specialty_shop' | 'builder'
  | 'fabrication' | 'club' | 'media' | 'motorsport_event' | 'rally_event' | 'concours' | 'automotive_expo'
  | 'registry'
  | 'villa_rental' | 'event_company' | 'restaurant_food' | 'hotel_lodging' | 'property_management'
  | 'travel_tourism' | 'art_creative' | 'retail_other' | 'health_medical' | 'professional_services'
  | 'sport_recreation' | 'marine_nautical' | 'education' | 'construction_services' | 'car_rental'
  | 'other';

function normalize(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).toLowerCase().trim();
}

function classify(
  business_name: string | null,
  description: string | null,
  website: string | null,
  specializations: string[] | null,
  services_offered: string[] | null
): AssignedType {
  const name = normalize(business_name);
  const desc = normalize(description);
  const url = normalize(website);
  const spec = (specializations || []).map(normalize).join(' ');
  const svc = (services_offered || []).map(normalize).join(' ');
  const combined = [name, desc, url, spec, svc].join(' ');
  const hasAuto = /\bauto|car|vehicle|motor|moteur|classic\s*car|collector\s*car|porsche|bmw|restor|auction|dealer|garage|repair\b/.test(combined);

  // —— AUTOMOTIVE (check first so BaT, registries, 2Shores don’t become “other”) ——
  if (/\bregistry\b/.test(combined) || /\bregistry\.org\b/.test(url) || /roadrunner|hemi\.com|356registry|weebly\.com.*registry/.test(combined)) {
    return 'registry';
  }
  if (
    /\bauction\b/.test(combined) || /\bbid\b/.test(combined) || /\blot\s*\d/.test(combined) ||
    /\bconsign/.test(combined) || /auctionhouse|auction-house|bringatrailer|bring.a.trailer/i.test(combined)
  ) {
    return 'auction_house';
  }
  if (/\bmarketplace\b/.test(combined) || /\bclassifieds?\b/.test(combined) || /\blisting\s*platform\b/.test(combined)) {
    return 'marketplace';
  }
  if (
    /\brestor/.test(combined) || /\brestoration\b/.test(combined) || /\bconcours\b/.test(combined) ||
    /\bpreservation\b/.test(combined)
  ) {
    return 'restoration_shop';
  }
  if (
    /\bbody\s*shop\b/.test(combined) || /\bcollision\b/.test(combined) || /\bpaint\s*shop\b/.test(combined) ||
    /\bspray\s*paint\b/.test(combined) || /\bsheet\s*metal\b/.test(combined)
  ) {
    return 'body_shop';
  }
  if (/\bdetailing\b/.test(combined) || /\bdetail\s*shop\b/.test(combined) || /\bcar\s*wash\b/.test(combined) || /\bceramic\s*coat/.test(combined)) {
    return 'detailing';
  }
  if (
    /\bperformance\b/.test(combined) || /\btuning\b/.test(combined) || /\bdyno\b/.test(combined) ||
    /\bracing\b/.test(combined) || /\bmotorsport\b/.test(combined) || /\bturbo\b/.test(combined) ||
    /\bhorsepower\b/.test(combined) || /\bengine\s*build\b/.test(combined) || /\bhp\s*(upgrade|tune)/.test(combined)
  ) {
    return 'performance_shop';
  }
  if (/\bfabricat/.test(combined) || /\bbuilder\b/.test(combined) || /\bcustom\s*build\b/.test(combined) || /\bchassis\b/.test(combined)) {
    return 'builder';
  }
  if (
    /\bgarage\b/.test(combined) || /\bservice\s*(center|department|shop)?\b/.test(combined) ||
    /\brepair\b/.test(combined) || /\bmechanic\b/.test(combined) || /\bmaintenance\b/.test(combined) ||
    /\bauto\s*repair\b/.test(combined) || /\bdiagnostic/.test(combined) || /\blift\b/.test(combined) ||
    /\boil\s*change\b/.test(combined) || /\bbrake\b/.test(combined) || /\balignment\b/.test(combined)
  ) {
    return 'garage';
  }
  if (
    /\bdealer\b/.test(combined) || /\bdealership\b/.test(combined) || /\bsales\b/.test(combined) ||
    /\binventory\b/.test(combined) || /\bcars?\s*for\s*sale\b/.test(combined) ||
    /\bpre-?owned\b/.test(combined) || /\bused\s*cars?\b/.test(combined) ||
    /\bclassic\s*cars?\s*(for\s*sale)?\b/.test(combined) || /\bcollector\s*cars?\b/.test(combined) ||
    /\bcollectable\s*porsches\b/.test(combined) || (/\bmotor\s*sport?s?\b/.test(combined) && !/\bracing\b/.test(combined))
  ) {
    return 'dealer';
  }
  if (hasAuto && (/\bshop\b/.test(combined) || /\bautomotive\b/.test(combined) || /\bmotors?\b/.test(combined))) {
    return 'dealer';
  }

  // —— NON-AUTOMOTIVE (specific types so we don’t dump into “other”) ——
  if ((/\bvilla\b/.test(combined) || /sibarth\.com|villainstbarth|myvillainstbarth/.test(combined)) && !hasAuto) {
    return 'villa_rental';
  }
  if (/car\s*rental|rental\s*car|avis|alamo|hertz|europcar|location\s*auto|mauricecarrental|gumbs-car-rental/.test(combined) && !hasAuto) {
    return 'car_rental';
  }
  if (/\bevent\b/.test(combined) && /planning|wedding|dkevents|floral\s*event/.test(combined) && !hasAuto) {
    return 'event_company';
  }
  if ((/\brestaurant\b/.test(combined) || /\bchef\b/.test(combined) || /\bcatering\b/.test(combined) || /\bcuisine\b/.test(combined) || /\bdining\b/.test(combined) || /\bfood\b/.test(combined)) && !hasAuto) {
    return 'restaurant_food';
  }
  if (/\bhotel\b/.test(combined) || /\bresort\b/.test(combined) || /\blodging\b/.test(combined) || /\bhebergement\b/.test(combined)) {
    return 'hotel_lodging';
  }
  if (/\bproperty\b/.test(combined) || /\bproperties\b/.test(combined) || /\breal\s*estate\b/.test(combined) || /\bimmobilier\b/.test(combined)) {
    return 'property_management';
  }
  if (/\btravel\b/.test(combined) || /\btourism\b/.test(combined) || /\btour\s*&?\s*travel\b/.test(combined) || /\bvoyage\b/.test(combined) || /\btourisme\b/.test(combined)) {
    return 'travel_tourism';
  }
  if ((/\bart\s*print\b|artprint|art\s*gallery\b|atelier\b|graphiste\b|peintre\b|artist\b/.test(combined) || /\bartisan\b/.test(combined)) && !hasAuto) {
    return 'art_creative';
  }
  if (/\bclub\b/.test(combined) || /\brotary\b/.test(combined) || /\bassociation\b/.test(combined) || /\bnonprofit\b/.test(combined) || /\bfoundation\b/.test(combined)) {
    return 'club';
  }
  if (/\bconstruction\b/.test(combined) || /\bbatiment\b/.test(combined) || /\brenovation\b/.test(combined) || /\bplombier\b/.test(combined) || /\belectricien\b/.test(combined) || /\betancheit\b/.test(combined) || /\baffichage\b/.test(combined) || /\bsignaletique\b/.test(combined)) {
    return 'construction_services';
  }
  if (/\blawyer\b/.test(combined) || /\blegal\b/.test(combined) || /\bnotaire\b/.test(combined) || /\baccounting\b/.test(combined) || /\bcomptab\b/.test(combined) || /\binsurance\b/.test(combined) || /\bassurance\b/.test(combined)) {
    return 'professional_services';
  }
  if (/\bhealth\b/.test(combined) || /\bsante\b/.test(combined) || /\bmedical\b/.test(combined) || /\bpharma\b/.test(combined) || /\bdoctor\b/.test(combined) || /\bclinic\b/.test(combined)) {
    return 'health_medical';
  }
  if (/\bschool\b/.test(combined) || /\beducation\b/.test(combined) || /\bformation\b/.test(combined) || /\btraining\b/.test(combined) || /\buniversity\b/.test(combined) || /\becole\b/.test(combined)) {
    return 'education';
  }
  if (/\bsport\b/.test(combined) || /\bfitness\b/.test(combined) || /\byoga\b/.test(combined) || /\bgym\b/.test(combined) || /\bechecs\b/.test(combined)) {
    return 'sport_recreation';
  }
  if (/\bboat\b/.test(combined) || /\bmarine\b/.test(combined) || /\byacht\b/.test(combined) || /\bnautic\b/.test(combined) || /\bvoilier\b/.test(combined)) {
    return 'marine_nautical';
  }
  if ((/\bshop\b/.test(combined) || /\bboutique\b/.test(combined) || /\bstore\b/.test(combined) || /\bretail\b/.test(combined)) && !hasAuto) {
    return 'retail_other';
  }

  return 'other';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const outCsv = process.argv.includes('--csv');
  const outSql = process.argv.includes('--sql');
  const revamp = process.argv.includes('--revamp'); // re-classify ALL businesses with new rules

  console.log('Classify pending businesses');
  console.log('Options:', { dryRun, outCsv, outSql, revamp });
  console.log('');

  const { count: total } = await supabase.from('businesses').select('*', { count: 'exact', head: true });

  // Pending = business_type null, empty, or not one of the five display types
  const PAGE = 100;
  let all: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data: page, error: fetchError } = await supabase
      .from('businesses')
      .select('id, business_name, description, website, specializations, services_offered, business_type')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (fetchError) {
      console.error('Fetch error:', fetchError);
      process.exit(1);
    }
    if (!page?.length) break;
    all = all.concat(page);
    if (page.length < PAGE) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log('Fetched', all.length, 'businesses');

  let pendingList = all.filter(
    (r) =>
      r.business_type == null ||
      String(r.business_type).trim() === '' ||
      !CLASSIFIED_TYPES.has(String(r.business_type))
  );

  if (revamp) {
    pendingList = all; // re-classify everyone
    console.log('Revamp mode: re-classifying all', pendingList.length, 'businesses with expanded types.');
  }
  const classifiedCount = revamp ? 0 : all.filter((r) => CLASSIFIED_TYPES.has(String(r.business_type || ''))).length;

  await runClassification(pendingList, { dryRun, outCsv, outSql, total: total ?? 0, classifiedCount });
}

async function runClassification(
  pending: Array<{
    id: string;
    business_name: string | null;
    description: string | null;
    website: string | null;
    specializations: string[] | null;
    services_offered: string[] | null;
    business_type: string | null;
  }>,
  opts: { dryRun: boolean; outCsv: boolean; outSql: boolean; total: number; classifiedCount: number }
) {
  const { dryRun, outCsv, outSql, total, classifiedCount } = opts;
  const updates: { id: string; business_type: AssignedType }[] = [];
  const byType: Partial<Record<AssignedType, number>> = {};
  const ensureType = (t: AssignedType) => { if (byType[t] == null) byType[t] = 0; };
  (
    ['dealer', 'dealership', 'garage', 'auction_house', 'restoration_shop', 'performance_shop', 'body_shop', 'detailing', 'marketplace', 'collection', 'specialty_shop', 'builder', 'fabrication', 'club', 'media', 'motorsport_event', 'rally_event', 'concours', 'automotive_expo', 'registry'] as AssignedType[]
  ).concat(
    ['villa_rental', 'event_company', 'restaurant_food', 'hotel_lodging', 'property_management', 'travel_tourism', 'art_creative', 'retail_other', 'health_medical', 'professional_services', 'sport_recreation', 'marine_nautical', 'education', 'construction_services', 'car_rental', 'other'] as AssignedType[]
  ).forEach(t => ensureType(t));

  for (const row of pending) {
    const assigned = classify(
      row.business_name,
      row.description,
      row.website,
      row.specializations,
      row.services_offered
    );
    updates.push({ id: row.id, business_type: assigned });
    byType[assigned]++;
  }

  console.log('Totals:');
  console.log('  Total businesses:', total);
  console.log('  Already classified (unchanged):', classifiedCount);
  console.log('  Pending (to classify):', pending.length);
  console.log('  Assigned types:', byType);
  console.log('');

  const dataDir = join(root, 'scripts', 'data');
  if (outCsv) {
    const lines = ['id,business_type'];
    updates.forEach((u) => lines.push(`${u.id},${u.business_type}`));
    const csvPath = join(dataDir, 'business-classification-updates.csv');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(csvPath, lines.join('\n'), 'utf8');
    console.log('Wrote CSV:', csvPath);
  }

  if (outSql) {
    const statements = updates.map((u) => `UPDATE businesses SET business_type = '${u.business_type}' WHERE id = '${u.id}';`);
    const sqlPath = join(dataDir, 'business-classification-updates.sql');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(sqlPath, statements.join('\n'), 'utf8');
    console.log('Wrote SQL:', sqlPath);
  }

  if (!dryRun && !outCsv && !outSql) {
    const BATCH = 100;
    let updated = 0;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      for (const u of batch) {
        const { error } = await supabase.from('businesses').update({ business_type: u.business_type }).eq('id', u.id);
        if (error) console.error('Update error', u.id, error);
        else updated++;
      }
      console.log('Updated', Math.min(i + BATCH, updates.length), 'of', updates.length);
    }
    console.log('Done. Updated', updated, 'businesses.');
  } else if (dryRun) {
    console.log('Dry run: no updates written. Use without --dry-run to apply, or --csv/--sql to export.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
