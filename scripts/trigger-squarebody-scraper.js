#!/usr/bin/env node

/**
 * Trigger the Craigslist squarebody scraper
 * Usage: node scripts/trigger-squarebody-scraper.js [max_regions]
 */

import https from 'https';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const FUNCTION_NAME = 'scrape-all-craigslist-squarebodies';

// Get service role key from environment or prompt
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY not found in environment');
  console.error('');
  console.error('Set it with:');
  console.error('  export SUPABASE_SERVICE_ROLE_KEY="your-key-here"');
  console.error('');
  console.error('Or get it from:');
  console.error('  https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api');
  process.exit(1);
}

const maxRegions = parseInt(process.argv[2]) || 5;
const maxListings = parseInt(process.argv[3]) || 50;

const payload = JSON.stringify({
  max_regions: maxRegions,
  max_listings_per_search: maxListings,
  user_id: null
});

const url = new URL(`${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`);

const options = {
  hostname: url.hostname,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': payload.length
  }
};

console.log('🚀 Triggering Craigslist squarebody scraper...');
console.log(`   Regions: ${maxRegions}`);
console.log(`   Max listings per search: ${maxListings}`);
console.log('');

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      
      if (res.statusCode === 200) {
        console.log('✅ Scraper triggered successfully!');
        console.log('');
        console.log('Response:');
        console.log(JSON.stringify(response, null, 2));
        console.log('');
        console.log('📊 Monitor progress:');
        console.log(`   https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions/${FUNCTION_NAME}/logs`);
        console.log('');
        console.log('The scraper is now running in Supabase cloud.');
        console.log('You can close this terminal - it will keep running!');
      } else {
        console.error(`❌ Error: ${res.statusCode}`);
        console.error('Response:', response);
      }
    } catch (e) {
      console.log('Response (raw):');
      console.log(data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request error:', error.message);
  process.exit(1);
});

req.write(payload);
req.end();

