const { chromium } = require('playwright');

const url = 'https://nuke-6hdn4r2lq-nzero.vercel.app';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  const consoleLogs = [];
  const pageErrors = [];
  const failedRequests = [];
  const allResponses = [];

  page.on('console', msg => consoleLogs.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => {
    pageErrors.push({ message: err.message, stack: err.stack });
  });
  page.on('requestfailed', req => failedRequests.push({ url: req.url(), failure: req.failure()?.errorText || 'unknown' }));
  page.on('response', async res => {
    const status = res.status();
    const url = res.url();
    // Track JS files and API calls
    if (url.includes('.js') || status >= 400 || url.includes('supabase') || url.includes('typesense')) {
      allResponses.push({ status, url: url.substring(0, 120) });
    }
  });

  console.log(`Navigating to ${url}...`);
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  console.log(`Status: ${response?.status()}, Final URL: ${page.url()}`);

  await page.waitForTimeout(4000);

  // Get full HTML source
  const html = await page.content();
  console.log(`\nHTML length: ${html.length}`);
  console.log(`HTML head snippet:\n${html.substring(0, 1000)}`);

  // Check what scripts are loaded
  const scripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
  });
  console.log(`\nLoaded scripts (${scripts.length}):`);
  scripts.forEach(s => console.log(`  ${s}`));

  // Check meta tags
  const metas = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('meta')).map(m => ({
      name: m.name || m.getAttribute('property') || '',
      content: (m.content || '').substring(0, 100)
    })).filter(m => m.name || m.content);
  });
  console.log(`\nMeta tags:`);
  metas.forEach(m => console.log(`  ${m.name}: ${m.content}`));

  // Get the actual error with stack
  if (pageErrors.length > 0) {
    console.log(`\nJavaScript Errors with Stack:`);
    pageErrors.forEach(e => {
      console.log(`  Message: ${e.message}`);
      console.log(`  Stack: ${e.stack ? e.stack.substring(0, 800) : 'no stack'}`);
    });
  }

  console.log(`\nAll console logs:`);
  consoleLogs.forEach(l => console.log(`  [${l.type}] ${l.text.substring(0, 500)}`));

  console.log(`\nNetwork responses (JS + errors):`);
  allResponses.slice(0, 20).forEach(r => console.log(`  ${r.status}: ${r.url}`));

  if (failedRequests.length > 0) {
    console.log(`\nFailed requests:`);
    failedRequests.forEach(r => console.log(`  ${r.url.substring(0, 120)} - ${r.failure}`));
  }

  await browser.close();
})();
