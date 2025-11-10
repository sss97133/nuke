#!/usr/bin/env node

/**
 * Fetches remote Supabase migration history and creates placeholder migration
 * files locally for any applied migrations that are missing from the repo.
 *
 * Usage:
 *   SUPABASE_DB_PASSWORD=... node tools/create_remote_placeholders.js
 *
 * Optional environment overrides:
 *   SUPABASE_DB_HOST (default: aws-0-us-west-1.pooler.supabase.com)
 *   SUPABASE_DB_USER (default: postgres.qkgaybvrernstplzjaam)
 *   SUPABASE_DB_NAME (default: postgres)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const migrationsDir = path.resolve('supabase', 'migrations');

const password = process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD;
if (!password) {
  console.error('Missing SUPABASE_DB_PASSWORD or PGPASSWORD environment variable.');
  process.exit(1);
}

const host = process.env.SUPABASE_DB_HOST || 'aws-0-us-west-1.pooler.supabase.com';
const user = process.env.SUPABASE_DB_USER || 'postgres.qkgaybvrernstplzjaam';
const database = process.env.SUPABASE_DB_NAME || 'postgres';

const fetchRemoteMigrations = () => {
  const query = `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version`;
  const command = `psql -h ${host} -U ${user} -d ${database} -A -F, -t -c "${query}"`;
  const output = execSync(command, {
    stdio: 'pipe',
    env: {
      ...process.env,
      PGPASSWORD: password,
      PGSSLMODE: process.env.PGSSLMODE || 'require',
      PGGSSENCMODE: 'disable'
    }
  })
    .toString('utf-8')
    .trim();
  if (!output) {
    return [];
  }
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [version, name] = line.split(',');
      return { version, name };
    });
};

const ensureMigrationsDir = () => {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found at ${migrationsDir}`);
  }
};

const createPlaceholder = ({ version, name }) => {
  const filename = `${version}_${name}.sql`;
  const filePath = path.join(migrationsDir, filename);
  if (fs.existsSync(filePath)) {
    return false;
  }
  const contents = `-- Placeholder migration for ${version}_${name}\n-- This migration was applied directly to the remote database and\n-- is recorded here to keep local history aligned.\n`;
  fs.writeFileSync(filePath, contents, 'utf-8');
  return true;
};

try {
  ensureMigrationsDir();
  const migrations = fetchRemoteMigrations();
  if (migrations.length === 0) {
    console.log('No remote migrations found.');
    process.exit(0);
  }

  let created = 0;
  migrations.forEach((migration) => {
    if (createPlaceholder(migration)) {
      created += 1;
      console.log(`Created placeholder for ${migration.version}_${migration.name}`);
    }
  });

  if (created === 0) {
    console.log('All remote migrations already have local files.');
  } else {
    console.log(`Created ${created} placeholder migration file(s).`);
  }
} catch (error) {
  console.error('Failed to create remote placeholders:', error.message);
  process.exit(1);
}

