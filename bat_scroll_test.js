const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading BaT past auctions...');
  await page.goto('https://bringatrailer.com/auctions/?bat_filter=1&auction_type=past', {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  const getUrlCount = async () => {
    return await page.$$eval('a[href*="/listing/"]', links =>
      [...new Set(links.map(a => a.href).filter(h => h.includes('/listing/')))].length
    );
  };

  let prevCount = 0;
  let currentCount = await getUrlCount();
  let scrolls = 0;
  let noChangeCount = 0;

  console.log('Starting scroll test...');
  console.log('Scroll 0: ' + currentCount + ' URLs');

  // Scroll 20 times to test pattern
  while (scrolls < 20 && noChangeCount < 3) {
    prevCount = currentCount;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    currentCount = await getUrlCount();
    scrolls++;

    const added = currentCount - prevCount;
    console.log('Scroll ' + scrolls + ': ' + currentCount + ' URLs (+' + added + ')');

    if (added === 0) {
      noChangeCount++;
    } else {
      noChangeCount = 0;
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('Total scrolls: ' + scrolls);
  console.log('Total unique URLs: ' + currentCount);
  console.log('Avg per scroll: ~' + Math.round(currentCount / scrolls));

  // At this rate, estimate total pages needed for 150k listings
  const listingsPerScroll = 50;
  const totalEstimate = 150000;
  const scrollsNeeded = Math.ceil(totalEstimate / listingsPerScroll);
  console.log('\nTo get 150k listings would need ~' + scrollsNeeded + ' scrolls');
  console.log('At 2 sec/scroll = ~' + Math.round(scrollsNeeded * 2 / 60) + ' minutes');

  await browser.close();
})();
