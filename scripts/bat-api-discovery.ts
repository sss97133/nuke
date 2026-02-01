import { chromium } from 'playwright';

async function discoverBatApi() {
  console.log('Starting BAT API discovery...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  // Capture network requests to see API calls
  const apiCalls: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (url.includes('wp-json') || url.includes('api') || url.includes('ajax')) {
      apiCalls.push(`${request.method()} ${url}`);
    }
  });

  console.log('Navigating to BAT results...');
  await page.goto('https://bringatrailer.com/auctions/results/', {
    waitUntil: 'networkidle',
    timeout: 60000
  });

  // Wait for page to fully render
  await page.waitForTimeout(3000);

  // Extract any nonces or API config from the page
  const pageData = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script'));
    const nonces: string[] = [];
    const configs: string[] = [];

    scripts.forEach(script => {
      const content = script.textContent || '';
      // Look for nonce patterns
      const nonceMatch = content.match(/nonce["']?\s*[:=]\s*["']([^"']+)["']/gi);
      if (nonceMatch) nonces.push(...nonceMatch);

      // Look for API endpoints
      const apiMatch = content.match(/["']\/wp-json[^"']+["']/gi);
      if (apiMatch) configs.push(...apiMatch);
    });

    // Check for Knockout view model data
    const batLists = (window as any).bat_lists;
    const ko = (window as any).ko;

    return {
      nonces: nonces.slice(0, 10),
      apis: configs.slice(0, 10),
      hasBatLists: !!batLists,
      hasKnockout: !!ko,
      batListsKeys: batLists ? Object.keys(batLists) : [],
      totalResultsText: document.querySelector('[data-bind*="itemsFilteredNumberText"]')?.textContent || null,
      paginationButtons: Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(t => t && t.length < 30)
    };
  });

  console.log('\n=== Page Data ===');
  console.log('Nonces found:', pageData.nonces);
  console.log('API endpoints:', pageData.apis);
  console.log('Has bat_lists:', pageData.hasBatLists);
  console.log('bat_lists keys:', pageData.batListsKeys);
  console.log('Total results:', pageData.totalResultsText);
  console.log('Buttons:', pageData.paginationButtons);

  console.log('\n=== API Calls Captured ===');
  apiCalls.forEach(call => console.log(call));

  // Try scrolling to trigger API calls
  console.log('\nScrolling to trigger more API calls...');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);

  console.log('\n=== API Calls After Scroll ===');
  apiCalls.forEach(call => console.log(call));

  // Get the HTML structure of pagination controls
  const paginationHtml = await page.evaluate(() => {
    const footer = document.querySelector('.auctions-footer, .listing-footer, .pagination');
    return footer?.innerHTML?.slice(0, 2000) || 'No pagination footer found';
  });
  console.log('\n=== Pagination HTML ===');
  console.log(paginationHtml);

  await browser.close();
}

discoverBatApi().catch(console.error);
