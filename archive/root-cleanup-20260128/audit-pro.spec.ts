import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'https://n-zero.dev';

interface AuditFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: string;
  issue: string;
  location: string;
  recommendation?: string;
}

const findings: AuditFinding[] = [];

function log(finding: AuditFinding) {
  findings.push(finding);
  const emoji = {
    CRITICAL: '🔴',
    HIGH: '🟠',
    MEDIUM: '🟡',
    LOW: '🔵',
    INFO: '⚪'
  }[finding.severity];
  console.log(`${emoji} [${finding.severity}] ${finding.category}: ${finding.issue}`);
  console.log(`   Location: ${finding.location}`);
  if (finding.recommendation) {
    console.log(`   Fix: ${finding.recommendation}`);
  }
}

test.describe('Goldman Sachs Style Platform Audit', () => {
  test.setTimeout(600000); // 10 minutes

  test('COMPREHENSIVE PRODUCT AUDIT', async ({ page, request }) => {
    console.log('\n' + '='.repeat(70));
    console.log('🏦 INSTITUTIONAL PRODUCT AUDIT - N-ZERO PLATFORM');
    console.log('Evaluator: Automated QA (Goldman Standards)');
    console.log('Date: ' + new Date().toISOString());
    console.log('='.repeat(70) + '\n');

    // =========================================
    // SECTION 1: FIRST IMPRESSIONS & BRANDING
    // =========================================
    console.log('\n📋 SECTION 1: FIRST IMPRESSIONS & BRANDING\n');

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'audit/01-homepage.png', fullPage: true });

    // Check branding
    const hasLogo = await page.locator('text=n-zero').first().isVisible().catch(() => false);
    if (!hasLogo) {
      log({ severity: 'MEDIUM', category: 'Branding', issue: 'Logo/brand not immediately visible', location: 'Homepage header' });
    }

    // Check for professional footer
    const footer = await page.locator('footer').first().isVisible().catch(() => false);
    const hasLegalLinks = await page.locator('text=Privacy Policy').isVisible().catch(() => false);
    const hasTerms = await page.locator('text=Terms').isVisible().catch(() => false);

    if (!hasLegalLinks || !hasTerms) {
      log({ severity: 'HIGH', category: 'Compliance', issue: 'Missing legal links (Privacy Policy, Terms of Service)', location: 'Footer', recommendation: 'Add standard legal links for financial platform' });
    }

    // =========================================
    // SECTION 2: NAVIGATION & INFORMATION ARCHITECTURE
    // =========================================
    console.log('\n📋 SECTION 2: NAVIGATION & INFORMATION ARCHITECTURE\n');

    // Check main navigation
    const navLinks = await page.locator('nav a, header a').count();
    console.log(`   Found ${navLinks} navigation links`);

    // Test search functionality
    const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="VIN" i]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('1979 Chevrolet');
      await page.waitForTimeout(1000);
      await page.screenshot({ path: 'audit/02-search-test.png' });
      console.log('   ✓ Search input functional');
    }

    // =========================================
    // SECTION 3: MARKET DASHBOARD AUDIT
    // =========================================
    console.log('\n📋 SECTION 3: MARKET DASHBOARD AUDIT\n');

    await page.goto(`${BASE_URL}/market/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'audit/03-market-dashboard.png', fullPage: true });

    // Check for key metrics
    const metrics = ['Total Segments', 'Total Vehicles', 'Market Cap', 'ETF AUM'];
    for (const metric of metrics) {
      const found = await page.locator(`text=${metric}`).isVisible().catch(() => false);
      if (found) {
        console.log(`   ✓ ${metric} displayed`);
      } else {
        log({ severity: 'MEDIUM', category: 'Data Display', issue: `Missing metric: ${metric}`, location: '/market/dashboard' });
      }
    }

    // Check for actual data values (not just labels)
    const marketCap = await page.locator('text=/\\$[0-9,]+/').first().textContent().catch(() => null);
    if (marketCap) {
      console.log(`   Market Cap Value: ${marketCap}`);
    }

    // Check submarkets
    const submarkets = await page.locator('text=/ETF:.*@/').count();
    console.log(`   Found ${submarkets} submarkets with ETF tickers`);

    // Click into a submarket
    const trukMarket = page.locator('text=Truck Market').first();
    if (await trukMarket.isVisible()) {
      await trukMarket.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'audit/04-submarket-detail.png', fullPage: true });

      // Check if detail view loaded
      const detailContent = await page.content();
      if (detailContent.includes('Error') || detailContent.includes('not found')) {
        log({ severity: 'HIGH', category: 'Navigation', issue: 'Submarket click leads to error', location: '/market/dashboard -> Truck Market' });
      }
    }

    // =========================================
    // SECTION 4: INVESTMENT PLATFORM AUDIT
    // =========================================
    console.log('\n📋 SECTION 4: INVESTMENT PLATFORM AUDIT\n');

    await page.goto(`${BASE_URL}/invest`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'audit/05-invest-platform.png', fullPage: true });

    // Check demo mode indicators
    const demoIndicator = await page.locator('text=DEMO').first().isVisible().catch(() => false);
    const paperTrading = await page.locator('text=/paper trading/i').first().isVisible().catch(() => false);

    if (demoIndicator || paperTrading) {
      console.log('   ✓ Demo/Paper Trading mode clearly indicated');
    } else {
      log({ severity: 'CRITICAL', category: 'Compliance', issue: 'Demo mode not clearly indicated on investment page', location: '/invest', recommendation: 'Must clearly show this is paper trading to avoid regulatory issues' });
    }

    // Check tabs functionality
    const tabs = ['Market Indexes', 'My Holdings', 'Transaction History'];
    for (const tab of tabs) {
      const tabEl = page.locator(`text=${tab}`).first();
      if (await tabEl.isVisible()) {
        await tabEl.click();
        await page.waitForTimeout(500);
        console.log(`   ✓ Tab "${tab}" clickable`);
      }
    }

    // =========================================
    // SECTION 5: MARKET EXCHANGE AUDIT
    // =========================================
    console.log('\n📋 SECTION 5: MARKET EXCHANGE AUDIT\n');

    await page.goto(`${BASE_URL}/market/exchange`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'audit/06-exchange.png', fullPage: true });

    // Check ETF cards
    const etfTickers = ['PORS', 'SQBD', 'TRUK', 'Y79'];
    for (const ticker of etfTickers) {
      const found = await page.locator(`text=${ticker}`).isVisible().catch(() => false);
      if (found) {
        console.log(`   ✓ ETF ${ticker} displayed`);
      }
    }

    // Check NAV values
    const navValues = await page.locator('text=/NAV.*[0-9]/').count();
    console.log(`   Found ${navValues} NAV displays`);

    // Check for 7d performance
    const perfIndicators = await page.locator('text=/[+-]?[0-9.]+%/').count();
    console.log(`   Found ${perfIndicators} performance indicators`);

    // =========================================
    // SECTION 6: DATA INTEGRITY CHECKS
    // =========================================
    console.log('\n📋 SECTION 6: DATA INTEGRITY CHECKS\n');

    // Check API responses
    const platformStatus = await request.get('https://qkgaybvrernstplzjaam.supabase.co/functions/v1/platform-status');
    const statusData = await platformStatus.json();

    if (statusData.demo_mode?.enabled !== true) {
      log({ severity: 'CRITICAL', category: 'Configuration', issue: 'Platform not in demo mode', location: 'platform-status API', recommendation: 'Ensure demo_mode.enabled = true before any public access' });
    } else {
      console.log('   ✓ Demo mode confirmed enabled');
    }

    // Check DB stats
    const dbStats = await request.get('https://qkgaybvrernstplzjaam.supabase.co/functions/v1/db-stats');
    if (dbStats.ok()) {
      const stats = await dbStats.json();
      console.log(`   ✓ Database accessible`);
      console.log(`   Total vehicles: ${stats.total_vehicles || 'N/A'}`);
      console.log(`   Total comments: ${stats.total_comments || 'N/A'}`);
    } else {
      log({ severity: 'HIGH', category: 'Infrastructure', issue: 'DB stats endpoint not responding', location: 'db-stats API' });
    }

    // =========================================
    // SECTION 7: AUTHENTICATION FLOWS
    // =========================================
    console.log('\n📋 SECTION 7: AUTHENTICATION FLOWS\n');

    await page.goto(`${BASE_URL}/market/portfolio`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'audit/07-auth-required.png', fullPage: true });

    // Should redirect to login
    const hasLoginForm = await page.locator('input[type="email"], input[type="password"], text=/sign in/i, text=/login/i').first().isVisible().catch(() => false);
    if (hasLoginForm) {
      console.log('   ✓ Protected routes redirect to login');
    } else {
      log({ severity: 'HIGH', category: 'Security', issue: 'Portfolio page accessible without auth', location: '/market/portfolio' });
    }

    // Check OAuth options
    const googleAuth = await page.locator('text=/Google/i').isVisible().catch(() => false);
    const githubAuth = await page.locator('text=/GitHub/i').isVisible().catch(() => false);
    console.log(`   OAuth providers: Google=${googleAuth}, GitHub=${githubAuth}`);

    // =========================================
    // SECTION 8: ERROR HANDLING
    // =========================================
    console.log('\n📋 SECTION 8: ERROR HANDLING\n');

    // Test 404 page
    await page.goto(`${BASE_URL}/nonexistent-page-12345`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'audit/08-404-page.png' });

    const has404 = await page.locator('text=/not found/i, text=/404/i').first().isVisible().catch(() => false);
    if (has404) {
      console.log('   ✓ 404 page displays properly');
    } else {
      log({ severity: 'MEDIUM', category: 'UX', issue: 'No proper 404 error page', location: '/nonexistent-page', recommendation: 'Add user-friendly 404 page' });
    }

    // Test invalid vehicle ID
    await page.goto(`${BASE_URL}/vehicles/invalid-uuid-here`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'audit/09-invalid-vehicle.png' });

    // =========================================
    // SECTION 9: MARKET INTELLIGENCE
    // =========================================
    console.log('\n📋 SECTION 9: MARKET INTELLIGENCE AGENT\n');

    await page.goto(`${BASE_URL}/market-intelligence`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'audit/10-market-intel.png', fullPage: true });

    // Check for example queries
    const exampleQueries = await page.locator('button:has-text("What is a")').count();
    console.log(`   Found ${exampleQueries} example query buttons`);

    // Check input field
    const chatInput = page.locator('input[placeholder*="valuation" i], input[placeholder*="Ask" i]').first();
    if (await chatInput.isVisible()) {
      console.log('   ✓ Chat input available');
    }

    // =========================================
    // SECTION 10: MOBILE RESPONSIVENESS
    // =========================================
    console.log('\n📋 SECTION 10: MOBILE RESPONSIVENESS\n');

    await page.setViewportSize({ width: 375, height: 812 }); // iPhone X
    await page.goto(`${BASE_URL}/market/dashboard`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'audit/11-mobile-dashboard.png', fullPage: true });

    // Check if content is readable
    const mobileContent = await page.locator('body').isVisible();
    console.log(`   Mobile viewport renders: ${mobileContent}`);

    // Check for horizontal scroll (bad)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = 375;
    if (bodyWidth > viewportWidth + 10) {
      log({ severity: 'MEDIUM', category: 'Mobile UX', issue: `Horizontal scroll detected (${bodyWidth}px > ${viewportWidth}px)`, location: '/market/dashboard on mobile' });
    } else {
      console.log('   ✓ No horizontal scroll on mobile');
    }

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 });

    // =========================================
    // SECTION 11: PERFORMANCE AUDIT
    // =========================================
    console.log('\n📋 SECTION 11: PERFORMANCE AUDIT\n');

    const perfPages = [
      { path: '/', name: 'Homepage' },
      { path: '/market/dashboard', name: 'Dashboard' },
      { path: '/invest', name: 'Invest' },
    ];

    for (const p of perfPages) {
      const start = Date.now();
      await page.goto(`${BASE_URL}${p.path}`);
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - start;

      if (loadTime > 5000) {
        log({ severity: 'MEDIUM', category: 'Performance', issue: `Slow page load: ${loadTime}ms`, location: p.path, recommendation: 'Target < 3s for financial platforms' });
      } else if (loadTime > 3000) {
        console.log(`   ⚠️ ${p.name}: ${loadTime}ms (borderline)`);
      } else {
        console.log(`   ✓ ${p.name}: ${loadTime}ms`);
      }
    }

    // =========================================
    // SECTION 12: COMPLIANCE CHECKLIST
    // =========================================
    console.log('\n📋 SECTION 12: COMPLIANCE CHECKLIST\n');

    await page.goto(`${BASE_URL}/invest`);
    await page.waitForLoadState('networkidle');

    const complianceChecks = [
      { check: 'Demo/Paper trading disclaimer', selector: 'text=/demo|paper trading|simulated/i' },
      { check: 'Risk disclosure link', selector: 'text=/risk|disclosure/i' },
      { check: 'Terms of Service link', selector: 'text=/terms/i' },
      { check: 'Privacy Policy link', selector: 'text=/privacy/i' },
    ];

    for (const c of complianceChecks) {
      const found = await page.locator(c.selector).first().isVisible().catch(() => false);
      if (found) {
        console.log(`   ✓ ${c.check}`);
      } else {
        log({ severity: 'HIGH', category: 'Compliance', issue: `Missing: ${c.check}`, location: '/invest' });
      }
    }

    // =========================================
    // FINAL REPORT
    // =========================================
    console.log('\n' + '='.repeat(70));
    console.log('📊 AUDIT SUMMARY');
    console.log('='.repeat(70));

    const critical = findings.filter(f => f.severity === 'CRITICAL').length;
    const high = findings.filter(f => f.severity === 'HIGH').length;
    const medium = findings.filter(f => f.severity === 'MEDIUM').length;
    const low = findings.filter(f => f.severity === 'LOW').length;

    console.log(`\n🔴 CRITICAL: ${critical}`);
    console.log(`🟠 HIGH: ${high}`);
    console.log(`🟡 MEDIUM: ${medium}`);
    console.log(`🔵 LOW: ${low}`);
    console.log(`\nTotal Findings: ${findings.length}`);

    if (critical > 0) {
      console.log('\n⛔ VERDICT: NOT READY FOR PRODUCTION');
      console.log('   Critical issues must be resolved before launch.');
    } else if (high > 2) {
      console.log('\n⚠️ VERDICT: NEEDS WORK');
      console.log('   Multiple high-severity issues require attention.');
    } else if (high > 0 || medium > 3) {
      console.log('\n🟡 VERDICT: CONDITIONAL APPROVAL');
      console.log('   Address high/medium issues before wider release.');
    } else {
      console.log('\n✅ VERDICT: APPROVED FOR DEMO/BETA');
      console.log('   Platform meets minimum standards for controlled release.');
    }

    console.log('\n' + '='.repeat(70));
    console.log('📋 DETAILED FINDINGS');
    console.log('='.repeat(70) + '\n');

    for (const f of findings) {
      console.log(`[${f.severity}] ${f.category}`);
      console.log(`  Issue: ${f.issue}`);
      console.log(`  Location: ${f.location}`);
      if (f.recommendation) console.log(`  Fix: ${f.recommendation}`);
      console.log('');
    }

    await page.screenshot({ path: 'audit/99-final-state.png', fullPage: true });
  });
});
