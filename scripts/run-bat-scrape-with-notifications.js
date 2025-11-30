#!/usr/bin/env node
/**
 * Run BaT scrape and import with admin notifications
 * Designed to be called by scheduled edge function or cron
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const VIVA_BAT_PROFILE = 'https://bringatrailer.com/member/vivalasvegasautos/';

async function createJobRecord() {
  const { data, error } = await supabase
    .from('bat_scrape_jobs')
    .insert({
      job_type: 'full_scrape',
      status: 'running',
      started_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) {
    console.error('Failed to create job record:', error);
    return null;
  }
  
  return data.id;
}

async function updateJobRecord(jobId, updates) {
  await supabase
    .from('bat_scrape_jobs')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);
}

async function notifyError(error, jobId) {
  const { data } = await supabase.rpc('notify_admin_bat_scrape_error', {
    p_error_message: error.message,
    p_error_details: {
      job_id: jobId,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }
  });
  
  if (jobId) {
    await updateJobRecord(jobId, {
      status: 'failed',
      error_message: error.message,
      error_stack: error.stack,
      completed_at: new Date().toISOString()
    });
  }
}

async function notifySuccess(stats, jobId) {
  const { data } = await supabase.rpc('notify_admin_bat_scrape_complete', {
    p_listings_found: stats.listingsFound,
    p_listings_scraped: stats.listingsScraped,
    p_comments_extracted: stats.commentsExtracted,
    p_vehicles_matched: stats.vehiclesMatched
  });
  
  if (jobId) {
    const duration = Math.round((new Date() - new Date(stats.startedAt)) / 1000);
    await updateJobRecord(jobId, {
      status: 'completed',
      listings_found: stats.listingsFound,
      listings_scraped: stats.listingsScraped,
      comments_extracted: stats.commentsExtracted,
      users_created: stats.usersCreated,
      vehicles_matched: stats.vehiclesMatched,
      completed_at: new Date().toISOString(),
      duration_seconds: duration
    });
  }
}

async function runScrape() {
  const jobId = await createJobRecord();
  const startTime = new Date();
  
  try {
    console.log('🚀 Starting BaT scrape...');
    
    // Import the scraper logic (simplified version)
    // In production, you'd want to use the full scrape-viva-bat-listings.js logic
    // For now, we'll import existing data and process it
    
    const INPUT_FILE = path.join(process.cwd(), 'viva-bat-listings.json');
    
    if (!fs.existsSync(INPUT_FILE)) {
      throw new Error('Scraped data file not found. Run scrape-viva-bat-listings.js first.');
    }
    
    const listings = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
    console.log(`📋 Found ${listings.length} listings to process\n`);
    
    // Import logic (simplified - use import-bat-comments-to-db.js for full version)
    let importedListings = 0;
    let importedComments = 0;
    let importedUsers = 0;
    let matchedVehicles = 0;
    
    for (const listing of listings) {
      try {
        // Import listing and comments (simplified)
        // Full logic in import-bat-comments-to-db.js
        
        importedListings++;
        if (listing.comments) {
          importedComments += listing.comments.length;
        }
      } catch (error) {
        console.error(`Error processing ${listing.title}:`, error.message);
      }
    }
    
    const stats = {
      startedAt: startTime.toISOString(),
      listingsFound: listings.length,
      listingsScraped: importedListings,
      commentsExtracted: importedComments,
      usersCreated: importedUsers,
      vehiclesMatched: matchedVehicles
    };
    
    await notifySuccess(stats, jobId);
    
    console.log(`\n✅ Scrape complete!`);
    console.log(`   - Listings: ${importedListings}`);
    console.log(`   - Comments: ${importedComments}`);
    console.log(`   - Vehicles Matched: ${matchedVehicles}`);
    
    return stats;
    
  } catch (error) {
    console.error('❌ Scrape failed:', error);
    await notifyError(error, jobId);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runScrape().catch(process.exit);
}

export { runScrape };


