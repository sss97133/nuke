/**
 * DESIGN AUTO PLAYWRIGHT SCRAPER
 *
 * Extracts vehicle listings from designauto.com
 * Design Auto features dealers and individual sellers, similar to BaT
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface DesignAutoListing {
  url: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  mileage: number | null;
  location: string | null;
  dealer_name: string | null;
  image_url: string | null;
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseYearMakeModel(title: string): { year: number | null; make: string | null; model: string | null } {
  // Pattern: "2023 Porsche 911 GT3" or "1987 Ferrari 328 GTS"
  const match = title.match(/^(\d{4})\s+([A-Za-z\-]+)\s+(.+)/);
  if (match) {
    return {
      year: parseInt(match[1]),
      make: match[2],
      model: match[3].trim()
    };
  }

  // Try to extract year anywhere in string
  const yearMatch = title.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  return {
    year: yearMatch ? parseInt(yearMatch[1]) : null,
    make: null,
    model: null
  };
}

function parsePrice(priceText: string): number | null {
  if (!priceText) return null;
  const match = priceText.replace(/[^\d]/g, '');
  const num = parseInt(match);
  return (num > 0 && num < 100000000) ? num : null;
}

function parseMileage(text: string): number | null {
  if (!text) return null;
  const match = text.match(/(\d[\d,]*)\s*(?:miles?|mi\b|km)/i);
  if (match) {
    return parseInt(match[1].replace(/,/g, ''));
  }
  return null;
}

async function scrapeDesignAutoSearch(page: Page): Promise<DesignAutoListing[]> {
  const listings: DesignAutoListing[] = [];

  // Navigate to the search/inventory page
  const urls = [
    'https://www.designauto.com/search',
    'https://www.designauto.com/inventory',
    'https://www.designauto.com/listings',
    'https://www.designauto.com/'
  ];

  for (const url of urls) {
    try {
      console.log(`Trying: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await delay(3000);

      // Check page title and URL
      const pageTitle = await page.title();
      const currentUrl = page.url();
      console.log(`  Page: ${pageTitle} | URL: ${currentUrl}`);

      // Look for vehicle cards/listings
      const vehicleData = await page.evaluate(() => {
        const results: any[] = [];

        // Try various selectors for vehicle cards
        const selectors = [
          'a[href*="/vehicle/"]',
          'a[href*="/car/"]',
          'a[href*="/listing/"]',
          '[class*="vehicle"]',
          '[class*="listing"]',
          '[class*="card"]',
          'article',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            console.log(`Found ${elements.length} elements with selector: ${selector}`);

            elements.forEach(el => {
              const link = el.tagName === 'A' ? el : el.querySelector('a');
              const href = link?.getAttribute('href');

              // Get text content
              const text = el.textContent || '';

              // Look for price
              const priceEl = el.querySelector('[class*="price"]') || el.querySelector('[data-price]');
              const priceText = priceEl?.textContent || '';

              // Look for image
              const imgEl = el.querySelector('img');
              const imgSrc = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src');

              // Look for title/name
              const titleEl = el.querySelector('h2, h3, h4, [class*="title"], [class*="name"]');
              const title = titleEl?.textContent?.trim() || '';

              if (href && href.includes('/')) {
                results.push({
                  url: href.startsWith('http') ? href : `https://www.designauto.com${href}`,
                  title: title,
                  fullText: text.slice(0, 500),
                  price: priceText,
                  image: imgSrc
                });
              }
            });

            if (results.length > 0) break;
          }
        }

        return results;
      });

      console.log(`  Found ${vehicleData.length} potential listings`);

      if (vehicleData.length > 0) {
        for (const item of vehicleData) {
          const { year, make, model } = parseYearMakeModel(item.title || item.fullText);
          listings.push({
            url: item.url,
            title: item.title || `${year || ''} ${make || ''} ${model || ''}`.trim(),
            year,
            make,
            model,
            price: parsePrice(item.price),
            mileage: parseMileage(item.fullText),
            location: null,
            dealer_name: null,
            image_url: item.image
          });
        }
        break; // Found listings, no need to try other URLs
      }

      // Also dump page content for debugging
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000));
      console.log(`  Page preview: ${bodyText?.slice(0, 300)}...`);

    } catch (err: any) {
      console.log(`  Error on ${url}: ${err.message}`);
    }
  }

  return listings;
}

async function scrapeDealersPage(page: Page): Promise<{ name: string; url: string }[]> {
  const dealers: { name: string; url: string }[] = [];

  try {
    await page.goto('https://www.designauto.com/dealers', { waitUntil: 'networkidle', timeout: 30000 });
    await delay(2000);

    const dealerData = await page.evaluate(() => {
      const results: { name: string; url: string }[] = [];

      // Look for dealer links
      const links = document.querySelectorAll('a[href*="/dealer/"], a[href*="/dealers/"]');
      links.forEach(link => {
        const href = link.getAttribute('href');
        const name = link.textContent?.trim() || '';
        if (href && name) {
          results.push({
            name,
            url: href.startsWith('http') ? href : `https://www.designauto.com${href}`
          });
        }
      });

      return results;
    });

    dealers.push(...dealerData);
    console.log(`Found ${dealers.length} dealers`);

  } catch (err: any) {
    console.log(`Error scraping dealers: ${err.message}`);
  }

  return dealers;
}

async function main() {
  console.log('='.repeat(60));
  console.log('DESIGN AUTO PLAYWRIGHT SCRAPER');
  console.log('='.repeat(60));

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // First, explore the site structure
  console.log('\n--- Exploring Site Structure ---');

  try {
    await page.goto('https://www.designauto.com', { waitUntil: 'networkidle', timeout: 30000 });
    await delay(2000);

    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        links: Array.from(document.querySelectorAll('a')).slice(0, 50).map(a => ({
          href: a.getAttribute('href'),
          text: a.textContent?.trim().slice(0, 50)
        })).filter(l => l.href && l.href.startsWith('/'))
      };
    });

    console.log('Title:', pageInfo.title);
    console.log('URL:', pageInfo.url);
    console.log('\nNavigation links:');
    pageInfo.links.slice(0, 20).forEach(l => console.log(`  ${l.text}: ${l.href}`));

    // Look for vehicle listings on homepage
    console.log('\n--- Searching for Vehicle Listings ---');
    const listings = await scrapeDesignAutoSearch(page);

    console.log(`\nTotal listings found: ${listings.length}`);

    // Check dealers page
    console.log('\n--- Checking Dealers Page ---');
    const dealers = await scrapeDealersPage(page);

    // Add Design Auto to scrape_sources if not exists
    const { data: existing } = await supabase
      .from('scrape_sources')
      .select('id')
      .eq('name', 'Design Auto')
      .maybeSingle();

    if (!existing) {
      const { error: insertErr } = await supabase
        .from('scrape_sources')
        .insert({
          name: 'Design Auto',
          url: 'https://www.designauto.com',
          source_type: 'marketplace',
          is_active: true
        });

      if (insertErr) {
        console.log('Error adding Design Auto source:', insertErr.message);
      } else {
        console.log('Added Design Auto to scrape_sources');
      }
    }

    // Save listings to database
    let saved = 0;
    for (const listing of listings) {
      if (!listing.year || !listing.make) continue;

      const { data: existingVehicle } = await supabase
        .from('vehicles')
        .select('id')
        .eq('listing_url', listing.url)
        .maybeSingle();

      if (existingVehicle) continue;

      const { error } = await supabase.from('vehicles').insert({
        year: listing.year,
        make: listing.make,
        model: listing.model || 'Unknown',
        price: listing.price,
        mileage: listing.mileage,
        listing_url: listing.url,
        discovery_url: listing.url,
        listing_title: listing.title,
        location: listing.location,
        auction_source: 'Design Auto',
        primary_image_url: listing.image_url,
        is_public: true,
        status: 'active'
      });

      if (!error) {
        saved++;
        console.log(`Saved: ${listing.year} ${listing.make} ${listing.model}`);
      }
    }

    console.log(`\nSaved ${saved} new vehicles`);

  } catch (err: any) {
    console.error('Error:', err.message);
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
