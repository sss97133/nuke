import { chromium } from 'playwright';

async function discoverCABLiveAuctions() {
  // Launch with visible browser to handle Cloudflare
  const browser = await chromium.launch({ 
    headless: false,  // Non-headless may help with Cloudflare
    args: [
      '--disable-blink-features=AutomationControlled',
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  
  const page = await context.newPage();
  
  try {
    console.error('Navigating to C&B auctions...');
    await page.goto('https://carsandbids.com/auctions/', { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    // Wait for Cloudflare challenge to complete (up to 30s)
    console.error('Waiting for Cloudflare challenge...');
    await page.waitForFunction(
      () => !document.title.includes('moment'),
      { timeout: 30000 }
    );
    
    // Wait for auction content
    console.error('Waiting for auction content...');
    await page.waitForSelector('a[href*="/auctions/"]', { timeout: 30000 });
    
    // Give it a moment for dynamic content
    await page.waitForTimeout(2000);
    
    // Extract auction URLs
    const links = await page.$$eval('a[href*="/auctions/"]', anchors => 
      anchors.map(a => a.getAttribute('href')).filter(h => h && !h.includes('/auctions/past') && h !== '/auctions/')
    );
    
    const uniqueUrls = [...new Set(links)].filter(url => url && url.match(/\/auctions\/[a-zA-Z0-9-]+/));
    console.log(JSON.stringify({ urls: uniqueUrls, count: uniqueUrls.length }, null, 2));
  } catch (e: any) {
    console.error('Error:', e.message);
    const content = await page.content();
    console.error('Page title:', await page.title());
    console.error('Content snippet:', content.substring(0, 800));
  } finally {
    await browser.close();
  }
}

discoverCABLiveAuctions();
