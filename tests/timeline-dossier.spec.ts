// The following lines import the Playwright test automation library functions
import { test, expect, Page } from '@playwright/test';

// The next constant tries to set VEHICLE_URL from environment variable
// If the env var is not set, it uses a default development vehicle URL
const VEHICLE_URL =
  process.env.PLAYWRIGHT_TIMELINE_VEHICLE_URL ||
  'https://n-zero.dev/vehicle/05b2cc98-cd4f-4fb6-a17e-038d6664905e';
  process.env.PLAYWRIGHT_TIMELINE_VEHICLE_URL ||
  'https://n-zero.dev/vehicle/05b2cc98-cd4f-4fb6-a17e-038d6664905e';

async function openTimelineDossier(page: Page) {
  await page.goto(VEHICLE_URL, { waitUntil: 'networkidle' });
  // Expand the full timeline if the CTA is present
  const expandBtn = page.getByText('Open Full Timeline →').first();
  if (await expandBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await expandBtn.click();
  }

  const grid = page.locator('.timeline-grid').first();
  await expect(grid).toBeVisible({ timeout: 20000 });
  await grid.scrollIntoViewIfNeeded();

  const targetCell = grid.locator('div[title*="event" i], div[title*="Event"]').first();
  await expect(targetCell).toBeVisible({ timeout: 20000 });
  await targetCell.click();
  await expect(page.locator('text=SUMMARY').first()).toBeVisible({ timeout: 10000 });
}

async function expectProvenanceToast(page: Page) {
  const toast = page.locator('div[style*="z-index: 10003"]');
  await expect(toast).toBeVisible();
}

test.describe('Timeline Dossier Modal', () => {
  test('desktop dossier exposes provenance actions', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTimelineDossier(page);

    await expect(page.getByText('PROVENANCE')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload Receipt' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View Proof' })).toBeVisible();

    await page.getByRole('button', { name: 'View Proof' }).click();
    await expectProvenanceToast(page);

    await page.getByRole('button', { name: 'Close' }).click();
  });

  test('mobile dossier still provides provenance + CTAs', async ({ page }) => {
    await page.setViewportSize({ width: 414, height: 896 });
    await openTimelineDossier(page);

    await expect(page.getByText('SUMMARY')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload Receipt' })).toBeVisible();
    await page.getByRole('button', { name: 'View Proof' }).click();
    await expectProvenanceToast(page);
  });
});
