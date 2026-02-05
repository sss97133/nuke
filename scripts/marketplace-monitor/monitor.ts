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
 * Parse year from listing title. Handles formats like:
 * - "1978 Ford F-150"
 * - "$4,0001983 Chevrolet Monte Carlo" (price+year concatenated)
 * - "$1,0001999 Toyota Sienna"
 */
function parseYearFromTitle(title: string): number | null {
  // First try: year at word boundary
  let match = title.match(/\b(19[2-9]\d|20[0-2]\d)\b/);
  if (match) {
    const year = parseInt(match[1], 10);
    if (year >= 1920 && year <= 2030) return year;
  }

  // Second try: year embedded after price (e.g., "$4,0001983" -> 1983)
  // Look for 4 digits that form a valid year
  const allYears = title.match(/(19[2-9]\d|20[0-2]\d)/g);
  if (allYears) {
    for (const y of allYears) {
      const year = parseInt(y, 10);
      if (year >= 1920 && year <= 2030) return year;
    }
  }

  return null;
}

/** Get priority based on year: classic (≤1991), modern (1992+), unknown */
function getPriority(listing: { title: string }): 'classic' | 'modern' | 'unknown' {
  const year = parseYearFromTitle(listing.title);
  if (year === null) return 'unknown';
  return year <= MAX_YEAR ? 'classic' : 'modern';
}

/** WHITELIST: Valid car/truck makes - ONLY these are accepted */
const VALID_CAR_MAKES = new Set([
  // American
  'ford', 'chevrolet', 'chevy', 'dodge', 'gmc', 'jeep', 'ram',
  'chrysler', 'buick', 'cadillac', 'lincoln', 'pontiac', 'oldsmobile',
  'plymouth', 'mercury', 'saturn', 'hummer', 'tesla', 'rivian',
  'amc', 'international', 'studebaker', 'packard', 'hudson', 'nash',
  'desoto', 'willys', 'kaiser', 'checker', 'delorean', 'shelby',
  'saleen', 'hennessey', 'ssc', 'vector', 'panoz', 'fisker', 'lucid',
  // Japanese
  'toyota', 'honda', 'nissan', 'mazda', 'subaru', 'mitsubishi',
  'lexus', 'acura', 'infiniti', 'scion', 'datsun', 'isuzu',
  // German
  'volkswagen', 'vw', 'bmw', 'mercedes', 'mercedes-benz', 'audi', 'porsche', 'opel',
  // British
  'jaguar', 'land rover', 'land-rover', 'range rover', 'bentley', 'rolls-royce', 'rolls royce',
  'aston martin', 'lotus', 'mclaren', 'mini', 'mg', 'triumph',
  'austin', 'austin-healey', 'sunbeam', 'tvr', 'morgan', 'jensen',
  // Italian
  'ferrari', 'lamborghini', 'maserati', 'alfa romeo', 'alfa', 'fiat',
  'lancia', 'de tomaso', 'pagani',
  // Swedish
  'volvo', 'saab', 'koenigsegg',
  // Korean
  'hyundai', 'kia', 'genesis',
  // French
  'peugeot', 'renault', 'citroen', 'bugatti',
  // Combined/aliases
  'datsun/nissan',
]);

/** Check if make is a valid car/truck manufacturer */
function isValidCarMake(make: string | null | undefined): boolean {
  if (!make) return false;
  const normalized = make.toLowerCase().trim();
  return VALID_CAR_MAKES.has(normalized);
}

/** Check if listing should be skipped (not a valid car/truck) */
function shouldSkipListing(title: string, make?: string | null): boolean {
  // MUST have a recognized make - no exceptions
  if (!isValidCarMake(make)) {
    return true;
  }
  return false;
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
  // Deep extraction fields
  description?: string;
  sellerName?: string;
  allImages?: string[];
  // Vehicle details
  mileage?: number;
  transmission?: string;
  exteriorColor?: string;
  interiorColor?: string;
  fuelType?: string;
  listedDaysAgo?: number;
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

  async extractFullDetails(listing: MarketplaceListing): Promise<MarketplaceListing> {
    if (!this.page) return listing;

    try {
      console.log(`   📸 Extracting full details...`);
      await this.page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.sleep(3000);

      // Click "See more" / "Show more" buttons to get FULL description
      try {
        const seeMoreButtons = this.page.locator('text=/See more|Show more/i');
        const count = await seeMoreButtons.count();
        for (let i = 0; i < count; i++) {
          await seeMoreButtons.nth(i).click({ timeout: 1000 }).catch(() => {});
          await this.sleep(500);
        }
      } catch (e) { /* Continue if no See more button */ }

      // Get FULL description (after expanding)
      let description = await this.page.$eval(
        '[style*="text-align:start"]',
        el => el.textContent
      ).catch(() => null);

      // Fallback to meta tag if needed
      if (!description || description.length < 50) {
        description = await this.page.$eval(
          'meta[property="og:description"]',
          el => el.getAttribute('content')
        ).catch(() => null);
      }

      // Get seller name - try multiple selectors
      const sellerName = await this.page.$eval(
        'a[href*="/marketplace/profile/"] span',
        el => el.textContent
      ).catch(() => null) || await this.page.$eval(
        '[data-testid="marketplace_pdp_seller_name"]',
        el => el.textContent
      ).catch(() => null);

      // Get ALL images from the listing - IMPROVED FILTERING
      const allImages = await this.page.$$eval(
        'img[src*="fbcdn"]',
        imgs => imgs
          .map(img => img.src)
          .filter(src => src.includes('scontent'))  // Real photos
          .filter(src => !src.includes('emoji'))     // No emojis
          .filter(src => !src.includes('profile'))   // No profile pics
          .filter(src => !src.includes('_s.') && !src.includes('_t.'))  // No thumbnails
          .filter(src => !src.match(/\/p\d+x\d+\//))  // No tiny profile images
          .filter((src, i, arr) => arr.indexOf(src) === i) // dedupe
      ).catch(() => []);

      // Get high-res main image
      const mainImage = await this.page.$eval(
        'meta[property="og:image"]',
        el => el.getAttribute('content')
      ).catch(() => listing.imageUrl);

      // Get full page text for parsing structured data
      const pageText = await this.page.$eval('body', el => el.innerText).catch(() => '');

      // Parse location: "Listed X days ago in City, ST"
      const locationMatch = pageText.match(/Listed.*?in ([A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*[A-Z]{2})/);
      const location = locationMatch ? locationMatch[1] : listing.location;

      // Parse listed time: "Listed 4 days ago"
      const listedMatch = pageText.match(/Listed (\d+) (day|week|hour|month)s? ago/);
      let listedDaysAgo: number | undefined;
      if (listedMatch) {
        const num = parseInt(listedMatch[1], 10);
        const unit = listedMatch[2];
        if (unit === 'hour') listedDaysAgo = 0;
        else if (unit === 'day') listedDaysAgo = num;
        else if (unit === 'week') listedDaysAgo = num * 7;
        else if (unit === 'month') listedDaysAgo = num * 30;
      }

      // Parse mileage: "Driven 73,000 miles"
      const mileageMatch = pageText.match(/Driven ([\d,]+) miles/);
      const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ''), 10) : undefined;

      // Parse transmission: "Manual transmission" or "Automatic transmission"
      const transMatch = pageText.match(/(Manual|Automatic) transmission/i);
      const transmission = transMatch ? transMatch[1] : undefined;

      // Parse colors: "Exterior color: Black · Interior color: Black"
      const extColorMatch = pageText.match(/Exterior color:\s*([A-Za-z]+)/);
      const intColorMatch = pageText.match(/Interior color:\s*([A-Za-z]+)/);
      const exteriorColor = extColorMatch ? extColorMatch[1] : undefined;
      const interiorColor = intColorMatch ? intColorMatch[1] : undefined;

      // Parse fuel type: "Fuel type: Gasoline"
      const fuelMatch = pageText.match(/Fuel type:\s*([A-Za-z]+)/);
      const fuelType = fuelMatch ? fuelMatch[1] : undefined;

      // Parse better title (fix year/make/model)
      const titleParsed = this.parseEnhancedTitle(listing.title);

      // Extract contact info from description
      const contactInfo = description ? this.extractContactInfo(description + ' ' + pageText) : null;

      // Extract comments (if present - may be mobile-only feature)
      const comments = await this.extractComments().catch(() => null);

      return {
        ...listing,
        title: titleParsed.cleanTitle || listing.title,
        location: location || listing.location,
        description: description || undefined,
        sellerName: sellerName || undefined,
        allImages: allImages.length > 0 ? allImages : undefined,
        imageUrl: mainImage || listing.imageUrl,
        mileage,
        transmission,
        exteriorColor,
        interiorColor,
        fuelType,
        listedDaysAgo,
        // Enhanced parsed fields
        ...(titleParsed.year && { parsedYear: titleParsed.year }),
        ...(titleParsed.make && { parsedMake: titleParsed.make }),
        ...(titleParsed.model && { parsedModel: titleParsed.model }),
        ...(titleParsed.cleanPrice && { cleanPrice: titleParsed.cleanPrice }),
        ...(contactInfo && { contactInfo }),
        ...(comments && comments.length > 0 && { comments }),
      };
    } catch (e) {
      console.log(`   ⚠️ Could not extract full details`);
      return listing;
    }
  }

  /**
   * Extract comments from listing page
   * FB Marketplace may have comments on listings (possibly mobile-only)
   */
  private async extractComments(): Promise<Array<{author: string; text: string; posted_at: string}> | null> {
    if (!this.page) return null;

    try {
      // Look for comment sections - try multiple selectors
      const commentSelectors = [
        '[role="article"]',  // FB uses articles for comments
        '[data-testid*="comment"]',
        '[aria-label*="comment" i]',
        'text=/Comment|Reply|commented/i',
      ];

      const comments: Array<{author: string; text: string; posted_at: string}> = [];

      // Try to find comment containers
      for (const selector of commentSelectors) {
        try {
          const elements = await this.page.locator(selector).all();

          for (const el of elements) {
            const text = await el.textContent();
            if (!text || text.length < 5) continue;

            // Look for comment patterns: "John Doe: Is this available?"
            const commentMatch = text.match(/([A-Z][a-z]+ [A-Z][a-z]+)[\s:]+(.+)/);
            if (commentMatch) {
              const [, author, commentText] = commentMatch;

              // Look for timestamps like "2h", "3 days ago", etc.
              const timeMatch = text.match(/(\d+[hmd]|\d+ (hour|day|week|minute)s? ago)/i);
              const posted_at = timeMatch ? timeMatch[1] : 'unknown';

              comments.push({
                author: author.trim(),
                text: commentText.trim().slice(0, 500), // Limit length
                posted_at
              });
            }
          }

          if (comments.length > 0) break; // Found comments, stop searching
        } catch (e) {
          continue;
        }
      }

      return comments.length > 0 ? comments : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Enhanced title parser - handles corrupted FB titles
   * Handles formats like: "$1,9502021 Toyota Camry" -> price=$1,950, year=2021
   */
  private parseEnhancedTitle(title: string): {
    year: number | null;
    make: string | null;
    model: string | null;
    cleanPrice: number | null;
    cleanTitle: string;
  } {
    // Extract and clean price - look for year at END of price string
    let cleanPrice: number | null = null;
    const priceMatch = title.match(/^\$?([\d,]+)/);
    if (priceMatch) {
      const priceStr = priceMatch[1].replace(/,/g, '');
      // Look for 4-digit year (2020-2030 or 1920-1999) at the END of the price string
      const yearAtEnd = priceStr.match(/((?:19[2-9]\d|20[0-3]\d))$/);
      if (yearAtEnd && priceStr.length > 4) {
        // Year is at end - extract price from beginning
        const priceDigits = priceStr.slice(0, -4);
        cleanPrice = priceDigits.length > 0 ? parseInt(priceDigits, 10) : null;
      } else if (priceStr.length <= 7 && !priceStr.match(/^(19|20)\d{2}$/)) {
        // No year embedded, reasonable price length, not just a year
        cleanPrice = parseInt(priceStr, 10);
      }
    }

    // Remove price, location, and mileage suffixes
    let cleaned = title
      .replace(/^\$[\d,]+(?=\d{4})/g, '')  // Price stuck to year
      .replace(/^\$[\d,]+\s*/g, '')         // Price with space
      .replace(/[A-Z][a-z]+,\s*[A-Z]{2}.*$/g, '') // Location
      .replace(/\d+K miles.*$/gi, '')       // Mileage
      .trim();

    const yearMatch = cleaned.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

    if (!year) return { year: null, make: null, model: null, cleanPrice, cleanTitle: title };

    const afterYear = cleaned.split(String(year))[1]?.trim() || '';
    const words = afterYear.split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) return { year, make: null, model: null, cleanPrice, cleanTitle: cleaned };

    // Make normalization
    const makeMap: Record<string, string> = {
      'chevy': 'Chevrolet', 'chevrolet': 'Chevrolet',
      'ford': 'Ford', 'dodge': 'Dodge', 'gmc': 'GMC',
      'toyota': 'Toyota', 'honda': 'Honda', 'nissan': 'Nissan',
      'mazda': 'Mazda', 'subaru': 'Subaru', 'mitsubishi': 'Mitsubishi',
    };

    const rawMake = words[0].toLowerCase();
    const make = makeMap[rawMake] || words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();

    // Model: next 1-3 words
    const stopWords = ['pickup', 'truck', 'sedan', 'coupe', 'wagon', 'van'];
    const modelParts: string[] = [];
    for (let i = 1; i < Math.min(words.length, 5); i++) {
      const word = words[i];
      if (stopWords.includes(word.toLowerCase()) || /^[A-Z][a-z]+$/.test(word)) break;
      modelParts.push(word);
      if (modelParts.length >= 2) break;
    }

    const model = modelParts.length > 0 ? modelParts.join(' ') : null;
    const cleanTitle = `${year} ${make}${model ? ' ' + model : ''}`;

    return { year, make, model, cleanPrice, cleanTitle };
  }

  /**
   * Extract contact info from text
   */
  private extractContactInfo(text: string): {
    phones?: string[];
    emails?: string[];
    facebook_messenger?: boolean;
  } | null {
    const phones: string[] = [];
    const emails: string[] = [];

    // Phone patterns
    const patterns = [
      /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
      /\b\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/g,
    ];

    patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(m => {
          const cleaned = m.replace(/[^\d]/g, '');
          if (cleaned.length === 10) {
            const formatted = `${cleaned.slice(0,3)}-${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
            if (!phones.includes(formatted)) phones.push(formatted);
          }
        });
      }
    });

    // Email pattern
    const emailMatches = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g);
    if (emailMatches) {
      emailMatches.forEach(e => {
        if (!emails.includes(e.toLowerCase())) emails.push(e.toLowerCase());
      });
    }

    const hasMessenger = text.includes('Message seller') || text.includes('Send message');

    if (phones.length === 0 && emails.length === 0 && !hasMessenger) return null;

    return {
      ...(phones.length > 0 && { phones }),
      ...(emails.length > 0 && { emails }),
      ...(hasMessenger && { facebook_messenger: true }),
    };
  }

  async saveListing(listing: any): Promise<boolean> {
    // WHITELIST: Only save if make is a recognized car/truck manufacturer
    if (shouldSkipListing(listing.title, listing.parsedMake)) {
      console.log(`   ⏭️  Skipping (no valid make): ${listing.title.slice(0, 50)}...`);
      return false;
    }

    const priority = getPriority(listing);
    const year = listing.parsedYear || parseYearFromTitle(listing.title);

    try {
      const data: any = {
        facebook_id: listing.id,
        title: listing.title,
        price: listing.cleanPrice || listing.price,
        location: listing.location,
        url: listing.url,
        image_url: listing.imageUrl,
        search_query: listing.searchQuery,
        scraped_at: listing.scrapedAt,
        description: listing.description,
        seller_name: listing.sellerName,
        all_images: listing.allImages,
        mileage: listing.mileage,
        transmission: listing.transmission,
        exterior_color: listing.exteriorColor,
        interior_color: listing.interiorColor,
        fuel_type: listing.fuelType,
        listed_days_ago: listing.listedDaysAgo,
        priority: priority,
        parsed_year: listing.parsedYear || year,
        parsed_make: listing.parsedMake,
        parsed_model: listing.parsedModel,
      };

      // Add contact_info if present (stored as JSONB)
      if (listing.contactInfo) {
        data.contact_info = listing.contactInfo;
      }

      await supabase.from('marketplace_listings').upsert(data, { onConflict: 'facebook_id' });
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

    // Direct URL browsing - save ALL vehicles with priority
    for (const url of MARKETPLACE_URLS) {
      const listings = await this.browseDirectUrl(url);
      for (const listing of listings) {
        // DEEP EXTRACT: Visit listing page and grab seller, description, all images
        const fullListing = await this.extractFullDetails(listing);

        const saved = await this.saveListing(fullListing);
        if (saved) {
          await this.sendAlert(fullListing);
          totalNew++;
        }

        // Delay between listing extractions
        await this.sleep(1500 + Math.random() * 1500);
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
