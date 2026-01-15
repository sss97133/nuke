/**
 * Casual Casey - Just browsing, window shopping
 * Tests: Search, filters, vehicle browsing, public pages
 */

import { BotRunner } from '../BotRunner';
import type { BotPersona } from '../types';

export class CasualBrowserBot extends BotRunner {
  constructor(persona: BotPersona) {
    super(persona);
  }

  /**
   * Execute casual browsing behavior
   */
  async execute(): Promise<void> {
    await this.start();
    const page = this.getPage();
    if (!page) return;

    // 1. Visit homepage
    await this.navigate('/');
    await this.sleep(1000);

    // 2. Look for vehicles link and click it
    const navClicked = await this.click('a[href="/vehicles"]', 'Navigate to vehicles');
    if (!navClicked) {
      // Try alternative selectors
      await this.click('text=Vehicles', 'Navigate to vehicles (text)');
    }
    await this.sleep(1500);

    // 3. Try some filters (casual user behavior)
    await this.tryFilters();

    // 4. Click on a random vehicle card
    await this.browseVehicles();

    // 5. Check footer links work
    await this.checkFooterLinks();

    // 6. Try search functionality
    await this.trySearch();

    await this.complete();
  }

  private async tryFilters(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    // Look for filter buttons/dropdowns
    const filterSelectors = [
      '[data-testid="make-filter"]',
      'select[name="make"]',
      'button:has-text("Make")',
      '[class*="filter"]',
    ];

    for (const selector of filterSelectors) {
      try {
        const exists = await page.$(selector);
        if (exists) {
          await this.click(selector, 'Open filter');
          await this.sleep(500);
          break;
        }
      } catch {
        // Try next selector
      }
    }
  }

  private async browseVehicles(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    // Find vehicle cards
    const cardSelectors = [
      '[data-testid="vehicle-card"]',
      'a[href^="/vehicle/"]',
      '[class*="VehicleCard"]',
      '.vehicle-card',
    ];

    for (const selector of cardSelectors) {
      try {
        const cards = await page.$$(selector);
        if (cards.length > 0) {
          // Click a random card
          const randomIndex = Math.floor(Math.random() * Math.min(cards.length, 5));
          await cards[randomIndex].click();
          await this.sleep(2000);
          
          // Check if we're on a vehicle page
          const url = page.url();
          if (url.includes('/vehicle/')) {
            this.log('browse', 'success', 'Opened vehicle detail page');
            
            // Scroll down to see more content
            await page.evaluate(() => window.scrollBy(0, 500));
            await this.sleep(1000);
            
            // Go back
            await page.goBack();
          }
          break;
        }
      } catch {
        // Try next selector
      }
    }
  }

  private async checkFooterLinks(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    // Scroll to footer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await this.sleep(500);

    // Check common footer links
    const footerLinks = ['About', 'Contact', 'Privacy', 'Terms'];
    
    for (const linkText of footerLinks.slice(0, 2)) { // Only check first 2 to save time
      try {
        const link = await page.$(`footer a:has-text("${linkText}")`);
        if (link) {
          const href = await link.getAttribute('href');
          if (href) {
            this.log('check', 'success', `Footer link found: ${linkText}`);
          }
        }
      } catch {
        // Link might not exist
      }
    }
  }

  private async trySearch(): Promise<void> {
    const page = this.getPage();
    if (!page) return;

    const searchSelectors = [
      'input[type="search"]',
      'input[placeholder*="Search"]',
      'input[placeholder*="search"]',
      '[data-testid="search-input"]',
    ];

    for (const selector of searchSelectors) {
      try {
        const searchBox = await page.$(selector);
        if (searchBox) {
          await this.type(selector, 'Camaro', 'Search for Camaro');
          await this.sleep(1000);
          
          // Press enter or click search button
          await page.keyboard.press('Enter');
          await this.sleep(2000);
          
          // Check if results appeared
          const resultsExist = await page.$('[class*="result"]') || await page.$('[class*="vehicle"]');
          if (resultsExist) {
            this.log('search', 'success', 'Search returned results');
          } else {
            this.log('search', 'warning', 'Search may not have returned visible results');
          }
          break;
        }
      } catch {
        // Try next selector
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
