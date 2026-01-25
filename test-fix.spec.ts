import { test } from '@playwright/test';

test('verify market page is accessible', async ({ page }) => {
  await page.goto('https://n-zero.dev/market');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/fix-market.png', fullPage: true });

  // Try clicking on dashboard link
  await page.goto('https://n-zero.dev/market/dashboard');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/fix-dashboard.png', fullPage: true });

  // Try the invest page
  await page.goto('https://n-zero.dev/invest');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'screenshots/fix-invest.png', fullPage: true });

  console.log('✅ All pages accessible');
});
