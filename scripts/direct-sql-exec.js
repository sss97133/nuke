#!/usr/bin/env node
/**
 * Direct SQL Execution via Supabase PostgREST
 * Executes migration by creating a temporary SQL function
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

async function executeSql() {
  console.log('🚀 Applying migration via direct SQL execution...\n');
  
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema: 'public' },
    auth: { persistSession: false }
  });
  
  // Read migration
  const migrationPath = path.join(__dirname, '../supabase/migrations/20251123200000_personal_photo_library.sql');
  const fullSql = fs.readFileSync(migrationPath, 'utf8');
  
  console.log('📄 Migration loaded\n');
  console.log('⚠️  The Supabase client cannot execute raw SQL directly.');
  console.log('📋 Please copy the migration SQL and paste it into:');
  console.log('');
  console.log('   https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/editor');
  console.log('');
  console.log('✅ Or run this command if you have the DB password:');
  console.log('');
  console.log('   psql "postgresql://postgres.qkgaybvrernstplzjaam:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres" \\');
  console.log('     -f supabase/migrations/20251123200000_personal_photo_library.sql');
  console.log('');
}

executeSql();

