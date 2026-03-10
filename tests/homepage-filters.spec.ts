import { test, expect, Page } from 'playwright/test';

/**
 * CursorHomepage Filters (Production)
 *
 * Tests the Win95-style filter bar (year/make/model/price/location/type/sources/status).
 * Validates that filters change the rendered vehicle list without relying on a specific dataset.
 *
 * Handles transient Supabase API failures (PGRST002) via retry logic.
 */

/** Wait for vehicle cards to appear, retrying via Refresh button or page reload on API failures. */
async function waitForVehicles(page: Page, timeout = 90000) {
  const vehicleLinks = page.locator('main a[href^="/vehicle/"]');
  const refreshBtn = page.getByRole('button', { name: /^refresh$/i }).first();
  const deadline = Date.now() + timeout;
  let reloadCount = 0;

  while (Date.now() < deadline) {
    // If vehicles are already visible, we're done.
    if (await vehicleLinks.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      return;
    }
    // If the error state is showing, click Refresh to retry.
    if (await refreshBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(3000);
      continue;
    }
    // Fallback: full page reload (handles edge case where error state hasn't rendered)
    if (reloadCount < 3) {
      reloadCount++;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }
  }
  // Final assertion — will produce a clear error if still not visible.
  await expect(vehicleLinks.first()).toBeVisible({ timeout: 15000 });
}

test.describe('Homepage filter bar', () => {
  test.setTimeout(120000);

  test('year min filter reduces results to 0, reset restores results', async ({ page }) => {
    await page.goto('/?tab=feed', { waitUntil: 'domcontentloaded' });

    // Wait for vehicles with retry on transient API failures.
    const vehicleLinks = page.locator('main a[href^="/vehicle/"]');
    await waitForVehicles(page);

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

    // Collapse the filter panel, then ensure the minimized bar can reopen it.
    const hideBtn = page.getByRole('button', { name: /^hide$/i }).first();
    if (await hideBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await hideBtn.click();
      const miniBar = page.locator('[title="Click to open filters"]').first();
      await expect(miniBar).toBeVisible({ timeout: 10000 });

      // Clicking the minimized bar should reopen filters.
      await miniBar.click();
      await expect(page.getByPlaceholder(/min year/i).first()).toBeVisible({ timeout: 20000 });
    }

    // Reset should bring results back.
    const resetBtn = page.getByRole('button', { name: /^reset$/i }).first();
    await resetBtn.click();

    await waitForVehicles(page);
  });
});
