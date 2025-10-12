// Inspect the /vehicles page to see what's showing
const puppeteer = require('puppeteer');

async function inspectVehiclesPage() {
  console.log('🔍 Inspecting /vehicles page...');
  
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  const page = await browser.newPage();
  
  try {
    // Navigate to vehicles page
    console.log('📱 Opening /vehicles page...');
    await page.goto('http://localhost:5174/vehicles', { waitUntil: 'networkidle0' });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Get page title and URL
    const title = await page.title();
    const url = await page.url();
    console.log(`Page: ${title} - ${url}`);
    
    // Check for any vehicle-related elements
    const vehicleElements = await page.evaluate(() => {
      const elements = [];
      
      // Look for common vehicle element patterns
      const selectors = [
        '[class*="vehicle"]',
        '[data-testid*="vehicle"]',
        '.card',
        '[class*="grid"]',
        'h3',
        'span',
        'div'
      ];
      
      selectors.forEach(selector => {
        const found = document.querySelectorAll(selector);
        found.forEach(el => {
          const text = el.textContent?.trim();
          if (text && (text.includes('1932') || text.includes('1974') || 
                      text.includes('Ford') || text.includes('roadster') ||
                      text.match(/\d{4}.*\w+.*\w+/))) {
            elements.push({
              selector,
              className: el.className,
              textContent: text.substring(0, 200),
              innerHTML: el.innerHTML.substring(0, 300),
              tagName: el.tagName
            });
          }
        });
      });
      
      return elements;
    });
    
    console.log(`Found ${vehicleElements.length} suspicious elements:`);
    vehicleElements.forEach((el, i) => {
      console.log(`${i+1}. ${el.tagName}.${el.className}: "${el.textContent}"`);
    });
    
    // Get all text content
    const allText = await page.evaluate(() => document.body.textContent);
    
    // Check for hardcoded years
    if (allText.includes('1932') || allText.includes('1974')) {
      console.log('⚠️ FOUND HARDCODED YEARS IN PAGE');
      
      // Find specific text containing these years
      const lines = allText.split('\n').filter(line => 
        line.includes('1932') || line.includes('1974')
      );
      console.log('Lines with hardcoded years:');
      lines.forEach(line => console.log(`  "${line.trim()}"`));
    }
    
    // Take screenshot
    await page.screenshot({ path: '/Users/skylar/nuke/vehicles_page_inspection.png', fullPage: true });
    console.log('📸 Screenshot saved to vehicles_page_inspection.png');
    
    // Get the component source that's rendering
    const reactDevTools = await page.evaluate(() => {
      // Try to get React component info if available
      if (window.React && window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        return 'React DevTools available';
      }
      return 'No React DevTools';
    });
    
    console.log('React info:', reactDevTools);
    
  } catch (error) {
    console.error('❌ Inspection error:', error);
  } finally {
    // Keep browser open for manual inspection
    console.log('🔍 Browser left open for manual inspection...');
    // await browser.close();
  }
}

inspectVehiclesPage();
