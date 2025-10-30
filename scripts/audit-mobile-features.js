#!/usr/bin/env node
/**
 * Comprehensive Mobile Feature Audit
 * Checks what's actually rendered and reports issues
 */

const { chromium } = require('playwright');

(async () => {
  console.log('🔍 COMPREHENSIVE MOBILE AUDIT\n');
  console.log('Site: https://n-zero.dev\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  const page = await context.newPage();

  try {
    // Navigate to homepage
    await page.goto('https://n-zero.dev', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Navigate directly to known vehicle
    const vehicleId = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
    console.log(`📍 Navigating directly to vehicle: ${vehicleId}`);
    await page.goto(`https://n-zero.dev/vehicle/${vehicleId}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Check if mobile view is active
    const isMobileCheck = await page.evaluate(() => window.innerWidth < 768);
    console.log(`   Mobile view detected: ${isMobileCheck} (width: ${await page.evaluate(() => window.innerWidth)})`);

    // AUDIT: What tabs exist?
    console.log('\n📋 TAB AUDIT:');
    const tabElements = await page.locator('button, div').filter({ hasText: /Overview|Images|Timeline|Specs/i }).all();
    for (const tab of tabElements) {
      const text = await tab.textContent();
      const visible = await tab.isVisible();
      console.log(`   - "${text}" (visible: ${visible})`);
    }

    // AUDIT: What buttons exist?
    console.log('\n🔘 BUTTON AUDIT:');
    const allButtons = await page.locator('button').all();
    console.log(`   Total buttons found: ${allButtons.length}`);
    for (const btn of allButtons.slice(0, 20)) { // First 20
      const text = await btn.textContent();
      const visible = await btn.isVisible();
      const testId = await btn.getAttribute('data-testid');
      if (text && text.trim()) {
        console.log(`   - "${text.trim().substring(0, 30)}" (visible: ${visible}, testid: ${testId || 'none'})`);
      }
    }

    // AUDIT: Overview tab specifically
    console.log('\n📊 OVERVIEW TAB AUDIT:');
    const overviewTab = await page.locator('button').filter({ hasText: /Overview/i }).first();
    if (await overviewTab.count() > 0) {
      await overviewTab.click();
      await page.waitForTimeout(2000);

      // Check for specific buttons
      const priceBtn = await page.locator('[data-testid="edit-price-button"]').first();
      const docBtn = await page.locator('[data-testid="upload-doc-button"]').first();
      const priceBtnText = await page.locator('button').filter({ hasText: /Edit Price/i }).first();
      const docBtnText = await page.locator('button').filter({ hasText: /Upload Doc/i }).first();

      console.log(`   Edit Price (by testid): ${await priceBtn.count()} found`);
      console.log(`   Edit Price (by text): ${await priceBtnText.count()} found`);
      console.log(`   Upload Doc (by testid): ${await docBtn.count()} found`);
      console.log(`   Upload Doc (by text): ${await docBtnText.count()} found`);

      // Screenshot of overview tab
      await page.screenshot({ path: 'test-results/audit-overview-tab.png', fullPage: true });
      console.log('   📸 Screenshot saved: audit-overview-tab.png');

      // Check page HTML structure
      const html = await page.content();
      const hasPriceButton = html.includes('Edit Price') || html.includes('💰 Edit Price');
      const hasDocButton = html.includes('Upload Doc') || html.includes('📄 Upload Doc');
      console.log(`   HTML contains "Edit Price": ${hasPriceButton}`);
      console.log(`   HTML contains "Upload Doc": ${hasDocButton}`);
刚
    }

    // AUDIT: Images tab
    console.log('\n📸 IMAGES TAB AUDIT:');
    const imagesTab = await page.locator('button').filter({ hasText: /Images|📷/i }).first();
    if (await imagesTab.count() > 0) {
      await imagesTab.click();
      await page.waitForTimeout(2000);

      const images = await page.locator('img[src*="vehicle"], img[src*="supabase"]').all();
      console.log(`   Images found: ${images.length}`);
      
      if (images.length > 0) {
        await images[0].click();
        await page.waitForTimeout(2000);

        // Check for viewer elements
        const helpText = await page.locator('*').filter({ hasText: /Double-tap|Swipe to navigate/i }).all();
        const dots = await page.locator('[style*="borderRadius"],[style*="border-radius"]').all();
        const counter = await page.locator('*').filter({ hasText: /\d+ \/ \d+/ }).all();

        console.log(`   Viewer help text elements: ${helpText.length}`);
        console.log(`   Progress dots: ${dots.length}`);
        console.log(`   Image counter: ${counter.length}`);

        await page.screenshot({ path: 'test-results/audit-image-viewer.png', fullPage: false });
        console.log('   📸 Viewer screenshot: audit-image-viewer.png');

        // Close viewer
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
      }
    }

    // Final page HTML dump (first 5000 chars)
    const pageHTML = await page.content();
    const relevantHTML = pageHTML
      .split('\n')
      .filter(line => 
        line.includes('Upload Doc') || 
        line.includes('Edit Price') || 
        line.includes('data-testid') ||
        line.includes('actionBtn')
      )
      .slice(0, 50)
      .join('\n');

    console.log('\n🔍 RELEVANT HTML EXCERPT:');
    console.log(relevantHTML.substring(0, 2000));

  } catch (error) {
    console.error('\n❌ Audit Error:', error.message);
    console.error(error.stack);
  }

  await browser.close();
  console.log('\n✅ Audit complete');
})();

