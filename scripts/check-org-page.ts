import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // Collect console messages
  const consoleMessages: string[] = [];
  page.on('console', (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Collect page errors
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  // Collect failed network requests
  const failedRequests: string[] = [];
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });

  // Collect network responses with errors
  const errorResponses: string[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400) {
      errorResponses.push(`${res.status()} ${res.url()}`);
    }
  });

  console.log('--- Navigating to https://nuke.ag/org ---');

  try {
    const response = await page.goto('https://nuke.ag/org', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    console.log(`\n--- HTTP Response ---`);
    console.log(`Status: ${response?.status()}`);
    console.log(`URL after navigation: ${page.url()}`);

    // Wait 3 seconds for any additional loading
    await page.waitForTimeout(3000);

    // Take screenshot of initial state
    await page.screenshot({ path: '/tmp/org-page-1-initial.png', fullPage: false });
    console.log('\nScreenshot 1 saved: /tmp/org-page-1-initial.png');

    // Get page title
    const title = await page.title();
    console.log(`\n--- Page Title ---`);
    console.log(title);

    // Get visible text content
    const bodyText = await page.evaluate(() => {
      return document.body?.innerText?.substring(0, 3000) || 'NO BODY TEXT';
    });
    console.log(`\n--- Visible Text (first 3000 chars) ---`);
    console.log(bodyText);

    // Check for common error/loading indicators
    const indicators = await page.evaluate(() => {
      const results: Record<string, any> = {};

      // Check for loading spinners
      const spinners = document.querySelectorAll('[class*="spinner"], [class*="loading"], [class*="loader"], [role="progressbar"]');
      results.spinners = spinners.length;

      // Check for error messages
      const errors = document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"]');
      results.errorElements = Array.from(errors).map(e => e.textContent?.trim().substring(0, 200));

      // Check for blank/empty main content
      const main = document.querySelector('main, [role="main"], #root, #app, #__next');
      results.mainContent = main ? {
        tag: main.tagName,
        id: main.id,
        childCount: main.children.length,
        textLength: main.textContent?.trim().length || 0,
        isEmpty: (main.textContent?.trim().length || 0) < 10
      } : 'NO MAIN ELEMENT FOUND';

      // Check overall DOM size
      results.totalElements = document.querySelectorAll('*').length;
      results.bodyChildCount = document.body?.children.length || 0;

      // Check for toast/notification elements
      const toasts = document.querySelectorAll('[class*="toast"], [class*="notification"], [class*="snackbar"]');
      results.toasts = Array.from(toasts).map(t => t.textContent?.trim().substring(0, 200));

      // Check for modals/dialogs
      const modals = document.querySelectorAll('[class*="modal"], [class*="dialog"], [role="dialog"]');
      results.modals = Array.from(modals).map(m => m.textContent?.trim().substring(0, 200));

      // Check for iframes
      const iframes = document.querySelectorAll('iframe');
      results.iframes = Array.from(iframes).map(f => ({ src: f.src, width: f.width, height: f.height }));

      return results;
    });
    console.log(`\n--- UI Indicators ---`);
    console.log(JSON.stringify(indicators, null, 2));

    // Check current URL (might have been redirected)
    console.log(`\n--- Current URL ---`);
    console.log(page.url());

    // Scroll down and take another screenshot
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/org-page-2-scrolled.png', fullPage: false });
    console.log('\nScreenshot 2 saved: /tmp/org-page-2-scrolled.png');

    // Get text after scrolling
    const afterScrollText = await page.evaluate(() => {
      return document.body?.innerText?.substring(0, 3000) || 'NO BODY TEXT';
    });

    if (afterScrollText !== bodyText) {
      console.log(`\n--- Text After Scroll (first 3000 chars) ---`);
      console.log(afterScrollText);
    } else {
      console.log('\n--- No new text visible after scrolling ---');
    }

    // Take a full page screenshot
    await page.screenshot({ path: '/tmp/org-page-3-fullpage.png', fullPage: true });
    console.log('\nScreenshot 3 (full page) saved: /tmp/org-page-3-fullpage.png');

    // Get all links on page
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent?.trim().substring(0, 100),
        href: a.href
      })).filter(l => l.text);
    });
    console.log(`\n--- Links on Page (${links.length} total) ---`);
    links.slice(0, 30).forEach(l => console.log(`  ${l.text} -> ${l.href}`));

    // Get any images
    const images = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(img => ({
        src: img.src?.substring(0, 200),
        alt: img.alt,
        width: img.naturalWidth,
        height: img.naturalHeight
      }));
    });
    console.log(`\n--- Images on Page (${images.length} total) ---`);
    images.slice(0, 20).forEach(i => console.log(`  ${i.alt || 'no alt'} (${i.width}x${i.height}) -> ${i.src}`));

    // Check HTML structure
    const htmlStructure = await page.evaluate(() => {
      const root = document.getElementById('root') || document.getElementById('app') || document.getElementById('__next');
      if (!root) return 'No #root/#app/#__next found';

      const getStructure = (el: Element, depth: number): string => {
        if (depth > 3) return '...';
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const classes = el.className && typeof el.className === 'string'
          ? `.${el.className.split(' ').slice(0, 3).join('.')}` : '';
        const children = Array.from(el.children).map(c => getStructure(c, depth + 1)).join('\n' + '  '.repeat(depth + 1));
        return `${'  '.repeat(depth)}<${tag}${id}${classes}>${children ? '\n' + children : ''}`;
      };

      return getStructure(root, 0);
    });
    console.log(`\n--- HTML Structure ---`);
    console.log(htmlStructure.substring(0, 3000));

  } catch (err: any) {
    console.log(`\n--- NAVIGATION ERROR ---`);
    console.log(err.message);

    // Still try to take a screenshot
    try {
      await page.screenshot({ path: '/tmp/org-page-error.png', fullPage: false });
      console.log('Error screenshot saved: /tmp/org-page-error.png');
    } catch {}
  }

  // Print collected console messages
  console.log(`\n--- Browser Console Messages (${consoleMessages.length}) ---`);
  consoleMessages.forEach(m => console.log(`  ${m}`));

  // Print page errors
  console.log(`\n--- Page Errors (${pageErrors.length}) ---`);
  pageErrors.forEach(e => console.log(`  ${e}`));

  // Print failed requests
  console.log(`\n--- Failed Network Requests (${failedRequests.length}) ---`);
  failedRequests.forEach(r => console.log(`  ${r}`));

  // Print error responses
  console.log(`\n--- Error HTTP Responses (${errorResponses.length}) ---`);
  errorResponses.forEach(r => console.log(`  ${r}`));

  await browser.close();
})();
