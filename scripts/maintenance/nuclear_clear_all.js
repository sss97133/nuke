// Nuclear option - clear everything and find hardcoded vehicles
const puppeteer = require('puppeteer');

async function nuclearClear() {
  console.log('🚀 Nuclear clearing all vehicle data...');
  
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--disable-web-security', '--disable-features=VizDisplayCompositor']
  });
  
  const page = await browser.newPage();
  
  try {
    // Navigate to the frontend
    console.log('📱 Opening frontend...');
    await page.goto('http://localhost:5174', { waitUntil: 'networkidle0' });
    
    // Nuclear clear everything
    console.log('💥 NUCLEAR CLEARING ALL DATA...');
    await page.evaluate(() => {
      // Clear all storage
      localStorage.clear();
      sessionStorage.clear();
      
      // Clear IndexedDB
      if (window.indexedDB) {
        indexedDB.databases().then(databases => {
          databases.forEach(db => {
            indexedDB.deleteDatabase(db.name);
          });
        });
      }
      
      // Clear service worker cache
      if ('caches' in window) {
        caches.keys().then(names => {
          names.forEach(name => {
            caches.delete(name);
          });
        });
      }
      
      // Clear any React state by forcing reload
      window.location.reload(true);
    });
    
    // Wait for reload
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    
    // Check what's on the page now
    console.log('🔍 Checking page content...');
    
    // Look for vehicle elements
    const vehicleCards = await page.$$eval('[class*="vehicle"], [data-testid*="vehicle"]', elements => {
      return elements.map(el => ({
        className: el.className,
        textContent: el.textContent?.substring(0, 100),
        innerHTML: el.innerHTML?.substring(0, 200)
      }));
    });
    
    console.log('Found vehicle elements:', vehicleCards.length);
    vehicleCards.forEach((card, i) => {
      console.log(`${i+1}. ${card.textContent}`);
    });
    
    // Check for specific hardcoded text
    const pageText = await page.evaluate(() => document.body.textContent);
    if (pageText.includes('1932') || pageText.includes('1974')) {
      console.log('⚠️ STILL FOUND HARDCODED YEARS IN PAGE TEXT');
      
      // Find elements containing these years
      const hardcodedElements = await page.$$eval('*', elements => {
        return elements.filter(el => {
          const text = el.textContent || '';
          return text.includes('1932') || text.includes('1974');
        }).map(el => ({
          tagName: el.tagName,
          className: el.className,
          textContent: el.textContent?.substring(0, 100),
          outerHTML: el.outerHTML?.substring(0, 300)
        }));
      });
      
      console.log('Elements with hardcoded years:', hardcodedElements);
    }
    
    // Take screenshot
    await page.screenshot({ path: '/Users/skylar/nuke/nuclear_clear.png', fullPage: true });
    console.log('📸 Screenshot saved');
    
  } catch (error) {
    console.error('❌ Nuclear clear error:', error);
  } finally {
    await browser.close();
  }
}

nuclearClear();
