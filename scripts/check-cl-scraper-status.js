#!/usr/bin/env node
/**
 * Check status of existing Craigslist scraper
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
  console.log('🔍 Checking Craigslist Scraper Status\n');

  // 1. Check for active cron jobs
  console.log('1️⃣ Checking active cron jobs...');
  let cronJobs = null;
  let cronError = null;
  
  try {
    const result = await supabase.rpc('exec_sql', {
      sql: `
        SELECT jobid, jobname, schedule, active, command
        FROM cron.job 
        WHERE active = true
        ORDER BY jobname;
      `
    });
    cronJobs = result.data;
    cronError = result.error;
  } catch (e) {
    cronError = { message: 'Cannot query cron directly' };
  }

  if (cronError || !cronJobs) {
    console.log('   ⚠️ Cannot query cron.job table directly');
    console.log('   Check Supabase Dashboard → Database → Cron Jobs\n');
  } else {
    const clJobs = cronJobs.filter(j => j.jobname.includes('craigslist') || j.jobname.includes('cl-'));
    if (clJobs.length > 0) {
      console.log('   ✅ Found active Craigslist cron jobs:');
      clJobs.forEach(j => {
        console.log(`      - ${j.jobname}: ${j.schedule}`);
      });
    } else {
      console.log('   ❌ No active Craigslist cron jobs found');
    }
    console.log('');
  }

  // 2. Check recent vehicles from Craigslist
  console.log('2️⃣ Checking recent Craigslist imports...');
  const { data: recentVehicles, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, created_at, discovery_source')
    .or('discovery_source.eq.craigslist_scrape,discovery_source.eq.craigslist_scrape_test,profile_origin.eq.craigslist_scrape')
    .order('created_at', { ascending: false })
    .limit(10);

  if (vehicleError) {
    console.log('   ❌ Error:', vehicleError.message);
  } else if (!recentVehicles || recentVehicles.length === 0) {
    console.log('   ❌ No vehicles found with discovery_source = "craigslist_scrape"');
    console.log('   🔍 The scraper may not have run recently, or it\'s not creating vehicles\n');
  } else {
    console.log(`   ✅ Found ${recentVehicles.length} recent vehicles:`);
    recentVehicles.slice(0, 5).forEach(v => {
      console.log(`      - ${v.year} ${v.make} ${v.model} (${new Date(v.created_at).toLocaleDateString()})`);
    });
    console.log('');
  }

  // 3. Check vehicles from past 7 days
  console.log('3️⃣ Checking scraper activity (last 7 days)...');
  const { data: weekStats, error: statsError } = await supabase
    .from('vehicles')
    .select('created_at, discovery_source')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .or('discovery_source.eq.craigslist_scrape,profile_origin.eq.craigslist_scrape');

  if (statsError) {
    console.log('   ❌ Error:', statsError.message);
  } else {
    console.log(`   📊 Vehicles created from Craigslist in past 7 days: ${weekStats?.length || 0}`);
    
    if (weekStats && weekStats.length > 0) {
      // Group by day
      const byDay = {};
      weekStats.forEach(v => {
        const day = new Date(v.created_at).toLocaleDateString();
        byDay[day] = (byDay[day] || 0) + 1;
      });
      
      console.log('   📅 By day:');
      Object.entries(byDay).sort().slice(-7).forEach(([day, count]) => {
        console.log(`      ${day}: ${count} vehicles`);
      });
    }
  }
  console.log('');

  // 4. Test scraper function
  console.log('4️⃣ Testing scrape-all-craigslist-squarebodies function...');
  console.log('   (This will do a small test scrape - 1 region, 2 searches)\n');
  
  const testResponse = await fetch(
    `${supabaseUrl}/functions/v1/scrape-all-craigslist-squarebodies`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        max_regions: 1,
        max_listings_per_search: 5
      })
    }
  );

  if (!testResponse.ok) {
    console.error('   ❌ Function call failed:', testResponse.status, testResponse.statusText);
    const errorText = await testResponse.text();
    console.error('   Error:', errorText.substring(0, 300));
  } else {
    const result = await testResponse.json();
    console.log('   ✅ Function responded successfully');
    console.log('   Response:', JSON.stringify(result, null, 2).substring(0, 500));
  }
  console.log('');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📝 Summary:\n');
  console.log('You have TWO Craigslist scraping approaches:');
  console.log('');
  console.log('1. OLD: scrape-all-craigslist-squarebodies');
  console.log('   - Scrapes AND creates vehicles in one run');
  console.log('   - Can timeout on large scrapes');
  console.log('   - Version 77 (actively maintained)');
  console.log('');
  console.log('2. NEW: discover + process queue system');
  console.log('   - discover-cl-squarebodies: Finds URLs only');
  console.log('   - process-cl-queue: Scrapes in batches');
  console.log('   - More reliable, handles timeouts better');
  console.log('   - Not yet set up (needs queue table + cron)');
  console.log('');
  console.log('💡 Recommendation:');
  console.log('   - Keep using scrape-all-craigslist-squarebodies for now');
  console.log('   - Set up a cron job for it if not already done');
  console.log('   - Or migrate to the queue system for better reliability');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(console.error);

