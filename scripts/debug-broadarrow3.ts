import { chromium } from 'playwright';

async function debug() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  
  console.log('Loading /vehicles page...');
  await page.goto('https://www.broadarrowauctions.com/vehicles', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);
  
  // Scroll to load
  for (let i = 0; i < 5; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 500);
    await page.waitForTimeout(500);
  }
  
  const debug = await page.evaluate(() => {
    const results: Record<string, number> = {};
    
    results['vehicle classes'] = document.querySelectorAll('[class*="vehicle"]').length;
    results['lot classes'] = document.querySelectorAll('[class*="lot"]').length;
    results['card classes'] = document.querySelectorAll('[class*="card"]').length;
    results['item classes'] = document.querySelectorAll('[class*="item"]').length;
    results['grid classes'] = document.querySelectorAll('[class*="grid"]').length;
    
    // Check link patterns
    results['links with /vehicles/'] = document.querySelectorAll('a[href*="/vehicles/"]').length;
    results['all links'] = document.querySelectorAll('a').length;
    
    // Sample vehicle links
    const vehicleLinks = Array.from(document.querySelectorAll('a[href*="/vehicles/"]')).slice(0, 10);
    const sampleLinks = vehicleLinks.map(a => {
      const el = a as HTMLAnchorElement;
      const parent = a.closest('[class*="vehicle"], [class*="card"], [class*="item"], article') || a.parentElement;
      return {
        href: el.href,
        text: el.textContent?.trim().substring(0, 80),
        parentClass: parent?.className,
        parentTag: parent?.tagName,
      };
    });
    
    return { counts: results, sampleLinks, title: document.title };
  });
  
  console.log('Title:', debug.title);
  console.log('\nElement counts:');
  for (const [k, v] of Object.entries(debug.counts)) {
    console.log(`  ${k}: ${v}`);
  }
  
  console.log('\nSample vehicle links:');
  for (const link of debug.sampleLinks) {
    console.log(`  ${link.href}`);
    console.log(`    Parent: ${link.parentTag} - ${link.parentClass}`);
    console.log(`    Text: ${link.text}`);
  }
  
  await browser.close();
}

debug().catch(console.error);
