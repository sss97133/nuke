#!/usr/bin/env node
/**
 * Quick test for OldCarOnline extraction
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Fetching homepage...');
  await page.goto('https://www.oldcaronline.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2000);

  const listings = await page.evaluate(() => {
    return [...document.querySelectorAll('a[href*="for-sale-ID"][href$=".htm"]')]
      .map(a => a.href)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 5);
  });

  console.log(`Found ${listings.length} listings\n`);

  let saved = 0;
  for (const url of listings) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(1500);

      const data = await page.evaluate(() => {
        const text = document.body.innerText;
        const title = document.querySelector('h1')?.innerText || document.title;

        // Parse title: "1966 AMC American 440 for sale by Owner - Mead, Washington"
        const yearMatch = title.match(/^(\d{4})/);
        // Stop at "for sale" or location pattern
        const makeModelMatch = title.match(/^\d{4}\s+([A-Za-z]+(?:\s+Benz)?)\s+(.+?)(?:\s+for\s+sale|\s+-\s+[A-Z]|$)/i);

        // Price: look for $ followed by numbers
        const priceMatches = text.match(/\$\s*([\d,]+)/g) || [];
        const prices = priceMatches.map(p => parseInt(p.replace(/[$,\s]/g, ''))).filter(p => p > 100);
        const price = prices.length > 0 ? Math.max(...prices) : null;

        // Images
        const images = [...document.querySelectorAll('img[src*="photos"], img[src*="images"]')]
          .map(i => i.src)
          .filter(s => s && !s.includes('logo') && !s.includes('icon'));

        return {
          url: window.location.href,
          title,
          year: yearMatch ? parseInt(yearMatch[1]) : null,
          make: makeModelMatch ? makeModelMatch[1] : null,
          model: makeModelMatch ? makeModelMatch[2].split(/\s+[A-Z][a-z]+$/)[0].trim() : null,
          price,
          image_count: images.length,
          primary_image: images[0] || null
        };
      });

      console.log(`${data.year} ${data.make} ${data.model} - $${data.price || '?'} (${data.image_count} images)`);

      // Save to DB
      const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          discovery_url: data.url,
          discovery_source: 'oldcaronline',
          year: data.year,
          make: data.make,
          model: data.model,
          sale_price: data.price,
          primary_image_url: data.primary_image,
          status: 'active',
          notes: `OldCarOnline listing. ${data.image_count} images.`
        })
      });

      if (res.ok) {
        saved++;
        console.log(`  ✓ Saved`);
      } else {
        console.log(`  ✗ Failed: ${res.status}`);
      }

      // Rate limit
      await page.waitForTimeout(1000);

    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`);
    }
  }

  await browser.close();
  console.log(`\nDone: ${saved}/${listings.length} saved`);
}

main().catch(console.error);
