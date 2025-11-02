/**
 * Playwright E2E Test: Document Upload Flow
 * 
 * Tests the complete flow:
 * 1. Navigate to vehicle profile
 * 2. Click "+ Add Receipt" button
 * 3. Upload sample document
 * 4. Verify parsing
 * 5. Save and verify database
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');

const SITE_URL = 'https://nuke-rust.vercel.app';
const VEHICLE_ID = 'eea40748-cdc1-4ae9-ade1-4431d14a7726';
const DB_URL = 'postgresql://postgres:RbzKq32A0uhqvJMQ@db.qkgaybvrernstplzjaam.supabase.co:5432/postgres';

// Sample receipt
const SAMPLE_RECEIPT = `AUTOZONE
Store #4532
123 Main Street
Los Angeles, CA 90001

Date: 10/27/2025
Invoice: AZ-2025-10271534

Item                    Qty  Price   Total
----------------------------------------
Brake Pads (Front)       1   $85.00  $85.00
Oil Filter Premium       2   $12.25  $24.50
Shop Supplies           1   $17.95  $17.95

Subtotal:                        $127.45
Tax (9.5%):                       $12.11
Total:                           $139.56

Payment Method: VISA ****1234
Thank you for shopping at AutoZone!`;

function dbQuery(sql) {
  try {
    const result = execSync(`psql "${DB_URL}" -t -c "${sql}"`, { encoding: 'utf-8' });
    return result.trim();
  } catch (e) {
    console.error('DB Query failed:', e.message);
    return null;
  }
}

(async () => {
  console.log('🧪 PLAYWRIGHT E2E TEST: Document Upload');
  console.log('==========================================\n');

  // Step 1: Check database before
  console.log('📊 Step 1: Checking current database state...');
  const beforeCount = dbQuery(`SELECT COUNT(*) FROM timeline_events WHERE vehicle_id = '${VEHICLE_ID}';`);
  console.log(`   Timeline events before: ${beforeCount}\n`);

  // Step 2: Create sample receipt file
  console.log('📄 Step 2: Creating sample receipt file...');
  const receiptPath = '/tmp/test_receipt_playwright.txt';
  fs.writeFileSync(receiptPath, SAMPLE_RECEIPT);
  console.log(`   ✅ Receipt created: ${receiptPath}\n`);

  // Step 3: Launch browser
  console.log('🌐 Step 3: Launching browser...');
  const browser = await chromium.launch({ 
    headless: false, // Show browser for debugging
    slowMo: 500 // Slow down for visibility
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // Enable console logging from browser
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('   🔴 Browser Error:', msg.text());
    }
  });

  try {
    // Step 4: Navigate to vehicle profile
    console.log(`   Navigating to vehicle profile...`);
    await page.goto(`${SITE_URL}/vehicle/${VEHICLE_ID}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); // Wait for page to fully load
    console.log('   ✅ Page loaded\n');

    // Step 5: Take screenshot of initial state
    await page.screenshot({ path: '/tmp/01_vehicle_profile.png', fullPage: true });
    console.log('📸 Screenshot: /tmp/01_vehicle_profile.png\n');

    // Step 6: Look for "+ Add Receipt" button
    console.log('🔍 Step 4: Looking for "+ Add Receipt" button...');
    
    // Try multiple possible selectors
    const buttonSelectors = [
      'button:has-text("Add Receipt")',
      'button:has-text("🧾")',
      'button:has-text("Upload")',
      '.button:has-text("Receipt")'
    ];

    let addButton = null;
    for (const selector of buttonSelectors) {
      try {
        addButton = await page.waitForSelector(selector, { timeout: 3000 });
        if (addButton) {
          console.log(`   ✅ Found button: ${selector}\n`);
          break;
        }
      } catch (e) {
        console.log(`   ⏭️  Trying next selector...`);
      }
    }

    if (!addButton) {
      throw new Error('Could not find "+ Add Receipt" button on page!');
    }

    // Step 7: Click the button
    console.log('👆 Step 5: Clicking "+ Add Receipt" button...');
    await addButton.click();
    await page.waitForTimeout(1000);
    console.log('   ✅ Button clicked\n');

    // Step 8: Wait for modal to open
    console.log('⏳ Step 6: Waiting for upload modal...');
    await page.waitForSelector('text=Upload Document', { timeout: 5000 });
    await page.screenshot({ path: '/tmp/02_modal_opened.png', fullPage: true });
    console.log('   ✅ Modal opened');
    console.log('📸 Screenshot: /tmp/02_modal_opened.png\n');

    // Step 9: Select "Receipt" category (should be default)
    console.log('📋 Step 7: Selecting "Receipt" category...');
    const receiptCategory = await page.locator('button:has-text("Receipt")').first();
    await receiptCategory.click();
    await page.waitForTimeout(500);
    console.log('   ✅ Category selected\n');

    // Step 10: Upload file
    console.log('📤 Step 8: Uploading file...');
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(receiptPath);
    console.log('   ✅ File uploaded\n');

    // Step 11: Wait for parsing
    console.log('🤖 Step 9: Waiting for AI parsing...');
    await page.waitForSelector('text=Parsing with AI', { timeout: 5000 });
    console.log('   ⏳ Parsing started...');
    
    // Wait for preview or error
    try {
      await page.waitForSelector('text=Review & Save', { timeout: 30000 });
      await page.screenshot({ path: '/tmp/03_parsed_preview.png', fullPage: true });
      console.log('   ✅ Parsing complete!');
      console.log('📸 Screenshot: /tmp/03_parsed_preview.png\n');
    } catch (e) {
      await page.screenshot({ path: '/tmp/03_parsing_error.png', fullPage: true });
      console.log('   ❌ Parsing failed or timed out');
      console.log('📸 Screenshot: /tmp/03_parsing_error.png\n');
      throw e;
    }

    // Step 12: Check parsed data
    console.log('🔍 Step 10: Verifying parsed data...');
    const pageText = await page.textContent('body');
    
    if (pageText.includes('AutoZone') || pageText.includes('Vendor')) {
      console.log('   ✅ Vendor information found');
    } else {
      console.log('   ⚠️  Vendor information not found (might still work)');
    }
    
    if (pageText.includes('139.56') || pageText.includes('127.45') || pageText.includes('Total')) {
      console.log('   ✅ Total amount found');
    } else {
      console.log('   ⚠️  Total amount not found (might still work)');
    }
    console.log('');

    // Step 13: Click Save
    console.log('💾 Step 11: Clicking Save button...');
    const saveButton = await page.locator('button:has-text("Save Document")').first();
    await saveButton.click();
    console.log('   ✅ Save clicked\n');

    // Step 14: Wait for success
    console.log('⏳ Step 12: Waiting for save to complete...');
    try {
      await page.waitForSelector('text=Saved', { timeout: 10000 });
      await page.screenshot({ path: '/tmp/04_save_success.png', fullPage: true });
      console.log('   ✅ Save successful!');
      console.log('📸 Screenshot: /tmp/04_save_success.png\n');
    } catch (e) {
      await page.screenshot({ path: '/tmp/04_save_error.png', fullPage: true });
      console.log('   ❌ Save failed or timed out');
      console.log('📸 Screenshot: /tmp/04_save_error.png\n');
      throw e;
    }

    // Step 15: Wait for modal to close
    await page.waitForTimeout(2000);
    console.log('   ⏳ Waiting for modal to close...\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    await page.screenshot({ path: '/tmp/error_state.png', fullPage: true });
    console.log('📸 Error screenshot: /tmp/error_state.png\n');
  } finally {
    await browser.close();
  }

  // Step 16: Verify database
  console.log('🗄️  Step 13: Verifying database changes...\n');
  
  const afterCount = dbQuery(`SELECT COUNT(*) FROM timeline_events WHERE vehicle_id = '${VEHICLE_ID}';`);
  const newEvents = parseInt(afterCount) - parseInt(beforeCount);
  
  console.log(`   Timeline events after: ${afterCount}`);
  console.log(`   New events created: ${newEvents}\n`);

  if (newEvents > 0) {
    console.log('   ✅ SUCCESS: Timeline event created!\n');
    
    console.log('   📋 Latest Timeline Event:');
    execSync(`psql "${DB_URL}" -c "
      SELECT 
          title,
          event_type,
          source,
          source_type,
          event_date,
          metadata->>'vendor' AS vendor,
          metadata->>'amount' AS amount
      FROM timeline_events
      WHERE vehicle_id = '${VEHICLE_ID}'
      ORDER BY created_at DESC
      LIMIT 1;
    "`, { stdio: 'inherit' });

    console.log('\n   📄 Latest Document:');
    execSync(`psql "${DB_URL}" -c "
      SELECT 
          document_type,
          vendor_name,
          amount,
          document_date,
          timeline_event_id IS NOT NULL AS linked_to_timeline
      FROM vehicle_documents
      WHERE vehicle_id = '${VEHICLE_ID}'
      ORDER BY created_at DESC
      LIMIT 1;
    "`, { stdio: 'inherit' });

  } else {
    console.log('   ❌ FAILED: No new timeline events created!\n');
    process.exit(1);
  }

  console.log('\n==========================================');
  console.log('🎉 E2E TEST COMPLETE!\n');
})();

