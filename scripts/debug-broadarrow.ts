import { chromium } from 'playwright';

async function debug() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Try the auctions page
  await page.goto('https://www.broadarrowauctions.com/auctions/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);
  
  // Scroll to load content
  for (let i = 0; i < 5; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 500);
    await page.waitForTimeout(500);
  }
  
  const debug = await page.evaluate(() => {
    const results: Record<string, number> = {};
    
    results['vehicle classes'] = document.querySelectorAll('[class*="vehicle"]').length;
    results['lot classes'] = document.querySelectorAll('[class*="lot"]').length;
    results['card classes'] = document.querySelectorAll('[class*="card"]').length;
    results['auction classes'] = document.querySelectorAll('[class*="auction"]').length;
    results['item classes'] = document.querySelectorAll('[class*="item"]').length;
    results['grid classes'] = document.querySelectorAll('[class*="grid"]').length;
    results['list classes'] = document.querySelectorAll('[class*="list"]').length;
    
    // Check various link patterns
    results['links with /lot'] = document.querySelectorAll('a[href*="/lot"]').length;
    results['links with /vehicle'] = document.querySelectorAll('a[href*="/vehicle"]').length;
    results['links with /auctions/'] = document.querySelectorAll('a[href*="/auctions/"]').length;
    results['all links'] = document.querySelectorAll('a').length;
    
    // Sample some links
    const allLinks = Array.from(document.querySelectorAll('a')).slice(0, 30);
    const sampleLinks = allLinks.map(a => (a as HTMLAnchorElement).href).filter(h => h.includes('broadarrow') && !h.includes('#'));
    
    // Page info
    const info = {
      title: document.title,
      url: window.location.href,
      bodyHTML: document.body.innerHTML.substring(0, 1000),
    };
    
    return { counts: results, sampleLinks: [...new Set(sampleLinks)].slice(0, 15), info };
  });
  
  console.log('=== Broad Arrow Debug ===');
  console.log('\nElement counts:');
  for (const [k, v] of Object.entries(debug.counts)) {
    console.log(`  ${k}: ${v}`);
  }
  
  console.log('\nPage info:');
  console.log(`  Title: ${debug.info.title}`);
  console.log(`  URL: ${debug.info.url}`);
  
  console.log('\nSample links on page:');
  for (const link of debug.sampleLinks) {
    console.log(`  ${link}`);
  }
  
  console.log('\nBody HTML preview:');
  console.log(debug.info.bodyHTML.substring(0, 500));
  
  await browser.close();
}

debug().catch(console.error);
