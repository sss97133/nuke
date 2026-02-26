import { test, expect } from 'playwright/test';

test.describe('Production Site Verification After Code Splitting', () => {
  
  test('1. Homepage loads correctly', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(err.message));

    const response = await page.goto('https://nuke.ag', { waitUntil: 'networkidle', timeout: 30000 });
    expect(response?.status()).toBeLessThan(400);

    await page.waitForTimeout(3000);
    const bodyText = await page.locator('body').innerText();
    console.log(`Homepage body length: ${bodyText.length} chars`);
    expect(bodyText.length).toBeGreaterThan(100);

    // Verify key homepage elements
    await expect(page.locator('h1:has-text("Nuke")')).toBeVisible();
    await expect(page.locator('text=Vehicle Provenance Engine')).toBeVisible();
    await expect(page.locator('button:has-text("Browse Feed")')).toBeVisible();
    await expect(page.locator('button:has-text("Get Started")')).toBeVisible();
    console.log('Homepage elements verified: h1, tagline, Browse Feed, Get Started');

    // Check JS bundles
    const scripts = await page.locator('script[src]').all();
    const scriptSrcs: string[] = [];
    for (const s of scripts) {
      const src = await s.getAttribute('src');
      if (src) scriptSrcs.push(src);
    }
    console.log(`Loaded ${scriptSrcs.length} script tags:`);
    scriptSrcs.forEach(s => console.log(`  ${s}`));

    if (consoleErrors.length > 0) {
      console.log('Console errors on homepage:');
      consoleErrors.forEach(e => console.log(`  ERROR: ${e}`));
    } else {
      console.log('No console errors on homepage');
    }
  });

  test('2. Browse Feed shows vehicles, navigate to profile and check tabs', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

    await page.goto('https://nuke.ag', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click "Browse Feed" to get to vehicle listings
    const browseFeed = page.locator('button:has-text("Browse Feed")');
    await expect(browseFeed).toBeVisible();
    await browseFeed.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log(`After Browse Feed click, URL: ${currentUrl}`);

    // Now look for vehicle links (could be /vehicle/, /v/, or card links)
    const allLinks = await page.locator('a[href]').all();
    const vehicleHrefs: string[] = [];
    for (const link of allLinks) {
      const href = await link.getAttribute('href');
      if (href && (href.includes('/vehicle/') || href.includes('/v/') || href.match(/\/[0-9a-f-]{36}/))) {
        vehicleHrefs.push(href);
      }
    }
    console.log(`Found ${vehicleHrefs.length} potential vehicle links`);
    if (vehicleHrefs.length > 0) {
      console.log(`First few: ${vehicleHrefs.slice(0, 5).join(', ')}`);
    }

    // If we found vehicle links, click one
    if (vehicleHrefs.length > 0) {
      const targetLink = page.locator(`a[href="${vehicleHrefs[0]}"]`).first();
      console.log(`Clicking vehicle link: ${vehicleHrefs[0]}`);
      await targetLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
      
      const profileUrl = page.url();
      console.log(`Vehicle profile URL: ${profileUrl}`);
      
      // Check for workspace tabs
      const bodyText = await page.locator('body').innerText();
      const tabNames = ['Evidence', 'Facts', 'Commerce', 'Financials'];
      for (const tab of tabNames) {
        const found = bodyText.toLowerCase().includes(tab.toLowerCase());
        console.log(`  Tab "${tab}": ${found ? 'FOUND' : 'NOT FOUND'}`);
      }
      
      await page.screenshot({ path: 'screenshots/prod-verify-vehicle.png', fullPage: false });
      console.log('Screenshot saved: screenshots/prod-verify-vehicle.png');
    } else {
      // Fallback: navigate directly to search
      console.log('No vehicle links found after Browse Feed, trying /search...');
      await page.goto('https://nuke.ag/search', { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);
      console.log(`Search page URL: ${page.url()}`);
      
      const searchBody = await page.locator('body').innerText();
      console.log(`Search page body length: ${searchBody.length} chars`);
      await page.screenshot({ path: 'screenshots/prod-verify-search-page.png', fullPage: false });
    }

    if (consoleErrors.length > 0) {
      console.log(`\nConsole errors (${consoleErrors.length}):`);
      consoleErrors.forEach(e => console.log(`  ERROR: ${e.substring(0, 200)}`));
    } else {
      console.log('\nNo console errors');
    }
  });

  test('3. Search box interaction and lazy loading', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(`PAGE ERROR: ${err.message}`));

    await page.goto('https://nuke.ag', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // The search box is visible: textbox "Search or paste URL..."
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();
    console.log('Search input found');

    await searchInput.click();
    await page.waitForTimeout(1000);
    console.log('Search input clicked (triggers lazy loading)');

    await searchInput.fill('Porsche');
    await page.waitForTimeout(3000);
    
    const bodyText = await page.locator('body').innerText();
    console.log(`Page text after typing "Porsche": ${bodyText.length} chars`);
    
    // Check if search results appeared
    if (bodyText.toLowerCase().includes('porsche')) {
      console.log('Search results contain "Porsche" - search is working');
    } else {
      console.log('No "Porsche" in results yet (may need Enter or different interaction)');
    }

    await page.screenshot({ path: 'screenshots/prod-verify-search.png', fullPage: false });
    console.log('Screenshot saved: screenshots/prod-verify-search.png');

    if (consoleErrors.length > 0) {
      console.log(`\nConsole errors during search (${consoleErrors.length}):`);
      consoleErrors.forEach(e => console.log(`  ERROR: ${e.substring(0, 200)}`));
    } else {
      console.log('\nNo console errors during search');
    }
  });

  test('4. Code-split chunks load correctly (all 200s)', async ({ page }) => {
    const jsRequests: { status: number; file: string }[] = [];
    page.on('response', response => {
      const url = response.url();
      if (url.endsWith('.js') || url.includes('.js?')) {
        jsRequests.push({ status: response.status(), file: url.split('/').pop() || url });
      }
    });

    await page.goto('https://nuke.ag', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log(`JS chunks loaded on initial page (${jsRequests.length}):`);
    jsRequests.forEach(r => console.log(`  ${r.status} ${r.file}`));

    // Navigate to trigger more lazy loads
    const initialCount = jsRequests.length;
    const browseFeed = page.locator('button:has-text("Browse Feed")');
    if (await browseFeed.isVisible()) {
      await browseFeed.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);

      const newChunks = jsRequests.slice(initialCount);
      if (newChunks.length > 0) {
        console.log(`\nLazy-loaded chunks after navigation (${newChunks.length}):`);
        newChunks.forEach(r => console.log(`  ${r.status} ${r.file}`));
      } else {
        console.log('\nNo additional lazy chunks loaded (may be pre-fetched)');
      }
    }

    // ALL JS requests should be 200
    const failedJs = jsRequests.filter(r => r.status !== 200);
    if (failedJs.length > 0) {
      console.log('\nFAILED JS requests:');
      failedJs.forEach(r => console.log(`  ${r.status} ${r.file}`));
    } else {
      console.log(`\nAll ${jsRequests.length} JS chunks loaded with 200 OK`);
    }
    expect(failedJs.length).toBe(0);
  });
});
