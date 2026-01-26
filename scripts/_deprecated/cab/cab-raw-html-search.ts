/**
 * Search raw HTML for all photo URLs
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/9a7XbAL8/2022-porsche-911-carrera-cabriolet';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  await page.goto(TEST_URL, { waitUntil: 'networkidle', timeout: 60000 });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Get full page source
  const html = await page.content();

  console.log('Page source length:', html.length, 'chars');

  // Find auction hash
  const hashMatch = html.match(/\/([a-f0-9]{40})\/photos\//);
  const auctionHash = hashMatch ? hashMatch[1] : null;
  console.log('Auction hash:', auctionHash?.substring(0, 20) + '...');

  // Search for ALL occurrences of this hash in the source
  if (auctionHash) {
    const hashRegex = new RegExp(auctionHash, 'g');
    const matches = html.match(hashRegex);
    console.log('Hash appears in source:', matches?.length, 'times');
  }

  // Search for "photos" or "images" JSON objects
  console.log('\n=== SEARCHING FOR JSON DATA ===');

  // Look for data-* attributes with photo data
  const dataAttrMatches = html.match(/data-[a-z-]+="[^"]*media\.carsandbids[^"]*"/g);
  console.log('Data attributes with C&B URLs:', dataAttrMatches?.length || 0);

  // Look for JavaScript objects with photos
  const photoArrayPatterns = [
    /photos\s*[=:]\s*\[[\s\S]*?\]/g,
    /images\s*[=:]\s*\[[\s\S]*?\]/g,
    /gallery\s*[=:]\s*\[[\s\S]*?\]/g,
  ];

  for (const pattern of photoArrayPatterns) {
    const matches = html.match(pattern);
    if (matches) {
      console.log(`Found ${matches.length} matches for ${pattern.source.substring(0, 20)}...`);
      matches.slice(0, 2).forEach((m, i) => {
        console.log(`  ${i + 1}: ${m.substring(0, 200)}...`);
      });
    }
  }

  // Look for preload-wrap elements with data-id
  const preloadIds = html.match(/data-id="([^"]+)"/g);
  const uniquePreloadIds = new Set(preloadIds?.map(s => s.match(/data-id="([^"]+)"/)?.[1]));
  console.log('\nUnique data-id values:', uniquePreloadIds.size);

  // Look for specific patterns in scripts
  console.log('\n=== SEARCHING SCRIPT TAGS ===');

  const scriptBlocks = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  console.log('Script tags found:', scriptBlocks?.length);

  let photoScripts = 0;
  scriptBlocks?.forEach((script, i) => {
    if (auctionHash && script.includes(auctionHash)) {
      photoScripts++;
      // Extract just the relevant part
      const photoMatches = script.match(new RegExp(`[^"']*${auctionHash}[^"']*`, 'g'));
      if (photoMatches && photoMatches.length > 10) {
        console.log(`Script ${i}: Contains ${photoMatches.length} URLs with auction hash`);
        // Show unique photo paths
        const photoPaths = new Set<string>();
        photoMatches.forEach(url => {
          const pathMatch = url.match(/\/photos\/[^"'\s]+/);
          if (pathMatch) photoPaths.add(pathMatch[0]);
        });
        console.log(`  Unique photo paths: ${photoPaths.size}`);
        Array.from(photoPaths).slice(0, 5).forEach(p => console.log(`    ${p}`));
      }
    }
  });

  console.log('Scripts containing auction hash:', photoScripts);

  // Direct count of all URLs with this hash
  console.log('\n=== ALL URLS WITH AUCTION HASH ===');
  if (auctionHash) {
    const urlPattern = new RegExp(`https?://media\\.carsandbids\\.com[^"'\\s]*${auctionHash}[^"'\\s]*`, 'g');
    const allUrls = html.match(urlPattern);
    const uniqueUrls = new Set(allUrls);
    console.log('Total URL occurrences:', allUrls?.length);
    console.log('Unique URLs:', uniqueUrls.size);

    // Extract unique photo IDs
    const photoIds = new Set<string>();
    allUrls?.forEach(url => {
      const idMatch = url.match(/\/photos\/[^/]+\/([^/]+)/);
      if (idMatch) photoIds.add(idMatch[1]);
    });
    console.log('Unique photo IDs:', photoIds.size);

    console.log('\nAll photo IDs found:');
    Array.from(photoIds).forEach((id, i) => {
      console.log(`  ${i + 1}. ${id}`);
    });
  }

  await browser.close();
}

main().catch(console.error);
