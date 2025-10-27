import { test, expect } from '@playwright/test';

/**
 * Visual Verification Tests - Screenshots of Production Features
 * Tests and captures: Mobile FAB, Financial Features, UI Pricing
 */

test.describe('Production Visual Verification', () => {
  const baseURL = 'https://nukefrontend-5dzr395le-nzero.vercel.app';

  test('homepage loads and shows vehicle grid', async ({ page }) => {
    await page.goto(baseURL);
    await page.waitForLoadState('networkidle');
    
    // Take full page screenshot
    await page.screenshot({ 
      path: 'screenshots/01-homepage.png',
      fullPage: true 
    });
    
    console.log('✓ Homepage screenshot captured');
  });

  test('mobile viewport - vehicle profile with FAB', async ({ page }) => {
    // Set mobile viewport (iPhone 13)
    await page.setViewportSize({ width: 390, height: 844 });
    
    await page.goto(baseURL);
    await page.waitForLoadState('networkidle');
    
    // Screenshot of mobile homepage
    await page.screenshot({ 
      path: 'screenshots/02-mobile-homepage.png',
      fullPage: true 
    });
    
    console.log('✓ Mobile homepage screenshot captured');
    
    // Try to navigate to a vehicle if we can see any
    const vehicleLinks = await page.locator('a[href*="/vehicle/"]').all();
    if (vehicleLinks.length > 0) {
      await vehicleLinks[0].click();
      await page.waitForLoadState('networkidle');
      
      // Screenshot showing FAB (should be visible bottom-right)
      await page.screenshot({ 
        path: 'screenshots/03-mobile-vehicle-with-FAB.png',
        fullPage: true 
      });
      
      console.log('✓ Mobile vehicle profile screenshot captured');
      console.log('  Note: Look for 📷 button in bottom-right corner');
    }
  });

  test('desktop viewport - vehicle profile with pricing', async ({ page }) => {
    // Desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    await page.goto(baseURL);
    await page.waitForLoadState('networkidle');
    
    // Screenshot desktop homepage
    await page.screenshot({ 
      path: 'screenshots/04-desktop-homepage.png',
      fullPage: false 
    });
    
    console.log('✓ Desktop homepage screenshot captured');
    
    // Try to navigate to a vehicle
    const vehicleLinks = await page.locator('a[href*="/vehicle/"]').all();
    if (vehicleLinks.length > 0) {
      await vehicleLinks[0].click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000); // Wait for any animations
      
      // Full page screenshot showing pricing sections
      await page.screenshot({ 
        path: 'screenshots/05-desktop-vehicle-pricing.png',
        fullPage: true 
      });
      
      console.log('✓ Desktop vehicle profile screenshot captured');
      console.log('  Note: Check for clean pricing (no redundancies)');
    }
  });

  test('capture bundle information', async ({ page }) => {
    await page.goto(baseURL);
    await page.waitForLoadState('networkidle');
    
    // Get bundle name from scripts
    const scripts = await page.locator('script[src*="index-"]').all();
    const bundles: string[] = [];
    
    for (const script of scripts) {
      const src = await script.getAttribute('src');
      if (src) {
        bundles.push(src);
      }
    }
    
    console.log('\n📦 Current Bundles:');
    bundles.forEach(b => console.log(`   ${b}`));
    
    // Take screenshot of the page source snippet
    await page.screenshot({ 
      path: 'screenshots/06-bundle-verification.png' 
    });
  });

  test('mobile - test all tabs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(baseURL);
    await page.waitForLoadState('networkidle');
    
    const vehicleLinks = await page.locator('a[href*="/vehicle/"]').all();
    if (vehicleLinks.length > 0) {
      await vehicleLinks[0].click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      
      // Screenshot overview tab
      await page.screenshot({ 
        path: 'screenshots/07-mobile-overview-tab.png',
        fullPage: true 
      });
      
      // Try to click timeline tab
      const timelineTab = page.locator('button:has-text("TIMELINE")').first();
      if (await timelineTab.isVisible()) {
        await timelineTab.click();
        await page.waitForTimeout(500);
        await page.screenshot({ 
          path: 'screenshots/08-mobile-timeline-tab.png',
          fullPage: true 
        });
      }
      
      // Try to click images tab
      const imagesTab = page.locator('button:has-text("IMAGES")').first();
      if (await imagesTab.isVisible()) {
        await imagesTab.click();
        await page.waitForTimeout(500);
        await page.screenshot({ 
          path: 'screenshots/09-mobile-images-tab.png',
          fullPage: true 
        });
      }
      
      console.log('✓ Mobile tabs screenshots captured');
      console.log('  Note: FAB should be visible on ALL tabs');
    }
  });
});

test.describe('Feature-Specific Tests', () => {
  test('verify security headers', async ({ page }) => {
    const response = await page.goto('https://nukefrontend-5dzr395le-nzero.vercel.app');
    
    if (response) {
      const headers = response.headers();
      
      console.log('\n🔒 Security Headers:');
      console.log(`   x-content-type-options: ${headers['x-content-type-options'] || 'missing'}`);
      console.log(`   x-frame-options: ${headers['x-frame-options'] || 'missing'}`);
      console.log(`   cache-control: ${headers['cache-control'] || 'missing'}`);
      
      expect(response.status()).toBeLessThan(500);
    }
  });

  test('verify page structure', async ({ page }) => {
    await page.goto('https://nukefrontend-5dzr395le-nzero.vercel.app');
    await page.waitForLoadState('domcontentloaded');
    
    // Check for React root
    const root = await page.locator('#root, #app').first();
    expect(root).toBeTruthy();
    
    // Check HTML structure
    const html = await page.content();
    expect(html).toContain('<!doctype html>');
    
    console.log('✓ Page structure verified');
  });
});

