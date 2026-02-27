import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE_URL = 'https://nuke.ag';
const SCREENSHOTS_DIR = '/Users/skylar/nuke/.claude/screenshots';

const findings = [];

function log(msg) {
  console.log(`[AUDIT] ${msg}`);
}

function addFinding(page_name, severity, title, description, element_hint = '') {
  findings.push({ page_name, severity, title, description, element_hint });
  log(`[${severity}] ${page_name}: ${title}`);
}

async function auditPage(browser, url, pageName, afterLoad = null) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  try {
    log(`Navigating to ${url}`);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const statusCode = response?.status();
    if (statusCode && statusCode >= 400) {
      addFinding(pageName, 95, `HTTP ${statusCode} on ${pageName}`, `Page returned HTTP ${statusCode}`, url);
    }

    // Wait for content to load
    await page.waitForTimeout(4000);

    // Run custom checks if provided
    if (afterLoad) {
      await afterLoad(page, pageName);
    }

    // Screenshot
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/${pageName.replace(/\//g, '_')}-desktop.png`,
      fullPage: true
    });

    // Check for generic error states
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');

    if (bodyText.includes('Error:') || bodyText.includes('Something went wrong') || bodyText.includes('Unexpected error')) {
      addFinding(pageName, 95, `Error state visible on ${pageName}`, `Page shows error text: ${bodyText.substring(0, 200)}`);
    }

    // Check for blank/empty pages
    const bodyLength = bodyText.trim().length;
    if (bodyLength < 100) {
      addFinding(pageName, 95, `Blank/near-empty page on ${pageName}`, `Page body has only ${bodyLength} chars of text`);
    }

    // Check for console errors
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    if (errors.length > 0) {
      addFinding(pageName, 85, `Console errors on ${pageName}`, errors.slice(0, 3).join('; '));
    }

    // Mobile audit
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/${pageName.replace(/\//g, '_')}-mobile.png`,
      fullPage: true
    });

    // Check for horizontal overflow on mobile
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    if (hasHorizontalOverflow) {
      addFinding(pageName, 70, `Horizontal scroll on mobile — ${pageName}`, `Page has horizontal overflow at 375px width. Elements are breaking out of viewport.`);
    }

    log(`Done with ${pageName}`);
    return page;
  } catch (err) {
    addFinding(pageName, 95, `Page failed to load: ${pageName}`, `Error: ${err.message}`);
    log(`ERROR on ${pageName}: ${err.message}`);
  } finally {
    await page.close();
  }
}

async function deepAuditPage(browser, url, pageName, checkFn) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Capture console errors
  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', req => {
    networkErrors.push(`${req.url()} — ${req.failure()?.errorText}`);
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const result = await checkFn(page);

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/${pageName.replace(/[\/\s]/g, '_')}.png`,
      fullPage: true
    });

    // Also viewport
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/${pageName.replace(/[\/\s]/g, '_')}_viewport.png`,
      fullPage: false
    });

    if (consoleErrors.length > 0) {
      addFinding(pageName, 70, `JS console errors on ${pageName}`,
        `${consoleErrors.length} errors: ${consoleErrors.slice(0,3).join(' | ')}`.substring(0, 500));
    }

    return result;
  } catch (err) {
    addFinding(pageName, 95, `Audit script failed on ${pageName}`, err.message);
    log(`SCRIPT ERROR on ${pageName}: ${err.message}`);
    return null;
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ============================================================
  // 1. HOMEPAGE
  // ============================================================
  log('=== Auditing Homepage ===');
  await deepAuditPage(browser, `${BASE_URL}/`, 'homepage', async (page) => {
    const info = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const h1s = Array.from(document.querySelectorAll('h1')).map(el => el.textContent.trim());
      const buttons = Array.from(document.querySelectorAll('button, a[href]')).length;
      const imgs = Array.from(document.querySelectorAll('img')).length;
      const navLinks = Array.from(document.querySelectorAll('nav a, header a')).map(el => ({
        text: el.textContent.trim().substring(0, 30),
        href: el.getAttribute('href')
      }));

      // Check for "coming soon" / placeholder text
      const hasComingSoon = bodyText.toLowerCase().includes('coming soon');
      const hasTodoText = bodyText.includes('TODO') || bodyText.includes('placeholder') || bodyText.includes('Lorem ipsum');
      const hasNukeText = bodyText.toLowerCase().includes('nuke');

      // Check login/signup CTAs
      const hasSignup = bodyText.toLowerCase().includes('sign up') || bodyText.toLowerCase().includes('get started');
      const hasLogin = bodyText.toLowerCase().includes('log in') || bodyText.toLowerCase().includes('sign in');

      return {
        title: document.title,
        bodyLength: bodyText.length,
        h1s,
        buttonCount: buttons,
        imageCount: imgs,
        navLinks,
        hasComingSoon,
        hasTodoText,
        hasNukeText,
        hasSignup,
        hasLogin,
        bodyPreview: bodyText.substring(0, 500)
      };
    });

    log(`Homepage: ${JSON.stringify(info, null, 2)}`);

    if (info.hasComingSoon) {
      addFinding('homepage', 85, 'Homepage has "Coming Soon" placeholder text',
        'Visitors land on page with "coming soon" content — immediately signals unfinished product');
    }
    if (info.hasTodoText) {
      addFinding('homepage', 95, 'Homepage has TODO/placeholder text',
        'Development artifacts visible to end users');
    }
    if (!info.hasNukeText) {
      addFinding('homepage', 85, 'Homepage may not display brand name',
        'No "Nuke" text detected in body content');
    }
    if (info.h1s.length === 0) {
      addFinding('homepage', 70, 'Homepage missing H1 tag',
        'No h1 element found — SEO and accessibility problem');
    }

    return info;
  });

  // ============================================================
  // 2. SEARCH PAGE — no query
  // ============================================================
  log('=== Auditing Search (no query) ===');
  await deepAuditPage(browser, `${BASE_URL}/search`, 'search-empty', async (page) => {
    const info = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const searchInputs = document.querySelectorAll('input[type="search"], input[placeholder*="search" i], input[placeholder*="Search"]');
      const filterPanels = document.querySelectorAll('[class*="filter" i], [class*="Filter"]');
      const vehicleCards = document.querySelectorAll('[class*="vehicle-card" i], [class*="VehicleCard"], [class*="vehicle_card"]');
      const hasFilters = bodyText.toLowerCase().includes('filter') || bodyText.toLowerCase().includes('make') || bodyText.toLowerCase().includes('year');
      const hasEmptyState = bodyText.toLowerCase().includes('no results') || bodyText.toLowerCase().includes('no vehicles');
      const hasVINSearch = bodyText.toLowerCase().includes('vin');

      return {
        searchInputCount: searchInputs.length,
        filterPanelCount: filterPanels.length,
        vehicleCardCount: vehicleCards.length,
        hasFilters,
        hasEmptyState,
        hasVINSearch,
        bodyPreview: bodyText.substring(0, 600)
      };
    });

    log(`Search empty: ${JSON.stringify(info, null, 2)}`);

    if (info.vehicleCardCount === 0) {
      addFinding('search-empty', 85, 'Search page shows no vehicles by default',
        'Empty search page shows 0 vehicle cards. Should show featured/recent vehicles to give users something to explore. Users with no specific query see a blank results area.');
    }
    if (info.searchInputCount === 0) {
      addFinding('search-empty', 95, 'Search page missing search input',
        'No search input detected on /search page');
    }

    return info;
  });

  // ============================================================
  // 3. SEARCH WITH QUERY
  // ============================================================
  log('=== Auditing Search (with query: porsche) ===');
  await deepAuditPage(browser, `${BASE_URL}/search?q=porsche`, 'search-with-query', async (page) => {
    // Wait for results to load
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const vehicleCards = document.querySelectorAll('[class*="vehicle"], [class*="Vehicle"]');
      const loadingSpinners = document.querySelectorAll('[class*="loading" i], [class*="spinner" i], [class*="skeleton" i]');
      const resultCount = bodyText.match(/(\d+)\s*(result|vehicle)/i);

      // Check for filter panel
      const filterEl = document.querySelector('[class*="filter" i], [class*="Filter"]');
      const sortEl = document.querySelector('[class*="sort" i], select');

      // Look for price/year filters
      const hasPriceFilter = bodyText.toLowerCase().includes('price');
      const hasYearFilter = bodyText.toLowerCase().includes('year');
      const hasMakeFilter = bodyText.toLowerCase().includes('make');

      return {
        vehicleCardCount: vehicleCards.length,
        hasLoadingSpinner: loadingSpinners.length > 0,
        resultCount: resultCount ? resultCount[0] : 'not visible',
        hasFilterPanel: !!filterEl,
        hasSortControl: !!sortEl,
        hasPriceFilter,
        hasYearFilter,
        hasMakeFilter,
        bodyPreview: bodyText.substring(0, 800)
      };
    });

    log(`Search with query: ${JSON.stringify(info, null, 2)}`);

    if (!info.hasPriceFilter) {
      addFinding('search', 85, 'Search filter panel missing price filter',
        'No price filter visible on search page. Users cannot filter by budget — a primary use case. File: nuke_frontend/src/pages/Search.tsx or src/components/search/');
    }
    if (!info.hasYearFilter) {
      addFinding('search', 85, 'Search filter panel missing year filter',
        'No year filter visible. Year range is a fundamental filter for collector car search.');
    }

    return info;
  });

  // ============================================================
  // 4. VEHICLE PROFILE — find a real vehicle ID
  // ============================================================
  log('=== Auditing Vehicle Profile ===');
  // Use a known vehicle from DONE.md — K10 truck
  const vehicleId = '6442df03-9cac-43a8-b89e-e4fb4c08ee99';

  await deepAuditPage(browser, `${BASE_URL}/vehicle/${vehicleId}`, 'vehicle-profile-overview', async (page) => {
    await page.waitForTimeout(4000);

    const info = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';

      // Tabs
      const tabs = Array.from(document.querySelectorAll('[role="tab"], [class*="tab" i]'))
        .map(el => el.textContent?.trim().substring(0, 30));

      // Header
      const h1s = Array.from(document.querySelectorAll('h1')).map(el => el.textContent.trim().substring(0, 60));

      // Hero image
      const heroImg = document.querySelector('img');
      const heroInfo = heroImg ? {
        src: heroImg.src?.substring(0, 100),
        width: heroImg.getBoundingClientRect().width,
        height: heroImg.getBoundingClientRect().height,
        naturalWidth: heroImg.naturalWidth,
        naturalHeight: heroImg.naturalHeight
      } : null;

      // Transfer badge
      const hasTransferBadge = bodyText.toLowerCase().includes('transfer') ||
        !!document.querySelector('[class*="transfer" i]');

      // Key data points
      const hasMileage = bodyText.toLowerCase().includes('mileage') || bodyText.toLowerCase().includes('miles');
      const hasPrice = bodyText.includes('$');
      const hasVIN = bodyText.toUpperCase().includes('VIN');
      const hasNukeEstimate = bodyText.toLowerCase().includes('estimate') || bodyText.toLowerCase().includes('nuke estimate');
      const hasDealScore = bodyText.toLowerCase().includes('deal');

      // Image gallery
      const allImgs = document.querySelectorAll('img');

      // 404/error
      const is404 = bodyText.includes('404') || bodyText.includes('not found') || bodyText.toLowerCase().includes('vehicle not found');

      return {
        is404,
        h1s,
        tabs,
        heroInfo,
        imageCount: allImgs.length,
        hasTransferBadge,
        hasMileage,
        hasPrice,
        hasVIN,
        hasNukeEstimate,
        hasDealScore,
        bodyLength: bodyText.length,
        bodyPreview: bodyText.substring(0, 800)
      };
    });

    log(`Vehicle profile: ${JSON.stringify(info, null, 2)}`);

    if (info.is404) {
      addFinding('vehicle-profile', 95, 'Vehicle profile page returns 404',
        `Vehicle ID ${vehicleId} not found or returns 404/not found state`);
    }

    if (info.tabs.length < 3) {
      addFinding('vehicle-profile', 85, 'Vehicle profile missing tabs (Overview/Timeline/Evidence/Comps)',
        `Only ${info.tabs.length} tabs found: ${info.tabs.join(', ')}. Expected at least Overview, Timeline, Evidence, Comps.`);
    }

    if (!info.hasNukeEstimate) {
      addFinding('vehicle-profile-overview', 85, 'Vehicle profile Overview tab missing Nuke Estimate',
        'No "Nuke estimate" or "estimate" text visible on vehicle profile. This is a core value prop — should be prominent.');
    }

    if (!info.hasVIN) {
      addFinding('vehicle-profile-overview', 70, 'VIN not visible on vehicle profile',
        'VIN field not shown on vehicle overview. For collector vehicles, VIN is fundamental provenance data.');
    }

    if (!info.hasDealScore) {
      addFinding('vehicle-profile-overview', 70, 'Deal score not visible on vehicle overview tab',
        'Deal score not detected on vehicle profile — this is a key differentiator that should be shown.');
    }

    return info;
  });

  // ============================================================
  // 4b. VEHICLE PROFILE — TIMELINE TAB
  // ============================================================
  log('=== Auditing Vehicle Profile — Timeline Tab ===');
  const page2 = await browser.newPage();
  await page2.setViewportSize({ width: 1440, height: 900 });
  const consoleErrors2 = [];
  page2.on('console', msg => {
    if (msg.type() === 'error') consoleErrors2.push(msg.text());
  });
  try {
    await page2.goto(`${BASE_URL}/vehicle/${vehicleId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page2.waitForTimeout(4000);

    // Click Timeline tab
    const timelineTab = await page2.$('[role="tab"]:has-text("Timeline"), button:has-text("Timeline"), a:has-text("Timeline")');
    if (timelineTab) {
      await timelineTab.click();
      await page2.waitForTimeout(2000);

      const timelineInfo = await page2.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        const timelineItems = document.querySelectorAll('[class*="timeline" i] > *, [class*="TimelineEvent"], [class*="event"]');
        const hasEmptyState = bodyText.toLowerCase().includes('no events') || bodyText.toLowerCase().includes('no history');
        return {
          timelineItemCount: timelineItems.length,
          hasEmptyState,
          bodyPreview: bodyText.substring(0, 600)
        };
      });

      log(`Timeline tab: ${JSON.stringify(timelineInfo, null, 2)}`);

      if (timelineInfo.timelineItemCount === 0 && !timelineInfo.hasEmptyState) {
        addFinding('vehicle-profile-timeline', 85, 'Timeline tab shows nothing — no events and no empty state',
          'Timeline tab has 0 items and no "no events" message. Blank tab with no feedback. File: nuke_frontend/src/pages/vehicle-profile/ or VehicleTimeline.tsx');
      }

      await page2.screenshot({
        path: `${SCREENSHOTS_DIR}/vehicle_profile_timeline.png`,
        fullPage: true
      });
    } else {
      addFinding('vehicle-profile-timeline', 85, 'Timeline tab not clickable or not found',
        'Could not find Timeline tab button to click on vehicle profile page');
    }
  } catch (err) {
    addFinding('vehicle-profile-timeline', 85, 'Timeline tab audit failed', err.message);
  } finally {
    await page2.close();
  }

  // ============================================================
  // 4c. VEHICLE PROFILE — COMPS TAB (Similar Sales)
  // ============================================================
  log('=== Auditing Vehicle Profile — Comps Tab ===');
  const page3 = await browser.newPage();
  await page3.setViewportSize({ width: 1440, height: 900 });
  try {
    await page3.goto(`${BASE_URL}/vehicle/${vehicleId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page3.waitForTimeout(4000);

    const compsTab = await page3.$('[role="tab"]:has-text("Comp"), button:has-text("Comp"), a:has-text("Comp")');
    if (compsTab) {
      await compsTab.click();
      await page3.waitForTimeout(3000);

      const compsInfo = await page3.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        const hasSimilarSales = bodyText.toLowerCase().includes('similar') || bodyText.toLowerCase().includes('comparable') || bodyText.toLowerCase().includes('comp');
        const saleItems = document.querySelectorAll('[class*="sale" i], [class*="comp" i], [class*="similar" i]');
        const hasPrice = bodyText.includes('$');

        return {
          hasSimilarSales,
          saleItemCount: saleItems.length,
          hasPrice,
          bodyPreview: bodyText.substring(0, 800)
        };
      });

      log(`Comps tab: ${JSON.stringify(compsInfo, null, 2)}`);

      if (!compsInfo.hasSimilarSales) {
        addFinding('vehicle-profile-comps', 85, 'Comps tab not showing Similar Sales section',
          'SimilarSalesSection.tsx was just built but "similar" or "comparable" text not found on Comps tab. Either not rendering or data is empty.');
      }

      if (!compsInfo.hasPrice) {
        addFinding('vehicle-profile-comps', 85, 'Comps tab showing no price data',
          'No price ($) data visible on Comps tab — Similar Sales and user comps should show sale prices.');
      }

      await page3.screenshot({
        path: `${SCREENSHOTS_DIR}/vehicle_profile_comps.png`,
        fullPage: true
      });
    } else {
      addFinding('vehicle-profile-comps', 70, 'Comps tab not found on vehicle profile',
        'Could not find Comps/Comparables tab button — tab may not exist or have different label');
    }
  } catch (err) {
    addFinding('vehicle-profile-comps', 85, 'Comps tab audit failed', err.message);
  } finally {
    await page3.close();
  }

  // ============================================================
  // 4d. VEHICLE PROFILE — EVIDENCE TAB
  // ============================================================
  log('=== Auditing Vehicle Profile — Evidence Tab ===');
  const page4 = await browser.newPage();
  await page4.setViewportSize({ width: 1440, height: 900 });
  try {
    await page4.goto(`${BASE_URL}/vehicle/${vehicleId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page4.waitForTimeout(4000);

    const evidenceTab = await page4.$('[role="tab"]:has-text("Evidence"), button:has-text("Evidence"), a:has-text("Evidence")');
    if (evidenceTab) {
      await evidenceTab.click();
      await page4.waitForTimeout(3000);

      const evidenceInfo = await page4.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        const hasPhotos = bodyText.toLowerCase().includes('photo') || bodyText.toLowerCase().includes('image');
        const hasDocuments = bodyText.toLowerCase().includes('document') || bodyText.toLowerCase().includes('record');
        const hasEmptyState = bodyText.toLowerCase().includes('no evidence') || bodyText.toLowerCase().includes('no photos');

        return {
          hasPhotos,
          hasDocuments,
          hasEmptyState,
          bodyPreview: bodyText.substring(0, 600)
        };
      });

      log(`Evidence tab: ${JSON.stringify(evidenceInfo, null, 2)}`);

      if (!evidenceInfo.hasPhotos && !evidenceInfo.hasDocuments && !evidenceInfo.hasEmptyState) {
        addFinding('vehicle-profile-evidence', 85, 'Evidence tab appears blank with no state message',
          'Evidence tab shows no photos, no documents, and no empty state message. Blank tab is confusing.');
      }

      await page4.screenshot({
        path: `${SCREENSHOTS_DIR}/vehicle_profile_evidence.png`,
        fullPage: true
      });
    } else {
      addFinding('vehicle-profile-evidence', 70, 'Evidence tab not found on vehicle profile',
        'Could not find Evidence tab button');
    }
  } catch (err) {
    addFinding('vehicle-profile-evidence', 85, 'Evidence tab audit failed', err.message);
  } finally {
    await page4.close();
  }

  // ============================================================
  // 5. MARKET EXCHANGE (/market)
  // ============================================================
  log('=== Auditing Market Exchange ===');
  await deepAuditPage(browser, `${BASE_URL}/market`, 'market-exchange', async (page) => {
    await page.waitForTimeout(4000);

    const info = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const hasComingSoon = bodyText.toLowerCase().includes('coming soon');
      const hasBeta = bodyText.toLowerCase().includes('beta');
      const hasError = bodyText.toLowerCase().includes('error') || bodyText.toLowerCase().includes('failed');
      const hasMarketData = bodyText.includes('$') || bodyText.toLowerCase().includes('fund') || bodyText.toLowerCase().includes('nav');
      const hasTimeout = bodyText.toLowerCase().includes('timeout');

      return {
        hasComingSoon,
        hasBeta,
        hasError,
        hasMarketData,
        hasTimeout,
        bodyPreview: bodyText.substring(0, 800)
      };
    });

    log(`Market Exchange: ${JSON.stringify(info, null, 2)}`);

    if (info.hasComingSoon) {
      addFinding('market-exchange', 95, 'Market Exchange shows "Coming Soon" placeholder — blocks investors',
        'Market page is showing "Coming Soon" text. This is the premium investor product. A "Coming Soon" placeholder will destroy investor confidence in demos. File: nuke_frontend/src/pages/MarketExchange.tsx or MarketDashboard.tsx');
    }

    if (info.hasTimeout) {
      addFinding('market-exchange', 95, 'Market Exchange page timing out',
        'Timeout detected on /market page. Investors cannot see market data. Likely the database query is too slow.');
    }

    if (info.hasBeta && !info.hasMarketData) {
      addFinding('market-exchange', 85, 'Market shows BETA warning but no actual data',
        'BETA badge present but no $ figures, fund data, or NAV visible. Either data not loading or page broken.');
    }

    if (!info.hasMarketData && !info.hasComingSoon) {
      addFinding('market-exchange', 85, 'Market Exchange shows no market data',
        'No price data ($), fund info, or NAV on market page. Backend was built but frontend may not be connected.');
    }

    return info;
  });

  // ============================================================
  // 6. PORTFOLIO
  // ============================================================
  log('=== Auditing Portfolio ===');
  await deepAuditPage(browser, `${BASE_URL}/portfolio`, 'portfolio', async (page) => {
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const hasLogin = bodyText.toLowerCase().includes('log in') || bodyText.toLowerCase().includes('sign in') || bodyText.toLowerCase().includes('login');
      const hasComingSoon = bodyText.toLowerCase().includes('coming soon');
      const hasPortfolioData = bodyText.toLowerCase().includes('portfolio') || bodyText.includes('$');
      const hasAuthWall = !!document.querySelector('[class*="auth" i], [class*="login" i], [class*="Login"]');

      return {
        hasLogin,
        hasComingSoon,
        hasPortfolioData,
        hasAuthWall,
        bodyPreview: bodyText.substring(0, 600)
      };
    });

    log(`Portfolio: ${JSON.stringify(info, null, 2)}`);

    if (info.hasComingSoon) {
      addFinding('portfolio', 85, 'Portfolio page shows "Coming Soon" to logged-out users',
        'Portfolio is placeholdered. If investors click Portfolio in a demo while logged out, they see "coming soon". File: nuke_frontend/src/pages/Portfolio.tsx');
    }

    if (!info.hasLogin && !info.hasPortfolioData && !info.hasComingSoon) {
      addFinding('portfolio', 85, 'Portfolio page blank — no auth wall and no portfolio content',
        'Blank portfolio page with no content and no login prompt. Unclear what state this is in.');
    }

    return info;
  });

  // ============================================================
  // 7. INVESTOR OFFERING PAGE
  // ============================================================
  log('=== Auditing Investor Offering ===');
  await deepAuditPage(browser, `${BASE_URL}/offering`, 'offering', async (page) => {
    await page.waitForTimeout(4000);

    const info = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const hasStats = bodyText.includes('$') || /\d+,\d+/.test(bodyText);
      const hasError = bodyText.toLowerCase().includes('error') || bodyText.toLowerCase().includes('failed to load');
      const hasInvestmentInfo = bodyText.toLowerCase().includes('invest') || bodyText.toLowerCase().includes('raise') || bodyText.toLowerCase().includes('valuation');
      const h1s = Array.from(document.querySelectorAll('h1')).map(el => el.textContent.trim().substring(0, 60));

      // Check for blank/placeholder data (e.g., $0, 0 vehicles)
      const hasZeroData = /\$0\b/.test(bodyText) || /^0\s/m.test(bodyText);

      return {
        hasStats,
        hasError,
        hasInvestmentInfo,
        hasZeroData,
        h1s,
        bodyPreview: bodyText.substring(0, 800)
      };
    });

    log(`Offering: ${JSON.stringify(info, null, 2)}`);

    if (info.hasError) {
      addFinding('offering', 95, 'Investor offering page shows errors',
        `Error state visible on /offering — this is our investor pitch page. Cannot have errors here.`);
    }

    if (!info.hasStats) {
      addFinding('offering', 85, 'Investor offering page shows no live stats',
        'No $ figures or numeric stats visible on offering page. Live stats (vehicles, data points, etc.) should be shown.');
    }

    if (info.hasZeroData) {
      addFinding('offering', 95, 'Investor offering shows $0 or zero stats',
        'Zeros visible on offering page — broken stat display looks terrible to investors. Check the stats API.');
    }

    return info;
  });

  // ============================================================
  // 8. ORGANIZATION PROFILE
  // ============================================================
  log('=== Auditing Organization Profile ===');
  // We need a real org ID — search for one in the URL from main site navigation
  await deepAuditPage(browser, `${BASE_URL}/organizations`, 'organizations-list', async (page) => {
    await page.waitForTimeout(3000);

    const orgLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/org/"], a[href*="/organization/"]'));
      return links.slice(0, 3).map(el => ({
        href: el.getAttribute('href'),
        text: el.textContent.trim().substring(0, 40)
      }));
    });

    log(`Org links found: ${JSON.stringify(orgLinks)}`);

    if (orgLinks.length === 0) {
      addFinding('organizations', 70, 'Organizations page shows no org links',
        'Cannot navigate to any org profile from /organizations page');
    }

    // Try to navigate to first org if found
    if (orgLinks.length > 0) {
      const orgUrl = `${BASE_URL}${orgLinks[0].href}`;
      log(`Navigating to org: ${orgUrl}`);

      await page.goto(orgUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      const orgInfo = await page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        const hasOrgName = bodyText.length > 100;
        const hasVehicles = bodyText.toLowerCase().includes('vehicle') || bodyText.toLowerCase().includes('listing');
        const is404 = bodyText.includes('404') || bodyText.toLowerCase().includes('not found');
        return { hasOrgName, hasVehicles, is404, bodyPreview: bodyText.substring(0, 400) };
      });

      log(`Org profile: ${JSON.stringify(orgInfo)}`);

      if (orgInfo.is404) {
        addFinding('org-profile', 85, 'Organization profile pages return 404',
          `Org URL ${orgUrl} shows 404. Links from organizations list are broken.`);
      }

      await page.screenshot({
        path: `${SCREENSHOTS_DIR}/org_profile.png`,
        fullPage: false
      });
    }

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/organizations_list.png`,
      fullPage: true
    });

    return orgLinks;
  });

  // ============================================================
  // 9. USER PROFILE (/profile)
  // ============================================================
  log('=== Auditing User Profile ===');
  await deepAuditPage(browser, `${BASE_URL}/profile`, 'user-profile', async (page) => {
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const hasLogin = bodyText.toLowerCase().includes('log in') || bodyText.toLowerCase().includes('sign in');
      const hasProfileContent = bodyText.toLowerCase().includes('profile') || bodyText.toLowerCase().includes('account');
      const hasError = bodyText.toLowerCase().includes('error');

      return {
        hasLogin,
        hasProfileContent,
        hasError,
        bodyPreview: bodyText.substring(0, 400)
      };
    });

    log(`User profile: ${JSON.stringify(info, null, 2)}`);

    if (!info.hasLogin && !info.hasProfileContent) {
      addFinding('user-profile', 85, 'User profile page blank when logged out',
        'No login prompt and no profile content shown at /profile. Should show auth wall or redirect to login.');
    }

    return info;
  });

  // ============================================================
  // 10. NAV / GLOBAL UX CHECKS
  // ============================================================
  log('=== Auditing Navigation ===');
  await deepAuditPage(browser, `${BASE_URL}/`, 'nav-global', async (page) => {
    await page.waitForTimeout(3000);

    const navInfo = await page.evaluate(() => {
      // Nav links
      const nav = document.querySelector('nav, header');
      const navLinks = nav ? Array.from(nav.querySelectorAll('a')).map(el => ({
        text: el.textContent.trim().substring(0, 30),
        href: el.getAttribute('href')
      })) : [];

      // Check for logo
      const logoImgs = document.querySelectorAll('nav img, header img, [class*="logo" i]');
      const hasLogo = logoImgs.length > 0;

      // Dark mode
      const bodyBg = window.getComputedStyle(document.body).backgroundColor;

      // Mobile nav hamburger
      const hamburger = document.querySelector('[class*="hamburger" i], [class*="menu-btn" i], button[aria-label*="menu" i]');

      return {
        navLinkCount: navLinks.length,
        navLinks,
        hasLogo,
        bodyBg,
        hasHamburger: !!hamburger
      };
    });

    log(`Nav: ${JSON.stringify(navInfo, null, 2)}`);

    if (!navInfo.hasHamburger) {
      addFinding('nav-global', 70, 'Mobile nav hamburger menu not found',
        'No hamburger/menu button found for mobile navigation. At 375px, nav items will overflow. File: nuke_frontend/src/components/layout/');
    }

    if (navInfo.navLinkCount < 3) {
      addFinding('nav-global', 70, `Navigation has very few links (${navInfo.navLinkCount})`,
        'Minimal nav links may mean nav not rendering or collapsed. Users cannot navigate the product.');
    }

    // Check mobile nav specifically
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(1000);

    const mobileNavInfo = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      return { overflowX, bodyPreview: bodyText.substring(0, 200) };
    });

    if (mobileNavInfo.overflowX) {
      addFinding('nav-global-mobile', 85, 'Homepage has horizontal scroll on mobile (375px)',
        'Content bleeds past viewport width on mobile. All mobile users see broken layout.');
    }

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/nav_mobile.png`,
      fullPage: false
    });

    return navInfo;
  });

  // ============================================================
  // 11. SEARCH FILTER PANEL — deep check
  // ============================================================
  log('=== Deep audit of Search filter panel ===');
  await deepAuditPage(browser, `${BASE_URL}/search?q=chevrolet`, 'search-filter-deep', async (page) => {
    await page.waitForTimeout(4000);

    const filterInfo = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';

      // Find filter-related elements
      const allText = bodyText;
      const filterKeywords = ['Make', 'Model', 'Year', 'Price', 'Mileage', 'Condition', 'Color', 'Transmission', 'Sort'];
      const foundFilters = filterKeywords.filter(k => allText.includes(k));

      // Check selects/inputs
      const selects = document.querySelectorAll('select');
      const rangeInputs = document.querySelectorAll('input[type="range"]');
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');

      // Check VIN search mode
      const hasVinToggle = allText.toLowerCase().includes('vin');

      return {
        foundFilters,
        selectCount: selects.length,
        rangeInputCount: rangeInputs.length,
        checkboxCount: checkboxes.length,
        hasVinToggle,
        bodyPreview: allText.substring(0, 1000)
      };
    });

    log(`Filter deep: ${JSON.stringify(filterInfo, null, 2)}`);

    const missingFilters = ['Make', 'Year', 'Price'].filter(f => !filterInfo.foundFilters.includes(f));
    if (missingFilters.length > 0) {
      addFinding('search-filters', 85, `Search filters missing: ${missingFilters.join(', ')}`,
        `Key filter dimensions not visible: ${missingFilters.join(', ')}. Users cannot refine results by these critical attributes. File: nuke_frontend/src/pages/Search.tsx or src/components/search/`);
    }

    if (filterInfo.selectCount === 0 && filterInfo.rangeInputCount === 0 && filterInfo.checkboxCount === 0) {
      addFinding('search-filters', 85, 'Search page has no interactive filter controls',
        'No select dropdowns, range sliders, or checkboxes found on search page. Filter panel exists visually but may not be functional.');
    }

    await page.screenshot({
      path: `${SCREENSHOTS_DIR}/search_filters.png`,
      fullPage: true
    });

    return filterInfo;
  });

  // ============================================================
  // Done — save findings
  // ============================================================
  await browser.close();

  const output = {
    timestamp: new Date().toISOString(),
    totalFindings: findings.length,
    by_severity: {
      critical_95: findings.filter(f => f.severity === 95).length,
      ugly_85: findings.filter(f => f.severity === 85).length,
      polish_70: findings.filter(f => f.severity === 70).length,
    },
    findings
  };

  writeFileSync('/Users/skylar/nuke/.claude/ux-audit-results.json', JSON.stringify(output, null, 2));

  console.log('\n\n=== AUDIT COMPLETE ===');
  console.log(`Total findings: ${findings.length}`);
  console.log(`Critical (95): ${output.by_severity.critical_95}`);
  console.log(`Ugly/Confusing (85): ${output.by_severity.ugly_85}`);
  console.log(`Polish (70): ${output.by_severity.polish_70}`);
  console.log('\nFindings:');
  findings.forEach((f, i) => {
    console.log(`\n[${i+1}] [P${f.severity}] ${f.page_name}: ${f.title}`);
    console.log(`    ${f.description.substring(0, 150)}`);
  });
})();
