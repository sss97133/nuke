#!/usr/bin/env node

/**
 * Batch index Classic.com dealer directory
 * Extracts dealer profiles and creates organizations automatically
 * 
 * Usage: node scripts/index-classic-com-dealers.js [profile_url_or_directory]
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_ANON_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Index a single Classic.com dealer profile
 */
async function indexDealerProfile(profileUrl) {
  console.log(`\n🔍 Indexing: ${profileUrl}`);
  
  try {
    const { data, error } = await supabase.functions.invoke('index-classic-com-dealer', {
      body: { profile_url: profileUrl }
    });

    if (error) {
      throw error;
    }

    if (data.success) {
      console.log(`   ✅ ${data.action === 'created' ? 'Created' : 'Found existing'}: ${data.organization_name}`);
      if (data.logo_url) {
        console.log(`   🖼️  Logo: ${data.logo_url}`);
      }
      return {
        success: true,
        organization_id: data.organization_id,
        action: data.action
      };
    } else {
      console.log(`   ❌ Failed: ${data.error}`);
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Scrape Classic.com dealer directory to get all profile URLs
 */
async function scrapeDealerDirectory() {
  console.log('\n📋 Scraping Classic.com dealer directory...');
  
  // Classic.com dealer directory URL
  const directoryUrl = 'https://www.classic.com/dealers';
  
  try {
    // Use scrape-multi-source to extract dealer profile URLs
    const { data, error } = await supabase.functions.invoke('scrape-multi-source', {
      body: {
        source_url: directoryUrl,
        source_type: 'marketplace',
        extract_listings: false,
        extract_dealer_info: false,
        use_llm_extraction: true,
        max_listings: 1000
      }
    });

    if (error) {
      throw error;
    }

    // Extract dealer profile URLs from Classic.com
    // Profile URLs look like: /s/111-motorcars-ZnQygen/
    const profileUrls = [];
    
    // This would need to be implemented based on actual Classic.com structure
    // For now, we'll use a known example
    console.log('   ⚠️  Directory scraping not yet implemented - using example URL');
    
    return [
      'https://www.classic.com/s/111-motorcars-ZnQygen/'
      // Add more profile URLs here as we discover them
    ];
  } catch (error) {
    console.error(`   ❌ Error scraping directory: ${error.message}`);
    return [];
  }
}

/**
 * Batch index multiple dealer profiles
 */
async function batchIndexDealers(profileUrls) {
  console.log(`\n🚀 Batch indexing ${profileUrls.length} dealers...\n`);
  
  const stats = {
    total: profileUrls.length,
    created: 0,
    found: 0,
    failed: 0,
    errors: []
  };

  for (let i = 0; i < profileUrls.length; i++) {
    const url = profileUrls[i];
    console.log(`[${i + 1}/${profileUrls.length}]`);
    
    const result = await indexDealerProfile(url);
    
    if (result.success) {
      if (result.action === 'created') {
        stats.created++;
      } else {
        stats.found++;
      }
    } else {
      stats.failed++;
      stats.errors.push({ url, error: result.error });
    }
    
    // Rate limit: 1 second between requests
    if (i < profileUrls.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 INDEXING SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total processed: ${stats.total}`);
  console.log(`✅ Created: ${stats.created}`);
  console.log(`📍 Found existing: ${stats.found}`);
  console.log(`❌ Failed: ${stats.failed}`);
  
  if (stats.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    stats.errors.forEach(err => {
      console.log(`   ${err.url}: ${err.error}`);
    });
  }

  return stats;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  console.log('='.repeat(60));
  console.log('CLASSIC.COM DEALER INDEXER');
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
    // Batch mode: scrape directory and index all
    console.log('\n📋 Mode: Batch indexing from dealer directory');
    const profileUrls = await scrapeDealerDirectory();
    
    if (profileUrls.length === 0) {
      console.log('\n⚠️  No dealer profiles found. Using example URL...');
      await indexDealerProfile('https://www.classic.com/s/111-motorcars-ZnQygen/');
    } else {
      await batchIndexDealers(profileUrls);
    }
  }
}

main().catch(console.error);

