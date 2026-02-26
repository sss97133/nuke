import { chromium } from 'playwright';

const url = 'http://localhost:5173/vehicle/0015ef65-87c4-451a-b175-81981a31aeca';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

  console.log(`Navigating to ${url}...`);

  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  console.log(`Status: ${response?.status()}`);
  await new Promise(r => setTimeout(r, 5000));

  // Helper: click tab, scroll to workspace, screenshot (viewport + fullpage)
  async function screenshotTab(tabName, viewportPath, fullPagePath) {
    const tab = page.locator(`button:has-text("${tabName}")`).first();
    const count = await tab.count();
    if (count > 0) {
      await tab.click();
      console.log(`Clicked ${tabName} tab`);
    } else {
      console.log(`${tabName} tab not found`);
    }
    await new Promise(r => setTimeout(r, 2000));

    // Scroll to the workspace area (tab bar is below the hero image)
    // Find tab buttons and scroll them into view
    await page.evaluate(() => {
      const tabBar = document.querySelector('[class*="workspace"], [class*="tab-bar"], [class*="tabBar"]');
      if (tabBar) {
        tabBar.scrollIntoView({ behavior: 'instant', block: 'start' });
      } else {
        // Scroll to where the tab buttons are (around 600-700px on this page)
        window.scrollTo({ top: 500, behavior: 'instant' });
      }
    });
    await new Promise(r => setTimeout(r, 500));

    await page.screenshot({ path: viewportPath, fullPage: false });
    await page.screenshot({ path: fullPagePath, fullPage: true });
    console.log(`  -> Saved ${viewportPath} and ${fullPagePath}`);
  }

  // Evidence tab (default - already on it)
  await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'instant' }));
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: '/tmp/vehicle-profile-evidence.png', fullPage: false });
  await page.screenshot({ path: '/tmp/vehicle-profile-evidence-full.png', fullPage: true });
  console.log('Evidence tab screenshots saved');

  // Scroll back to top for each tab click
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await screenshotTab('Facts', '/tmp/vehicle-profile-facts.png', '/tmp/vehicle-profile-facts-full.png');

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await screenshotTab('Commerce', '/tmp/vehicle-profile-commerce.png', '/tmp/vehicle-profile-commerce-full.png');

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await screenshotTab('Financials', '/tmp/vehicle-profile-financials.png', '/tmp/vehicle-profile-financials-full.png');

  // Get visible content for each tab (go back to Evidence first to test)
  const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 4000));
  console.log('\n=== CURRENT PAGE TEXT (Financials tab) ===');
  console.log(pageText);

  // Check for visible errors or empty states in each tab
  const tabContent = await page.evaluate(() => {
    const workspace = document.querySelector('[class*="workspace"], [class*="Workspace"], [class*="tab-content"], [class*="TabContent"]');
    if (workspace) return workspace.innerText?.substring(0, 1000);
    // Fallback: find the section after the tab buttons
    const tabButtons = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Financials');
    if (tabButtons) {
      let next = tabButtons.parentElement?.nextElementSibling;
      if (next) return next.innerText?.substring(0, 1000);
    }
    return 'Could not find workspace content';
  });
  console.log('\n=== WORKSPACE CONTENT ===');
  console.log(tabContent);

  if (consoleErrors.length > 0) {
    console.log('\n=== CONSOLE ERRORS ===');
    consoleErrors.forEach(e => console.log(' -', e));
  } else {
    console.log('\nNo console errors.');
  }

  await browser.close();
})();
