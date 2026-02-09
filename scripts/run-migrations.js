#!/usr/bin/env node
/**
 * Run specific migration files against the database using DATABASE_URL.
 * Usage: node scripts/run-migrations.js [migration-file.sql ...]
 * If no args: runs migrations from supabase/migrations that match 20260208*.
 */

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

async function run() {
  if (!DATABASE_URL) {
    console.error('Missing DATABASE_URL or SUPABASE_DB_URL in .env');
    console.error('Set the Postgres connection string (e.g. from Supabase Dashboard → Settings → Database).');
    process.exit(1);
  }

  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  let files = process.argv.slice(2);

  if (files.length === 0) {
    const all = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    files = all.filter((f) => f.startsWith('20260208')).sort();
    console.log('No files specified; running 20260208* migrations:', files);
  }

  const client = new Client({ connectionString: DATABASE_URL });
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
    process.exit(1);
  } finally {
    await client.end();
  }
  console.log('Done.');
}

run();
