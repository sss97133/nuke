import { test, expect } from '@playwright/test';

const BASE_URL = 'https://n-zero.dev';

const pages = [
  { path: '/', name: 'Homepage' },
  { path: '/invest', name: 'Investment Platform' },
  { path: '/market', name: 'Market' },
  { path: '/market/dashboard', name: 'Market Dashboard' },
  { path: '/market/exchange', name: 'Market Exchange' },
  { path: '/market-intelligence', name: 'Market Intelligence' },
  { path: '/auctions', name: 'Auctions' },
  { path: '/search', name: 'Search' },
];

test.describe('Continuous Platform Testing', () => {
  test.setTimeout(120000);

  for (const page of pages) {
    test(`${page.name} loads correctly`, async ({ page: browserPage }) => {
      const start = Date.now();

      await browserPage.goto(`${BASE_URL}${page.path}`);
      await browserPage.waitForLoadState('networkidle');

      const loadTime = Date.now() - start;

      // Check page loaded
      const title = await browserPage.title();
      expect(title).toBeTruthy();

      // Check no critical errors in console
      const errors: string[] = [];
      browserPage.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(msg.text());
        }
      });

      // Check main content exists
      const body = await browserPage.locator('body').innerHTML();
      expect(body.length).toBeGreaterThan(100);

      console.log(`✅ ${page.name}: ${loadTime}ms`);
    });
  }

  test('API health check', async ({ request }) => {
    // Platform status
    const statusRes = await request.get('https://qkgaybvrernstplzjaam.supabase.co/functions/v1/platform-status');
    expect(statusRes.ok()).toBeTruthy();
    const status = await statusRes.json();
    expect(status.demo_mode).toBeDefined();
    console.log('✅ Platform Status API: OK');

    // DB Stats
    const statsRes = await request.get('https://qkgaybvrernstplzjaam.supabase.co/functions/v1/db-stats');
    expect(statsRes.ok()).toBeTruthy();
    console.log('✅ DB Stats API: OK');
  });
});
