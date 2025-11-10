#!/usr/bin/env node

/**
 * Normalizes Supabase migration filenames so that each migration version is unique.
 * Keeps the first occurrence of a version untouched, and renames subsequent files
 * by expanding the version to 14 digits and appending an incremental suffix.
 *
 * Example:
 *   20250102_alpha.sql          -> stays the same (first occurrence)
 *   20250102_beta.sql           -> 20250102000001_beta.sql
 *   20250102_gamma.sql          -> 20250102000002_gamma.sql
 *
 * Usage:
 *   node tools/normalize_migration_versions.js
 */

import fs from 'fs';
import path from 'path';

const migrationsDir = path.resolve('supabase', 'migrations');

const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) {
    throw new Error(`Migrations directory not found at ${dir}`);
  }
};

const getMigrationFiles = (dir) => {
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
};

const toFourteenDigitVersion = (version, increment) => {
  const len = version.length;
  if (len > 14) {
    throw new Error(`Version "${version}" exceeds 14 digits; cannot normalize.`);
  }
  const power = BigInt('1' + '0'.repeat(14 - len));
  const base = BigInt(version) * power;
  const offset = BigInt(increment);
  const normalized = base + offset;
  const normalizedStr = normalized.toString();
  return normalizedStr.padStart(14, '0');
};

const normalizeMigrations = () => {
  ensureDirExists(migrationsDir);
  const files = getMigrationFiles(migrationsDir);
  const versionCounts = new Map();
  const renameOperations = [];

  for (const file of files) {
    const [versionPart, ...restParts] = file.split('_');
    if (!versionPart || restParts.length === 0) {
      console.warn(`Skipping file with unexpected format: ${file}`);
      continue;
    }

    const rest = restParts.join('_');
    const occurrence = (versionCounts.get(versionPart) ?? 0) + 1;
    versionCounts.set(versionPart, occurrence);

    if (occurrence === 1) {
      // First occurrence stays as-is.
      continue;
    }

    const increment = occurrence - 1; // start from 1
    const newVersion = toFourteenDigitVersion(versionPart, increment);
    const newFileName = `${newVersion}_${rest}`;

    if (fs.existsSync(path.join(migrationsDir, newFileName))) {
      throw new Error(`Cannot rename ${file} -> ${newFileName}: target already exists.`);
    }

    renameOperations.push({
      from: file,
      to: newFileName
    });
  }

  if (renameOperations.length === 0) {
    console.log('No duplicate migration versions detected. Nothing to do.');
    return;
  }

  console.log('Planned migration renames:');
  renameOperations.forEach(({ from, to }) => {
    console.log(`  ${from} -> ${to}`);
  });

  for (const { from, to } of renameOperations) {
    fs.renameSync(
      path.join(migrationsDir, from),
      path.join(migrationsDir, to)
    );
  }

  console.log(`Renamed ${renameOperations.length} migration files.`);
};

try {
  normalizeMigrations();
} catch (error) {
  console.error('Failed to normalize migrations:', error.message);
  process.exit(1);
}

