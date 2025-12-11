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
  
  // Classic.com dealer directory URLs (try both /dealers and /data)
  const directoryUrls = [
    'https://www.classic.com/dealers',
    'https://www.classic.com/data'
  ];
  
  const allProfileUrls = new Set();
  
  for (const directoryUrl of directoryUrls) {
    try {
      console.log(`   🔍 Scraping ${directoryUrl}...`);
      
      // Use scrape-multi-source with LLM extraction to find dealer profile URLs
      const { data, error } = await supabase.functions.invoke('scrape-multi-source', {
        body: {
          source_url: directoryUrl,
          source_type: 'marketplace',
          extract_listings: false,
          extract_dealer_info: false,
          use_llm_extraction: true,
          max_listings: 5000 // High limit to catch all dealers
        }
      });

      if (error) {
        console.warn(`   ⚠️  Error scraping ${directoryUrl}: ${error.message}`);
        continue;
      }

      // Extract dealer profile URLs from the scraped data
      // Profile URLs pattern: https://www.classic.com/s/dealer-name-ID/
      const html = data?.html || data?.markdown || '';
      const markdown = data?.markdown || '';
      
      // Pattern 1: Extract from HTML href attributes
      const hrefPattern = /href=["'](https?:\/\/www\.classic\.com\/s\/[^"']+)/gi;
      let match;
      while ((match = hrefPattern.exec(html)) !== null) {
        const url = match[1].replace(/\/$/, '') + '/'; // Ensure trailing slash
        allProfileUrls.add(url);
      }
      
      // Pattern 2: Extract from markdown links
      const markdownPattern = /\[([^\]]+)\]\((https?:\/\/www\.classic\.com\/s\/[^)]+)\)/gi;
      while ((match = markdownPattern.exec(markdown)) !== null) {
        const url = match[2].replace(/\/$/, '') + '/';
        allProfileUrls.add(url);
      }
      
      // Pattern 3: Extract raw URLs from text
      const urlPattern = /https?:\/\/www\.classic\.com\/s\/[^\s\)"']+/gi;
      while ((match = urlPattern.exec(html + markdown)) !== null) {
        const url = match[0].replace(/\/$/, '') + '/';
        if (url.includes('/s/')) {
          allProfileUrls.add(url);
        }
      }
      
      // Pattern 4: Extract relative URLs
      const relativePattern = /["']\/s\/([^"']+)/gi;
      while ((match = relativePattern.exec(html)) !== null) {
        const url = `https://www.classic.com/s/${match[1].replace(/\/$/, '')}/`;
        allProfileUrls.add(url);
      }
      
      console.log(`   ✅ Found ${allProfileUrls.size} unique dealer profiles so far`);
      
      // Also check if scrape-multi-source extracted listings that are actually dealer profiles
      if (data?.listings && Array.isArray(data.listings)) {
        for (const listing of data.listings) {
          if (listing.url && listing.url.includes('classic.com/s/')) {
            const url = listing.url.replace(/\/$/, '') + '/';
            allProfileUrls.add(url);
          }
        }
      }
      
    } catch (error) {
      console.warn(`   ⚠️  Error scraping ${directoryUrl}: ${error.message}`);
    }
    
    // Rate limit between directory URLs
    if (directoryUrls.indexOf(directoryUrl) < directoryUrls.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  const profileUrls = Array.from(allProfileUrls).filter(url => 
    url.includes('classic.com/s/') && url.length > 25 // Filter out invalid URLs
  );
  
  console.log(`   ✅ Total unique dealer profiles found: ${profileUrls.length}`);
  
  if (profileUrls.length === 0) {
    console.log('   ⚠️  No profiles found, using example URL for testing');
    return ['https://www.classic.com/s/111-motorcars-ZnQygen/'];
  }
  
  return profileUrls;
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

