/**
 * Test extract-bat-core function via direct HTTP - using correct parameter name
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const testUrl = 'https://bringatrailer.com/listing/1981-jeep-cj-5-22/';
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  console.log('Testing extract-bat-core with:', testUrl);
  console.log('Using parameter name: url (not listing_url)');
  console.log('');

  const response = await fetch(`${supabaseUrl}/functions/v1/extract-bat-core`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: testUrl })
  });

  console.log('Status:', response.status);
  console.log('Status Text:', response.statusText);

  const text = await response.text();
  if (text.length > 3000) {
    console.log('Response (truncated):', text.substring(0, 3000));
  } else {
    console.log('Response:', text);
  }
}

main().catch(console.error);
