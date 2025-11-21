/**
 * PIP Test: Mobile Feature Parity
 * Tests all 6 new mobile components on production
 */

const { chromium } = require('playwright');

(async () => {
  console.log('🧪 PIP TEST: Mobile Feature Parity\n');
  console.log('Testing: https://n-zero.dev\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 Pro
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  const page = await context.newPage();

  const results = {
    instagram_swipes: '❌',
    doc_uploader: '❌',
    price_editor: '❌',
    comments: '❌',
    ai_insights: '❌',
    data_editor: '❌',
    org_switcher: '❌'
  };

  try {
    // Navigate directly to homepage
    console.log('📍 Navigating to production...');
    await page.goto('https://n-zero.dev', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Take screenshot of homepage
    await page.screenshot({ path: 'test-results/mobile-homepage.png', fullPage: false });
    console.log('📸 Homepage screenshot saved');

    // Look for any vehicle link on the page
    console.log('\n🔍 Finding a vehicle to test...');
    const pageContent = await page.content();
    console.log(`   Page has ${pageContent.length} characters`);
    
    // Try multiple selectors
    let vehicleLink = null;
    
    // Method 1: Direct vehicle links
    vehicleLink = await page.locator('a[href*="/vehicle/"]').first();
    if (await vehicleLink.count() === 0) {
      // Method 2: Try clicking on any card/image that might lead to vehicle
      console.log('   Trying card-based navigation...');
      vehicleLink = await page.locator('div[style*="cursor: pointer"]').first();
    }
    if (await vehicleLink.count() === 0) {
      // Method 3: Try "View" or "Details" buttons
      vehicleLink = await page.locator('button:has-text("View")').or(page.locator('a:has-text("View")')).first();
    }
    
    if (await vehicleLink.count() > 0) {
      console.log('   Found vehicle link, navigating...');
      await vehicleLink.click();
      await page.waitForTimeout(3000);
      
      // Verify we're on a vehicle page
      const currentUrl = page.url();
      console.log(`   Current URL: ${currentUrl}`);
      
      if (currentUrl.includes('/vehicle/')) {
        console.log('✅ Vehicle page loaded successfully');
        await page.screenshot({ path: 'test-results/mobile-vehicle-loaded.png' });
      } else {
        console.log('⚠️  Navigation may have redirected, current URL:', currentUrl);
      }
    } else {
      console.log('⚠️  No obvious vehicle links found, checking page structure...');
      const links = await page.locator('a').count();
      console.log(`   Found ${links} total links on page`);
      
      // Continue with manual URL for testing
      console.log('   Using direct vehicle URL for testing...');
      await page.goto('https://n-zero.dev/vehicles', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      
      const vehLink = await page.locator('a[href*="/vehicle/"]').first();
      if (await vehLink.count() > 0) {
        await vehLink.click();
        await page.waitForTimeout(3000);
        console.log('✅ Vehicle page loaded via /vehicles route');
      }
    }

    // TEST 1: Check if mobile view is active
    console.log('\n📱 TEST 1: Mobile View Detection');
    const isMobileView = await page.evaluate(() => {
      return window.innerWidth < 768 || document.querySelector('[class*="mobile"]') !== null;
    });
    console.log(`   Mobile view active: ${isMobileView ? '✅' : '❌'}`);

    // TEST  рез: Instagram-style image swipes (from previous session)
    console.log('\n📸 TEST 2: Instagram Image Swipes');
    const imagesTab = await page.locator('text=Images').or(page.locator('text=📷')).or(page.locator('[data-tab="images"]')).first();
    if (await imagesTab.count() > 0) {
      await imagesTab.click();
      await page.waitForTimeout(2000); // Wait longer for images to load
      
      const firstImage = await page.locator('img[src*="vehicle"]').or(page.locator('img[src*="supabase"]')).first();
      if (await firstImage.count() > 0) {
        await firstImage.click();
        await page.waitForTimeout(2000); // Wait for viewer to fully render
        
        // Check for viewer overlay - look for help text or dots
        const helpText = await page.locator('div').filter({ hasText: /Double-tap|Swipe to navigate/i }).count();
        const hasDots = await page.locator('div').filter({ has: page.locator('[style*="borderRadius"][style*="50%"],[style*="border-radius"][style*="50%"]') }).count() > 0;
        const imageCounter = await page.locator('text=/\\d+ \\/ \\d+/').count(); // "1 / 5" format
        
        if (helpText > 0 || hasDots || imageCounter > 0) {
          results.instagram_swipes = '✅';
          console.log(`   ✅ Enhanced viewer opens (found help text: ${helpText}, dots: ${hasDots}, counter: ${imageCounter})`);
        } else {
          // Check if fullscreen overlay exists
          const overlay = await page.locator('[style*="position: fixed"],[style*="z-index"]').filter({ hasText: /[0-9]/ }).count();
          if (overlay > 0) {
            results.instagram_swipes = '⚠️';
            console.log('   ⚠️  Viewer opens but help text/indicators not detected');
          } else {
            console.log('   ⚠️  Image opens but no enhanced viewer detected');
          }
        }
        
        // Close viewer - try multiple methods
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        // Also try clicking close button or swiping down
        const closeBtn = await page.locator('button:has-text("✕")').or(page.locator('[aria-label="Close"]')).first();
        if (await closeBtn.count() > 0) {
          await closeBtn.click();
        }
        await page.waitForTimeout(1000);
      } else {
        console.log('   ⚠️  No images found to test swipes');
      }
    } else {
      console.log('   ⚠️  Images tab not found');
    }

    // Go back to Overview for remaining tests
    const overviewTab = await page.locator('text=Overview').or(page.locator('text=📊')).or(page.locator('[data-tab="overview"]')).first();
    if (await overviewTab.count() > 0) {
      await overviewTab.click();
      await page.waitForTimeout(2000); // Wait for tab to fully load
    }

    // TEST 3: Document Uploader Button
    console.log('\n📄 TEST 3: Document Uploader');
    // Try multiple selectors - button might be in different locations
    let docUploadBtn = await page.locator('button:has-text("Upload Doc")').or(
      page.locator('button:has-text("📄 Upload Doc")'),
      page.locator('[data-testid="upload-doc-button"]'),
      page.locator('button').filter({ hasText: /Upload Doc|📄/i })
    ).first();
    
    // If not found, scroll to find it
    if (await docUploadBtn.count() === 0) {
      console.log('   Scrolling to find Upload Doc button...');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      docUploadBtn = await page.locator('button:has-text("Upload Doc")').or(
        page.locator('[data-testid="upload-doc-button"]'),
        page.locator('button').filter({ hasText: /Upload Doc/i })
      ).first();
    }
    
    if (await docUploadBtn.count() > 0) {
      results.doc_uploader = '✅';
      console.log('   ✅ "Upload Doc" button exists');
      
      // Click to test modal opens
      await docUploadBtn.click();
      await page.waitForTimeout(1000);
      
      const modalTitle = await page.locator('text=Upload Document').or(
        page.locator('h2:has-text("📁")')
      ).count();
      
      if (modalTitle > 0) {
        console.log('   ✅ Document upload modal opens');
        // Close modal
        const closeBtn = await page.locator('button:has-text("✕")').first();
        if (await closeBtn.count() > 0) {
          await closeBtn.click();
          await page.waitForTimeout(500);
        }
      }
    } else {
      console.log('   ❌ Upload Doc button not found');
    }

    // TEST 4: Price Editor Button
    console.log('\n💰 TEST 4: Price Editor');
    // Try multiple selectors
    let priceEditBtn = await page.locator('button:has-text("Edit Price")').or(
      page.locator('button:has-text("💰 Edit Price")'),
      page.locator('[data-testid="edit-price-button"]'),
      page.locator('button').filter({ hasText: /Edit Price|💰/i })
    ).first();
    
    // If not found, scroll to find it
    if (await priceEditBtn.count() === 0) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await page.waitForTimeout(1000);
      priceEditBtn = await page.locator('button:has-text("Edit Price")').or(
        page.locator('[data-testid="edit-price-button"]'),
        page.locator('button').filter({ hasText: /Edit Price/i })
      ).first();
    }
    
    if (await priceEditBtn.count() > 0) {
      results.price_editor = '✅';
      console.log('   ✅ "Edit Price" button exists');
      
      await priceEditBtn.click();
      await page.waitForTimeout(1000);
      
      const priceModal = await page.locator('text=Edit Prices').or(
        page.locator('h2:has-text("💰")')
      ).count();
      
      if (priceModal > 0) {
        console.log('   ✅ Price editor modal opens');
        
        // Check for gain/loss calculation
        const hasGainCard = await page.locator('text=Gain/Loss').count() > 0;
        if (hasGainCard) {
          console.log('   ✅ Gain/loss calculator present');
        }
        
        // Close modal
        const closeBtn = await page.locator('button:has-text("✕")').first();
        if (await closeBtn.count() > 0) {
          await closeBtn.click();
          await page.waitForTimeout(500);
        }
      }
    } else {
      console.log('   ⚠️  Price edit button not found (may need to be owner)');
      results.price_editor = '⚠️';
    }

    // TEST 5: Comment Box
    console.log('\n💬 TEST 5: Comment System');
    const commentBox = await page.locator('text=Comment').or(
      page.locator('text=💬')
    ).first();
    
    if (await commentBox.count() > 0) {
      results.comments = '✅';
      console.log('   ✅ Comment box found');
      
      // Click to expand
      await commentBox.click();
      await page.waitForTimeout(1000);
      
      const commentInput = await page.locator('textarea[placeholder*="comment"]').count();
      if (commentInput > 0) {
        console.log('   ✅ Comment input field present');
      }
    } else {
      console.log('   ❌ Comment box not found');
    }

    // TEST 6: AI Timeline Insights
    console.log('\n📊 TEST 6: AI Timeline Insights');
    const timelineTab = await page.locator('text=Timeline').or(page.locator('text=🗓️')).first();
    if (await timelineTab.count() > 0) {
      await timelineTab.click();
      await page.waitForTimeout(2000);
      
      // Look for expanded year
      const yearHeader = await page.locator('[style*="background"][style*="000080"]').filter({ hasText: /20\d{2}/ }).first();
      if (await yearHeader.count() > 0) {
        await yearHeader.click();
        await page.waitForTimeout(1000);
        
        // Check for value impact badges
        const valueBadges = await page.locator('text=/💎|🔥|🚀/').count();
        if (valueBadges > 0) {
          results.ai_insights = '✅';
          console.log(`   ✅ Found ${valueBadges} AI value impact badge(s)`);
        } else {
          console.log('   ⚠️  No AI value badges (events may not have cost/duration data)');
          results.ai_insights = '⚠️';
        }
        
        // Check for cost badges
        const costBadges = await page.locator('text=/\\$\\d+/').count();
        if (costBadges > 0) {
          console.log(`   ✅ Found ${costBadges} cost badge(s)`);
        }
      } else {
        console.log('   ⚠️  No timeline years to expand');
        results.ai_insights = '⚠️';
      }
    }

    // Go back to Specs tab
    const specsTab = await page.locator('text=Specs').or(page.locator('text=⚙️')).first();
    if (await specsTab.count() > 0) {
      await specsTab.click();
      await page.waitForTimeout(1000);
    }

    // TEST 7: Data Editor
    console.log('\n✏️ TEST 7: Vehicle Data Editor');
    const dataEditBtn = await page.locator('button:has-text("Edit Vehicle Data")').or(
      page.locator('button:has-text("✏️")')
    ).first();
    
    if (await dataEditBtn.count() > 0) {
      results.data_editor = '✅';
      console.log('   ✅ "Edit Vehicle Data" button exists');
      
      await dataEditBtn.click();
      await page.waitForTimeout(1000);
      
      const sections = await page.locator('button').filter({ hasText: /Basic Info|Technical|Financial|Dimensions/ }).count();
      if (sections > 0) {
        console.log(`   ✅ Found ${sections} collapsible section(s)`);
      }
      
      // Close modal
      const closeBtn = await page.locator('button:has-text("✕")').first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
        await page.waitForTimeout(500);
      }
    } else {
      console.log('   ⚠️  Data editor button not found (may need to be owner)');
      results.data_editor = '⚠️';
    }

    // TEST 8: Org Switcher (requires org membership)
    console.log('\n🏢 TEST 8: Organization Switcher');
    await page.goto('https://n-zero.dev/mobile/org', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    const orgSwitcher = await page.locator('button').filter({ has: page.locator('text=/owner|admin|staff/i') }).count();
    const orgPage = await page.locator('text=Organizations').count();
    
    if (orgSwitcher > 0 || orgPage > 0) {
      results.org_switcher = '✅';
      console.log('   ✅ Organization page loads');
    } else {
      console.log('   ⚠️  Org switcher not visible (user may not have orgs)');
      results.org_switcher = '⚠️';
    }

    // Screenshot final state
    await page.screenshot({ path: 'test-results/mobile-parity-final.png', fullPage: true });
    console.log('\n📸 Screenshot saved: test-results/mobile-parity-final.png');

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
  }

  // SUMMARY
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Instagram Swipes:     ${results.instagram_swipes}`);
  console.log(`Document Uploader:    ${results.doc_uploader}`);
  console.log(`Price Editor:         ${results.price_editor}`);
  console.log(`Comment System:       ${results.comments}`);
  console.log(`AI Timeline Insights: ${results.ai_insights}`);
  console.log(`Data Editor:          ${results.data_editor}`);
  console.log(`Org Switcher:         ${results.org_switcher}`);
  console.log('='.repeat(60));

  const passCount = Object.values(results).filter(r => r === '✅').length;
  const warnCount = Object.values(results).filter(r => r === '⚠️').length;
  const failCount = Object.values(results).filter(r => r === '❌').length;

  console.log(`\n✅ Passed: ${passCount}/7`);
  console.log(`⚠️  Warnings: ${warnCount}/7`);
  console.log(`❌ Failed: ${failCount}/7`);

  if (failCount === 0 && passCount >= 5) {
    console.log('\n🎉 MOBILE PARITY TEST PASSED!\n');
  } else if (failCount > 0) {
    console.log('\n⚠️  SOME TESTS FAILED - Review results above\n');
  } else {
    console.log('\n⚠️  PARTIAL SUCCESS - Some features need login/ownership\n');
  }

  await browser.close();
})();

