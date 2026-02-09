#!/usr/bin/env npx tsx
/**
 * Apply business_type expanded types migration via Supabase.
 * Uses service role; runs the two ALTER statements.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
try {
  const p = join(root, '.env');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
} catch {}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function main() {
  const supabase = createClient(url, key);
  // Supabase REST doesn't support raw DDL. Use rpc if exists, else we need pg.
  const { data, error } = await (supabase as any).rpc('exec_sql', {
    sql: `ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_business_type_check; ALTER TABLE businesses ADD CONSTRAINT businesses_business_type_check CHECK (business_type IN (
  'sole_proprietorship', 'partnership', 'llc', 'corporation',
  'garage', 'dealership', 'restoration_shop', 'performance_shop',
  'body_shop', 'detailing', 'mobile_service', 'specialty_shop',
  'parts_supplier', 'fabrication', 'racing_team',
  'auction_house', 'marketplace', 'concours', 'automotive_expo',
  'motorsport_event', 'rally_event', 'builder',
  'collection', 'dealer', 'forum', 'club', 'media', 'registry',
  'villa_rental', 'event_company', 'restaurant_food', 'hotel_lodging',
  'property_management', 'travel_tourism', 'art_creative', 'retail_other',
  'health_medical', 'professional_services', 'sport_recreation', 'marine_nautical',
  'education', 'construction_services', 'car_rental',
  'other'
));`
  });
  if (error) {
    console.error('RPC exec_sql not available or failed:', error.message);
    console.error('Apply the migration manually: node scripts/run-migrations.cjs 20260210000001_business_type_expanded_types.sql');
    process.exit(1);
  }
  console.log('Migration applied.');
}

main().catch((e) => { console.error(e); process.exit(1); });
