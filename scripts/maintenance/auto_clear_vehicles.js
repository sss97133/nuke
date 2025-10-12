// Auto-clear all vehicle data from browser storage
const puppeteer = require('puppeteer');

async function clearAllVehicleData() {
  console.log('🚀 Starting automated localStorage clearing...');
  
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  const page = await browser.newPage();
  
  try {
    // Navigate to the frontend
    console.log('📱 Opening frontend...');
    await page.goto('http://localhost:5174', { waitUntil: 'networkidle0' });
    
    // Clear all localStorage
    console.log('🧹 Clearing localStorage...');
    await page.evaluate(() => {
      console.log('Before clear - localStorage keys:', Object.keys(localStorage));
      localStorage.clear();
      sessionStorage.clear();
      console.log('After clear - localStorage keys:', Object.keys(localStorage));
    });
    
    // Refresh the page
    console.log('🔄 Refreshing page...');
    await page.reload({ waitUntil: 'networkidle0' });
    
    // Wait a moment for React to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if vehicles are gone
    const vehicleElements = await page.$$('[data-testid="vehicle-card"], .vehicle-card, [class*="vehicle"]');
    console.log(`🔍 Found ${vehicleElements.length} vehicle elements on page`);
    
    // Take a screenshot for verification
    await page.screenshot({ path: '/Users/skylar/nuke/after_clear.png', fullPage: true });
    console.log('📸 Screenshot saved to after_clear.png');
    
    console.log('✅ Automated clearing complete!');
    
  } catch (error) {
    console.error('❌ Error during automated clearing:', error);
  } finally {
    await browser.close();
  }
}

clearAllVehicleData();
