const { chromium } = require('playwright');

const url = 'https://nuke-6hdn4r2lq-nzero.vercel.app';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleLogs = [];

  page.on('console', msg => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', err => {
    pageErrors.push({ message: err.message, stack: err.stack });
  });

  // Inject error interceptor BEFORE navigation
  await page.addInitScript(() => {
    const originalError = window.onerror;
    window.onerror = function(msg, src, line, col, error) {
      console.error('ONERROR: ' + JSON.stringify({ msg, src, line, col, stack: error?.stack }));
      return false;
    };
    window.addEventListener('unhandledrejection', e => {
      console.error('UNHANDLED_REJECTION: ' + (e.reason?.stack || e.reason?.message || String(e.reason)));
    });
  });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Try to manually evaluate what's broken
  const evalResult = await page.evaluate(() => {
    // Check if React is available
    const reactCheck = {
      hasReact: typeof React !== 'undefined',
      hasReactDOM: typeof ReactDOM !== 'undefined',
    };

    // Check what globals exist
    const globals = Object.keys(window).filter(k => 
      ['__REACT', 'React', 'ReactDOM', '__env', 'ENV', 'VITE', '__vite', 'supabase'].some(prefix => 
        k.startsWith(prefix) || k.toLowerCase().includes('supabase')
      )
    );

    return { reactCheck, globals: globals.slice(0, 20) };
  });
  console.log('Eval result:', JSON.stringify(evalResult, null, 2));

  console.log('\nAll console logs:');
  consoleLogs.forEach(l => console.log(`[${l.type}] ${l.text.substring(0, 600)}`));

  console.log('\nPage errors:');
  pageErrors.forEach(e => {
    console.log('Message:', e.message);
    console.log('Stack:', e.stack?.substring(0, 1000));
  });

  await browser.close();
})();
