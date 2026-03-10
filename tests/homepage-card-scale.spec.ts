import { test, expect, Page } from 'playwright/test';

/**
 * CursorHomepage card scale sweep
 *
 * Captures screenshots for cards-per-row 1..16 to quickly spot layout regressions:
 * - Follow button overlapping price badge
 * - Badge readability
 * - Spacing/proportions as card size changes
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
    if (await vehicleLinks.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      return;
    }
    if (await refreshBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(3000);
      continue;
    }
    if (reloadCount < 3) {
      reloadCount++;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }
  }
  await expect(vehicleLinks.first()).toBeVisible({ timeout: 15000 });
}

test.describe('Homepage card scale sweep', () => {
  test.setTimeout(120000);

  test('captures screenshots across 1..16 cards/row (chromium only)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Visual sweep is chromium-only');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?tab=feed', { waitUntil: 'domcontentloaded' });

    // Wait for vehicles with retry on transient API failures.
    await waitForVehicles(page);

    const sliders = page.locator('input[type="range"][min="1"][max="16"]');
    await expect(sliders.first()).toBeAttached({ timeout: 10000 });

    // Pick a visible slider (there can be 2 depending on filter panel/minibar state).
    let slider = sliders.first();
    if (!(await slider.isVisible({ timeout: 1000 }).catch(() => false))) {
      slider = sliders.nth(1);
    }
    await expect(slider).toBeVisible({ timeout: 10000 });

    for (let n = 1; n <= 16; n++) {
      await slider.evaluate((el, value) => {
        const input = el as HTMLInputElement;
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, n);

      // Wait for state persistence (CursorHomepage writes this key on change).
      await page.waitForFunction(
        (value) => window.localStorage.getItem('nuke_homepage_cardsPerRow') === String(value),
        n,
        { timeout: 10000 }
      );

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);

      await page.screenshot({
        path: testInfo.outputPath(`homepage-cards-per-row-${n}.png`),
        fullPage: false,
      });
    }
  });
});
