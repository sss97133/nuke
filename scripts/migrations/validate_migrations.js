#!/usr/bin/env node
/**
 * Validate Supabase migration filenames to prevent db push failures.
 * - Enforces YYYYMMDDHHMMSS_name.sql format
 * - Detects duplicate versions (YYYYMMDDHHMMSS) and day-only prefixes (YYYYMMDD_name.sql)
 * - Exits non-zero on any issues
 */

import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.resolve('supabase/migrations');
const GRANDFATHER_FILE = path.join(MIGRATIONS_DIR, '.grandfathered.txt');

function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`[ERROR] Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(2);
  }
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));

  // Grandfather current filenames on first run
  if (!fs.existsSync(GRANDFATHER_FILE)) {
    fs.writeFileSync(GRANDFATHER_FILE, files.join('\n') + '\n');
    console.log('[migrations:validate] Generated grandfather list at supabase/migrations/.grandfathered.txt');
    console.log('All existing migrations are grandfathered. Future migrations must use YYYYMMDDHHMMSS_name.sql');
    process.exit(0);
  }
  const grandfathered = new Set(
    fs.readFileSync(GRANDFATHER_FILE, 'utf8')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
  );
  const issues = [];

  const reFull = /^(\d{14})_.+\.sql$/; // YYYYMMDDHHMMSS
  const reDay = /^(\d{8})_.+\.sql$/;   // YYYYMMDD

  const seenVersions = new Map(); // version -> filenames[]
  const dayOnly = [];
  const nonCompliant = [];

  for (const f of files) {
    if (grandfathered.has(f)) continue;
    if (reFull.test(f)) {
      const m = f.match(reFull);
      const v = m[1];
      const list = seenVersions.get(v) || [];
      list.push(f);
      seenVersions.set(v, list);
      continue;
    }
    if (reDay.test(f)) {
      dayOnly.push(f);
    } else {
      nonCompliant.push(f);
    }
  }

  for (const [version, list] of seenVersions.entries()) {
    if (list.length > 1) {
      issues.push(`[DUPLICATE VERSION] ${version} used by: ${list.join(', ')}`);
    }
  }
  for (const f of dayOnly) {
    issues.push(`[DAY-ONLY VERSION] ${f} should be YYYYMMDDHHMMSS_name.sql`);
  }
  for (const f of nonCompliant) {
    issues.push(`[BAD FILENAME] ${f} should be YYYYMMDDHHMMSS_name.sql`);
  }

  if (issues.length) {
    console.log('Migration validation issues found:\n' + issues.map(x => ` - ${x}`).join('\n'));
    console.log('\nRun: npm run migrations:fix   # dry-run suggestions');
    process.exit(1);
  }
  console.log('Migrations look good.');
}

main();
