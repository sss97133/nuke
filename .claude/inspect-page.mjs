import { chromium } from 'playwright';

const url = 'https://n-zero.dev/org';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Collect console messages
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  // Collect page errors
  const pageErrors = [];
  page.on('pageerror', err => {
    pageErrors.push(err.message);
  });

  // Collect failed network requests
  const failedRequests = [];
  page.on('requestfailed', request => {
    failedRequests.push({
      url: request.url(),
      failure: request.failure()?.errorText || 'unknown'
    });
  });

  // Track all network requests and responses
  const networkLog = [];
  page.on('response', response => {
    const status = response.status();
    if (status >= 400) {
      networkLog.push({
        url: response.url(),
        status: status,
        statusText: response.statusText()
      });
    }
  });

  // Track redirects
  const redirects = [];
  page.on('response', response => {
    if ([301, 302, 303, 307, 308].includes(response.status())) {
      redirects.push({
        from: response.url(),
        status: response.status(),
        to: response.headers()['location'] || 'unknown'
      });
    }
  });

  console.log(`Navigating to ${url}...`);

  try {
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    console.log(`\n=== NAVIGATION RESULT ===`);
    console.log(`Final URL: ${page.url()}`);
    console.log(`Status: ${response?.status()}`);
    console.log(`Status Text: ${response?.statusText()}`);

    // Wait extra time for any lazy loading
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({
      path: '/Users/skylar/nuke/.claude/page-screenshot.png',
      fullPage: true
    });
    console.log(`\nScreenshot saved to /Users/skylar/nuke/.claude/page-screenshot.png`);

    // Also take a viewport-only screenshot
    await page.screenshot({
      path: '/Users/skylar/nuke/.claude/page-screenshot-viewport.png',
      fullPage: false
    });

    // Get page title
    const title = await page.title();
    console.log(`\nPage Title: "${title}"`);

    // Get page content summary
    const bodyText = await page.evaluate(() => {
      return document.body?.innerText?.substring(0, 3000) || 'NO BODY TEXT';
    });
    console.log(`\n=== PAGE TEXT (first 3000 chars) ===`);
    console.log(bodyText);

    // Check for common auth/login elements
    const authElements = await page.evaluate(() => {
      const results = [];
      // Check for login forms
      const forms = document.querySelectorAll('form');
      forms.forEach(f => {
        const inputs = f.querySelectorAll('input');
        const inputTypes = Array.from(inputs).map(i => i.type);
        results.push({ tag: 'form', inputs: inputTypes, action: f.action });
      });
      // Check for login-related text
      const loginText = document.body.innerText.match(/(sign in|log in|login|sign up|register|authenticate)/gi);
      if (loginText) results.push({ loginKeywords: loginText });
      return results;
    });

    if (authElements.length > 0) {
      console.log(`\n=== AUTH/LOGIN ELEMENTS ===`);
      console.log(JSON.stringify(authElements, null, 2));
    }

    // Get all visible elements structure
    const pageStructure = await page.evaluate(() => {
      function getStructure(el, depth = 0) {
        if (depth > 4) return null;
        const tag = el.tagName?.toLowerCase();
        if (!tag || ['script', 'style', 'link', 'meta'].includes(tag)) return null;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return null;

        const result = {
          tag,
          id: el.id || undefined,
          class: el.className?.toString()?.substring(0, 100) || undefined,
          text: el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
            ? el.textContent?.substring(0, 80) : undefined,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        };

        const children = Array.from(el.children)
          .map(c => getStructure(c, depth + 1))
          .filter(Boolean);
        if (children.length > 0 && children.length < 20) {
          result.children = children;
        } else if (children.length >= 20) {
          result.childCount = children.length;
        }

        return result;
      }
      return getStructure(document.body);
    });

    console.log(`\n=== PAGE STRUCTURE (top levels) ===`);
    console.log(JSON.stringify(pageStructure, null, 2).substring(0, 5000));

    // Check for error states in the UI
    const errorElements = await page.evaluate(() => {
      const errors = [];
      // Check for error-related classes
      document.querySelectorAll('[class*="error"], [class*="Error"], [class*="alert"], [class*="Alert"], [role="alert"]').forEach(el => {
        errors.push({ class: el.className?.toString()?.substring(0, 100), text: el.textContent?.substring(0, 200) });
      });
      // Check for empty root divs (SPA that didn't render)
      const root = document.getElementById('root') || document.getElementById('app') || document.getElementById('__next');
      if (root && root.innerHTML.trim() === '') {
        errors.push({ issue: 'Empty root element', id: root.id });
      }
      return errors;
    });

    if (errorElements.length > 0) {
      console.log(`\n=== ERROR ELEMENTS IN DOM ===`);
      console.log(JSON.stringify(errorElements, null, 2));
    }

  } catch (err) {
    console.error(`\nNavigation error: ${err.message}`);
    // Still try to screenshot whatever is there
    try {
      await page.screenshot({
        path: '/Users/skylar/nuke/.claude/page-screenshot.png',
        fullPage: true
      });
      console.log('Screenshot taken despite error');
    } catch (e) {
      console.error('Could not take screenshot:', e.message);
    }
  }

  // Print collected logs
  if (redirects.length > 0) {
    console.log(`\n=== REDIRECTS ===`);
    redirects.forEach(r => console.log(JSON.stringify(r)));
  }

  if (consoleLogs.length > 0) {
    console.log(`\n=== CONSOLE LOGS (${consoleLogs.length} total) ===`);
    consoleLogs.forEach(log => {
      console.log(`[${log.type}] ${log.text.substring(0, 500)}`);
    });
  }

  if (pageErrors.length > 0) {
    console.log(`\n=== PAGE ERRORS ===`);
    pageErrors.forEach(err => console.log(err));
  }

  if (failedRequests.length > 0) {
    console.log(`\n=== FAILED REQUESTS ===`);
    failedRequests.forEach(r => console.log(JSON.stringify(r)));
  }

  if (networkLog.length > 0) {
    console.log(`\n=== HTTP ERRORS (4xx/5xx) ===`);
    networkLog.forEach(r => console.log(JSON.stringify(r)));
  }

  await browser.close();
})();
