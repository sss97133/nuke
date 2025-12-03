#!/usr/bin/env node
/**
 * Test the complete scraping system
 * 1. Check health table exists
 * 2. Trigger a small scrape
 * 3. Verify health tracking
 * 4. Check cron jobs
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function main() {
  console.log('🧪 Testing Scraping Infrastructure\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Check health table
  console.log('1️⃣ Checking scraping_health table...');
  const { data: healthCheck, error: healthError } = await supabase
    .from('scraping_health')
    .select('id')
    .limit(1);

  if (healthError) {
    console.error('❌ Health table does not exist!');
    console.error('   Error:', healthError.message);
    console.log('\n📝 Apply migration first:');
    console.log('   node scripts/apply-scraper-infrastructure.js\n');
    return;
  }
  console.log('✅ Health table exists\n');

  // 2. Trigger small test scrape
  console.log('2️⃣ Triggering test scrape (1 region, 5 searches)...');
  console.log('   This will take ~30 seconds...\n');
  
  const scrapeStart = Date.now();
  const scrapeResponse = await fetch(
    `${supabaseUrl}/functions/v1/scrape-all-craigslist-squarebodies`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        max_regions: 1,
        max_listings_per_search: 10
      })
    }
  );

  const scrapeTime = ((Date.now() - scrapeStart) / 1000).toFixed(1);

  if (!scrapeResponse.ok) {
    console.error('❌ Scrape failed:', scrapeResponse.status, scrapeResponse.statusText);
    const errorText = await scrapeResponse.text();
    console.error('   Error:', errorText.substring(0, 300));
    return;
  }

  const scrapeResult = await scrapeResponse.json();
  console.log(`✅ Scrape completed in ${scrapeTime}s`);
  console.log('   Stats:', {
    regions_searched: scrapeResult.stats?.regions_searched,
    listings_found: scrapeResult.stats?.listings_found,
    processed: scrapeResult.stats?.processed,
    created: scrapeResult.stats?.created,
    errors: scrapeResult.stats?.errors
  });
  console.log('');

  // 3. Verify health tracking was updated
  console.log('3️⃣ Checking health tracking...');
  const { data: recentHealth } = await supabase
    .from('scraping_health')
    .select('*')
    .eq('source', 'craigslist')
    .gte('created_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())  // Last 2 minutes
    .order('created_at', { ascending: false })
    .limit(10);

  if (!recentHealth || recentHealth.length === 0) {
    console.warn('⚠️ No health records found (table might not be tracking yet)');
  } else {
    const successCount = recentHealth.filter(h => h.success).length;
    const failCount = recentHealth.filter(h => !h.success).length;
    const avgResponseTime = recentHealth
      .filter(h => h.response_time_ms)
      .reduce((sum, h) => sum + h.response_time_ms, 0) / recentHealth.length;

    console.log(`✅ Found ${recentHealth.length} health records:`);
    console.log(`   - Successful: ${successCount}`);
    console.log(`   - Failed: ${failCount}`);
    console.log(`   - Avg response: ${Math.round(avgResponseTime)}ms`);
  }
  console.log('');

  // 4. Check cron jobs
  console.log('4️⃣ Checking cron jobs...');
  console.log('   Run this in Supabase SQL Editor:');
  console.log('   ```sql');
  console.log('   SELECT jobname, schedule, active FROM cron.job');
  console.log('   WHERE jobname IN (');
  console.log("     'daily-craigslist-squarebodies',");
  console.log("     'hourly-scraper-health-check'");
  console.log('   );');
  console.log('   ```\n');

  // 5. Test health check function
  console.log('5️⃣ Testing health check function...');
  const healthCheckResponse = await fetch(
    `${supabaseUrl}/functions/v1/check-scraper-health`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    }
  );

  if (!healthCheckResponse.ok) {
    console.error('❌ Health check failed:', healthCheckResponse.status);
  } else {
    const healthResult = await healthCheckResponse.json();
    console.log('✅ Health check function working');
    console.log('   System status:', healthResult.system_status);
    console.log('   Sources monitored:', healthResult.summary?.total_sources || 0);
    
    if (healthResult.sources && healthResult.sources.length > 0) {
      console.log('\n   Source Health:');
      healthResult.sources.forEach((s) => {
        const emoji = s.status === 'healthy' ? '✅' : 
                     s.status === 'degraded' ? '⚠️' : '❌';
        console.log(`   ${emoji} ${s.source}: ${s.success_rate}% (${s.total_attempts} attempts)`);
      });
    }
  }
  console.log('');

  // 6. Check created vehicles
  console.log('6️⃣ Checking vehicles created...');
  const { data: todayVehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, created_at')
    .eq('discovery_source', 'craigslist_scrape')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(5);

  if (todayVehicles && todayVehicles.length > 0) {
    console.log(`✅ ${todayVehicles.length} vehicles created in last 24h:`);
    todayVehicles.forEach(v => {
      const timeAgo = Math.round((Date.now() - new Date(v.created_at).getTime()) / 1000 / 60);
      console.log(`   - ${v.year} ${v.make} ${v.model} (${timeAgo}m ago)`);
    });
  } else {
    console.log('⚠️ No vehicles created in last 24h (scraper may not have run)');
  }
  console.log('');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ SYSTEM TEST COMPLETE\n');
  
  console.log('📊 Summary:');
  console.log(`   - Health tracking: ${recentHealth && recentHealth.length > 0 ? 'WORKING ✅' : 'NOT TRACKING ⚠️'}`);
  console.log(`   - Scraper function: WORKING ✅`);
  console.log(`   - Health check function: ${healthCheckResponse.ok ? 'WORKING ✅' : 'FAILED ❌'}`);
  console.log(`   - Data flowing: ${todayVehicles && todayVehicles.length > 0 ? 'YES ✅' : 'NO (run daily scrape) ⚠️'}`);
  console.log('');

  if (!recentHealth || recentHealth.length === 0) {
    console.log('⚠️ Next step: Apply migrations manually');
    console.log('   Run: node scripts/apply-scraper-infrastructure.js\n');
  } else {
    console.log('✅ System is operational!\n');
    console.log('📖 Monitor health at:');
    console.log(`   curl -X POST "${supabaseUrl}/functions/v1/check-scraper-health" \\`);
    console.log(`     -H "Authorization: Bearer YOUR_KEY"\n`);
  }
}

main().catch(console.error);

