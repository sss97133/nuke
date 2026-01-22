/**
 * Debug what the scrape function returns for C&B
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const testUrl = 'https://carsandbids.com/auctions/36gjwewx/2018-mclaren-720s';
  console.log('Testing scrape of:', testUrl);

  try {
    const { data, error } = await supabase.functions.invoke('scrape-vehicle-with-firecrawl', {
      body: { url: testUrl, return_html: true },
    });

    if (error) {
      console.log('Error:', error);
      return;
    }

    console.log('\nResponse keys:', Object.keys(data || {}));
    console.log('Success:', data?.success);

    if (data?.html) {
      console.log('HTML length:', data.html.length);
      console.log('Has __NEXT_DATA__:', data.html.includes('__NEXT_DATA__'));
      console.log('First 500 chars:');
      console.log(data.html.substring(0, 500));
      console.log('\n... Last 500 chars:');
      console.log(data.html.substring(data.html.length - 500));
    }

    if (data?.vehicle) {
      console.log('\nVehicle data:', JSON.stringify(data.vehicle, null, 2).substring(0, 1000));
    }

    if (data?.error) {
      console.log('\nError in response:', data.error);
    }
  } catch (e: any) {
    console.log('Exception:', e.message);
  }
}

main();
