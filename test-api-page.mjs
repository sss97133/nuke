import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  await page.goto('https://nuke.ag/api', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const body = await page.textContent('body');
  console.log('=== /api Page Content ===');
  console.log('Has hero:', body.includes('Your raw data in.'));
  console.log('Has VISION:', body.includes('Send a photo. Know the car.'));
  console.log('Has DATA:', body.includes('Every value shows its work.'));
  console.log('Has SDK:', body.includes('npm install @nuke1/sdk'));
  console.log('Has MCP:', body.includes('mcpServers'));
  console.log('NO extractors:', !body.includes('extractor'));
  console.log('NO 810K:', !body.includes('810K'));

  // Test market search
  console.log('\n=== Market Search ===');
  const input = page.locator('input[placeholder*="Porsche"]');
  console.log('Search input found:', await input.count() > 0);
  await input.fill('how many Porsche 911 sold');
  await page.waitForTimeout(5000);

  const afterSearch = await page.textContent('body');
  console.log('Has "comparable":', afterSearch.includes('comparable sale'));
  console.log('Has "avg":', afterSearch.includes('avg'));

  const marketCard = page.locator('text=MARKET DATA');
  const marketCount = await marketCard.count();
  console.log('Market card count:', marketCount);

  // Test entity search
  console.log('\n=== Entity Search ===');
  await input.fill('1967 Mustang');
  await page.waitForTimeout(3000);
  const afterEntity = await page.textContent('body');
  console.log('Has results:', afterEntity.includes('result'));

  // Test /developers
  console.log('\n=== /developers ===');
  await page.goto('https://nuke.ag/developers', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  const devBody = await page.textContent('body');
  console.log('Page loads:', devBody.includes('Developer Documentation'));
  console.log('Has Structuring:', devBody.includes('Structuring'));
  console.log('NO extractors:', !devBody.includes('extractor'));
} catch (err) {
  console.error('Test error:', err.message);
} finally {
  await browser.close();
  console.log('\nDone.');
}
