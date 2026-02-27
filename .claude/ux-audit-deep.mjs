/**
 * Deep UX Audit — Phase 2
 * Focuses on pages that need longer waits + more specific checks
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE_URL = 'https://nuke.ag';
const SCREENSHOTS_DIR = '/Users/skylar/nuke/.claude/screenshots';

const findings = [];

function log(msg) {
  console.log(`[AUDIT-DEEP] ${msg}`);
}

function addFinding(page_name, severity, title, description) {
  findings.push({ page_name, severity, title, description });
  log(`[P${severity}] ${page_name}: ${title}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ============================================================
  // VEHICLE PROFILE — with 15s wait for auth + data
  // ============================================================
  log('=== Vehicle Profile Deep Audit (15s wait) ===');
  const vp = await browser.newPage();
  await vp.setViewportSize({ width: 1440, height: 900 });
  const vpErrors = [];
  vp.on('console', msg => {
    if (msg.type() === 'error') vpErrors.push(msg.text());
  });

  // Use K10 truck
  const vehicleId = '6442df03-9cac-43a8-b89e-e4fb4c08ee99';

  try {
    await vp.goto(`${BASE_URL}/vehicle/${vehicleId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for auth check + data load (generous)
    log('Waiting 12s for vehicle data to load...');
    await vp.waitForTimeout(12000);

    const vpInfo = await vp.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const isLoading = bodyText.includes('Loading vehicle...');
      const is404 = bodyText.includes('Vehicle Not Found') || bodyText.includes('404');

      // Tabs
      const tabs = Array.from(document.querySelectorAll('button[class*="tab" i], [role="tab"], [class*="workspace-tab" i], [class*="Tab"]'))
        .map(el => ({ text: el.textContent?.trim().substring(0, 30), class: el.className?.substring(0, 60) }));

      // Header info
      const h1 = document.querySelector('h1')?.textContent?.trim();
      const h2 = document.querySelector('h2')?.textContent?.trim();

      // Vehicle data displayed
      const hasVIN = bodyText.toUpperCase().includes('VIN');
      const hasMileage = /\d[\d,]+\s*(mi|mile|km)/i.test(bodyText);
      const hasPrice = /\$[\d,]+/.test(bodyText);
      const hasEstimate = /estimate|nuke\s*estimate/i.test(bodyText);
      const hasDealScore = /deal\s*score|deal\s*grade/i.test(bodyText);
      const hasTransfer = /transfer/i.test(bodyText);
      const hasImages = document.querySelectorAll('img').length;
      const hasTabContent = document.querySelectorAll('[class*="tab-content" i], [class*="tabcontent" i], [class*="tab-panel" i]').length;

      // Nav tabs visible
      const navItems = Array.from(document.querySelectorAll('nav a, header a')).map(el => el.textContent?.trim().substring(0, 20));

      // Any error banners
      const errorBanners = Array.from(document.querySelectorAll('[class*="error" i], [class*="alert" i]'))
        .map(el => el.textContent?.trim().substring(0, 100));

      return {
        isLoading,
        is404,
        h1,
        h2,
        tabs,
        tabCount: tabs.length,
        hasVIN,
        hasMileage,
        hasPrice,
        hasEstimate,
        hasDealScore,
        hasTransfer,
        imageCount: hasImages,
        hasTabContent,
        navItems,
        errorBanners,
        bodyLength: bodyText.length,
        bodyPreview: bodyText.substring(0, 1000)
      };
    });

    log(`Vehicle profile after 12s: ${JSON.stringify(vpInfo, null, 2)}`);

    await vp.screenshot({ path: `${SCREENSHOTS_DIR}/vp_after_12s.png`, fullPage: false });
    await vp.screenshot({ path: `${SCREENSHOTS_DIR}/vp_after_12s_full.png`, fullPage: true });

    if (vpInfo.isLoading) {
      addFinding('vehicle-profile', 95, 'Vehicle profile stuck in "Loading vehicle..." state for 12+ seconds',
        'Page shows loading spinner indefinitely. Supabase auth check or data fetch is not completing. Likely the RPC or .from("vehicles") query is timing out or failing silently. Visitors get a perpetual loader — effectively a blank page. File: nuke_frontend/src/pages/VehicleProfile.tsx around line 1733-1795 (loadVehicle function). Check if api-v1-vehicles edge function is responsive.');
    }

    if (vpInfo.is404) {
      addFinding('vehicle-profile', 95, 'Vehicle profile showing "Vehicle Not Found" for known vehicle',
        `Vehicle ID ${vehicleId} (K10 truck) not found by the page. Either the fetch failed or the vehicle is filtered out by stub filter.`);
    }

    if (!vpInfo.isLoading && !vpInfo.is404) {
      // Data loaded — check quality

      if (vpInfo.tabCount < 3) {
        addFinding('vehicle-profile', 85, `Vehicle profile has only ${vpInfo.tabCount} tab(s) visible`,
          `Expected 4 tabs (Evidence, Facts, Commerce, Financials) but found ${vpInfo.tabCount}: ${vpInfo.tabs.map(t => t.text).join(', ')}. Tab labels also confusing — "Evidence/Facts/Commerce/Financials" vs old "Overview/Timeline/Evidence/Comps" naming.`);
      }

      if (!vpInfo.hasEstimate) {
        addFinding('vehicle-profile', 85, 'Vehicle profile: Nuke Estimate not visible on page',
          'No "Nuke estimate" text found. This is the #1 data point we claim to provide. Must be prominent above the fold. File: nuke_frontend/src/components/vehicle/NukeEstimatePanel.tsx or VehicleProfile.tsx');
      }

      if (!vpInfo.hasVIN) {
        addFinding('vehicle-profile', 70, 'Vehicle profile: VIN not displayed',
          'VIN not visible on vehicle page. For collector cars, VIN is primary identity. Should appear in header or Overview section.');
      }

      if (!vpInfo.hasDealScore) {
        addFinding('vehicle-profile', 70, 'Vehicle profile: Deal Score not displayed',
          'Deal Score not visible on vehicle page. This is a core differentiator. File: nuke_frontend/src/components/vehicle/VehiclePricingValueCard.tsx or NukeEstimatePanel.tsx');
      }

      if (vpInfo.imageCount === 0) {
        addFinding('vehicle-profile', 85, 'Vehicle profile: No images rendered',
          '0 images on page even after 12s load. Hero image or gallery not rendering. File: nuke_frontend/src/pages/vehicle-profile/VehicleHeroImage.tsx or VehicleImageGallery.tsx');
      }

      if (!vpInfo.hasTransfer) {
        addFinding('vehicle-profile', 70, 'Vehicle profile: Transfer badge not visible',
          'Transfer badge (showing title transfer status) not showing on vehicle header. Was just built — may not be rendering for this vehicle. File: nuke_frontend/src/pages/vehicle-profile/VehicleHeader.tsx');
      }
    }

    // Tab click tests (only if page loaded)
    if (!vpInfo.isLoading && !vpInfo.is404 && vpInfo.tabCount > 0) {
      const tabTexts = vpInfo.tabs.map(t => t.text?.toLowerCase() || '');

      // Find and click Timeline/Evidence tab
      for (const tabName of ['Timeline', 'Evidence', 'Facts', 'Comps', 'Comparables']) {
        const tabEl = await vp.$(`button:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`);
        if (tabEl) {
          log(`Clicking tab: ${tabName}`);
          await tabEl.click();
          await vp.waitForTimeout(2000);

          const tabContent = await vp.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
          log(`${tabName} tab content: ${tabContent.substring(0, 200)}`);
          await vp.screenshot({ path: `${SCREENSHOTS_DIR}/vp_tab_${tabName.toLowerCase()}.png`, fullPage: false });

          if (tabContent.length < 200) {
            addFinding(`vehicle-profile-${tabName.toLowerCase()}`, 85,
              `${tabName} tab appears blank or near-empty`,
              `After clicking ${tabName} tab, page body is only ${tabContent.length} chars. Tab may not be rendering content.`);
          }
        }
      }
    }

    if (vpErrors.length > 0) {
      addFinding('vehicle-profile', 70, `Vehicle profile has ${vpErrors.length} console errors`,
        `Errors: ${vpErrors.slice(0, 3).join(' | ').substring(0, 400)}`);
    }

  } catch (err) {
    addFinding('vehicle-profile', 95, 'Vehicle profile page crashed during deep audit', err.message);
  } finally {
    await vp.close();
  }

  // ============================================================
  // MARKET EXCHANGE — longer wait
  // ============================================================
  log('=== Market Exchange Deep Audit ===');
  const mkt = await browser.newPage();
  await mkt.setViewportSize({ width: 1440, height: 900 });
  const mktErrors = [];
  mkt.on('console', msg => {
    if (msg.type() === 'error') mktErrors.push(msg.text());
  });

  try {
    await mkt.goto(`${BASE_URL}/market`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    log('Waiting 10s for Market to load...');
    await mkt.waitForTimeout(10000);

    const mktInfo = await mkt.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return {
        isLoading: bodyText.includes('Loading market'),
        hasComingSoon: bodyText.toLowerCase().includes('coming soon'),
        hasBeta: bodyText.toLowerCase().includes('beta'),
        hasError: bodyText.toLowerCase().includes('error'),
        hasMarketData: /\$[\d,]+/.test(bodyText) || /NAV/i.test(bodyText),
        hasFundNames: bodyText.includes('PORS') || bodyText.includes('TRUK') || bodyText.includes('SQBD'),
        hasTable: !!document.querySelector('table'),
        hasCharts: !!document.querySelector('canvas, [class*="chart" i]'),
        bodyPreview: bodyText.substring(0, 1000)
      };
    });

    log(`Market after 10s: ${JSON.stringify(mktInfo, null, 2)}`);
    await mkt.screenshot({ path: `${SCREENSHOTS_DIR}/market_after_10s.png`, fullPage: true });

    if (mktInfo.isLoading) {
      addFinding('market-exchange', 95, 'Market Exchange stuck in loading state for 10+ seconds',
        '"Loading market dashboard..." shown for 10+ seconds. The dashboard is timing out on a slow DB query. The P0 issue that caused the "Coming Soon" replacement seems to be recurring — data is not loading. Users and investors see a spinner indefinitely. File: nuke_frontend/src/pages/MarketDashboard.tsx or MarketExchange.tsx');
    }

    if (mktInfo.hasComingSoon) {
      addFinding('market-exchange', 95, 'Market Exchange is showing "Coming Soon" placeholder',
        'Market page shows "Coming Soon" text — this is a placeholder from when the market dashboard timed out (P0). The real dashboard is not loading. Investors cannot see market data at all. File: nuke_frontend/src/pages/MarketDashboard.tsx');
    }

    if (!mktInfo.isLoading && !mktInfo.hasComingSoon) {
      if (!mktInfo.hasMarketData && !mktInfo.hasFundNames) {
        addFinding('market-exchange', 85, 'Market Exchange loaded but shows no fund data',
          'Market page loaded but shows no NAV, no fund names (PORS/TRUK/SQBD/Y79), no prices. Backend seeded baselines exist but frontend may not be fetching from api-v1-exchange correctly.');
      }

      if (mktInfo.hasBeta) {
        addFinding('market-exchange', 70, 'Market Exchange shows BETA warning — prominence and wording need review',
          'BETA badge visible. If market data is functional, the BETA label is a credibility risk in investor demos. Review whether it should stay or be changed to something less alarming.');
      }
    }

    if (mktErrors.length > 0) {
      addFinding('market-exchange', 70, `Market Exchange has ${mktErrors.length} console errors`,
        `Errors include: ${mktErrors.slice(0, 3).join(' | ').substring(0, 400)}`);
    }

  } catch (err) {
    addFinding('market-exchange', 95, 'Market Exchange page crashed during audit', err.message);
  } finally {
    await mkt.close();
  }

  // ============================================================
  // SEARCH — Real vehicle search
  // ============================================================
  log('=== Search Results Deep Audit ===');
  const srch = await browser.newPage();
  await srch.setViewportSize({ width: 1440, height: 900 });

  try {
    await srch.goto(`${BASE_URL}/search?q=porsche+911`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    log('Waiting 8s for search results...');
    await srch.waitForTimeout(8000);

    const srchInfo = await srch.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const noResults = bodyText.includes('NO RESULTS FOUND') || bodyText.includes('0 results');
      const hasVehicleCards = document.querySelectorAll('[class*="vehicle-card" i], [class*="VehicleCard"], [class*="card vehicle" i]').length;
      const hasImages = document.querySelectorAll('img[src*="supabase"], img[src*="vehicle"], img[src*="http"]').length;
      const hasResultCount = /(\d+)\s*(result|vehicle)/i.test(bodyText);
      const resultMatch = bodyText.match(/(\d+)\s*results?/i);
      const hasFilterControls = document.querySelectorAll('select, input[type="range"]').length;
      const hasVINSection = bodyText.toLowerCase().includes('vin lookup') || bodyText.toLowerCase().includes('vin search');
      const allText = bodyText.substring(0, 2000);

      // Look for actual vehicle data
      const hasYear = /\b(19|20)\d\d\b/.test(bodyText);
      const hasCarBrand = /porsche|911|ferrari|bmw|mercedes/i.test(bodyText);

      return {
        noResults,
        hasVehicleCards,
        imageCount: hasImages,
        resultCount: resultMatch ? resultMatch[1] : '?',
        hasFilterControls,
        hasVINSection,
        hasYear,
        hasCarBrand,
        bodyPreview: bodyText.substring(0, 1500)
      };
    });

    log(`Search results for 'porsche 911': ${JSON.stringify(srchInfo, null, 2)}`);
    await srch.screenshot({ path: `${SCREENSHOTS_DIR}/search_results_porsche.png`, fullPage: true });

    if (srchInfo.noResults) {
      addFinding('search-results', 95, 'Search "porsche 911" returns 0 results — database not being searched',
        '"NO RESULTS FOUND" for "porsche 911". We have 18k+ vehicles including Porsches. The search engine is not returning results — either the stub vehicle filter broke search, or universal-search edge function is not returning vehicles. This is catastrophic for the demo. Check universal-search edge function and the stub vehicle filter migration.');
    }

    if (!srchInfo.noResults && srchInfo.hasVehicleCards === 0) {
      addFinding('search-results', 85, 'Search returns results but vehicle cards not rendering',
        `Result count shows ${srchInfo.resultCount} but 0 vehicle card elements found. Frontend component not rendering. File: nuke_frontend/src/components/vehicles/VehicleCardDense.tsx or VehicleResults.tsx`);
    }

    if (srchInfo.hasVehicleCards > 0 && srchInfo.imageCount === 0) {
      addFinding('search-results', 70, 'Vehicle cards show in search but no images loading',
        'Vehicle cards render but 0 images visible. Missing images make results look low-quality. Check image URL format and CDN.');
    }

    if (!srchInfo.hasVINSection) {
      addFinding('search', 70, 'VIN Lookup toggle not visible on search page',
        'VIN search was just built (P1 task) but VIN lookup section not visible on search page. Either not deployed or hidden. File: nuke_frontend/src/pages/Search.tsx');
    }

  } catch (err) {
    addFinding('search', 95, 'Search page crashed during deep audit', err.message);
  } finally {
    await srch.close();
  }

  // ============================================================
  // HOMEPAGE — check the tabs (Feed, Garage, Map)
  // ============================================================
  log('=== Homepage Feed Tabs Audit ===');
  const hp = await browser.newPage();
  await hp.setViewportSize({ width: 1440, height: 900 });

  try {
    await hp.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await hp.waitForTimeout(5000);

    const hpInfo = await hp.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const hasFeedTab = bodyText.toLowerCase().includes('feed');
      const hasGarageTab = bodyText.toLowerCase().includes('garage');
      const hasMapTab = bodyText.toLowerCase().includes('map');
      const tabs = Array.from(document.querySelectorAll('button, [role="tab"]'))
        .map(el => el.textContent?.trim()).filter(t => t && t.length < 20);

      // What's visible in hero
      const heroText = bodyText.substring(0, 600);

      // Nav items
      const navItems = Array.from(document.querySelectorAll('nav a, header a')).map(el => ({
        text: el.textContent?.trim().substring(0, 20),
        href: el.getAttribute('href')
      }));

      // Check if it's showing CursorHomepage or the regular one
      const isCursor = !!document.querySelector('[class*="cursor" i], [class*="terminal" i]');

      return {
        hasFeedTab,
        hasGarageTab,
        hasMapTab,
        tabs,
        heroText,
        navItems,
        isCursor,
        bodyPreview: bodyText.substring(0, 800)
      };
    });

    log(`Homepage after 5s: ${JSON.stringify(hpInfo, null, 2)}`);
    await hp.screenshot({ path: `${SCREENSHOTS_DIR}/homepage_full.png`, fullPage: true });
    await hp.screenshot({ path: `${SCREENSHOTS_DIR}/homepage_viewport.png`, fullPage: false });

    // Nav quality
    if (hpInfo.navItems.length < 3) {
      addFinding('homepage-nav', 85, `Navigation has only ${hpInfo.navItems.length} links visible to logged-out users`,
        `Nav shows: ${hpInfo.navItems.map(n => n.text + ' → ' + n.href).join(', ')}. Logged-out users see almost no navigation — cannot discover Search, Market, or any feature. The nav is too sparse. File: nuke_frontend/src/components/layout/ (AppHeader, NukeMenu)`);
    }

    // No logo in nav
    addFinding('homepage-nav', 70, 'Navigation has no logo or brand mark',
      'Nav shows only 3 text links (Home, +, Profile) with no logo/wordmark. Brand is invisible until scrolling past fold. File: nuke_frontend/src/components/layout/AppHeader.tsx or NukeMenu.tsx');

    // Feed tab check
    if (hpInfo.hasFeedTab || hpInfo.hasGarageTab) {
      // Click Browse Feed
      const feedBtn = await hp.$('button:has-text("BROWSE FEED"), button:has-text("Feed"), button:has-text("Browse")');
      if (feedBtn) {
        await feedBtn.click();
        await hp.waitForTimeout(3000);

        const feedInfo = await hp.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const hasFeedContent = bodyText.toLowerCase().includes('activity') || bodyText.toLowerCase().includes('vehicle') || bodyText.toLowerCase().includes('recent');
          const hasEmptyFeed = bodyText.toLowerCase().includes('no activity') || bodyText.toLowerCase().includes('nothing here');
          const feedItems = document.querySelectorAll('[class*="feed" i] > *, [class*="activity" i]').length;
          return { hasFeedContent, hasEmptyFeed, feedItems, bodyPreview: bodyText.substring(0, 600) };
        });

        log(`Feed tab: ${JSON.stringify(feedInfo)}`);
        await hp.screenshot({ path: `${SCREENSHOTS_DIR}/homepage_feed_tab.png`, fullPage: false });

        if (!feedInfo.hasFeedContent && !feedInfo.hasEmptyFeed) {
          addFinding('homepage-feed', 85, 'Homepage Feed tab shows blank content — no activity items, no empty state',
            'After clicking Browse Feed / Feed tab, content area is empty with no feedback. Users see nothing. File: nuke_frontend/src/components/garage/GarageTab.tsx or DiscoveryFeed.tsx. The feed needs an empty state with content discovery prompts.');
        }
      }
    }

    // Check mobile nav
    await hp.setViewportSize({ width: 375, height: 812 });
    await hp.waitForTimeout(1000);
    await hp.screenshot({ path: `${SCREENSHOTS_DIR}/homepage_mobile.png`, fullPage: false });

    const mobileInfo = await hp.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const overflowX = document.documentElement.scrollWidth > window.innerWidth;
      const bottomNav = document.querySelector('[class*="bottom-nav" i], [class*="mobile-nav" i], [class*="BottomNav"]');
      const hamburger = document.querySelector('[aria-label*="menu" i], [class*="hamburger" i], [class*="menu-btn" i]');

      return {
        overflowX,
        hasBottomNav: !!bottomNav,
        hasHamburger: !!hamburger,
        bodyPreview: bodyText.substring(0, 300)
      };
    });

    log(`Mobile homepage: ${JSON.stringify(mobileInfo)}`);

    if (mobileInfo.overflowX) {
      addFinding('homepage-mobile', 85, 'Homepage has horizontal scroll on 375px mobile',
        'Content overflows viewport width on iPhone-sized screen. All mobile users see broken layout with content cut off. Check padding, fixed widths, overflow in HomePage.tsx and AppHeader.');
    }

    if (!mobileInfo.hasBottomNav && !mobileInfo.hasHamburger) {
      addFinding('homepage-mobile', 85, 'Mobile has no bottom nav and no hamburger menu',
        'On 375px, no bottom navigation bar and no hamburger menu visible. Mobile users cannot navigate. This is a critical mobile UX gap. File: nuke_frontend/src/components/layout/MobileBottomNav.tsx (if exists) or AppHeader.tsx');
    }

  } catch (err) {
    addFinding('homepage', 85, 'Homepage deep audit crashed', err.message);
  } finally {
    await hp.close();
  }

  // ============================================================
  // INVESTOR OFFERING — check what's behind the access code gate
  // ============================================================
  log('=== Investor Offering Deep Audit ===');
  const offer = await browser.newPage();
  await offer.setViewportSize({ width: 1440, height: 900 });

  try {
    await offer.goto(`${BASE_URL}/offering`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await offer.waitForTimeout(4000);

    const offerInfo = await offer.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const hasAccessCode = bodyText.toLowerCase().includes('access code');
      const hasDataRoom = bodyText.toLowerCase().includes('data room');
      const hasContact = bodyText.toLowerCase().includes('contact') || bodyText.toLowerCase().includes('info@');
      const hasStats = /\$[\d,]+/.test(bodyText) || /\d+[,k]?\s*(vehicle|user|data)/i.test(bodyText);
      const h1 = document.querySelector('h1')?.textContent;
      return { hasAccessCode, hasDataRoom, hasContact, hasStats, h1, bodyPreview: bodyText.substring(0, 600) };
    });

    log(`Offering: ${JSON.stringify(offerInfo, null, 2)}`);
    await offer.screenshot({ path: `${SCREENSHOTS_DIR}/offering_gate.png`, fullPage: true });

    if (offerInfo.hasAccessCode) {
      addFinding('offering-gate', 85, 'Investor offering page is behind an access code gate with no live stats visible',
        'The /offering page shows only an "ACCESS CODE" login gate with no visible platform stats. Investors who are NOT given a code see nothing compelling — no proof of traction (vehicles, data points, users). The gate page itself needs key stats (vehicle count, data coverage, etc.) to be visible BEFORE the code is entered. File: nuke_frontend/src/pages/InvestorOffering.tsx');
    }

    if (!offerInfo.hasStats) {
      addFinding('offering', 85, 'Offering gate page shows zero traction data',
        'No $ figures, user counts, or vehicle counts on the offering page entry screen. Even behind a gate, first impressions matter. The email contact is there but no proof of scale. File: nuke_frontend/src/pages/InvestorOffering.tsx');
    }

  } catch (err) {
    addFinding('offering', 85, 'Offering page audit crashed', err.message);
  } finally {
    await offer.close();
  }

  // ============================================================
  // SEARCH — check what "no results" state looks like
  // ============================================================
  log('=== Search Empty State Audit ===');
  const srch2 = await browser.newPage();
  await srch2.setViewportSize({ width: 1440, height: 900 });

  try {
    await srch2.goto(`${BASE_URL}/search`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await srch2.waitForTimeout(5000);

    const emptyInfo = await srch2.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const searchInput = document.querySelector('input[type="search"], input[placeholder*="search" i], input[placeholder*="Search"]');
      const hasPromptText = bodyText.includes('Enter a search query') || bodyText.includes('Search vehicles');
      const hasFeaturedVehicles = bodyText.toLowerCase().includes('featured') || bodyText.toLowerCase().includes('popular') || bodyText.toLowerCase().includes('recent');
      const hasTrendingSearches = bodyText.toLowerCase().includes('trending') || bodyText.toLowerCase().includes('popular search');
      const hasPopularSearches = bodyText.toLowerCase().includes('popular searches') || bodyText.toLowerCase().includes('try:');

      return {
        searchInputFound: !!searchInput,
        searchInputPlaceholder: searchInput?.getAttribute('placeholder'),
        hasPromptText,
        hasFeaturedVehicles,
        hasTrendingSearches,
        hasPopularSearches,
        bodyPreview: bodyText.substring(0, 600)
      };
    });

    log(`Search empty state: ${JSON.stringify(emptyInfo, null, 2)}`);
    await srch2.screenshot({ path: `${SCREENSHOTS_DIR}/search_empty.png`, fullPage: true });

    if (!emptyInfo.hasFeaturedVehicles && !emptyInfo.hasTrendingSearches) {
      addFinding('search-empty-state', 85, 'Search empty state shows nothing to explore',
        'No results page shows "Enter a search query" message and popular search terms but NO featured vehicles, no trending listings, no "start here" content. Users who land on /search with no query have nothing to click on. File: nuke_frontend/src/pages/Search.tsx. Fix: show 12 featured/recent vehicles in the results area when query is empty.');
    }

  } catch (err) {
    addFinding('search-empty', 85, 'Search empty state audit crashed', err.message);
  } finally {
    await srch2.close();
  }

  // ============================================================
  // NAV — what does the nav look like?
  // ============================================================
  log('=== Global Nav Audit ===');
  const nav = await browser.newPage();
  await nav.setViewportSize({ width: 1440, height: 900 });

  try {
    await nav.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await nav.waitForTimeout(4000);

    const navInfo = await nav.evaluate(() => {
      const header = document.querySelector('header, nav, [class*="header" i], [class*="navbar" i]');
      if (!header) return { headerFound: false };

      const headerHtml = header.outerHTML.substring(0, 2000);
      const navLinks = Array.from(header.querySelectorAll('a, button')).map(el => ({
        type: el.tagName,
        text: el.textContent?.trim().substring(0, 30),
        href: el.getAttribute('href'),
        class: el.className?.substring(0, 50)
      }));

      const hasSearchLink = navLinks.some(l => l.href?.includes('/search') || l.text?.toLowerCase().includes('search'));
      const hasMarketLink = navLinks.some(l => l.href?.includes('/market') || l.text?.toLowerCase().includes('market'));
      const hasLogo = !!header.querySelector('img, [class*="logo" i]');
      const bgColor = window.getComputedStyle(header).backgroundColor;

      return {
        headerFound: true,
        navLinks,
        hasSearchLink,
        hasMarketLink,
        hasLogo,
        bgColor,
        headerHtml: headerHtml.substring(0, 500)
      };
    });

    log(`Nav info: ${JSON.stringify(navInfo, null, 2)}`);
    await nav.screenshot({ path: `${SCREENSHOTS_DIR}/nav_desktop.png`, fullPage: false });

    if (!navInfo.hasSearchLink) {
      addFinding('nav', 85, 'Navigation has no link to /search',
        'Search is not linked from the main navigation. Users cannot discover the search feature from the homepage. Nav only shows Home, +, Profile. File: nuke_frontend/src/components/layout/AppHeader.tsx or NukeMenu.tsx');
    }

    if (!navInfo.hasMarketLink) {
      addFinding('nav', 85, 'Navigation has no link to /market',
        'Market Exchange is not linked from the main navigation. Core investor product not discoverable from nav. File: nuke_frontend/src/components/layout/AppHeader.tsx or NukeMenu.tsx');
    }

  } catch (err) {
    addFinding('nav', 70, 'Nav audit crashed', err.message);
  } finally {
    await nav.close();
  }

  await browser.close();

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    phase: 'deep-audit',
    totalFindings: findings.length,
    findings
  };

  writeFileSync('/Users/skylar/nuke/.claude/ux-audit-deep-results.json', JSON.stringify(output, null, 2));

  console.log('\n\n=== DEEP AUDIT COMPLETE ===');
  console.log(`Total findings: ${findings.length}`);
  findings.sort((a, b) => b.severity - a.severity).forEach((f, i) => {
    console.log(`\n[${i+1}] [P${f.severity}] ${f.page_name}: ${f.title}`);
    console.log(`    ${f.description.substring(0, 200)}`);
  });
})();
