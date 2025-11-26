#!/usr/bin/env node
/**
 * Apply user_vehicle_preferences migration using direct psql connection
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to get DB connection from environment
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || process.env.DATABASE_PASSWORD;
const DB_URL = process.env.DATABASE_URL;

if (!DB_PASSWORD && !DB_URL) {
  console.error('❌ Missing database credentials');
  console.error('   Set SUPABASE_DB_PASSWORD or DATABASE_URL environment variable');
  console.error('\n💡 Alternative: Copy the SQL from supabase/sql/apply_user_vehicle_preferences.sql and paste into:');
  console.error('   https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql');
  process.exit(1);
}

async function applyMigration() {
  const migrationPath = path.join(__dirname, '../supabase/sql/apply_user_vehicle_preferences.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log('🚀 Applying User Vehicle Preferences migration...\n');

  let connectionString;
  if (DB_URL) {
    connectionString = DB_URL;
  } else {
    connectionString = `postgresql://postgres.qkgaybvrernstplzjaam:${DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:5432/postgres`;
  }

  try {
    // Write SQL to temp file
    const tempFile = '/tmp/user_vehicle_prefs_migration.sql';
    fs.writeFileSync(tempFile, sql);

    console.log('📄 Executing migration SQL...\n');
    
    const { stdout, stderr } = await execAsync(
      `psql "${connectionString}" -f ${tempFile}`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes('NOTICE')) {
      console.error('⚠️  Warnings:', stderr);
    }

    console.log('\n✅ Migration applied successfully!');
    console.log('\n📋 The user_vehicle_preferences table is now available.');

    // Clean up
    fs.unlinkSync(tempFile);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.message.includes('password authentication failed')) {
      console.error('\n💡 Password incorrect or connection failed.');
      console.error('   Please apply manually in Supabase SQL Editor:');
      console.error('   https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql');
      console.error('   Copy SQL from: supabase/sql/apply_user_vehicle_preferences.sql');
    }
    process.exit(1);
  }
}

applyMigration();


