import { test, expect } from '@playwright/test';

const BASE_URL = 'https://n-zero.dev';

test.describe('Institutional Infrastructure Tests', () => {

  test('homepage loads with demo banner', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/01-homepage.png', fullPage: true });

    // Check for demo banner
    const demoBanner = page.locator('text=DEMO').first();
    const hasDemoBanner = await demoBanner.isVisible().catch(() => false);
    console.log('Demo banner visible:', hasDemoBanner);
  });

  test('invest page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/invest`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/02-invest-page.png', fullPage: true });

    // Look for investment platform content
    const pageContent = await page.content();
    console.log('Page has invest content:', pageContent.includes('invest') || pageContent.includes('Invest'));
  });

  test('market portfolio page loads', async ({ page }) => {
    await page.goto(`${BASE_URL}/market/portfolio`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/03-portfolio.png', fullPage: true });

    const pageContent = await page.content();
    console.log('Portfolio page loaded');
  });

  test('check API endpoints', async ({ request }) => {
    // Test platform-status endpoint (public)
    const response = await request.get('https://qkgaybvrernstplzjaam.supabase.co/functions/v1/platform-status');
    const status = await response.json();

    console.log('Platform Status:', JSON.stringify(status, null, 2));
    expect(status.demo_mode).toBeDefined();
    expect(status.demo_mode.enabled).toBe(true);
  });
});
