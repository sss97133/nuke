/**
 * Test extract-bat-core function via direct HTTP
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const testUrl = 'https://bringatrailer.com/listing/1960-volvo-pv445-duett/';
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  console.log('Testing extract-bat-core with:', testUrl);
  console.log('Supabase URL:', supabaseUrl ? 'Set' : 'Not set');
  console.log('');

  const response = await fetch(`${supabaseUrl}/functions/v1/extract-bat-core`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ listing_url: testUrl })
  });

  console.log('Status:', response.status);
  console.log('Status Text:', response.statusText);

  const text = await response.text();
  console.log('Response:', text.substring(0, 2000));
}

main().catch(console.error);
