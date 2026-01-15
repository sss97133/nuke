#!/usr/bin/env node
/**
 * Check for system errors and failure reports
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('═'.repeat(70));
console.log('🔍 CHECKING FOR ERRORS AND FAILURE REPORTS');
console.log('═'.repeat(70) + '\n');

async function checkSystemHealthIssues() {
  console.log('📋 SYSTEM HEALTH ISSUES:\n');
  
  const { data, error } = await supabase
    .from('system_health_issues')
    .select('*')
    .eq('status', 'open')
    .order('detected_at', { ascending: false })
    .limit(20);

  if (error) {
    console.log(`  Error querying: ${error.message}`);
    return;
  }

  if (!data || data.length === 0) {
    console.log('  ✅ No open system health issues found\n');
    return;
  }

  console.log(`  Found ${data.length} open issues:\n`);
  data.forEach((issue, i) => {
    console.log(`  [${i + 1}] ${issue.issue_type} - ${issue.severity}`);
    console.log(`      ${issue.title}`);
    console.log(`      ${issue.description?.substring(0, 100) || 'No description'}`);
    if (issue.error_message) {
      console.log(`      Error: ${issue.error_message.substring(0, 80)}`);
    }
    console.log('');
  });
}

async function checkScraperJobs() {
  console.log('🕷️ SCRAPER JOB STATUS:\n');

  // Check bat_scrape_jobs if it exists
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

  console.log(`  Recent scrape jobs:`);
  data.forEach(job => {
    const status = job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : '⏳';
    console.log(`  ${status} ${job.id?.substring(0, 8)} - ${job.status} - ${job.created_at}`);
    if (job.error_message) {
      console.log(`      Error: ${job.error_message}`);
    }
  });
  console.log('');
}

async function checkContentExtractionQueue() {
  console.log('📥 CONTENT EXTRACTION QUEUE:\n');

  const { data, error } = await supabase
    .from('content_extraction_queue')
    .select('*')
    .in('status', ['failed', 'pending'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    if (error.message.includes('does not exist')) {
      console.log('  ℹ️  content_extraction_queue table does not exist\n');
    } else {
      console.log(`  Error: ${error.message}\n`);
    }
    return;
  }

  const failed = data?.filter(d => d.status === 'failed') || [];
  const pending = data?.filter(d => d.status === 'pending') || [];

  console.log(`  Failed: ${failed.length}`);
  console.log(`  Pending: ${pending.length}`);

  if (failed.length > 0) {
    console.log('\n  Failed extractions:');
    failed.slice(0, 5).forEach(item => {
      console.log(`    - ${item.content_type}: ${item.error_message || 'Unknown error'}`);
    });
  }
  console.log('');
}

async function checkRecentVehicleIssues() {
  console.log('🚗 RECENT VEHICLE DATA ISSUES:\n');

  // Check for vehicles with incomplete data that should have been filled
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, vin, mileage, color, updated_at')
    .not('discovery_url', 'is', null)
    .or('vin.is.null,mileage.is.null')
    .order('updated_at', { ascending: false })
    .limit(10);

  if (error) {
    console.log(`  Error: ${error.message}\n`);
    return;
  }

  if (!data || data.length === 0) {
    console.log('  ✅ All vehicles with URLs have complete data\n');
    return;
  }

  console.log(`  Found ${data.length} vehicles with URLs missing key data:`);
  data.forEach(v => {
    const missing = [];
    if (!v.vin) missing.push('VIN');
    if (!v.mileage) missing.push('mileage');
    if (!v.color) missing.push('color');
    
    console.log(`    ${v.year} ${v.make} ${v.model} - Missing: ${missing.join(', ')}`);
    console.log(`      URL: ${v.discovery_url?.substring(0, 50)}...`);
  });
  console.log('');
}

async function checkImageProcessingErrors() {
  console.log('🖼️ IMAGE PROCESSING STATUS:\n');

  // Check for images that failed processing
  const { data, error } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, ai_scan_metadata, created_at')
    .is('ai_scan_metadata', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.log(`  Error: ${error.message}\n`);
    return;
  }

  console.log(`  Unprocessed images: ${data?.length || 0}`);
  
  // Check for images with error in metadata
  const { data: errorImages, error: err2 } = await supabase
    .from('vehicle_images')
    .select('id, ai_scan_metadata')
    .not('ai_scan_metadata', 'is', null)
    .limit(1000);

  if (!err2 && errorImages) {
    const withErrors = errorImages.filter(img => 
      img.ai_scan_metadata?.error || 
      img.ai_scan_metadata?.status === 'failed'
    );
    console.log(`  Images with processing errors: ${withErrors.length}`);
  }
  console.log('');
}

async function checkNotifications() {
  console.log('🔔 RECENT ERROR NOTIFICATIONS:\n');

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .or('type.eq.error,type.eq.warning,title.ilike.%error%,title.ilike.%fail%')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    if (error.message.includes('does not exist')) {
      console.log('  ℹ️  notifications table does not exist\n');
    } else {
      console.log(`  Error: ${error.message}\n`);
    }
    return;
  }

  if (!data || data.length === 0) {
    console.log('  No error notifications found\n');
    return;
  }

  console.log(`  Found ${data.length} error/warning notifications:`);
  data.forEach(n => {
    console.log(`    [${n.type}] ${n.title}`);
    console.log(`      ${n.message?.substring(0, 80) || ''}`);
  });
  console.log('');
}

async function main() {
  await checkSystemHealthIssues();
  await checkScraperJobs();
  await checkContentExtractionQueue();
  await checkRecentVehicleIssues();
  await checkImageProcessingErrors();
  await checkNotifications();

  console.log('═'.repeat(70));
  console.log('✅ Error check complete\n');
}

main().catch(console.error);
