#!/usr/bin/env npx tsx

/**
 * Facebook Marketplace Monitor
 * Monitors for classic cars/trucks, stores in Supabase, alerts on new finds.
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as config from './config.js';
import { MARKETPLACE_URLS } from './config.js';

/** Max year we accept: 1991 (older than 1992). */
const MAX_YEAR = 1991;

/**
 * Parse year from listing title (e.g. "1978 Ford F-150", "1987 Chevy C10").
 * Returns null if no plausible year found. Cautious: only skip when we're sure year > 1991.
 */
function parseYearFromTitle(title: string): number | null {
  const match = title.match(/\b(19[4-9]\d|200\d)\b/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  return year >= 1900 && year <= 2030 ? year : null;
}

/** True if we should accept this listing (year ≤ 1991 or no year in title). */
function isOlderThan1992(listing: { title: string }): boolean {
  const year = parseYearFromTitle(listing.title);
  if (year === null) return true; // no year = allow (URL already filters)
  return year <= MAX_YEAR;
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface MarketplaceListing {
  id: string;
  title: string;
  price: number | null;
  location: string;
  url: string;
  imageUrl: string | null;
  searchQuery: string;
  scrapedAt: string;
}

class MarketplaceMonitor {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private seenListings: Set<string> = new Set();
  private isRunning: boolean = false;

  async initialize(): Promise<void> {
    console.log('🚀 Starting Facebook Marketplace Monitor...');
    console.log(`📍 Location: ${config.LOCATION.city}, ${config.LOCATION.state}`);
    console.log(`🔍 Monitoring ${config.SEARCH_QUERIES.length} search queries`);
    console.log(`⏰ Search interval: ${config.SEARCH_INTERVAL_MINUTES} minutes`);

    this.context = await chromium.launchPersistentContext(
      config.BROWSER.userDataDir,
      {
        headless: config.BROWSER.headless,
        slowMo: config.BROWSER.slowMo,
        viewport: { width: 1280, height: 800 },
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--disable-blink-features=AutomationControlled'],
      }
    );

    this.page = await this.context.newPage();
    await this.loadSeenListings();
    console.log(`📚 Loaded ${this.seenListings.size} previously seen listings`);
  }

  async loadSeenListings(): Promise<void> {
    try {
      const { data } = await supabase
        .from('marketplace_listings')
        .select('facebook_id')
        .limit(10000);
      if (data) data.forEach(row => this.seenListings.add(row.facebook_id));
    } catch (e) {
      console.log('⚠️ Could not load seen listings');
    }
  }

  async checkLogin(): Promise<boolean> {
    if (!this.page) return false;
    try {
      await this.page.goto('https://www.facebook.com/marketplace', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.sleep(5000);
      const url = this.page.url();
      return !url.includes('login') && !url.includes('checkpoint');
    } catch (e) {
      console.log('⚠️ Page load slow, checking anyway...');
      const url = this.page.url();
      return !url.includes('login') && !url.includes('checkpoint');
    }
  }

  async waitForManualLogin(): Promise<void> {
    console.log('\n' + '='.repeat(50));
    console.log('🔐 LOG INTO FACEBOOK IN THE BROWSER WINDOW');
    console.log('='.repeat(50) + '\n');

    while (!(await this.checkLogin())) {
      console.log('⏳ Waiting for login...');
      await this.sleep(5000);
    }
    console.log('✅ Login successful!');
  }

  async searchMarketplace(query: string): Promise<MarketplaceListing[]> {
    if (!this.page) return [];
    const listings: MarketplaceListing[] = [];

    try {
      const searchUrl = new URL('https://www.facebook.com/marketplace/search');
      searchUrl.searchParams.set('query', query);
      searchUrl.searchParams.set('minPrice', config.PRICE_MIN.toString());
      searchUrl.searchParams.set('maxPrice', config.PRICE_MAX.toString());
      searchUrl.searchParams.set('maxYear', config.YEAR_MAX.toString());
      searchUrl.searchParams.set('daysSinceListed', '7');
      searchUrl.searchParams.set('sortBy', 'creation_time_descend');

      console.log(`🔍 Searching: "${query}"`);
      await this.page.goto(searchUrl.toString(), { waitUntil: 'domcontentloaded' });
      await this.sleep(3000);

      // Scroll to load more
      for (let i = 0; i < 3; i++) {
        await this.page.evaluate(() => window.scrollBy(0, 1000));
        await this.sleep(1500);
      }

      // Extract listings - try multiple selectors
      const links = await this.page.$$('a[href*="/marketplace/item/"]');

      for (const link of links.slice(0, 20)) {
        try {
          const href = await link.getAttribute('href');
          if (!href) continue;

          const idMatch = href.match(/\/item\/(\d+)/);
          if (!idMatch) continue;

          const id = idMatch[1];
          if (this.seenListings.has(id)) continue;

          const textContent = await link.textContent() || '';
          const priceMatch = textContent.match(/\$[\d,]+/);
          const price = priceMatch ? parseInt(priceMatch[0].replace(/[$,]/g, '')) : null;

          const imgElement = await link.$('img');
          const imageUrl = imgElement ? await imgElement.getAttribute('src') : null;

          listings.push({
            id,
            title: textContent.slice(0, 100),
            price,
            location: '',
            url: `https://www.facebook.com/marketplace/item/${id}`,
            imageUrl,
            searchQuery: query,
            scrapedAt: new Date().toISOString(),
          });
        } catch (e) { /* skip */ }
      }

      console.log(`   Found ${listings.length} new listings`);
    } catch (error) {
      console.error(`❌ Error searching "${query}":`, error);
    }

    return listings;
  }

  async saveListing(listing: MarketplaceListing): Promise<boolean> {
    if (!isOlderThan1992(listing)) {
      console.log(`   ⏭️ Skip (year > ${MAX_YEAR}): ${listing.title.slice(0, 60)}...`);
      return false;
    }
    try {
      await supabase.from('marketplace_listings').upsert({
        facebook_id: listing.id,
        title: listing.title,
        price: listing.price,
        location: listing.location,
        url: listing.url,
        image_url: listing.imageUrl,
        search_query: listing.searchQuery,
        scraped_at: listing.scrapedAt,
      }, { onConflict: 'facebook_id' });
      this.seenListings.add(listing.id);
      return true;
    } catch (e) {
      console.error('Error saving:', e);
      return false;
    }
  }

  async sendAlert(listing: MarketplaceListing): Promise<void> {
    const msg = `🚗 NEW: ${listing.title}\n💰 ${listing.price ? '$' + listing.price.toLocaleString() : 'N/A'}\n🔗 ${listing.url}`;
    console.log('\n🚨 ' + msg.replace(/\n/g, ' | ') + '\n');
  }

  async browseDirectUrl(url: string): Promise<MarketplaceListing[]> {
    if (!this.page) return [];
    const listings: MarketplaceListing[] = [];

    try {
      console.log(`🌐 Browsing: ${url.split('?')[0].split('/').pop()}`);
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      await this.sleep(3000);

      // Scroll to load more
      for (let i = 0; i < 5; i++) {
        await this.page.evaluate(() => window.scrollBy(0, 1500));
        await this.sleep(2000);
      }

      const links = await this.page.$$('a[href*="/marketplace/item/"]');

      for (const link of links.slice(0, 50)) {
        try {
          const href = await link.getAttribute('href');
          if (!href) continue;

          const idMatch = href.match(/\/item\/(\d+)/);
          if (!idMatch) continue;

          const id = idMatch[1];
          if (this.seenListings.has(id)) continue;

          const textContent = await link.textContent() || '';
          const priceMatch = textContent.match(/\$[\d,]+/);
          const price = priceMatch ? parseInt(priceMatch[0].replace(/[$,]/g, '')) : null;

          const imgElement = await link.$('img');
          const imageUrl = imgElement ? await imgElement.getAttribute('src') : null;

          listings.push({
            id,
            title: textContent.slice(0, 150).replace(/\n/g, ' '),
            price,
            location: url.split('/marketplace/')[1]?.split('/')[0] || '',
            url: `https://www.facebook.com/marketplace/item/${id}`,
            imageUrl,
            searchQuery: url,
            scrapedAt: new Date().toISOString(),
          });
        } catch (e) { /* skip */ }
      }

      console.log(`   Found ${listings.length} new listings`);
    } catch (error) {
      console.error(`❌ Error browsing:`, error);
    }

    return listings;
  }

  async runSearchCycle(): Promise<void> {
    console.log(`\n🔄 Search cycle at ${new Date().toLocaleTimeString()}`);
    let totalNew = 0;

    // Direct URL browsing (better) - only save listings ≤ 1991
    for (const url of MARKETPLACE_URLS) {
      const listings = await this.browseDirectUrl(url);
      for (const listing of listings) {
        const saved = await this.saveListing(listing);
        if (saved) {
          await this.sendAlert(listing);
          totalNew++;
        }
      }
      await this.sleep(3000 + Math.random() * 4000);
    }

    // Keyword searches (if any)
    for (const query of config.SEARCH_QUERIES) {
      const listings = await this.searchMarketplace(query);
      for (const listing of listings) {
        const saved = await this.saveListing(listing);
        if (saved) {
          await this.sendAlert(listing);
          totalNew++;
        }
      }
      await this.sleep(2000 + Math.random() * 3000);
    }

    console.log(`✅ Cycle done. ${totalNew} new listings. Next in ${config.SEARCH_INTERVAL_MINUTES} min.`);
  }

  async start(): Promise<void> {
    await this.initialize();
    if (!(await this.checkLogin())) await this.waitForManualLogin();

    this.isRunning = true;
    await this.runSearchCycle();

    while (this.isRunning) {
      await this.sleep(config.SEARCH_INTERVAL_MINUTES * 60 * 1000);
      if (!(await this.checkLogin())) await this.waitForManualLogin();
      await this.runSearchCycle();
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.context) await this.context.close();
    console.log('👋 Stopped.');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const monitor = new MarketplaceMonitor();
process.on('SIGINT', async () => { await monitor.stop(); process.exit(0); });
monitor.start().catch(console.error);
