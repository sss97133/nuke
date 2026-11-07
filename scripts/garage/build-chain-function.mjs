#!/usr/bin/env node
// Keeps the body of derive_vehicle_relationships in the migration byte-identical to the read-only preview.
//   node scripts/garage/build-chain-function.mjs           write the generated block into the migration
//   node scripts/garage/build-chain-function.mjs --check   exit 1 if the migration's block differs from the preview
// The block is the preview from `WITH cfg AS` to its final `ORDER BY`, with :'user_id' -> p_user and
// nullif(:'vehicle_id', '')::uuid -> p_vehicle, and without the trailing semicolon.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url).pathname;
const previewPath = `${root}supabase/sql/derive_vehicle_relationships_preview.sql`;
const migrationPath = `${root}supabase/migrations/20261111200000_garage_listing_org_evidence.sql`;
const BEGIN = '-- BEGIN GENERATED FROM supabase/sql/derive_vehicle_relationships_preview.sql (scripts/garage/build-chain-function.mjs)\n';
const END = '\n-- END GENERATED';

const preview = readFileSync(previewPath, 'utf8');
const body = preview.slice(preview.indexOf('WITH cfg AS'))
  .replaceAll("nullif(:'vehicle_id', '')::uuid", 'p_vehicle')
  .replaceAll(":'user_id'::uuid", 'p_user')
  .replace(/;\s*$/, '');
if (/:'(user_id|vehicle_id)'/.test(body)) { console.error('unreplaced psql variable in preview'); process.exit(2); }

const migration = readFileSync(migrationPath, 'utf8');
const a = migration.indexOf(BEGIN); const b = migration.indexOf(END);
if (a < 0 || b < a) { console.error('generated markers not found in migration'); process.exit(2); }
const current = migration.slice(a + BEGIN.length, b);
if (process.argv.includes('--check')) {
  if (current !== body) { console.error('migration function body differs from the preview; run build-chain-function.mjs'); process.exit(1); }
  console.log('identical'); process.exit(0);
}
writeFileSync(migrationPath, migration.slice(0, a + BEGIN.length) + body + migration.slice(b));
console.log('written');
