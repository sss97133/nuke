/**
 * Test Firecrawl directly via scrape-vehicle-with-firecrawl
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
  console.log('=== Testing Firecrawl for C&B (with HTML) ===\n');

  const testUrl = 'https://carsandbids.com/auctions/rx4bQMXB/2008-honda-s2000-cr';

  // Call scrape-vehicle-with-firecrawl which should return full HTML
  console.log('Testing with scrape-vehicle-with-firecrawl function...');
  const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle-with-firecrawl', {
    body: { url: testUrl, return_html: true }
  });

  if (scrapeError) {
    console.log('Error:', scrapeError.message);
    return;
  }

  console.log('Success:', scrapeResult?.success);
  console.log('Keys:', Object.keys(scrapeResult || {}));

  const html = scrapeResult?.html || scrapeResult?.data?.html || '';
  console.log('HTML length:', html.length);

  if (html) {
    // Save to file for inspection
    fs.writeFileSync('/tmp/cab-test.html', html);
    console.log('Saved HTML to /tmp/cab-test.html');

    // Look for __NEXT_DATA__
    const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (match) {
      console.log('\nFound __NEXT_DATA__!');
      try {
        const data = JSON.parse(match[1]);
        console.log('Top-level keys:', Object.keys(data));
        console.log('props keys:', Object.keys(data.props || {}));
        console.log('pageProps keys:', Object.keys(data.props?.pageProps || {}));

        const auction = data.props?.pageProps?.auction;
        if (auction) {
          console.log('\nauction keys:', Object.keys(auction).slice(0, 30));
          console.log('VIN:', auction.vin || 'NOT FOUND');
          console.log('mileage:', auction.mileage || 'NOT FOUND');
          console.log('title:', auction.title || 'NOT FOUND');
        }
      } catch (e) {
        console.log('Parse error:', e);
      }
    } else {
      console.log('\nNo __NEXT_DATA__ found');
      // Look for any script data patterns
      const scriptMatches = html.match(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi);
      console.log('Application/json scripts:', scriptMatches?.length || 0);
    }
  }
}

main().catch(console.error);
