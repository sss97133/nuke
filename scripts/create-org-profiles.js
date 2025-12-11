#!/usr/bin/env node

/**
 * Create Organization Profiles
 * Indexes Classic.com dealers and creates organization profiles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
let envConfig = {};
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env')
];

for (const envPath of possiblePaths) {
  try {
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath });
      if (!result.error) {
        envConfig = result.parsed || {};
      }
      break;
    }
  } catch (e) {}
}

const SUPABASE_URL = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_KEY = envConfig.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || 
                     envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY ||
                     envConfig.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY ||
                     envConfig.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error('❌ SUPABASE keys not found.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Index a single Classic.com dealer profile
 */
async function indexDealerProfile(profileUrl) {
  console.log(`\n🔍 Indexing: ${profileUrl}`);
  
  try {
    const result = await supabase.functions.invoke('index-classic-com-dealer', {
      body: { profile_url: profileUrl }
    });

    const { data, error } = result;

    if (error) {
      console.error('   ❌ Function error details:', JSON.stringify(error, null, 2));
      throw error;
    }

    // Also check for error in response body
    if (data && !data.success && data.error) {
      throw new Error(data.error);
    }

    if (!data) {
      throw new Error('No response data from function');
    }

    if (data.success) {
      console.log(`   ✅ ${data.action === 'created' ? 'Created' : 'Found existing'}: ${data.organization_name}`);
      if (data.logo_url) console.log(`   🖼️  Logo: ${data.logo_url}`);
      if (data.team_members_stored) console.log(`   👥 Team members: ${data.team_members_stored}`);
      return {
        success: true,
        organization_id: data.organization_id,
        action: data.action,
        team_members: data.team_members_stored || 0
      };
    } else {
      console.log(`   ❌ Failed: ${data.error || JSON.stringify(data)}`);
      return { success: false, error: data.error || 'Unknown error' };
    }
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    if (error.response) {
      console.error(`   Response: ${JSON.stringify(error.response)}`);
    }
    if (error.context) {
      console.error(`   Context: ${JSON.stringify(error.context)}`);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Batch index multiple dealer profiles
 */
async function batchIndexDealers(profileUrls, delay = 2000) {
  console.log(`\n🚀 Batch indexing ${profileUrls.length} dealers...\n`);
  
  const stats = {
    total: profileUrls.length,
    created: 0,
    found: 0,
    failed: 0,
    team_members_total: 0
  };

  for (let i = 0; i < profileUrls.length; i++) {
    const url = profileUrls[i];
    const result = await indexDealerProfile(url);
    
    if (result.success) {
      if (result.action === 'created') {
        stats.created++;
      } else {
        stats.found++;
      }
      stats.team_members_total += result.team_members || 0;
    } else {
      stats.failed++;
    }
    
    // Rate limit between requests
    if (i < profileUrls.length - 1) {
      await new Promise(r => setTimeout(r, delay));
    }
    
    // Progress update every 10
    if ((i + 1) % 10 === 0) {
      console.log(`\n📊 Progress: ${i + 1}/${profileUrls.length} (${stats.created} created, ${stats.found} existing, ${stats.failed} failed)`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL STATS');
  console.log('='.repeat(60));
  console.log(`Total processed: ${stats.total}`);
  console.log(`✅ Created: ${stats.created}`);
  console.log(`🔍 Found existing: ${stats.found}`);
  console.log(`❌ Failed: ${stats.failed}`);
  console.log(`👥 Team members extracted: ${stats.team_members_total}`);
  
  return stats;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  console.log('='.repeat(60));
  console.log('CREATE ORGANIZATION PROFILES');
  console.log('='.repeat(60));

  if (args.length > 0) {
    // Single profile URL provided
    const profileUrl = args[0];
    if (!profileUrl.includes('classic.com/s/')) {
      console.error('❌ Invalid Classic.com profile URL');
      console.log('Expected format: https://www.classic.com/s/dealer-name-ID/');
      process.exit(1);
    }
    
    await indexDealerProfile(profileUrl);
  } else {
    // Default: Index some example dealers to start
    const exampleDealers = [
      'https://www.classic.com/s/111-motorcars-ZnQygen/',
      // Add more URLs as needed
    ];
    
    console.log(`\n📋 Mode: Indexing ${exampleDealers.length} example dealer(s)\n`);
    await batchIndexDealers(exampleDealers, 3000);
  }
}

main().catch(console.error);

