import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const url = 'https://www.facebook.com/marketplace/item/2123863061707922';
const vehicleId = '716ee56f-ddde-4272-ae07-25e3480b1d31';

async function extract() {
  const context = await chromium.launchPersistentContext('./fb-session-test', {
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  const page = await context.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const imgs = await page.$$eval('img[src*="fbcdn"]', imgs => 
      imgs.map(i => i.src)
        .filter(s => s.includes('scontent'))
        .filter((s,i,a) => a.indexOf(s) === i)
        .filter(s => !s.includes('emoji') && !s.includes('profile'))
    );

    console.log(`Found ${imgs.length} images`);

    // Build records with correct schema
    const records = imgs.map((imageUrl, i) => ({
      vehicle_id: vehicleId,
      image_url: imageUrl,
      is_primary: i === 0,
      position: i,
      category: 'listing',
      image_context: 'facebook_marketplace',
    }));

    // Delete existing FB images for this vehicle
    await supabase.from('vehicle_images').delete().eq('vehicle_id', vehicleId).eq('image_context', 'facebook_marketplace');

    // Insert new ones
    const { error } = await supabase.from('vehicle_images').insert(records);
    if (error) console.error('Insert error:', error);
    else console.log(`Inserted ${records.length} images`);

  } finally {
    await context.close();
  }
}

extract();
