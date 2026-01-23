const { chromium } = require('playwright');

// Test if we can get more listings by filtering by year
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const getUrlCount = async () => {
    return await page.$$eval('a[href*="/listing/"]', links =>
      [...new Set(links.map(a => a.href).filter(h => h.includes('/listing/')))]
    );
  };

  // Test a few year ranges to see how many listings each has
  const years = [2024, 2020, 2015, 2010, 2005, 2000, 1990, 1980, 1970, 1960];

  console.log('Testing BaT year-filtered searches...\n');

  for (const year of years) {
    const url = 'https://bringatrailer.com/auctions/results/?type=all&era=' + year + 's';
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Scroll a few times to load more
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    const urls = await getUrlCount();
    console.log(year + 's era: ' + urls.length + ' listings visible (after 5 scrolls)');
  }

  // Also try direct year filter
  console.log('\nTrying direct year filter...');
  await page.goto('https://bringatrailer.com/auctions/?bat_filter=1&auction_type=past&year_from=2020&year_to=2020', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }

  const year2020 = await getUrlCount();
  console.log('Year 2020 filter: ' + year2020.length + ' listings');

  await browser.close();
})();
