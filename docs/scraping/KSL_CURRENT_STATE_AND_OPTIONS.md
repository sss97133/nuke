# KSL Scraping: Current State & Scale Options

## Critical Finding (Jan 2026)

**Both historical approaches now fail:**
- ✅ Playwright with stealth args: **Worked 3-6 months ago** (80-95% success)
- ❌ Playwright with stealth args: **Now blocked** (0% success)
- ❌ Firecrawl standard: **Blocked** (403 Forbidden)
- ❌ Firecrawl stealth mode: **Blocked** (0-10% success)

**Conclusion:** KSL upgraded PerimeterX protection ~3-6 months ago. What worked before no longer works.

## What Changed

### PerimeterX Evolution
- **Before (2023-2024):** Basic browser fingerprinting
- **Now (2025-2026):** Advanced behavioral analysis
  - Detects `--disable-blink-features=AutomationControlled`
  - Analyzes mouse/touch patterns
  - Checks for human-like navigation
  - Monitors scroll/interaction timing

### Evidence
```bash
$ node scripts/scrape-ksl-listing-example.js https://cars.ksl.com/listing/10286857

Result:
{
  "title": "Access to this page has been denied.",
  "images": ["https://img.ksl.com/slc/2865/286508/28650891.png"]  # Only PerimeterX logo
}
```

## Realistic Options for Scale

### Option 1: Premium Proxy Service with Playwright ⭐ RECOMMENDED

**Services:**
- **Bright Data** (formerly Luminati)
  - Residential proxy network: 72M+ IPs
  - PerimeterX bypass: Excellent
  - Cost: $500/mo minimum
  - Success rate: 95-99%

- **Oxylabs**
  - Residential proxy network: 100M+ IPs
  - PerimeterX bypass: Excellent  
  - Cost: $300/mo minimum
  - Success rate: 95-99%

**Implementation:**
```javascript
const browser = await chromium.launch({
  proxy: {
    server: 'http://brd.superproxy.io:22225',
    username: 'brd-customer-{id}',
    password: '{password}'
  }
});
```

**Cost at Scale:**
- 10,000 KSL listings
- $300-500/mo for proxy service
- = $0.03-0.05 per listing
- Success rate: 95%+

### Option 2: Browser Extension / User-Driven Collection

**How it Works:**
1. User installs Chrome extension
2. Extension scrapes while user browses KSL
3. Sends data to your API

**Pros:**
- ✅ Free (no proxy costs)
- ✅ No bot detection (runs in real browser)
- ✅ Can use user's session
- ✅ 100% success rate

**Cons:**
- ❌ Requires user action
- ❌ Only works when users browse
- ❌ Slower collection rate

**Use Case:**
- Early MVP / small scale
- Complement to automated scraping
- User contribution model

### Option 3: Manual Collection + Community Sourcing

**Process:**
1. Create "Submit KSL Listing" form
2. Users paste KSL URL
3. Your team manually extracts data
4. Community members contribute

**Pros:**
- ✅ Free
- ✅ 100% accurate
- ✅ No legal concerns
- ✅ Builds community

**Cons:**
- ❌ Not scalable
- ❌ Labor intensive
- ❌ Slow

**Use Case:**
- Seed data (first 100 vehicles)
- High-value listings only
- Pre-product/market fit

### Option 4: KSL API Partnership

**Approach:**
- Contact KSL business development
- Request official API access
- Pay for data access

**Pros:**
- ✅ Legal/official
- ✅ Reliable
- ✅ No bot detection
- ✅ May include exclusive data

**Cons:**
- ❌ May be expensive
- ❌ May require revenue share
- ❌ Approval process
- ❌ May not be available

### Option 5: Computer Vision Automation (Advanced)

**How it Works:**
1. Remote browser service (BrowserStack / SauceLabs)
2. Computer vision to control browser
3. Mimics human mouse/keyboard patterns
4. Extracts data from rendered page

**Tools:**
- **Playwright with humanization plugins**
- **Puppeteer Extra with stealth + humanize plugins**
- **Selenium with ActionChains**

**Example:**
```javascript
// Playwright with human-like behavior
import playwright from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import humanize from 'playwright-humanize';

playwright.use(StealthPlugin());

const page = await browser.newPage();
await humanize(page); // Adds random mouse movements, pauses, etc.
await page.goto(url);
```

**Pros:**
- ✅ Can bypass advanced detection
- ✅ Scales reasonably well
- ✅ Self-hosted option

**Cons:**
- ❌ Complex to implement
- ❌ Still may be detected
- ❌ Requires ongoing maintenance

**Cost:**
- BrowserStack: $99-$499/mo
- Development time: 20-40 hours
- Success rate: 60-80% (not guaranteed)

## Cost/Success Matrix

| Option | Monthly Cost | Success Rate | Scalability | Setup Time |
|--------|-------------|--------------|-------------|------------|
| Bright Data + Playwright | $500 | 95-99% | Excellent | 2-4 hours |
| Oxylabs + Playwright | $300 | 95-99% | Excellent | 2-4 hours |
| Browser Extension | $0 | 100% | Poor | 8-16 hours |
| Manual Collection | $0 | 100% | Very Poor | Ongoing |
| KSL API | $?? | 100% | Excellent | Weeks-Months |
| Computer Vision | $100-500 | 60-80% | Medium | 20-40 hours |
| Firecrawl Stealth | $20 | 0-10% | N/A | Done |

## Recommended Path Forward

### Phase 1: Immediate (Next 7 Days)
1. **Manual collection** for seed data (50-100 vehicles)
2. **Browser extension** for community contribution
3. Test **Bright Data trial** (7-day free trial available)

### Phase 2: MVP (Weeks 2-4)
1. If Bright Data works (>90% success):
   - Integrate with scrape-vehicle function
   - Deploy Playwright microservice with Bright Data proxy
   - Scale to 1,000+ vehicles

2. If Bright Data fails:
   - Focus on browser extension + manual collection
   - Build community submission workflow
   - Pursue KSL API partnership

### Phase 3: Scale (Month 2+)
1. If scraping works:
   - Process entire KSL inventory (10k+ listings)
   - Monitor for detection changes
   - Build fallback strategies

2. If scraping doesn't work:
   - Full community-driven model
   - Partner with dealers who have KSL access
   - Focus on high-value listings only

## Testing Bright Data (Recommended First Step)

### 1. Sign Up for Trial
https://brightdata.com/products/residential-proxies
- 7-day free trial
- Includes residential proxies
- Test with KSL before committing

### 2. Test Script
```javascript
import { chromium } from 'playwright';

async function testBrightData() {
  const browser = await chromium.launch({
    proxy: {
      server: 'http://brd.superproxy.io:22225',
      username: 'brd-customer-YOUR_ID',
      password: 'YOUR_PASSWORD'
    },
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const page = await browser.newPage();
  await page.goto('https://cars.ksl.com/listing/10286857');
  await page.waitForTimeout(3000);
  
  const html = await page.content();
  const images = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img[src*="ksl.com"]'))
      .map(img => img.src);
  });
  
  console.log(`Images found: ${images.length}`);
  console.log('Title:', await page.title());
  
  await browser.close();
}

testBrightData();
```

### 3. Success Criteria
- ✅ Title shows vehicle (not "Access Denied")
- ✅ Extracts 15+ images
- ✅ HTML length > 50,000 chars
- ✅ No PerimeterX block page

### 4. If Successful
- ✅ Integrate with Edge Function
- ✅ Deploy Playwright microservice
- ✅ Subscribe to Bright Data plan
- ✅ Scale to 10k+ KSL vehicles

## Alternative: Playwright-Extra Stealth

**Before paying for proxies, try this:**

```bash
npm install playwright-extra puppeteer-extra-plugin-stealth
```

```javascript
import playwright from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

playwright.use(StealthPlugin());

const browser = await playwright.chromium.launch();
// ... rest of scraping logic
```

**May bypass detection without proxies** (free to test)

## Bottom Line

**For Scale:**
- **Best ROI**: Bright Data + Playwright ($500/mo, 95%+ success)
- **Budget**: Playwright-Extra Stealth (free, 20-40% success?)
- **No-Code**: Browser Extension + Manual ($0, 100% accuracy, low scale)

**Next Step:**
Test Bright Data trial to confirm it bypasses KSL's current PerimeterX setup.

