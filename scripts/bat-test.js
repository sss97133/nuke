const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Navigating to BaT auctions results...');
  await page.goto('https://bringatrailer.com/auctions/results/', { waitUntil: 'networkidle', timeout: 30000 });
  
  // Get all listing links
  const links = await page.$$eval('a[href*="/listing/"]', els => 
    [...new Set(els.map(e => e.href))].filter(h => !h.includes('#'))
  );
  console.log('Listing links found:', links.length);
  console.log('Sample:', links.slice(0, 3));
  
  // Look for pagination/load more
  const buttons = await page.$$eval('button', els => els.map(e => e.textContent?.trim()));
  console.log('Buttons:', buttons.filter(b => b && b.length < 30));
  
  // Check for "show more" or pagination
  const showMore = await page.$('button:has-text("Show More"), button:has-text("Load More"), .load-more');
  console.log('Show More button exists:', !!showMore);
  
  await browser.close();
})();
