#!/usr/bin/env node
/**
 * Propose (and optionally apply) safe renames for non-compliant Supabase migration filenames.
 * - Detects files named YYYYMMDD_name.sql and renames to YYYYMMDDHHMMSS_name.sql using file mtime for HHMMSS
 * - Detects duplicates and increments seconds to ensure uniqueness
 * - Dry-run by default; set CONFIRM=YES to apply
 */

import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.resolve('supabase/migrations');
const CONFIRM = process.env.CONFIRM === 'YES';

const reFull = /^(\d{14})_(.+)\.sql$/;
const reDay = /^(\d{8})_(.+)\.sql$/;

function pad(n) { return n.toString().padStart(2, '0'); }

function toVersionFromMtime(mtime) {
  const d = new Date(mtime);
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}`;
}

function main() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`[ERROR] Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(2);
  }
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));

  const plans = [];
  const used = new Set();

  // First, record already full versions
  for (const f of files) {
    const mFull = f.match(reFull);
    if (mFull) used.add(mFull[1]);
  }

  for (const f of files) {
    const mDay = f.match(reDay);
    if (!mDay) continue;
    const fullPath = path.join(MIGRATIONS_DIR, f);
    const stat = fs.statSync(fullPath);
    let version = toVersionFromMtime(stat.mtimeMs);

    // Ensure uniqueness
    while (used.has(version)) {
      // bump seconds
      const base = version.slice(0, 12);
      let sec = parseInt(version.slice(12, 14), 10);
      sec = (sec + 1) % 60;
      version = `${base}${pad(sec)}`;
    }
    used.add(version);

    const name = mDay[2];
    const target = `${version}_${name}.sql`;
    plans.push({ from: f, to: target });
  }

  if (plans.length === 0) {
    console.log('No day-only migrations to fix. Nothing to do.');
    process.exit(0);
  }

  console.log('Proposed renames:');
  for (const p of plans) console.log(` - ${p.from}  ->  ${p.to}`);

  if (!CONFIRM) {
    console.log('\nDry-run only. To apply, run: CONFIRM=YES node scripts/migrations/fix_migrations.js');
    process.exit(0);
  }

  for (const p of plans) {
    const src = path.join(MIGRATIONS_DIR, p.from);
    const dst = path.join(MIGRATIONS_DIR, p.to);
    fs.renameSync(src, dst);
  }
  console.log('Renames applied.');
}

main();
