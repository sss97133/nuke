import { test, expect } from 'playwright/test';

/**
 * CursorHomepage Filters (Production)
 *
 * The production baseURL (see config/playwright.config.ts) currently lands on the
 * CursorHomepage-style grid with the Win95 filter bar (year/make/price/location/type/sources/status).
 *
 * This test validates that filters actually change the rendered vehicle list without relying on
 * any specific dataset.
 */
test.describe('Homepage filter bar', () => {
  test('year min filter reduces results to 0, reset restores results', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Ensure we have vehicles rendered before applying any filters (avoids false positives during initial load).
    const vehicleLinks = page.locator('main a[href^="/vehicle/"]');
    await expect(vehicleLinks.first()).toBeVisible({ timeout: 30000 });

    // Ensure filter panel is visible; if it's hidden, show it.
    const yearButton = page.getByRole('button', { name: /^year$/i }).first();
    if (!(await yearButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      const showFilters = page.getByRole('button', { name: /show filters/i }).first();
      if (await showFilters.isVisible({ timeout: 2000 }).catch(() => false)) {
        await showFilters.click();
      }
    }

    // Open year filters if needed.
    const minYear = page.getByPlaceholder(/min year/i).first();
    if (!(await minYear.isVisible({ timeout: 2000 }).catch(() => false))) {
      await yearButton.click();
      await expect(minYear).toBeVisible({ timeout: 10000 });
    }

    // Apply an impossible year lower-bound to force 0 results deterministically.
    await minYear.fill('3000');

    await expect(vehicleLinks).toHaveCount(0, { timeout: 20000 });

    // Reset should bring results back.
    const resetBtn = page.getByRole('button', { name: /^reset$/i }).first();
    await resetBtn.click();

    await expect(vehicleLinks.first()).toBeVisible({ timeout: 30000 });
  });
});

