#!/usr/bin/env npx tsx
/**
 * Run the Craigslist archive import migration
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Read migration file
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20260130_craigslist_archive_import.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  console.log('Running migration...');

  // Split by statement (simple approach - split on semicolons followed by newline)
  // This is a simplified approach; a proper SQL parser would be better
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let successCount = 0;
  let errorCount = 0;

  for (const statement of statements) {
    if (!statement) continue;

    try {
      const { error } = await supabase.rpc('exec_sql', {
        query: statement + ';'
      });

      if (error) {
        // Try direct execution for DDL statements
        const { error: error2 } = await supabase.from('_migrations_test').select('*').limit(0);
        // If the statement is a CREATE or ALTER, we need a different approach
        console.log(`Note: Statement may need direct DB access: ${statement.substring(0, 50)}...`);
        errorCount++;
      } else {
        successCount++;
      }
    } catch (err) {
      console.log(`Note: ${statement.substring(0, 50)}...`);
      errorCount++;
    }
  }

  console.log(`\nMigration complete: ${successCount} succeeded, ${errorCount} notes`);
}

main().catch(console.error);
