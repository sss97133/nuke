import { chromium } from 'playwright';

async function debug() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  
  // Try the main page first
  console.log('Trying main page...');
  await page.goto('https://www.broadarrowauctions.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  
  let debug = await page.evaluate(() => ({
    title: document.title,
    url: window.location.href,
    links: document.querySelectorAll('a').length,
  }));
  
  console.log('Main page:', debug);
  
  // Try to find an auctions link
  const auctionLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    return links
      .map(a => ({ href: (a as HTMLAnchorElement).href, text: a.textContent?.trim() }))
      .filter(l => l.href.includes('auction') || l.text?.toLowerCase().includes('auction'))
      .slice(0, 10);
  });
  
  console.log('\nAuction-related links found:', auctionLinks);
  
  // If we found auction links, try navigating to one
  if (auctionLinks.length > 0) {
    const firstAuction = auctionLinks.find(l => l.href.includes('/auctions/') || l.href.includes('/auction/'));
    if (firstAuction) {
      console.log(`\nTrying: ${firstAuction.href}`);
      await page.goto(firstAuction.href, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
      
      const pageInfo = await page.evaluate(() => ({
        title: document.title,
        bodyPreview: document.body.textContent?.substring(0, 500),
      }));
      console.log('Result:', pageInfo.title);
      console.log('Body:', pageInfo.bodyPreview);
    }
  }
  
  await browser.close();
}

debug().catch(console.error);
