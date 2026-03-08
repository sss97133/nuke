import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', msg => {
  if (msg.text().includes('LiveSearch')) console.log(`[BROWSER] ${msg.text()}`);
});
page.on('response', response => {
  if (response.url().includes('functions/v1/')) {
    const fn = response.url().split('functions/v1/')[1]?.split('?')[0];
    console.log(`[NET] ${response.request().method()} ${fn} → ${response.status()}`);
  }
});

await page.goto('https://nuke.ag/api', { waitUntil: 'networkidle', timeout: 30000 });

// Use fill() which triggers React onChange
const input = page.locator('input[placeholder*="Mustangs"]');
const count = await input.count();
console.log('Found search input:', count);

if (count > 0) {
  await input.fill('how many Porsche 911 sold');
  console.log('Filled, waiting 6s...');
  await page.waitForTimeout(6000);
} else {
  // Try old placeholder
  const oldInput = page.locator('input[placeholder*="Porsche"]');
  console.log('Found old input:', await oldInput.count());
  if (await oldInput.count() > 0) {
    await oldInput.fill('how many Porsche 911 sold');
    console.log('Filled with old input, waiting 6s...');
    await page.waitForTimeout(6000);
  }
}

const check = await page.evaluate(() => {
  const body = document.body.innerText;
  const parts = body.split('LIVE');
  const liveContent = parts.length > 1 ? parts[1].split('VISION')[0] : '';
  return {
    hasMarketData: body.includes('MARKET DATA'),
    hasComparableSales: /\d+ comparable sale/.test(body),
    liveContent: liveContent.substring(0, 400),
  };
});

console.log('\nMarket card:', check.hasMarketData);
console.log('Comparable sales:', check.hasComparableSales);
console.log('LIVE section:', JSON.stringify(check.liveContent));

await browser.close();
