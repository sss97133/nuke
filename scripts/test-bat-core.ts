/**
 * Test extract-bat-core function
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const testUrl = 'https://bringatrailer.com/listing/1960-volvo-pv445-duett/';

  console.log('Testing extract-bat-core with:', testUrl);
  console.log('');

  const { data, error } = await supabase.functions.invoke('extract-bat-core', {
    body: { listing_url: testUrl }
  });

  if (error) {
    console.log('Error:', JSON.stringify(error, null, 2));
    return;
  }

  console.log('Success!');
  console.log('Result:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
