#!/usr/bin/env node
/**
 * Run specific migration files against the database using DATABASE_URL.
 * Usage: node scripts/run-migrations.cjs [migration-file.sql ...]
 * If no args: runs migrations from supabase/migrations that match 20260208*.
 */

const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });
require('dotenv').config({ path: path.join(root, 'nuke_api', '.env') });
const { Client } = require('pg');

let DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
// If DATABASE_URL isn't a real Postgres URI, build direct Supabase URL from project + password
if (!DATABASE_URL?.startsWith('postgres')) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  const ref = url?.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (ref && password) {
    DATABASE_URL = `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
  }
}

async function run() {
  if (!DATABASE_URL) {
    console.error('Missing DATABASE_URL or (VITE_SUPABASE_URL + SUPABASE_DB_PASSWORD) in .env or nuke_api/.env');
    process.exit(1);
  }
  if (!DATABASE_URL.startsWith('postgres')) {
    console.error('DATABASE_URL should be a Postgres URI.');
    process.exit(1);
  }

  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  let files = process.argv.slice(2);

  if (files.length === 0) {
    // Default: only the four migrations from the data-room / nuke-ltd work
    files = [
      '20260208100000_handle_new_user_phone_and_definer.sql',
      '20260208110000_nuke_ltd_no_vehicle_deals.sql',
      '20260208120000_business_timeline_events_commit_type.sql',
      '20260208130000_business_type_developer_and_nuke.sql',
    ];
    console.log('No files specified; running:', files.join(', '));
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  });
  try {
    await client.connect();
    for (const file of files) {
      const filePath = path.isAbsolute(file) ? file : path.join(migrationsDir, file);
      if (!fs.existsSync(filePath)) {
        console.warn('Skip (not found):', filePath);
        continue;
      }
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log('Running:', path.basename(filePath));
      await client.query(sql);
      console.log('  OK');
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
    if (err.code === 'ENOTFOUND') {
      console.error('Check DATABASE_URL host (e.g. db.xxxx.supabase.co) and network.');
    }
    process.exit(1);
  } finally {
    await client.end();
  }
  console.log('Done.');
}

run();
