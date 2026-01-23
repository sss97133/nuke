const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading BaT past auctions page...');
  await page.goto('https://bringatrailer.com/auctions/?bat_filter=1&auction_type=past', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  // Count initial listings
  let initialCount = await page.$$eval('.auctions-item-listing, .listing-card, a[href*="/listing/"]', els => els.length);
  console.log('Initial listing elements: ' + initialCount);

  // Get unique listing URLs
  let initialUrls = await page.$$eval('a[href*="/listing/"]', links =>
    [...new Set(links.map(a => a.href).filter(h => h.includes('/listing/')))].length
  );
  console.log('Initial unique listing URLs: ' + initialUrls);

  // Find "Show More" button - various selectors
  const showMoreSelectors = [
    'button:has-text("Show More")',
    '.show-more',
    '[data-bind*="loadMore"]',
    'a:has-text("Show More")',
    '.auctions-load-more',
    'button:has-text("Load More")'
  ];

  let showMoreButton = null;
  for (const sel of showMoreSelectors) {
    try {
      showMoreButton = await page.$(sel);
      if (showMoreButton) {
        console.log('Found button with selector: ' + sel);
        break;
      }
    } catch (e) {}
  }

  if (showMoreButton) {
    const buttonText = await showMoreButton.textContent();
    console.log('Button text: ' + buttonText.trim());

    // Click and measure
    await showMoreButton.click();
    await page.waitForTimeout(3000);

    let afterClick = await page.$$eval('a[href*="/listing/"]', links =>
      [...new Set(links.map(a => a.href).filter(h => h.includes('/listing/')))].length
    );
    console.log('After 1 click: ' + afterClick + ' URLs (added ' + (afterClick - initialUrls) + ')');

    // Try second click
    showMoreButton = await page.$(showMoreSelectors.find(s => s.includes('Show More')) || showMoreSelectors[0]);
    if (showMoreButton) {
      await showMoreButton.click();
      await page.waitForTimeout(3000);
      let afterClick2 = await page.$$eval('a[href*="/listing/"]', links =>
        [...new Set(links.map(a => a.href).filter(h => h.includes('/listing/')))].length
      );
      console.log('After 2 clicks: ' + afterClick2 + ' URLs (added ' + (afterClick2 - afterClick) + ')');
    }
  } else {
    console.log('No Show More button found');

    // Try scrolling for infinite scroll
    console.log('Testing infinite scroll...');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);

    let afterScroll = await page.$$eval('a[href*="/listing/"]', links =>
      [...new Set(links.map(a => a.href).filter(h => h.includes('/listing/')))].length
    );
    console.log('After scroll: ' + afterScroll + ' URLs');
  }

  // Get sample URLs
  const sampleUrls = await page.$$eval('a[href*="/listing/"]', links =>
    [...new Set(links.map(a => a.href).filter(h => h.includes('/listing/')))].slice(0, 5)
  );
  console.log('\nSample URLs:');
  sampleUrls.forEach(u => console.log('  ' + u));

  await browser.close();
})();
