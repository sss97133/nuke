import { chromium } from 'playwright';

const url = 'http://localhost:5173/vehicle/0015ef65-87c4-451a-b175-81981a31aeca';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Collect console messages and errors
  const consoleLogs = [];
  const consoleErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push({ type: msg.type(), text });
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push(`PAGE ERROR: ${err.message}`);
  });

  console.log(`Navigating to ${url}...`);

  try {
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    console.log(`Final URL: ${page.url()}`);
    console.log(`Status: ${response?.status()}`);

    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Screenshot 1: Evidence tab (default)
    await page.screenshot({
      path: '/tmp/vehicle-profile-evidence.png',
      fullPage: false
    });
    console.log('Screenshot 1 (Evidence/default) saved');

    // Get page structure info
    const structure = await page.evaluate(() => {
      const results = {};
      const h1 = document.querySelector('h1');
      results.h1 = h1?.textContent?.trim();
      const h2s = Array.from(document.querySelectorAll('h2')).map(h => h.textContent?.trim()).filter(Boolean);
      results.h2s = h2s;
      // Look for tab elements
      const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab, [class*="tab"], [class*="Tab"], button'))
        .map(t => ({ tag: t.tagName, class: t.className?.toString()?.substring(0, 80), text: t.textContent?.trim() }))
        .filter(t => t.text && t.text.length < 50);
      results.tabs = tabs;
      const buttons = Array.from(document.querySelectorAll('button'))
        .map(b => b.textContent?.trim())
        .filter(Boolean)
        .slice(0, 30);
      results.buttons = buttons;
      return results;
    });

    console.log('\n=== PAGE STRUCTURE ===');
    console.log(JSON.stringify(structure, null, 2));

    // Look for the Facts tab and click it
    console.log('\nLooking for Facts tab...');

    // Try multiple selectors for tab buttons
    let factsTab = null;
    const tabSelectors = [
      'button:has-text("Facts")',
      '[role="tab"]:has-text("Facts")',
      'text=Facts',
      '*:has-text("Facts")',
    ];

    for (const sel of tabSelectors) {
      try {
        const el = page.locator(sel).first();
        const count = await el.count();
        if (count > 0) {
          console.log(`Found Facts tab with selector: ${sel}`);
          factsTab = el;
          break;
        }
      } catch (e) {
        // continue
      }
    }

    if (factsTab) {
      await factsTab.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.screenshot({
        path: '/tmp/vehicle-profile-facts.png',
        fullPage: false
      });
      console.log('Screenshot 2 (Facts tab) saved');
    } else {
      console.log('Facts tab not found, saving current state');
      await page.screenshot({
        path: '/tmp/vehicle-profile-facts.png',
        fullPage: false
      });
    }

    // Click Commerce tab
    console.log('\nLooking for Commerce tab...');
    let commerceTab = null;
    const commerceSelectors = [
      'button:has-text("Commerce")',
      '[role="tab"]:has-text("Commerce")',
      'text=Commerce',
    ];

    for (const sel of commerceSelectors) {
      try {
        const el = page.locator(sel).first();
        const count = await el.count();
        if (count > 0) {
          console.log(`Found Commerce tab with selector: ${sel}`);
          commerceTab = el;
          break;
        }
      } catch (e) {
        // continue
      }
    }

    if (commerceTab) {
      await commerceTab.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.screenshot({
        path: '/tmp/vehicle-profile-commerce.png',
        fullPage: false
      });
      console.log('Screenshot 3 (Commerce tab) saved');
    } else {
      console.log('Commerce tab not found, saving current state');
      await page.screenshot({
        path: '/tmp/vehicle-profile-commerce.png',
        fullPage: false
      });
    }

    // Click Financials tab
    console.log('\nLooking for Financials tab...');
    let financialsTab = null;
    const financialsSelectors = [
      'button:has-text("Financials")',
      '[role="tab"]:has-text("Financials")',
      'text=Financials',
    ];

    for (const sel of financialsSelectors) {
      try {
        const el = page.locator(sel).first();
        const count = await el.count();
        if (count > 0) {
          console.log(`Found Financials tab with selector: ${sel}`);
          financialsTab = el;
          break;
        }
      } catch (e) {
        // continue
      }
    }

    if (financialsTab) {
      await financialsTab.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.screenshot({
        path: '/tmp/vehicle-profile-financials.png',
        fullPage: false
      });
      console.log('Screenshot 4 (Financials tab) saved');
    } else {
      console.log('Financials tab not found, saving current state');
      await page.screenshot({
        path: '/tmp/vehicle-profile-financials.png',
        fullPage: false
      });
    }

    // Final page text summary
    const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 3000));
    console.log('\n=== PAGE TEXT (first 3000 chars) ===');
    console.log(pageText);

    // Report errors
    if (consoleErrors.length > 0) {
      console.log('\n=== CONSOLE ERRORS ===');
      consoleErrors.forEach(e => console.log(' -', e));
    } else {
      console.log('\nNo console errors detected.');
    }

  } catch (err) {
    console.error(`Navigation error: ${err.message}`);
    try {
      await page.screenshot({
        path: '/tmp/vehicle-profile-error.png',
        fullPage: false
      });
      console.log('Error screenshot saved to /tmp/vehicle-profile-error.png');
    } catch (e) {
      console.error('Could not take screenshot:', e.message);
    }
  }

  await browser.close();
})();
