import { chromium } from 'playwright';

const URL = 'https://nuke.ag/vehicle/83f6f033-a3c3-4cf4-a85e-a60d2c588838';
const OUT = '/Users/skylar/Downloads/mustang-timeline-2026-05-03.png';
const TIMELINE_OUT = '/Users/skylar/Downloads/mustang-timeline-only-2026-05-03.png';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1800 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

console.log('navigating:', URL);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });

// Wait for page chrome
await page.waitForTimeout(2000);

// Try several render markers — any one means timeline likely rendered
const markers = ['WORK RECORD', 'Mustang', '6F07C219593', '1966'];
let foundMarker = null;
for (const m of markers) {
  try {
    await page.waitForSelector(`text=${m}`, { timeout: 3000 });
    foundMarker = m;
    break;
  } catch {}
}
console.log('marker found:', foundMarker || '(none)');

// Scroll down to trigger any lazy rendering, then back to top for screenshot
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

await page.screenshot({ path: OUT, fullPage: true });
console.log('full-page screenshot:', OUT);

const wr = await page.locator('text=WORK RECORD').first();
if (await wr.count() > 0) {
  const card = wr.locator('xpath=ancestor::*[contains(@class,"timeline") or contains(@id,"timeline") or contains(@class,"observation")][1]');
  if (await card.count() > 0) {
    await card.first().screenshot({ path: TIMELINE_OUT });
    console.log('timeline-only screenshot:', TIMELINE_OUT);
  }
}

console.log('current URL:', page.url());
console.log('title:', await page.title());

await browser.close();
