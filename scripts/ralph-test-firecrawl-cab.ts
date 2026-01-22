/**
 * Test Firecrawl for C&B to see what HTML structure we get
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== Testing Firecrawl for C&B ===\n');

  // Call the extract-cars-and-bids-core function directly via Supabase
  // But first, let's check if we can call scrape-vehicle which also uses Firecrawl

  const testUrl = 'https://carsandbids.com/auctions/rx4bQMXB/2008-honda-s2000-cr';

  console.log('Testing with scrape-vehicle function...');
  const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: testUrl, use_firecrawl: true }
  });

  if (scrapeError) {
    console.log('scrape-vehicle error:', scrapeError.message);
  } else {
    console.log('scrape-vehicle result:', JSON.stringify(scrapeResult, null, 2).substring(0, 2000));
  }
}

main().catch(console.error);
