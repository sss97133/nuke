#!/usr/bin/env node
/**
 * Apply scraping infrastructure migrations
 * 1. Health tracking table
 * 2. Daily scraping cron
 * 3. Health check cron  
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

console.log('🚀 Applying Scraping Infrastructure\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('📋 Instructions:\n');
console.log('1. Open Supabase Dashboard SQL Editor:');
console.log('   https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new\n');

console.log('2. Apply these migrations IN ORDER:\n');

console.log('   Step 1: scraping_health table');
console.log('   File: supabase/migrations/20251202_scraping_health_tracking.sql');
console.log('   Copy/paste entire file → Run\n');

console.log('   Step 2: Set service role key (ONE TIME ONLY)');
console.log('   ```sql');
console.log(`   ALTER DATABASE postgres SET app.settings.service_role_key = '${SERVICE_KEY}';`);
console.log('   ```\n');

console.log('   Step 3: Daily Craigslist cron');
console.log('   File: supabase/migrations/20251202_daily_craigslist_cron.sql');
console.log('   Copy/paste entire file → Run\n');

console.log('   Step 4: Health monitoring cron');
console.log('   File: supabase/migrations/20251202_scraper_health_cron.sql');
console.log('   Copy/paste entire file → Run\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('3. Verify setup:\n');
console.log('   ```sql');
console.log('   -- Check table exists');
console.log('   SELECT COUNT(*) FROM scraping_health;');
console.log('');
console.log('   -- Check cron jobs');
console.log('   SELECT jobname, schedule, active FROM cron.job;');
console.log('   ```\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('✅ Once applied, run test:');
console.log('   cd /Users/skylar/nuke');
console.log('   node scripts/test-scraper-system.js\n');

