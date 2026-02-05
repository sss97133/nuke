#!/usr/bin/env npx tsx

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function extractListing(page: Page, url: string): Promise<any> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    const pageText = await page.$eval('body', el => el.innerText).catch(() => '');
    if (pageText.includes('no longer available') || pageText.includes('content isn\'t available')) return { unavailable: true };

    const description = await page.$eval('meta[property="og:description"]', el => el.getAttribute('content')).catch(() => null);
    const mainImage = await page.$eval('meta[property="og:image"]', el => el.getAttribute('content')).catch(() => null);
    const sellerName = await page.$eval('a[href*="/marketplace/profile/"] span', el => el.textContent).catch(() => null);
    const allImages = await page.$$eval('img[src*="fbcdn"]', imgs =>
      imgs.map(i => i.src).filter(s => s.includes('scontent') && !s.includes('emoji') && !s.includes('profile'))
        .filter((s, i, a) => a.indexOf(s) === i)
    ).catch(() => []);

    const locationMatch = pageText.match(/Listed.*?in ([A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*[A-Z]{2})/);
    const mileageMatch = pageText.match(/Driven ([\d,]+) miles/);
    const transMatch = pageText.match(/(Manual|Automatic) transmission/i);
    const extColorMatch = pageText.match(/Exterior color:\s*([A-Za-z]+)/);
    const intColorMatch = pageText.match(/Interior color:\s*([A-Za-z]+)/);

    return {
      description, location: locationMatch?.[1] || null, seller_name: sellerName,
      mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ''), 10) : null,
      transmission: transMatch?.[1] || null, exterior_color: extColorMatch?.[1] || null,
      interior_color: intColorMatch?.[1] || null,
      all_images: allImages.length > 0 ? allImages : null, image_url: mainImage,
    };
  } catch (e) { return { error: true }; }
}

async function main() {
  console.log('🚀 Bulk extract #2 (offset 1000) starting...');

  // Get listings from offset 1000
  const { data: listings } = await supabase
    .from('marketplace_listings')
    .select('id, facebook_id, url, title, vehicle_id')
    .or('mileage.is.null,all_images.is.null')
    .order('scraped_at', { ascending: true }) // Different order to get different listings
    .limit(1000);

  if (!listings?.length) { console.log('No listings'); return; }
  console.log(`📋 ${listings.length} listings`);

  // Use different session directory
  const context = await chromium.launchPersistentContext('./fb-session-2', {
    headless: true, viewport: { width: 1280, height: 800 },
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = await context.newPage();
  let done = 0, unavailable = 0, errors = 0;

  for (const listing of listings) {
    const data = await extractListing(page, listing.url);
    if (data.unavailable) { unavailable++; }
    else if (data.error) { errors++; }
    else {
      const updates: any = {};
      for (const [k, v] of Object.entries(data)) { if (v !== null) updates[k] = v; }
      if (Object.keys(updates).length > 0) {
        await supabase.from('marketplace_listings').update(updates).eq('id', listing.id);
      }
      if (listing.vehicle_id && (data.mileage || data.transmission)) {
        const vUpdates: any = {};
        if (data.mileage) vUpdates.mileage = data.mileage;
        if (data.transmission) vUpdates.transmission = data.transmission;
        if (data.exterior_color) vUpdates.color = data.exterior_color;
        if (data.description) vUpdates.description = data.description;
        await supabase.from('vehicles').update(vUpdates).eq('id', listing.vehicle_id);
        if (data.all_images?.length > 0) {
          await supabase.from('vehicle_images').delete().eq('vehicle_id', listing.vehicle_id).eq('image_context', 'facebook_marketplace');
          const imgRecords = data.all_images.map((url: string, i: number) => ({
            vehicle_id: listing.vehicle_id, image_url: url, is_primary: i === 0, position: i, image_context: 'facebook_marketplace',
          }));
          await supabase.from('vehicle_images').insert(imgRecords);
        }
      }
      done++;
    }
    if ((done + unavailable + errors) % 10 === 0) console.log(`[${done + unavailable + errors}/${listings.length}] ✅${done} ❌${unavailable} ⚠️${errors}`);
    await page.waitForTimeout(500 + Math.random() * 500);
  }
  await context.close();
  console.log(`\n✅ Done! Extracted: ${done}, Unavailable: ${unavailable}, Errors: ${errors}`);
}

main().catch(console.error);
