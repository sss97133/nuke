#!/usr/bin/env node
// Apply a SQL file against Supabase via an exec_sql RPC using the service role key.
// Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/apply_sql.js supabase/migrations/<file>.sql

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node scripts/apply_sql.js <path-to-sql-file>');
    process.exit(1);
  }
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    process.exit(1);
  }

  const sqlPath = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(sqlPath)) {
    console.error('SQL file not found:', sqlPath);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Applying SQL from', sqlPath);

  const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`
    },
    body: JSON.stringify({ sql })
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error('Failed to apply SQL. Status:', resp.status, text);
    process.exit(1);
  }

  const data = await resp.json().catch(() => ({}));
  console.log('SQL applied successfully.', data || '');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
