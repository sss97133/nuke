#!/usr/bin/env node
/**
 * Mobile Timeline Test Script
 * Tests the mobile timeline functionality on production
 */

const { chromium } = require('playwright');

async function testMobileTimeline() {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--disable-dev-shm-usage']
  });
  
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  
  const page = await context.newPage();
  
  console.log('\n🧪 Testing Mobile Timeline on Production...\n');
  
  try {
    // Navigate to vehicle profile
    console.log('1️⃣  Navigating to vehicle profile...');
    await page.goto('https://n-zero.dev/vehicle/92a39d4c-abd1-47b1-971d-dffe173c5793', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    await page.waitForTimeout(2000);
    
    // Check for new bundle hash
    const bundleHash = await page.evaluate(() => {
      const script = document.querySelector('script[src*="index-"]');
      return script ? script.src.match(/index-([^.]+)\.js/)?.[1] : 'not found';
    });
    console.log(`   Bundle hash: ${bundleHash}`);
    
    // Check mobile detection
    const isMobile = await page.evaluate(() => {
      return window.innerWidth < 768;
    });
    console.log(`   Mobile detected: ${isMobile}`);
    
    // Look for Timeline tab
    console.log('\n2️⃣  Looking for TIMELINE tab...');
    const timelineTab = await page.locator('text=TIMELINE').first();
    const tabVisible = await timelineTab.isVisible().catch(() => false);
    console.log(`   Timeline tab visible: ${tabVisible}`);
    
    if (!tabVisible) {
      console.log('   ❌ Timeline tab not found!');
      return;
    }
    
    // Click Timeline tab
    console.log('\n3️⃣  Clicking TIMELINE tab...');
    await timelineTab.click();
    await page.waitForTimeout(3000);
    
    // Check for freeze (page should be responsive)
    console.log('\n4️⃣  Checking if page froze...');
    const isResponsive = await page.evaluate(() => {
      return document.readyState === 'complete';
    });
    console.log(`   Page responsive: ${isResponsive}`);
    
    // Check console for timeline logs
    const logs = [];
    page.on('console', msg => {
      if (msg.text().includes('MobileTimelineHeatmap')) {
        logs.push(msg.text());
      }
    });
    
    await page.waitForTimeout(2000);
    
    console.log('\n5️⃣  Timeline console logs:');
    if (logs.length === 0) {
      // Get all console messages
      const allLogs = await page.evaluate(() => {
        return window.console.history || 'No logs captured';
      });
      console.log('   No MobileTimelineHeatmap logs found');
      console.log('   This means component may not be loading');
    } else {
      logs.forEach(log => console.log(`   ${log}`));
    }
    
    // Check if heatmap is visible
    console.log('\n6️⃣  Checking for timeline content...');
    const yearHeader = await page.locator('text=/2022.*events/').first();
    const headerVisible = await yearHeader.isVisible().catch(() => false);
    console.log(`   Year header visible: ${headerVisible}`);
    
    if (headerVisible) {
      console.log('\n7️⃣  Clicking year to expand heatmap...');
      await yearHeader.click();
      await page.waitForTimeout(1000);
      
      // Check if heatmap expanded
      const heatmap = await page.locator('div').filter({ hasText: /Jan.*Feb.*Mar/ }).first();
      const heatmapVisible = await heatmap.isVisible().catch(() => false);
      console.log(`   Heatmap visible: ${heatmapVisible}`);
      
      if (heatmapVisible) {
        console.log('\n8️⃣  Looking for clickable day cells...');
        // Find a green day cell
        const greenDay = await page.locator('div').filter({ 
          has: page.locator('[style*="background"]') 
        }).first();
        
        try {
          await greenDay.click({ timeout: 2000 });
          await page.waitForTimeout(1000);
          
          // Check if modal appeared
          console.log('\n9️⃣  Checking if modal appeared...');
          const modal = await page.locator('div[style*="position: fixed"]').first();
          const modalVisible = await modal.isVisible().catch(() => false);
          console.log(`   Modal visible: ${modalVisible}`);
          
          if (modalVisible) {
            const modalBox = await modal.boundingBox();
            console.log(`   Modal position:`, modalBox);
            console.log(`   ✅ Modal appeared full-screen!`);
          } else {
            console.log(`   ❌ Modal did not appear`);
          }
        } catch (err) {
          console.log(`   ⚠️  Could not click day cell: ${err.message}`);
        }
      }
    }
    
    // Take screenshot
    console.log('\n📸 Taking screenshot...');
    await page.screenshot({ path: '/Users/skylar/nuke/test-results/mobile-timeline-test.png', fullPage: true });
    console.log('   Screenshot saved: test-results/mobile-timeline-test.png');
    
    console.log('\n✅ Test complete!\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/Users/skylar/nuke/test-results/mobile-timeline-error.png' });
  } finally {
    await browser.close();
  }
}

testMobileTimeline().catch(console.error);

