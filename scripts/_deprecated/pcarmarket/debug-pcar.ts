import { chromium } from 'playwright';

async function debug() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://www.pcarmarket.com/auctions/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);
  
  // Scroll to load content
  for (let i = 0; i < 5; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 500);
    await page.waitForTimeout(500);
  }
  
  const debug = await page.evaluate(() => {
    // Check various selectors
    const results: Record<string, number> = {};
    
    results['pcar-listing-tile--wrapper'] = document.querySelectorAll('.pcar-listing-tile--wrapper').length;
    results['pcar-listing-tile'] = document.querySelectorAll('[class*="pcar-listing-tile"]').length;
    results['auction links'] = document.querySelectorAll('a[href*="/auction/"]').length;
    results['all links'] = document.querySelectorAll('a').length;
    results['any tile class'] = document.querySelectorAll('[class*="tile"]').length;
    results['any listing class'] = document.querySelectorAll('[class*="listing"]').length;
    results['any card class'] = document.querySelectorAll('[class*="card"]').length;
    results['any auction class'] = document.querySelectorAll('[class*="auction"]').length;
    
    // Get sample auction links
    const auctionLinks = Array.from(document.querySelectorAll('a[href*="/auction/"]')).slice(0, 10);
    const sampleLinks = auctionLinks.map(a => ({
      href: (a as HTMLAnchorElement).href,
      parentClass: a.parentElement?.className,
      grandparentClass: a.parentElement?.parentElement?.className,
      text: a.textContent?.trim().substring(0, 60)
    }));
    
    // Get page title and body classes
    const info = {
      title: document.title,
      bodyClass: document.body.className,
      mainContent: document.querySelector('main')?.className || 'no main',
    };
    
    return { counts: results, sampleLinks, info };
  });
  
  console.log('=== PCarMarket Debug ===');
  console.log('\nElement counts:');
  for (const [k, v] of Object.entries(debug.counts)) {
    console.log(`  ${k}: ${v}`);
  }
  
  console.log('\nPage info:');
  console.log(`  Title: ${debug.info.title}`);
  console.log(`  Body class: ${debug.info.bodyClass}`);
  console.log(`  Main class: ${debug.info.mainContent}`);
  
  console.log('\nSample auction links:');
  for (const link of debug.sampleLinks) {
    console.log(`  ${link.href}`);
    console.log(`    Parent: ${link.parentClass}`);
    console.log(`    Grandparent: ${link.grandparentClass}`);
  }
  
  await browser.close();
}

debug().catch(console.error);
