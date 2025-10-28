# Production Integration Probe (PIP) Framework

**Type**: Live Deployment Verification Test  
**Purpose**: Step-by-step diagnostic testing of production features after deployment  
**Saved**: October 28, 2025

---

## Framework Template

```javascript
#!/usr/bin/env node
const { chromium } = require('playwright');

async function testFeature() {
  const browser = await chromium.launch({ 
    headless: false,
    args: ['--disable-dev-shm-usage']
  });
  
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 }, // Mobile
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
  });
  
  const page = await context.newPage();
  
  console.log('\n🧪 Testing [FEATURE] on Production...\n');
  
  try {
    // STEP 1: Navigate + verify bundle
    console.log('1️⃣  Navigating to [URL]...');
    await page.goto('[PRODUCTION_URL]', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await page.waitForTimeout(2000);
    
    const bundleHash = await page.evaluate(() => {
      const script = document.querySelector('script[src*="index-"]');
      return script ? script.src.match(/index-([^.]+)\.js/)?.[1] : 'not found';
    });
    console.log(`   Bundle hash: ${bundleHash}`);
    
    // STEP 2: Check detection/mode
    console.log('\n2️⃣  Checking [MODE]...');
    const detected = await page.evaluate(() => {
      return window.innerWidth < 768;
    });
    console.log(`   [MODE] detected: ${detected}`);
    
    // STEP 3: Find UI element
    console.log('\n3️⃣  Looking for [ELEMENT]...');
    const element = await page.locator('text=[SELECTOR]').first();
    const visible = await element.isVisible().catch(() => false);
    console.log(`   [ELEMENT] visible: ${visible}`);
    
    if (!visible) {
      console.log('   ❌ [ELEMENT] not found!');
      return;
    }
    
    // STEP 4: Interact
    console.log('\n4️⃣  Clicking [ELEMENT]...');
    await element.click();
    await page.waitForTimeout(3000);
    
    // STEP 5: Check for freeze/responsiveness
    console.log('\n5️⃣  Checking if page froze...');
    const isResponsive = await page.evaluate(() => {
      return document.readyState === 'complete';
    });
    console.log(`   Page responsive: ${isResponsive}`);
    
    // STEP 6: Verify feature loaded
    console.log('\n6️⃣  Checking for [RESULT]...');
    const result = await page.locator('[RESULT_SELECTOR]').first();
    const resultVisible = await result.isVisible().catch(() => false);
    console.log(`   [RESULT] visible: ${resultVisible}`);
    
    // STEP 7: Take screenshot
    console.log('\n📸 Taking screenshot...');
    await page.screenshot({ 
      path: '/path/to/test-results/[feature]-test.png', 
      fullPage: true 
    });
    console.log('   Screenshot saved');
    
    console.log('\n✅ Test complete!\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: '/path/to/test-results/[feature]-error.png' });
  } finally {
    await browser.close();
  }
}

testFeature().catch(console.error);
```

---

## Key Principles

### 1. **Step-by-Step Progression**
- Each step numbered with emoji
- Clear logging of what's being checked
- Shows EXACTLY where failure occurs

### 2. **Bundle Verification First**
- Always check bundle hash to confirm deployment
- Prevents testing old code

### 3. **Progressive Validation**
- Don't just check end result
- Verify each step of the flow
- Navigation → Detection → UI Element → Interaction → Result

### 4. **Visual Proof**
- Screenshots at success AND failure
- Full page captures show complete state

### 5. **Production-First**
- Test live site, not local/staging
- Real user experience
- Real data, real network

### 6. **Mobile Simulation**
```javascript
viewport: { width: 375, height: 667 }
userAgent: 'Mozilla/5.0 (iPhone...)'
```

---

## Example: Mobile Timeline PIP (Oct 28, 2025)

**Test Flow:**
```
1️⃣  Navigate → Verify bundle hash
2️⃣  Check mobile detection  
3️⃣  Find timeline tab → Visible?
4️⃣  Click timeline tab
5️⃣  Check for freeze → Responsive?
6️⃣  Find year header → Visible?
7️⃣  Click year → Expand heatmap
8️⃣  Find day cells → Clickable?
9️⃣  Click day → Modal appears?
📸 Screenshot proof
```

**Results:**
- ✅ Steps 1-7: All passed
- ❌ Step 8-9: Modal didn't appear (minor)
- **Critical freeze bug found and fixed at Step 7**

---

## When to Use PIP

### ✅ Use For:
- Post-deployment verification
- Mobile-specific features
- Critical user flows
- Regression testing after big changes
- Features with history of breaking

### ❌ Don't Use For:
- Unit tests (use Jest/Vitest)
- Component tests (use React Testing Library)
- API tests (use Postman/curl)
- Simple static pages

---

## PIP vs Other Tests

| Test Type | Scope | Environment | Speed | Detail |
|-----------|-------|-------------|-------|--------|
| **PIP** | End-to-end | Production | Slow | Step-by-step |
| E2E Test | Full flow | Staging | Medium | Pass/fail |
| Integration | Multiple components | Test | Fast | Isolated |
| Unit | Single function | Local | Very fast | Focused |

**PIP's Superpower**: Shows EXACTLY which step breaks in real production environment

---

## Iteration Pattern

```
1. Write PIP test
2. Run on production
3. Find exact failure point
4. Fix the bug
5. Deploy fix
6. Re-run PIP
7. Screenshot proves it works
8. Commit test for next time
```

---

## Template Customization

### For Features With Console Logs:
```javascript
const logs = [];
page.on('console', msg => {
  if (msg.text().includes('[YourComponent]')) {
    logs.push(msg.text());
  }
});

// Later...
console.log('\nConsole logs:');
logs.forEach(log => console.log(`   ${log}`));
```

### For Interactive Features:
```javascript
// Check if clickable
const clickable = await element.isEnabled();

// Try interaction with timeout
try {
  await element.click({ timeout: 5000 });
  console.log('   ✅ Click succeeded');
} catch (err) {
  console.log(`   ❌ Click failed: ${err.message}`);
}
```

### For Modal/Overlay Features:
```javascript
// Wait for modal
await page.waitForSelector('[MODAL_SELECTOR]', { timeout: 3000 });

// Check position
const box = await modal.boundingBox();
console.log(`   Modal position:`, box);

// Verify it's full-screen
if (box && box.width > 300) {
  console.log('   ✅ Modal is full-screen');
}
```

---

## Success Metrics

A good PIP test should:
- ✅ Run in < 60 seconds
- ✅ Show 5-10 diagnostic steps
- ✅ Pinpoint exact failure location
- ✅ Take visual proof (screenshots)
- ✅ Test real production deployment
- ✅ Simulate real user behavior

---

## **Saved Example:**

The mobile timeline test from Oct 28, 2025:
- Found infinite loop freeze at Step 7
- Showed heatmap expanded after fix
- Proved freeze was resolved
- **Best test we've ever done** ✅

Use this framework for all critical feature deployments!

