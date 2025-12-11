#!/usr/bin/env node
/**
 * Diagnose why new vehicles aren't being created
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('═'.repeat(70));
console.log('🔍 DIAGNOSING VEHICLE CREATION ISSUES');
console.log('═'.repeat(70) + '\n');

async function checkRecentVehicles() {
  console.log('📅 RECENTLY CREATED VEHICLES:\n');

  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_source, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.log(`  Error: ${error.message}\n`);
    return;
  }

  if (!data || data.length === 0) {
    console.log('  ❌ No vehicles found!\n');
    return;
  }

  console.log('  Last 20 vehicles created:');
  data.forEach((v, i) => {
    const date = new Date(v.created_at);
    const ago = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`  [${i+1}] ${v.year} ${v.make} ${v.model}`);
    console.log(`      Source: ${v.discovery_source || 'unknown'}`);
    console.log(`      Created: ${date.toISOString()} (${ago} days ago)`);
  });

  // Check when last vehicle was created
  const lastCreated = new Date(data[0].created_at);
  const hoursAgo = Math.floor((Date.now() - lastCreated.getTime()) / (1000 * 60 * 60));
  
  console.log(`\n  ⏰ Last vehicle created ${hoursAgo} hours ago`);
  
  if (hoursAgo > 24) {
    console.log('  ⚠️  WARNING: No vehicles created in over 24 hours!');
  }
  console.log('');
}

async function checkBATScraperResults() {
  console.log('🕷️ BAT SCRAPER JOBS:\n');

  const { data, error } = await supabase
    .from('bat_scrape_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    if (error.message.includes('does not exist')) {
      console.log('  ℹ️  bat_scrape_jobs table does not exist\n');
    } else {
      console.log(`  Error: ${error.message}\n`);
    }
    return;
  }

  if (!data || data.length === 0) {
    console.log('  No scrape jobs found\n');
    return;
  }

  console.log('  Recent jobs:');
  data.forEach(job => {
    const status = job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : '⏳';
    console.log(`  ${status} ${job.created_at} - ${job.status}`);
    console.log(`      Listings found: ${job.listings_found || 0}`);
    console.log(`      Listings scraped: ${job.listings_scraped || 0}`);
    console.log(`      Vehicles matched: ${job.vehicles_matched || 0}`);
    if (job.error_message) {
      console.log(`      Error: ${job.error_message}`);
    }
  });
  console.log('');
}

async function checkBATMonitors() {
  console.log('👀 BAT SELLER MONITORS:\n');

  const { data, error } = await supabase
    .from('bat_seller_monitors')
    .select('*')
    .limit(10);

  if (error) {
    if (error.message.includes('does not exist')) {
      console.log('  ℹ️  bat_seller_monitors table does not exist\n');
    } else {
      console.log(`  Error: ${error.message}\n`);
    }
    return;
  }

  if (!data || data.length === 0) {
    console.log('  No seller monitors configured\n');
    return;
  }

  console.log('  Configured monitors:');
  data.forEach(m => {
    const active = m.is_active ? '✅' : '❌';
    console.log(`  ${active} ${m.seller_username}`);
    console.log(`      Last checked: ${m.last_checked_at || 'never'}`);
    console.log(`      Listings found: ${m.listings_found_count || 0}`);
  });
  console.log('');
}

async function checkExternalListings() {
  console.log('📋 EXTERNAL LISTINGS (from BAT):\n');

  const { data, error } = await supabase
    .from('external_listings')
    .select('id, platform, listing_url, vehicle_id, created_at, listing_status')
    .eq('platform', 'bat')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    if (error.message.includes('does not exist')) {
      console.log('  ℹ️  external_listings table does not exist\n');
    } else {
      console.log(`  Error: ${error.message}\n`);
    }
    return;
  }

  if (!data || data.length === 0) {
    console.log('  No BAT listings tracked\n');
    return;
  }

  console.log(`  Found ${data.length} BAT listings:`);
  const withVehicle = data.filter(l => l.vehicle_id);
  const withoutVehicle = data.filter(l => !l.vehicle_id);
  
  console.log(`    Linked to vehicles: ${withVehicle.length}`);
  console.log(`    NOT linked to vehicles: ${withoutVehicle.length} ⚠️`);
  
  if (withoutVehicle.length > 0) {
    console.log('\n  Listings without vehicles:');
    withoutVehicle.slice(0, 5).forEach(l => {
      console.log(`    - ${l.listing_url.substring(0, 50)}...`);
    });
  }
  console.log('');
}

async function checkVehiclesBySource() {
  console.log('📊 VEHICLES BY SOURCE:\n');

  const { data, error } = await supabase
    .from('vehicles')
    .select('discovery_source, created_at');

  if (error) {
    console.log(`  Error: ${error.message}\n`);
    return;
  }

  const sources = {};
  const recentBySource = {};
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  data.forEach(v => {
    const source = v.discovery_source || 'unknown';
    sources[source] = (sources[source] || 0) + 1;
    
    if (new Date(v.created_at) > oneWeekAgo) {
      recentBySource[source] = (recentBySource[source] || 0) + 1;
    }
  });

  console.log('  All time:');
  Object.entries(sources)
    .sort((a, b) => b[1] - a[1])
    .forEach(([source, count]) => {
      const recent = recentBySource[source] || 0;
      console.log(`    ${source}: ${count} total (${recent} in last 7 days)`);
    });
  console.log('');
}

async function checkCraigslistScrapes() {
  console.log('🔗 CRAIGSLIST SCRAPING STATUS:\n');

  // Check for Craigslist-sourced vehicles
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, created_at')
    .ilike('discovery_source', '%craigslist%')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.log(`  Error: ${error.message}\n`);
    return;
  }

  if (!data || data.length === 0) {
    console.log('  No Craigslist vehicles found\n');
    return;
  }

  const lastCreated = new Date(data[0].created_at);
  const daysAgo = Math.floor((Date.now() - lastCreated.getTime()) / (1000 * 60 * 60 * 24));
  
  console.log(`  Found ${data.length} recent Craigslist vehicles`);
  console.log(`  Last one created ${daysAgo} days ago`);
  
  if (daysAgo > 7) {
    console.log('  ⚠️  WARNING: No new Craigslist vehicles in over a week!');
    console.log('  → Craigslist scraper may not be running');
  }
  console.log('');
}

async function diagnoseIssues() {
  console.log('🔎 DIAGNOSIS:\n');
  
  const issues = [];
  
  // Check if BAT scraper is creating vehicles
  const { data: recentBAT } = await supabase
    .from('vehicles')
    .select('id')
    .or('discovery_source.ilike.%bat%,discovery_url.ilike.%bringatrailer%')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  
  if (!recentBAT || recentBAT.length === 0) {
    issues.push('No BAT vehicles created in last 7 days');
  }

  // Check if monitor-bat-seller is finding new listings
  const { data: monitors } = await supabase
    .from('bat_seller_monitors')
    .select('*')
    .single();
  
  if (!monitors) {
    issues.push('BAT seller monitor not configured');
  }

  // Check for import errors
  const { data: failedJobs } = await supabase
    .from('bat_scrape_jobs')
    .select('*')
    .eq('status', 'failed')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  
  if (failedJobs && failedJobs.length > 0) {
    issues.push(`${failedJobs.length} scrape job(s) failed in last 24 hours`);
  }

  if (issues.length === 0) {
    console.log('  ✅ No obvious issues found');
    console.log('  → Scrapers may be running but finding no new listings');
    console.log('  → Check if source websites have new content');
  } else {
    console.log('  ⚠️  Issues found:');
    issues.forEach(issue => console.log(`    - ${issue}`));
  }
  console.log('');
}

async function main() {
  await checkRecentVehicles();
  await checkBATScraperResults();
  await checkBATMonitors();
  await checkExternalListings();
  await checkVehiclesBySource();
  await checkCraigslistScrapes();
  await diagnoseIssues();

  console.log('═'.repeat(70));
  console.log('📋 RECOMMENDATIONS:');
  console.log('═'.repeat(70));
  console.log(`
1. The Vercel deployment error is a Vercel CLI bug, not your code.
   → This happens during "vercel pull" - try re-running the workflow.

2. To see new vehicles from BAT scraping:
   → Go to: https://github.com/sss97133/nuke/actions
   → Manually run "BAT Scrape" workflow
   → Check the run logs for what was found

3. The BAT scraper (monitor-bat-seller) only creates vehicles if:
   → There are NEW listings on the seller's profile
   → The listing URL doesn't already exist in external_listings

4. To trigger comprehensive extraction on existing vehicles:
   → Set SUPABASE_SERVICE_ROLE_KEY and run:
   → node scripts/fix-missing-vehicle-data.js
`);
}

main().catch(console.error);
