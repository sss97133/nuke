import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get the HTML snapshot we just saved
  const { data } = await supabase
    .from('listing_page_snapshots')
    .select('html, listing_url')
    .eq('platform', 'carsandbids')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data || !data.html) {
    console.log('No snapshot found');
    return;
  }

  console.log('Snapshot URL:', data.listing_url);
  console.log('HTML length:', data.html.length);

  // Extract og:title
  const ogMatch = data.html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch) {
    console.log('\nog:title:', ogMatch[1]);

    // Check for mileage in og:title
    const mileageMatch = ogMatch[1].match(/~?([\d,]+)\s*Miles/i);
    if (mileageMatch) {
      console.log('Mileage found:', mileageMatch[1]);
    } else {
      console.log('NO MILEAGE in og:title');
    }
  } else {
    console.log('No og:title found');
  }

  // Extract meta description
  const descMatch = data.html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (descMatch) {
    console.log('\ndescription:', descMatch[1]);
  }

  // Look for mileage anywhere in the HTML
  const mileagePatterns = [
    /Mileage[:\s]*([0-9,]+)/gi,
    /([0-9,]+)\s*miles/gi,
    /"mileage"[:\s]*"?([0-9,]+)"?/gi,
    /odometer[:\s]*([0-9,]+)/gi,
  ];

  console.log('\n--- Searching for mileage patterns in HTML ---');
  for (const pattern of mileagePatterns) {
    const matches = data.html.matchAll(pattern);
    for (const match of matches) {
      console.log(`Found: ${match[0]}`);
    }
  }
}

main().catch(console.error);
