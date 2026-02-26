const { chromium } = require('playwright');

const urls = [
  'https://nuke-6hdn4r2lq-nzero.vercel.app',
  'https://nuke-6hdn4r2lq-nzero.vercel.app/?tab=feed'
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const page = await context.newPage();

    const consoleLogs = [];
    const pageErrors = [];
    const failedRequests = [];
    const networkErrors = [];

    page.on('console', msg => consoleLogs.push({ type: msg.type(), text: msg.text() }));
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('requestfailed', req => failedRequests.push({ url: req.url(), failure: req.failure()?.errorText || 'unknown' }));
    page.on('response', res => {
      if (res.status() >= 400) networkErrors.push({ url: res.url(), status: res.status() });
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`URL ${i+1}: ${url}`);
    console.log('='.repeat(60));

    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      console.log(`Final URL: ${page.url()}`);
      console.log(`HTTP Status: ${response?.status()}`);

      await page.waitForTimeout(3000);

      const screenshotPath = `/tmp/vercel-screenshot-${i+1}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Screenshot saved: ${screenshotPath}`);

      const title = await page.title();
      console.log(`Page Title: "${title}"`);

      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || 'NO BODY TEXT');
      console.log(`\nPage Text:\n${bodyText}`);

      const rootInfo = await page.evaluate(() => {
        const root = document.getElementById('root');
        return {
          hasRoot: !!root,
          rootInnerHTML: root ? root.innerHTML.substring(0, 500) : null,
          rootEmpty: root ? root.innerHTML.trim() === '' : null,
          childCount: root ? root.children.length : 0
        };
      });
      console.log(`\nRoot element: ${JSON.stringify(rootInfo, null, 2)}`);

    } catch (err) {
      console.error(`Navigation error: ${err.message}`);
      try {
        await page.screenshot({ path: `/tmp/vercel-screenshot-${i+1}.png`, fullPage: true });
        console.log('Screenshot taken despite error');
      } catch(e) {}
    }

    if (consoleLogs.length > 0) {
      console.log(`\nConsole Logs (${consoleLogs.length} total):`);
      consoleLogs.forEach(l => console.log(`  [${l.type}] ${l.text.substring(0, 400)}`));
    } else {
      console.log('\nNo console logs.');
    }

    if (pageErrors.length > 0) {
      console.log(`\nJavaScript Errors (${pageErrors.length}):`);
      pageErrors.forEach(e => console.log(`  ERROR: ${e}`));
    } else {
      console.log('No JavaScript errors.');
    }

    if (failedRequests.length > 0) {
      console.log(`\nFailed Network Requests:`);
      failedRequests.forEach(r => console.log(`  FAILED: ${r.url.substring(0, 100)} (${r.failure})`));
    }

    if (networkErrors.length > 0) {
      console.log(`\nHTTP Errors (4xx/5xx):`);
      networkErrors.slice(0, 10).forEach(r => console.log(`  ${r.status}: ${r.url.substring(0, 100)}`));
    }

    await page.close();
  }

  await browser.close();
  console.log('\nDone.');
})();
