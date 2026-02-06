/**
 * PersonaBot — Trait-driven Playwright agent
 * Uses real commenter personality data to shape browsing behavior.
 * No LLM calls — the persona traits themselves drive what the bot
 * looks for, cares about, and flags as issues.
 */

import { BotRunner } from '../BotRunner';
import type { BotPersona, AuthorPersonaRow } from '../types';

/** What the bot found on a page */
interface PageAudit {
  url: string;
  title: string;
  vehicleCount: number;
  hasSearch: boolean;
  hasFilters: boolean;
  hasImages: boolean;
  hasPricing: boolean;
  hasSpecs: boolean;
  hasComments: boolean;
  hasHistory: boolean;
  loadTimeMs: number;
  brokenImages: number;
  emptyStates: number;
  consoleErrors: number;
  missingElements: string[];
}

export class PersonaBot extends BotRunner {
  private authorRow: AuthorPersonaRow;
  private maxActions: number;
  private visitedUrls: Set<string> = new Set();

  constructor(
    botPersona: BotPersona,
    authorRow: AuthorPersonaRow,
    opts: { maxActions?: number } = {},
  ) {
    super(botPersona, {
      slowMo: 80,
    });
    this.authorRow = authorRow;
    this.maxActions = opts.maxActions || 15;
  }

  async execute(): Promise<void> {
    await this.start();
    const page = this.getPage();
    if (!page) return;

    const p = this.authorRow;
    console.log(`\n   Persona: ${p.username} (${p.primary_persona})`);
    console.log(`   Tone: helpful=${p.avg_tone_helpful?.toFixed(2)} technical=${p.avg_tone_technical?.toFixed(2)} snarky=${p.avg_tone_snarky?.toFixed(2)}`);
    console.log(`   Comments: ${p.total_comments} | Expertise: ${p.expertise_level}\n`);

    // Build a browsing plan based on persona type
    const plan = this.buildBrowsingPlan();
    console.log(`   Plan: ${plan.map(s => s.name).join(' → ')}\n`);

    for (const step of plan) {
      try {
        await step.fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        this.log(step.name, 'failure', msg);
      }
    }
  }

  // ─── Browsing plan builder ──────────────────────────────────

  private buildBrowsingPlan(): Array<{ name: string; fn: () => Promise<void> }> {
    const type = this.authorRow.primary_persona;
    const steps: Array<{ name: string; fn: () => Promise<void> }> = [];

    // Everyone starts at the homepage
    steps.push({ name: 'homepage', fn: () => this.auditHomepage() });

    switch (type) {
      case 'serious_buyer':
        steps.push({ name: 'vehicles', fn: () => this.browseVehicleList() });
        steps.push({ name: 'filter_by_make', fn: () => this.tryFilterByMake() });
        steps.push({ name: 'price_check', fn: () => this.auditPricing() });
        steps.push({ name: 'vehicle_detail', fn: () => this.deepDiveVehicleDetail() });
        steps.push({ name: 'search_specific', fn: () => this.searchForMakes() });
        steps.push({ name: 'compare', fn: () => this.tryCompareVehicles() });
        break;

      case 'helpful_expert':
        steps.push({ name: 'vehicles', fn: () => this.browseVehicleList() });
        steps.push({ name: 'vehicle_detail', fn: () => this.deepDiveVehicleDetail() });
        steps.push({ name: 'audit_specs', fn: () => this.auditTechnicalData() });
        steps.push({ name: 'search_specific', fn: () => this.searchForMakes() });
        steps.push({ name: 'check_comments', fn: () => this.auditCommentData() });
        break;

      case 'critic':
        steps.push({ name: 'vehicles', fn: () => this.browseVehicleList() });
        steps.push({ name: 'vehicle_detail', fn: () => this.deepDiveVehicleDetail() });
        steps.push({ name: 'broken_pages', fn: () => this.huntForBrokenPages() });
        steps.push({ name: 'search_edge', fn: () => this.searchEdgeCases() });
        steps.push({ name: 'empty_states', fn: () => this.testEmptyStates() });
        steps.push({ name: 'footer_links', fn: () => this.auditFooterLinks() });
        break;

      case 'dealer':
        steps.push({ name: 'vehicles', fn: () => this.browseVehicleList() });
        steps.push({ name: 'filter_by_make', fn: () => this.tryFilterByMake() });
        steps.push({ name: 'price_check', fn: () => this.auditPricing() });
        steps.push({ name: 'search_inventory', fn: () => this.searchForMakes() });
        steps.push({ name: 'vehicle_detail', fn: () => this.deepDiveVehicleDetail() });
        break;

      case 'platform_owner':
        // Skylar: metrics, data quality, coverage, every feature
        steps.push({ name: 'vehicles', fn: () => this.browseVehicleList() });
        steps.push({ name: 'data_coverage', fn: () => this.auditDataCoverage() });
        steps.push({ name: 'vehicle_detail', fn: () => this.deepDiveVehicleDetail() });
        steps.push({ name: 'quality_spotcheck', fn: () => this.spotCheckDataQuality() });
        steps.push({ name: 'market_dashboard', fn: () => this.auditMarketDashboard() });
        steps.push({ name: 'market_segments', fn: () => this.auditMarketSegments() });
        steps.push({ name: 'collections_map', fn: () => this.auditCollectionsMap() });
        steps.push({ name: 'search_specific', fn: () => this.searchForMakes() });
        steps.push({ name: 'admin_check', fn: () => this.checkAdminPages() });
        steps.push({ name: 'admin_analytics', fn: () => this.auditAdminAnalytics() });
        steps.push({ name: 'console_audit', fn: () => this.deepConsoleAudit() });
        steps.push({ name: 'perf_check', fn: () => this.auditPerformance() });
        break;

      case 'dev':
        // Dev sim: console errors, network, perf, a11y, every route
        steps.push({ name: 'vehicles', fn: () => this.browseVehicleList() });
        steps.push({ name: 'console_audit', fn: () => this.deepConsoleAudit() });
        steps.push({ name: 'vehicle_detail', fn: () => this.deepDiveVehicleDetail() });
        steps.push({ name: 'market_dashboard', fn: () => this.auditMarketDashboard() });
        steps.push({ name: 'market_segments', fn: () => this.auditMarketSegments() });
        steps.push({ name: 'network_audit', fn: () => this.auditNetworkRequests() });
        steps.push({ name: 'perf_check', fn: () => this.auditPerformance() });
        steps.push({ name: 'broken_pages', fn: () => this.huntForBrokenPages() });
        steps.push({ name: 'a11y_check', fn: () => this.auditAccessibility() });
        steps.push({ name: 'collections_map', fn: () => this.auditCollectionsMap() });
        steps.push({ name: 'search_edge', fn: () => this.searchEdgeCases() });
        steps.push({ name: 'all_routes', fn: () => this.smokeTestAllRoutes() });
        break;

      case 'casual_enthusiast':
      default:
        steps.push({ name: 'vehicles', fn: () => this.browseVehicleList() });
        steps.push({ name: 'browse_photos', fn: () => this.browseForPhotos() });
        steps.push({ name: 'vehicle_detail', fn: () => this.deepDiveVehicleDetail() });
        steps.push({ name: 'search_fun', fn: () => this.searchForFunCars() });
        steps.push({ name: 'footer_links', fn: () => this.auditFooterLinks() });
        break;
    }

    return steps.slice(0, this.maxActions);
  }

  // ─── Page auditing ──────────────────────────────────────────

  private async auditPage(): Promise<PageAudit> {
    const page = this.getPage()!;
    const url = page.url();

    const audit = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      let brokenImages = 0;
      imgs.forEach(img => {
        if (img.naturalWidth === 0 && img.src && !img.src.startsWith('data:')) brokenImages++;
      });

      return {
        title: document.title,
        vehicleCount: document.querySelectorAll('a[href*="/vehicle"], [data-testid="vehicle-card"], .vehicle-card, [class*="VehicleCard"]').length,
        hasSearch: !!document.querySelector('input[type="search"], input[placeholder*="earch"], [data-testid="search"]'),
        hasFilters: !!document.querySelector('[class*="filter"], [data-testid*="filter"], select[name="make"], button:is([class*="filter"])'),
        hasImages: imgs.length > 0,
        hasPricing: !!document.body.innerText.match(/\$[\d,]+/),
        hasSpecs: !!document.body.innerText.match(/(VIN|mileage|engine|transmission|horsepower)/i),
        hasComments: !!document.querySelector('[class*="comment"], [data-testid*="comment"]'),
        hasHistory: !!document.querySelector('[class*="history"], [class*="timeline"], [data-testid*="history"]'),
        brokenImages,
        emptyStates: document.querySelectorAll('[class*="empty"], [class*="no-result"]').length,
        missingElements: [] as string[],
      };
    });

    return { url, loadTimeMs: 0, consoleErrors: 0, ...audit };
  }

  /** Poll for vehicle links to appear (homepage loads data async from supabase) */
  private async waitForVehicleLinks(timeoutMs = 8000): Promise<number> {
    const page = this.getPage()!;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const count = await page.$$eval(
        'a[href*="/vehicle/"], tr[style*="cursor: pointer"], [data-testid="vehicle-card"]',
        els => els.length
      );
      if (count > 0) return count;
      await this.sleep(500);
    }
    return 0;
  }

  // ─── Step implementations ───────────────────────────────────

  private async auditHomepage(): Promise<void> {
    const loaded = await this.navigate('/');
    if (!loaded) return;
    // Homepage loads vehicle data async from supabase — poll until links appear
    await this.waitForVehicleLinks(8000);

    const audit = await this.auditPage();
    const type = this.authorRow.primary_persona;

    this.log('homepage', 'success', `"${audit.title}" — ${audit.vehicleCount} vehicle links`);

    // Persona-specific expectations
    if (type === 'serious_buyer' && !audit.hasSearch) {
      await this.reportFinding('ux_friction', 'high',
        `[${type}] No search on homepage`,
        `${this.authorRow.username} wants to search for vehicles to buy but can't find a search box on the homepage`);
    }
    if (type === 'dealer' && !audit.hasPricing) {
      await this.reportFinding('ux_friction', 'medium',
        `[${type}] No pricing visible on homepage`,
        `${this.authorRow.username} (dealer) wants to see market prices immediately`);
    }
    if (audit.brokenImages > 0) {
      await this.reportFinding('bug', 'medium',
        `${audit.brokenImages} broken images on homepage`,
        `Found ${audit.brokenImages} images that failed to load on the homepage`);
    }
  }

  private async browseVehicleList(): Promise<void> {
    const page = this.getPage()!;

    // Homepage renders vehicle cards as <a href="/vehicle/{uuid}"> after async data loads
    // Check if we already have vehicle links on the current page (from homepage)
    let vehicleLinks = await page.$$('a[href*="/vehicle/"]');
    if (vehicleLinks.length === 0) {
      // Navigate to homepage which shows all vehicles in a feed
      await this.navigate('/');
      await this.waitForVehicleLinks(8000);
    }
    await this.sleep(500);

    const audit = await this.auditPage();
    this.log('vehicle_list', 'success', `${audit.vehicleCount} vehicles found`);

    if (audit.vehicleCount === 0) {
      await this.reportFinding('bug', 'critical',
        'Vehicle listing page shows no vehicles',
        'Navigated to vehicles page but found zero vehicle cards/links');
    }

    // Scroll to load more (test lazy loading)
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await this.sleep(500);
    }

    const afterScroll = await this.auditPage();
    if (afterScroll.vehicleCount > audit.vehicleCount) {
      this.log('lazy_load', 'success', `Loaded ${afterScroll.vehicleCount - audit.vehicleCount} more vehicles on scroll`);
    }
  }

  private async tryFilterByMake(): Promise<void> {
    const page = this.getPage()!;
    const makes = this.authorRow.unique_makes;
    const searchMake = makes?.length ? makes[0] : 'Porsche';

    // Try various filter UI patterns
    const filterSelectors = [
      '[data-testid="make-filter"]',
      'select[name="make"]',
      'button:has-text("Make")',
      '[class*="filter"] select',
      '[class*="filter"] button',
    ];

    let foundFilter = false;
    for (const sel of filterSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          foundFilter = true;
          await el.click();
          await this.sleep(500);

          // Try to select make
          const option = await page.$(`option:has-text("${searchMake}")`);
          if (option) {
            await page.selectOption(sel, { label: searchMake });
            this.log('filter', 'success', `Filtered by ${searchMake}`);
          } else {
            this.log('filter', 'warning', `Make "${searchMake}" not in filter options`);
          }
          await this.sleep(1000);
          break;
        }
      } catch { /* try next */ }
    }

    if (!foundFilter) {
      const severity = this.authorRow.primary_persona === 'serious_buyer' ? 'high' : 'medium';
      await this.reportFinding('ux_friction', severity,
        `[${this.authorRow.primary_persona}] No make filter found`,
        `${this.authorRow.username} wanted to filter vehicles by make but no filter UI was found`);
    }
  }

  private async auditPricing(): Promise<void> {
    const page = this.getPage()!;
    const type = this.authorRow.primary_persona;

    const priceData = await page.evaluate(() => {
      const text = document.body.innerText;
      const prices = text.match(/\$[\d,]+/g) || [];
      return {
        priceCount: prices.length,
        prices: prices.slice(0, 5),
        hasNoPrice: text.includes('No price') || text.includes('N/A') || text.includes('Contact'),
        hasSoldLabel: /sold|hammer|final/i.test(text),
      };
    });

    if (priceData.priceCount === 0 && (type === 'serious_buyer' || type === 'dealer')) {
      await this.reportFinding('ux_friction', 'high',
        `[${type}] No prices visible on current page`,
        `${this.authorRow.username} is looking at vehicles but can't see any pricing. URL: ${page.url()}`);
    } else {
      this.log('pricing', 'success', `${priceData.priceCount} prices visible (${priceData.prices.slice(0, 3).join(', ')})`);
    }
  }

  private async deepDiveVehicleDetail(): Promise<void> {
    const page = this.getPage()!;
    const type = this.authorRow.primary_persona;

    // Find and click a vehicle
    let vehicleLinks = await page.$$('a[href*="/vehicle/"]');
    if (vehicleLinks.length === 0) {
      // Homepage renders vehicle cards as <a> tags; /vehicle/list uses onClick divs
      await this.navigate('/');
      await this.waitForVehicleLinks(10000);
      vehicleLinks = await page.$$('a[href*="/vehicle/"]');
      if (vehicleLinks.length === 0) {
        this.log('vehicle_detail', 'warning', 'No vehicle links found to click after 10s wait');
        return;
      }
    }

    // Pick a vehicle — experts pick one further down, casuals pick top
    const links = await page.$$('a[href*="/vehicle/"]');
    const pickIndex = type === 'helpful_expert'
      ? Math.min(3, links.length - 1)
      : type === 'critic'
        ? Math.min(5, links.length - 1)
        : 0;

    const link = links[Math.max(0, pickIndex)];
    if (!link) return;

    const href = await link.getAttribute('href');
    await link.click();
    await this.sleep(2000);

    const audit = await this.auditPage();
    this.log('vehicle_detail', 'success', `Viewing: ${audit.title}`);
    this.visitedUrls.add(page.url());

    // Persona-specific checks on detail page
    if (type === 'helpful_expert' || type === 'serious_buyer') {
      if (!audit.hasSpecs) {
        await this.reportFinding('ux_friction', 'high',
          `[${type}] Vehicle detail page missing specs`,
          `${this.authorRow.username} expects VIN, mileage, engine details but found none. URL: ${page.url()}`);
      }
    }

    if (type === 'serious_buyer') {
      if (!audit.hasPricing) {
        await this.reportFinding('ux_friction', 'high',
          `[${type}] Vehicle detail page missing price`,
          `${this.authorRow.username} wants to know the price but it's not visible. URL: ${page.url()}`);
      }
    }

    if (type === 'casual_enthusiast' || type === 'critic') {
      if (!audit.hasImages) {
        await this.reportFinding('ux_friction', 'high',
          `[${type}] Vehicle detail page has no images`,
          `${this.authorRow.username} came to look at cars but there are no photos. URL: ${page.url()}`);
      }
    }

    if (audit.brokenImages > 0) {
      await this.reportFinding('bug', 'medium',
        `${audit.brokenImages} broken images on vehicle detail`,
        `Vehicle page has ${audit.brokenImages} images that failed to load. URL: ${page.url()}`);
    }

    // Scroll through the detail page
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await this.sleep(400);
    }

    // Check for back navigation
    const hasBack = await page.$('a:has-text("Back"), button:has-text("Back"), [aria-label="Back"], nav[aria-label="breadcrumb"], [class*="breadcrumb"]');
    if (!hasBack && type === 'casual_enthusiast') {
      await this.reportFinding('ux_friction', 'low',
        'Vehicle detail has no obvious back navigation',
        'No back button or breadcrumbs visible on vehicle detail page');
    }

    // Go back for next steps
    await page.goBack();
    await this.sleep(1000);
  }

  private async auditTechnicalData(): Promise<void> {
    const page = this.getPage()!;

    // Navigate to a vehicle detail if not already on one
    if (!page.url().includes('/vehicle/')) {
      const links = await page.$$('a[href*="/vehicle/"]');
      if (links.length > 0) {
        await links[0].click();
        await this.sleep(2000);
      } else {
        return;
      }
    }

    const techData = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasVIN: /\b[A-HJ-NPR-Z0-9]{17}\b/.test(text),
        hasMileage: /\b[\d,]+\s*(miles|mi|km)\b/i.test(text),
        hasEngine: /\b(engine|motor|cylinder|liter|displacement)\b/i.test(text),
        hasTransmission: /\b(manual|automatic|transmission|speed|gearbox)\b/i.test(text),
        hasYear: /\b(19|20)\d{2}\b/.test(text),
        hasMakeModel: /\b(Porsche|BMW|Mercedes|Ford|Chevrolet|Toyota|Ferrari|Lamborghini)\b/i.test(text),
      };
    });

    const missing: string[] = [];
    if (!techData.hasVIN) missing.push('VIN');
    if (!techData.hasMileage) missing.push('Mileage');
    if (!techData.hasEngine) missing.push('Engine');
    if (!techData.hasTransmission) missing.push('Transmission');

    if (missing.length > 0) {
      this.log('tech_audit', 'warning', `Missing: ${missing.join(', ')}`);
      if (missing.length >= 3) {
        await this.reportFinding('ux_friction', 'high',
          `[helpful_expert] Vehicle detail missing key specs: ${missing.join(', ')}`,
          `${this.authorRow.username} (expert) expects comprehensive technical data. Missing: ${missing.join(', ')}. URL: ${page.url()}`);
      }
    } else {
      this.log('tech_audit', 'success', 'All key technical fields present');
    }

    await page.goBack();
    await this.sleep(800);
  }

  private async auditCommentData(): Promise<void> {
    const page = this.getPage()!;

    // Navigate to a vehicle that should have comments
    if (!page.url().includes('/vehicle/')) {
      const links = await page.$$('a[href*="/vehicle/"]');
      if (links.length > 1) {
        await links[1].click();
        await this.sleep(2000);
      } else {
        return;
      }
    }

    // Scroll down to where comments would be
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.sleep(1000);

    const hasComments = await page.$('[class*="comment"], [data-testid*="comment"], #comments, [id*="comment"]');

    if (!hasComments) {
      this.log('comments', 'warning', 'No comment section visible');
      // For an expert, this is a bigger deal — they want to see community discussion
      await this.reportFinding('ux_friction', 'medium',
        '[helpful_expert] No comment/discussion section on vehicle detail',
        `${this.authorRow.username} is an active commenter and expects to see community discussion. URL: ${page.url()}`);
    } else {
      this.log('comments', 'success', 'Comment section found');
    }

    await page.goBack();
    await this.sleep(800);
  }

  private async searchForMakes(): Promise<void> {
    const page = this.getPage()!;
    const makes = this.authorRow.unique_makes;
    const searchTerm = makes?.length ? makes[0] : 'BMW';

    await this.performSearch(searchTerm);
  }

  private async searchForFunCars(): Promise<void> {
    const funSearches = ['Corvette', 'Mustang', 'Porsche 911', 'Land Cruiser'];
    const pick = funSearches[Math.floor(Math.random() * funSearches.length)];
    await this.performSearch(pick);
  }

  private async searchEdgeCases(): Promise<void> {
    // Critics try to break things
    const edgeCases = [
      { term: '', label: 'empty search' },
      { term: 'xyznotacar99999', label: 'nonexistent' },
      { term: '<script>alert(1)</script>', label: 'XSS attempt' },
      { term: 'a', label: 'single character' },
    ];

    for (const { term, label } of edgeCases) {
      await this.navigate('/vehicles');
      await this.sleep(1000);
      await this.performSearch(term, label);
    }
  }

  private async performSearch(term: string, label?: string): Promise<void> {
    const page = this.getPage()!;
    const desc = label || term;

    const searchSelectors = [
      'input[type="search"]',
      'input[placeholder*="earch"]',
      '[data-testid="search-input"]',
      'input[name="q"]',
      'input[name="search"]',
    ];

    let found = false;
    for (const sel of searchSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          found = true;
          await this.type(sel, term, `Search: ${desc}`);
          await this.sleep(500);
          await page.keyboard.press('Enter');
          await this.sleep(2000);

          // Check results
          const resultCount = await page.$$('a[href*="/vehicle/"], [data-testid="vehicle-card"], .vehicle-card');

          if (term && term.length > 3 && resultCount.length === 0) {
            // Check for helpful empty state
            const emptyMsg = await page.$('[class*="empty"], [class*="no-result"], text=/no .*(result|vehicle)/i');
            if (!emptyMsg) {
              await this.reportFinding('ux_friction', 'medium',
                `No results message for search "${desc}"`,
                `Search for "${term}" returned nothing but there's no helpful empty state message`);
            } else {
              this.log('search', 'success', `"${desc}" → empty with helpful message`);
            }
          } else {
            this.log('search', 'success', `"${desc}" → ${resultCount.length} results`);
          }

          // Check for XSS reflection
          if (term.includes('<') && term.includes('>')) {
            const bodyHtml = await page.content();
            if (bodyHtml.includes(term) && !bodyHtml.includes(encodeURIComponent(term))) {
              await this.reportFinding('bug', 'critical',
                'Potential XSS: unescaped input reflected in page',
                `Search input "${term}" was reflected unescaped in page HTML`);
            }
          }

          break;
        }
      } catch { /* try next */ }
    }

    if (!found) {
      this.log('search', 'warning', 'No search input found on page');
    }
  }

  private async browseForPhotos(): Promise<void> {
    const page = this.getPage()!;

    // Casual browsers want big, beautiful photos
    let links = await page.$$('a[href*="/vehicle/"]');
    if (links.length === 0) {
      await this.navigate('/');
      await this.waitForVehicleLinks(8000);
      links = await page.$$('a[href*="/vehicle/"]');
      if (links.length === 0) return;
    }

    // Click a random vehicle
    const idx = Math.floor(Math.random() * Math.min(links.length, 8));
    await links[idx].click();
    await this.sleep(2000);

    const imageData = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      let total = 0;
      let broken = 0;
      let tiny = 0;
      imgs.forEach(img => {
        if (img.src && !img.src.startsWith('data:')) {
          total++;
          if (img.naturalWidth === 0) broken++;
          if (img.naturalWidth > 0 && img.naturalWidth < 100) tiny++;
        }
      });
      return { total, broken, tiny };
    });

    this.log('photos', 'success', `${imageData.total} images (${imageData.broken} broken, ${imageData.tiny} tiny)`);

    if (imageData.total < 2) {
      await this.reportFinding('ux_friction', 'medium',
        '[casual_enthusiast] Very few photos on vehicle page',
        `${this.authorRow.username} came to browse car photos but only found ${imageData.total} image(s). URL: ${page.url()}`);
    }

    if (imageData.broken > 0) {
      await this.reportFinding('bug', 'medium',
        `${imageData.broken} broken images on vehicle page`,
        `URL: ${page.url()}`);
    }

    await page.goBack();
    await this.sleep(800);
  }

  private async tryCompareVehicles(): Promise<void> {
    const page = this.getPage()!;

    // Serious buyers want to compare — check if the feature exists
    const compareBtn = await page.$('button:has-text("Compare"), a:has-text("Compare"), [data-testid*="compare"]');

    if (!compareBtn) {
      await this.reportFinding('ux_friction', 'low',
        '[serious_buyer] No vehicle comparison feature',
        `${this.authorRow.username} wants to compare vehicles side-by-side but no compare feature exists`);
    } else {
      this.log('compare', 'success', 'Compare feature found');
    }
  }

  private async huntForBrokenPages(): Promise<void> {
    // Critics poke at unusual URLs
    const testPaths = [
      '/vehicle/00000000-0000-0000-0000-000000000000',
      '/vehicles?page=-1',
      '/vehicles?make=',
      '/this-page-does-not-exist',
    ];

    for (const path of testPaths) {
      const page = this.getPage()!;
      const startTime = Date.now();

      try {
        const response = await page.goto(`${page.url().split('/').slice(0, 3).join('/')}${path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 10000,
        });
        const loadTime = Date.now() - startTime;

        if (!response) {
          await this.reportFinding('bug', 'medium', `No response for ${path}`);
          continue;
        }

        const status = response.status();

        if (status >= 500) {
          await this.reportFinding('bug', 'high',
            `Server error ${status} on ${path}`,
            `URL ${path} returned HTTP ${status}`);
        } else if (status === 404) {
          // Check for proper 404 page
          const hasHomeLink = await page.$('a[href="/"], a:has-text("Home")');
          if (!hasHomeLink) {
            await this.reportFinding('ux_friction', 'medium',
              `[critic] 404 page for ${path} has no way home`,
              'Users who hit this page have no obvious navigation back');
          }
          this.log('broken_page', 'success', `${path} → proper 404`);
        } else {
          // Page loaded — check it's not blank/broken
          const bodyText = await page.evaluate(() => document.body?.innerText?.trim().length || 0);
          if (bodyText < 20) {
            await this.reportFinding('bug', 'medium',
              `[critic] Near-empty page at ${path}`,
              `Page loaded with status ${status} but has almost no content (${bodyText} chars)`);
          } else {
            this.log('broken_page', 'success', `${path} → ${status}, ${bodyText} chars`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'error';
        if (msg.includes('timeout')) {
          await this.reportFinding('performance', 'high',
            `[critic] Page timeout: ${path}`,
            `${path} didn't load within 10 seconds`);
        }
      }
    }
  }

  private async testEmptyStates(): Promise<void> {
    const page = this.getPage()!;

    // Navigate with impossible filters to test empty states
    await this.navigate('/vehicles');
    await this.sleep(1500);

    await this.performSearch('xyznothing12345nonexistent', 'impossible search');
  }

  private async auditFooterLinks(): Promise<void> {
    const page = this.getPage()!;
    await this.navigate('/');
    await this.sleep(1000);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.sleep(500);

    const footerLinks = await page.$$('footer a');
    const brokenLinks: string[] = [];

    for (const link of footerLinks.slice(0, 5)) {
      const href = await link.getAttribute('href');
      const text = await link.innerText();
      if (href && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
        this.log('footer', 'success', `Link: ${text.trim()} → ${href}`);
      }
    }

    if (footerLinks.length === 0) {
      await this.reportFinding('ux_friction', 'low',
        'No footer links found',
        'Page has no footer navigation links (About, Contact, Privacy, etc.)');
    }
  }

  // ─── Shared deep-test steps (market, map, admin) ───────────

  private async auditMarketDashboard(): Promise<void> {
    const page = this.getPage()!;
    const type = this.authorRow.primary_persona;

    await this.navigate('/market');
    await this.sleep(3000);

    const market = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasSegments: /segment/i.test(text),
        hasETFs: /etf|fund|index/i.test(text),
        hasPrices: /\$[\d,]+/.test(text),
        hasCharts: document.querySelectorAll('canvas, svg, [class*="chart"], [class*="Chart"]').length,
        hasVehicleCount: /\d+\s*vehicle/i.test(text),
        hasMarketCap: /market\s*cap/i.test(text),
        bodyLength: text.length,
        hasError: /error|failed|undefined|null/i.test(text),
      };
    });

    this.log('market', 'success',
      `Market dashboard: ${market.bodyLength} chars, ${market.hasCharts} charts, segments=${market.hasSegments}, prices=${market.hasPrices}`);

    if (market.bodyLength < 100) {
      await this.reportFinding('bug', 'high',
        `[${type}] Market dashboard is nearly empty`,
        `Market page at /market has only ${market.bodyLength} chars of content`);
    }

    if (!market.hasSegments && !market.hasETFs) {
      await this.reportFinding('ux_friction', 'medium',
        `[${type}] Market dashboard missing segments/ETFs`,
        'No market segments or ETF data visible on market dashboard');
    }

    if (market.hasError) {
      await this.reportFinding('bug', 'medium',
        `[${type}] Market dashboard shows error text`,
        'Error/failed/undefined visible in market dashboard page text');
    }

    // Scroll to see lazy-loaded content
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await this.sleep(500);
    }
  }

  private async auditMarketSegments(): Promise<void> {
    const page = this.getPage()!;
    const type = this.authorRow.primary_persona;

    await this.navigate('/market/segments');
    await this.sleep(3000);

    // Segments render as <button title="Open segment">, not <a> tags
    const segmentTiles = await page.$$('button[title="Open segment"]');

    this.log('segments', 'success', `Found ${segmentTiles.length} market segment tiles`);

    if (segmentTiles.length === 0) {
      // Also check for the "No segments returned" empty state
      const bodyText = await page.evaluate(() => document.body.innerText);
      const hasEmpty = /no segments returned/i.test(bodyText);
      const hasLoading = /loading market segments/i.test(bodyText);
      const hasError = /error/i.test(bodyText);

      await this.reportFinding('bug', 'high',
        `[${type}] No market segments found on /market/segments`,
        `Page shows 0 segment tiles. Empty state: ${hasEmpty}, loading stuck: ${hasLoading}, error: ${hasError}`);
      return;
    }

    // Click into the first segment for drill-down testing
    const firstName = await segmentTiles[0].evaluate(el => el.querySelector('div')?.textContent || 'unknown');
    await segmentTiles[0].click();
    await this.sleep(3000);

    const currentUrl = page.url();
    const detail = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasVehicles: /\d+\s*vehicle/i.test(text),
        hasPrices: /\$[\d,]+/.test(text),
        hasSubcategories: document.querySelectorAll('[class*="subcategor"], [class*="Subcategor"]').length > 0 ||
          /subcategor/i.test(text),
        hasChart: document.querySelectorAll('canvas, svg, [class*="chart"]').length > 0,
        bodyLength: text.length,
      };
    });

    this.log('segment_detail', 'success',
      `Segment detail (${firstName} → ${currentUrl}): ${detail.bodyLength} chars, vehicles=${detail.hasVehicles}, subcategories=${detail.hasSubcategories}`);

    if (detail.bodyLength < 100) {
      await this.reportFinding('bug', 'high',
        `[${type}] Market segment detail page is empty`,
        `Drilled into segment "${firstName}" (${currentUrl}) but page has only ${detail.bodyLength} chars`);
    }

    if (!detail.hasVehicles && !detail.hasPrices) {
      await this.reportFinding('ux_friction', 'medium',
        `[${type}] Segment detail has no vehicle/price data`,
        `Segment "${firstName}" (${currentUrl}) loaded but shows no vehicle counts or pricing`);
    }

    await page.goBack();
    await this.sleep(1000);
  }

  private async auditCollectionsMap(): Promise<void> {
    const page = this.getPage()!;
    const type = this.authorRow.primary_persona;

    await this.navigate('/collections-map');
    await this.sleep(6000); // Maps take longer to load (Leaflet init + tile fetch)

    const mapState = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      return {
        hasLeaflet: !!document.querySelector('.leaflet-container, [class*="leaflet"]'),
        hasMapTiles: document.querySelectorAll('.leaflet-tile, img[src*="tile"]').length,
        hasMarkers: document.querySelectorAll('.leaflet-marker-icon, .custom-marker, [class*="marker"]').length,
        hasMapBox: !!document.querySelector('[class*="map"], [id*="map"]'),
        bodyLength: bodyText.length,
        hasError: /error|failed/i.test(bodyText),
        hasLoading: /loading/i.test(bodyText),
        hasCountries: /countries/i.test(bodyText),
        hasCollections: /collections/i.test(bodyText),
        // Debug: check if the flex-1 container has height
        mapContainerHeight: (() => {
          const el = document.querySelector('.leaflet-container') as HTMLElement;
          return el ? el.clientHeight : -1;
        })(),
        outerDivClasses: document.querySelector('.fullscreen-content')?.className || 'no-fullscreen-content',
      };
    });

    this.log('map', 'success',
      `Collections map: leaflet=${mapState.hasLeaflet}, tiles=${mapState.hasMapTiles}, markers=${mapState.hasMarkers}, height=${mapState.mapContainerHeight}, loading=${mapState.hasLoading}, collections=${mapState.hasCollections}`);

    if (!mapState.hasLeaflet && !mapState.hasMapBox) {
      await this.reportFinding('bug', 'high',
        `[${type}] Collections map not rendering`,
        `No map container found. Loading: ${mapState.hasLoading}, Error: ${mapState.hasError}, Body: ${mapState.bodyLength} chars, Classes: ${mapState.outerDivClasses}`);
    } else if (mapState.mapContainerHeight < 10) {
      await this.reportFinding('bug', 'high',
        `[${type}] Collections map has zero height`,
        `Leaflet container exists but has height ${mapState.mapContainerHeight}px — CSS layout issue`);
    } else if (mapState.hasMarkers === 0) {
      await this.reportFinding('ux_friction', 'medium',
        `[${type}] Collections map has no markers/data points`,
        `Map renders (${mapState.mapContainerHeight}px height) but shows no collection markers. Tiles: ${mapState.hasMapTiles}`);
    }
  }

  private async auditAdminAnalytics(): Promise<void> {
    const page = this.getPage()!;
    const type = this.authorRow.primary_persona;

    const adminPages = [
      { path: '/admin/analytics', name: 'Inventory Analytics' },
      { path: '/admin/mission-control', name: 'Mission Control' },
      { path: '/admin/database-audit', name: 'Database Audit' },
      { path: '/admin/data-diagnostic', name: 'Data Diagnostic' },
      { path: '/admin/extraction-monitor', name: 'Extraction Monitor' },
      { path: '/admin/bot-testing', name: 'Bot Test Dashboard' },
    ];

    for (const { path, name } of adminPages) {
      try {
        await this.navigate(path);
        await this.sleep(2500);

        const audit = await page.evaluate(() => {
          const text = document.body.innerText;
          return {
            bodyLength: text.length,
            hasNumbers: /\d{2,}/.test(text), // at least 2-digit numbers = data
            hasCharts: document.querySelectorAll('canvas, svg, [class*="chart"], [class*="Chart"]').length,
            hasTable: document.querySelectorAll('table, [role="grid"], [class*="table"]').length,
            hasError: /error|failed|exception/i.test(text),
            hasNull: /\bnull\b|undefined|NaN/.test(text),
          };
        });

        const issues: string[] = [];
        if (audit.bodyLength < 100) issues.push('nearly empty');
        if (audit.hasError) issues.push('has error text');
        if (audit.hasNull) issues.push('shows null/undefined');
        if (!audit.hasNumbers && audit.bodyLength > 200) issues.push('no numeric data');

        if (issues.length > 0) {
          await this.reportFinding('bug', issues.includes('has error text') ? 'high' : 'medium',
            `[${type}] ${name} (${path}): ${issues.join(', ')}`,
            `Admin page ${name} issues: ${issues.join(', ')}. Body: ${audit.bodyLength} chars, charts: ${audit.hasCharts}, tables: ${audit.hasTable}`);
        } else {
          this.log('admin_page', 'success',
            `${name}: ${audit.bodyLength} chars, ${audit.hasCharts} charts, ${audit.hasTable} tables`);
        }
      } catch {
        // Page might require specific auth level
      }
    }
  }

  private async smokeTestAllRoutes(): Promise<void> {
    const page = this.getPage()!;

    // Hit every major route and check for crashes
    const routes = [
      '/vehicle/list',
      '/market',
      '/market/segments',
      '/market/browse',
      '/market/movement',
      '/search',
      '/collections-map',
      '/auctions',
      '/debrief',
      '/admin',
      '/admin/analytics',
      '/admin/mission-control',
      '/admin/ralph',
      '/admin/status',
      '/admin/bot-testing',
    ];

    const results: Array<{ route: string; status: string; chars: number }> = [];

    for (const route of routes) {
      try {
        const response = await page.goto(
          `${page.url().split('/').slice(0, 3).join('/')}${route}`,
          { waitUntil: 'domcontentloaded', timeout: 8000 },
        );

        await this.sleep(1500);
        const bodyLen = await page.evaluate(() => document.body?.innerText?.trim().length || 0);
        const status = response?.status()?.toString() || 'no response';

        results.push({ route, status, chars: bodyLen });

        if (!response || response.status() >= 500) {
          await this.reportFinding('bug', 'high',
            `[dev] Route ${route} returns ${status}`,
            `Smoke test: ${route} → HTTP ${status}`);
        } else if (bodyLen < 30) {
          await this.reportFinding('bug', 'medium',
            `[dev] Route ${route} is blank (${bodyLen} chars)`,
            `Page loaded (${status}) but has almost no content`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'error';
        results.push({ route, status: msg.substring(0, 30), chars: 0 });
        if (msg.includes('timeout')) {
          await this.reportFinding('performance', 'high',
            `[dev] Route ${route} timed out`,
            `Page didn't load within 8 seconds`);
        }
      }
    }

    // Print summary table
    console.log('\n   Route smoke test results:');
    for (const r of results) {
      const icon = r.chars > 100 ? '✓' : r.chars > 0 ? '⚠' : '✗';
      console.log(`   ${icon} ${r.route.padEnd(30)} ${r.status.padEnd(6)} ${r.chars} chars`);
    }
    console.log('');
  }

  // ─── Platform Owner (Skylar) steps ──────────────────────────

  private async auditDataCoverage(): Promise<void> {
    const page = this.getPage()!;

    // Skylar cares about: how many vehicles, do they have images, prices, YMM data
    const coverage = await page.evaluate(() => {
      const cards = document.querySelectorAll('a[href*="/vehicle/"], [data-testid="vehicle-card"], .vehicle-card, [class*="VehicleCard"]');
      let withImages = 0;
      let withPrices = 0;
      let withYear = 0;

      cards.forEach(card => {
        const text = card.textContent || '';
        const imgs = card.querySelectorAll('img');
        if (imgs.length > 0) withImages++;
        if (/\$[\d,]+/.test(text)) withPrices++;
        if (/\b(19|20)\d{2}\b/.test(text)) withYear++;
      });

      return {
        total: cards.length,
        withImages,
        withPrices,
        withYear,
      };
    });

    const imgPct = coverage.total > 0 ? Math.round(coverage.withImages / coverage.total * 100) : 0;
    const pricePct = coverage.total > 0 ? Math.round(coverage.withPrices / coverage.total * 100) : 0;
    const yearPct = coverage.total > 0 ? Math.round(coverage.withYear / coverage.total * 100) : 0;

    this.log('data_coverage', 'success',
      `${coverage.total} vehicles — images: ${imgPct}%, prices: ${pricePct}%, year: ${yearPct}%`);

    if (coverage.total > 0 && imgPct < 50) {
      await this.reportFinding('ux_friction', 'high',
        `[platform_owner] Only ${imgPct}% of vehicles have images`,
        `${coverage.withImages}/${coverage.total} vehicle cards show images. This is below quality threshold.`);
    }
    if (coverage.total > 0 && pricePct < 30) {
      await this.reportFinding('ux_friction', 'high',
        `[platform_owner] Only ${pricePct}% of vehicles show prices`,
        `${coverage.withPrices}/${coverage.total} vehicle cards show pricing. Data coverage gap.`);
    }
  }

  private async spotCheckDataQuality(): Promise<void> {
    const page = this.getPage()!;

    // Navigate to a vehicle detail and scrutinize the data
    const links = await page.$$('a[href*="/vehicle/"]');
    if (links.length === 0) {
      await this.navigate('/vehicles');
      await this.sleep(2000);
    }

    const allLinks = await page.$$('a[href*="/vehicle/"]');
    // Check 3 random vehicles for data quality
    const checkCount = Math.min(3, allLinks.length);
    const indices = Array.from({ length: allLinks.length }, (_, i) => i)
      .sort(() => Math.random() - 0.5)
      .slice(0, checkCount);

    for (const idx of indices) {
      const link = allLinks[idx];
      if (!link) continue;

      await link.click();
      await this.sleep(2000);

      const quality = await page.evaluate(() => {
        const text = document.body.innerText;
        const title = document.title;
        return {
          title,
          hasYear: /\b(19|20)\d{2}\b/.test(text),
          hasMake: /\b(Porsche|BMW|Mercedes|Ford|Chevrolet|Toyota|Honda|Audi|Volkswagen|Dodge|Jeep|Ferrari|Lamborghini|Corvette|Mustang)\b/i.test(text),
          hasPrice: /\$[\d,]+/.test(text),
          hasMileage: /\b[\d,]+\s*(miles|mi|km)\b/i.test(text),
          hasImages: document.querySelectorAll('img[src]:not([src^="data:"])').length,
          hasDescription: text.length > 500,
          hasVIN: /\b[A-HJ-NPR-Z0-9]{17}\b/.test(text),
          // Skylar's pet peeve: fabricated or nonsensical data
          suspiciousPrice: (() => {
            const prices = text.match(/\$[\d,]+/g) || [];
            return prices.some(p => {
              const num = parseInt(p.replace(/[$,]/g, ''));
              return num > 50_000_000 || num === 0; // $50M+ or $0 is suspect
            });
          })(),
          hasNullText: /\bnull\b|undefined|NaN/.test(text),
        };
      });

      const issues: string[] = [];
      if (!quality.hasYear) issues.push('no year');
      if (!quality.hasMake) issues.push('no make');
      if (!quality.hasPrice) issues.push('no price');
      if (quality.hasImages < 1) issues.push('no images');
      if (quality.suspiciousPrice) issues.push('SUSPICIOUS PRICE');
      if (quality.hasNullText) issues.push('LITERAL null/undefined IN TEXT');

      if (issues.length > 0) {
        const severity = issues.some(i => i.startsWith('SUSPICIOUS') || i.startsWith('LITERAL')) ? 'high' : 'medium';
        await this.reportFinding('bug', severity,
          `[platform_owner] Data quality: ${issues.join(', ')}`,
          `Vehicle "${quality.title}" is missing or has bad data: ${issues.join(', ')}. URL: ${page.url()}`);
        this.log('quality_check', 'warning', `${quality.title}: ${issues.join(', ')}`);
      } else {
        this.log('quality_check', 'success', `${quality.title}: all fields present`);
      }

      await page.goBack();
      await this.sleep(800);
    }
  }

  private async checkAdminPages(): Promise<void> {
    const page = this.getPage()!;

    // Skylar checks admin/dashboard routes
    const adminPaths = ['/admin', '/admin/analytics', '/dashboard'];

    for (const path of adminPaths) {
      try {
        const response = await page.goto(
          `${page.url().split('/').slice(0, 3).join('/')}${path}`,
          { waitUntil: 'domcontentloaded', timeout: 8000 },
        );

        if (!response) continue;
        const status = response.status();

        if (status >= 500) {
          await this.reportFinding('bug', 'high',
            `[platform_owner] Admin page ${path} returns ${status}`,
            `Server error on admin route`);
        } else if (status === 200) {
          const bodyLen = await page.evaluate(() => document.body?.innerText?.trim().length || 0);
          if (bodyLen < 50) {
            await this.reportFinding('bug', 'medium',
              `[platform_owner] Admin page ${path} is nearly empty`,
              `Page loaded but has almost no content (${bodyLen} chars)`);
          } else {
            this.log('admin', 'success', `${path} → ${status}, ${bodyLen} chars`);
          }
        } else {
          this.log('admin', 'success', `${path} → ${status} (expected if auth required)`);
        }
      } catch {
        // Timeout or nav error — admin might require auth
      }
    }
  }

  // ─── Dev sim steps ────────────────────────────────────────

  private async deepConsoleAudit(): Promise<void> {
    const page = this.getPage()!;

    // Navigate through key pages collecting console output
    const routes = ['/', '/vehicles'];
    const allErrors: Array<{ url: string; text: string; type: string }> = [];

    for (const route of routes) {
      const errors: Array<{ text: string; type: string }> = [];

      const handler = (msg: { type: () => string; text: () => string }) => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
          errors.push({ text: msg.text(), type: msg.type() });
        }
      };

      page.on('console', handler);
      await this.navigate(route);
      await this.sleep(3000);
      page.removeListener('console', handler);

      for (const err of errors) {
        allErrors.push({ url: route, ...err });
      }
    }

    // Categorize errors
    const uniqueErrors = new Map<string, number>();
    for (const err of allErrors) {
      const key = err.text.substring(0, 80);
      uniqueErrors.set(key, (uniqueErrors.get(key) || 0) + 1);
    }

    this.log('console_audit', 'success', `${allErrors.length} total console errors/warnings across ${routes.length} pages`);

    // Report unique errors
    for (const [text, count] of Array.from(uniqueErrors.entries())) {
      const isNetworkError = /fetch|network|CORS|blocked|ERR_/i.test(text);
      const isReactError = /react|render|hook|component/i.test(text);
      const severity = isReactError ? 'high' : isNetworkError ? 'medium' : 'low';

      await this.reportFinding('console_error', severity,
        `[dev] ${text.substring(0, 80)}${count > 1 ? ` (x${count})` : ''}`,
        `Console ${isReactError ? 'React' : isNetworkError ? 'network' : 'general'} error seen ${count} time(s): ${text}`);
    }
  }

  private async auditNetworkRequests(): Promise<void> {
    const page = this.getPage()!;

    const requests: Array<{ url: string; method: string; status: number; duration: number; size: number }> = [];
    const failedRequests: Array<{ url: string; error: string }> = [];

    // Listen to network
    page.on('requestfinished', async (req) => {
      try {
        const response = req.response ? await req.response() : null;
        if (response) {
          requests.push({
            url: req.url(),
            method: req.method(),
            status: response.status(),
            duration: req.timing().responseEnd - req.timing().requestStart,
            size: (await response.body().catch(() => Buffer.alloc(0))).length,
          });
        }
      } catch { /* swallow */ }
    });

    page.on('requestfailed', (req) => {
      failedRequests.push({
        url: req.url(),
        error: req.failure()?.errorText || 'unknown',
      });
    });

    // Load a page and capture
    await this.navigate('/vehicles');
    await this.sleep(4000);

    // Analyze
    const apiCalls = requests.filter(r => r.url.includes('/rest/') || r.url.includes('/functions/'));
    const slowCalls = requests.filter(r => r.duration > 2000);
    const errorCalls = requests.filter(r => r.status >= 400);

    this.log('network', 'success',
      `${requests.length} requests (${apiCalls.length} API, ${failedRequests.length} failed, ${slowCalls.length} slow)`);

    for (const slow of slowCalls) {
      await this.reportFinding('performance', 'medium',
        `[dev] Slow API call: ${new URL(slow.url).pathname} (${Math.round(slow.duration)}ms)`,
        `${slow.method} ${slow.url} took ${Math.round(slow.duration)}ms`);
    }

    for (const fail of failedRequests) {
      if (!fail.url.includes('favicon')) {
        await this.reportFinding('network_error', 'medium',
          `[dev] Failed request: ${new URL(fail.url).pathname}`,
          `${fail.url}: ${fail.error}`);
      }
    }

    for (const err of errorCalls) {
      if (err.status >= 500) {
        await this.reportFinding('bug', 'high',
          `[dev] Server error ${err.status}: ${new URL(err.url).pathname}`,
          `${err.method} ${err.url} → ${err.status}`);
      }
    }
  }

  private async auditPerformance(): Promise<void> {
    const page = this.getPage()!;

    // Measure Core Web Vitals-ish metrics on key pages
    const routes = ['/', '/vehicles'];

    for (const route of routes) {
      const start = Date.now();
      await this.navigate(route);
      await this.sleep(2000);

      const perf = await page.evaluate(() => {
        const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        const nav = entries[0];
        if (!nav) return null;

        return {
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
          loadComplete: Math.round(nav.loadEventEnd - nav.startTime),
          ttfb: Math.round(nav.responseStart - nav.startTime),
          domNodes: document.querySelectorAll('*').length,
          scripts: document.querySelectorAll('script').length,
          stylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
        };
      });

      if (perf) {
        this.log('perf', 'success',
          `${route}: TTFB ${perf.ttfb}ms, DCL ${perf.domContentLoaded}ms, ${perf.domNodes} DOM nodes`);

        if (perf.ttfb > 1000) {
          await this.reportFinding('performance', 'high',
            `[dev] Slow TTFB on ${route}: ${perf.ttfb}ms`,
            `Time to First Byte is ${perf.ttfb}ms (target: <500ms)`);
        }
        if (perf.domContentLoaded > 3000) {
          await this.reportFinding('performance', 'medium',
            `[dev] Slow DOMContentLoaded on ${route}: ${perf.domContentLoaded}ms`,
            `DOMContentLoaded at ${perf.domContentLoaded}ms (target: <2000ms)`);
        }
        if (perf.domNodes > 5000) {
          await this.reportFinding('performance', 'low',
            `[dev] Large DOM on ${route}: ${perf.domNodes} nodes`,
            `DOM has ${perf.domNodes} nodes which may impact rendering performance`);
        }
      }
    }
  }

  private async auditAccessibility(): Promise<void> {
    const page = this.getPage()!;

    await this.navigate('/vehicles');
    await this.sleep(2000);

    const a11y = await page.evaluate(() => {
      const issues: string[] = [];

      // Images without alt text
      const imgs = document.querySelectorAll('img');
      let noAlt = 0;
      imgs.forEach(img => { if (!img.alt && !img.getAttribute('aria-label')) noAlt++; });
      if (noAlt > 0) issues.push(`${noAlt} images missing alt text`);

      // Buttons without accessible names
      const buttons = document.querySelectorAll('button');
      let noName = 0;
      buttons.forEach(btn => {
        if (!btn.textContent?.trim() && !btn.getAttribute('aria-label') && !btn.getAttribute('title')) noName++;
      });
      if (noName > 0) issues.push(`${noName} buttons missing accessible name`);

      // Links without text
      const links = document.querySelectorAll('a');
      let emptyLinks = 0;
      links.forEach(a => {
        if (!a.textContent?.trim() && !a.getAttribute('aria-label') && !a.querySelector('img')) emptyLinks++;
      });
      if (emptyLinks > 0) issues.push(`${emptyLinks} links missing text`);

      // Form inputs without labels
      const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
      let noLabel = 0;
      inputs.forEach(input => {
        const id = input.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAria = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
        const hasPlaceholder = input.getAttribute('placeholder');
        if (!hasLabel && !hasAria && !hasPlaceholder) noLabel++;
      });
      if (noLabel > 0) issues.push(`${noLabel} inputs missing labels`);

      // Color contrast check (basic: look for very light text)
      let lowContrast = 0;
      document.querySelectorAll('p, span, a, h1, h2, h3, h4, li').forEach(el => {
        const style = window.getComputedStyle(el);
        const color = style.color;
        // Very rough: if text is very light gray on white bg
        const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (match) {
          const [, r, g, b] = match.map(Number);
          if (r > 200 && g > 200 && b > 200) lowContrast++;
        }
      });
      if (lowContrast > 5) issues.push(`${lowContrast} elements with potentially low contrast`);

      // Heading hierarchy
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const levels = headings.map(h => parseInt(h.tagName[1]));
      let skipped = false;
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] - levels[i - 1] > 1) { skipped = true; break; }
      }
      if (skipped) issues.push('heading hierarchy has gaps (e.g., h1 → h3)');

      const h1Count = document.querySelectorAll('h1').length;
      if (h1Count === 0) issues.push('page has no h1');
      if (h1Count > 1) issues.push(`page has ${h1Count} h1 elements (should be 1)`);

      return { issues, imgCount: imgs.length, noAlt };
    });

    if (a11y.issues.length > 0) {
      this.log('a11y', 'warning', `${a11y.issues.length} issues found`);
      for (const issue of a11y.issues) {
        await this.reportFinding('accessibility', 'medium',
          `[dev] A11y: ${issue}`,
          `Accessibility issue on /vehicles: ${issue}`);
      }
    } else {
      this.log('a11y', 'success', 'No major accessibility issues found');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
