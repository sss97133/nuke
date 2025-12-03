#!/usr/bin/env node
/**
 * Apply scraping infrastructure migrations directly via REST API
 */

import { readFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function executeSql(sql) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ sql })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  return response;
}

async function main() {
  console.log('🚀 Applying Scraping Infrastructure Migrations\n');

  try {
    // Try to apply via REST API
    const migration = readFileSync('supabase/migrations/20251202_scraping_health_tracking.sql', 'utf8');
    
    console.log('Attempting to apply via REST API...');
    await executeSql(migration);
    
    console.log('✅ Migration applied successfully!\n');
    console.log('Testing...');
    
    // Test if table exists
    const testResponse = await fetch(`${SUPABASE_URL}/rest/v1/scraping_health?select=id&limit=1`, {
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY
      }
    });

    if (testResponse.ok) {
      console.log('✅ Table created successfully!\n');
    } else {
      throw new Error('Table creation verification failed');
    }

  } catch (error) {
    console.log('\n⚠️ Direct application failed:', error.message);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📝 MANUAL APPLICATION REQUIRED\n');
    console.log('Open Supabase Dashboard SQL Editor:');
    console.log('https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new\n');
    console.log('Follow instructions in:');
    console.log('  APPLY_SCRAPER_MIGRATIONS_NOW.md\n');
    console.log('Or copy/paste these files:\n');
    console.log('1. supabase/migrations/20251202_scraping_health_tracking.sql');
    console.log('2. Set service key (see instructions)');
    console.log('3. supabase/migrations/20251202_daily_craigslist_cron.sql');
    console.log('4. supabase/migrations/20251202_scraper_health_cron.sql\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

main().catch(console.error);

