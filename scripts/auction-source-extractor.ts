/**
 * Comprehensive Auction Source Extractor
 *
 * Target: 8+ solid profiles per source with:
 * - Title (year, make, model)
 * - Current bid
 * - Bid count
 * - Time remaining
 * - Reserve status
 * - Image URL
 */

import { chromium, Page, Browser } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface AuctionProfile {
  source: string;
  url: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  current_bid: number | null;
  bid_count: number | null;
  time_remaining: string | null;
  reserve_status: string | null;
  image_url: string | null;
}

// Extended profile with full details from listing page
interface DetailedAuctionProfile extends AuctionProfile {
  // Vehicle specs
  vin: string | null;
  mileage: number | null;
  transmission: string | null;
  engine: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  location: string | null;
  seller_username: string | null;

  // All images
  image_urls: string[];

  // Auction details
  comment_count: number | null;
  view_count: number | null;
  description: string | null;
}

// Target: 8+ profiles per source
const TARGET_COUNT = 8;

// Whether to fetch full details from individual listing pages
const FETCH_DETAILS = true;

/**
 * Extract detailed data from a BaT listing page
 */
async function extractBatListingDetails(page: Page, url: string): Promise<Partial<DetailedAuctionProfile>> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    // Extract essentials using locators instead of page.evaluate
    const result: Partial<DetailedAuctionProfile> = {};

    // Get essentials section
    const essentialsItems = await page.locator('.essentials li').all();
    for (const li of essentialsItems) {
      const text = await li.textContent();
      if (!text) continue;
      const match = text.match(/^([A-Za-z][A-Za-z\s\/]+)\s*:\s*(.+)$/);
      if (!match) continue;

      const key = match[1].toLowerCase().trim();
      const value = match[2].trim();

      if (key === 'seller') result.seller_username = value;
      if (key === 'location') result.location = value;
      if (key === 'vin' || key === 'chassis') result.vin = value;
      // BaT uses various labels for mileage: "Mileage", "Miles", "TMU Indicated", "Indicated", etc.
      if (key.includes('mileage') || key.includes('miles') || key.includes('indicated') || key === 'tmu') {
        const m = value.match(/([\d,]+)/);
        if (m) result.mileage = parseInt(m[0].replace(/,/g, ''));
      }
      if (key.includes('engine')) result.engine = value;
      if (key.includes('transmission') || key.includes('drivetrain')) result.transmission = value;
      if (key.includes('exterior') || key === 'color') result.exterior_color = value;
      if (key.includes('interior')) result.interior_color = value;
    }

    // Extract gallery images - use page.evaluate with a simple function
    const imageUrls = await page.evaluate(() => {
      var urls: string[] = [];
      var galleryDiv = document.getElementById('bat_listing_page_photo_gallery');
      if (!galleryDiv) return urls;

      var galleryAttr = galleryDiv.getAttribute('data-gallery-items');
      if (!galleryAttr) {
        var inner = galleryDiv.querySelector('[data-gallery-items]');
        if (inner) galleryAttr = inner.getAttribute('data-gallery-items');
      }

      if (!galleryAttr) return urls;

      try {
        var decoded = galleryAttr
          .replace(/&quot;/g, '"')
          .replace(/&#039;/g, "'")
          .replace(/&#038;/g, '&')
          .replace(/&amp;/g, '&');
        var items = JSON.parse(decoded);

        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var imgUrl = (item.full && item.full.url) || (item.original && item.original.url) || (item.large && item.large.url) || (item.small && item.small.url);
          if (imgUrl && typeof imgUrl === 'string') {
            imgUrl = imgUrl
              .replace(/[?&]resize=[^&]*/g, '')
              .replace(/[?&]w=\d+/g, '')
              .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
              .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1');
            if (imgUrl.indexOf('bringatrailer.com/wp-content/uploads/') >= 0 && imgUrl.indexOf('.svg') < 0) {
              urls.push(imgUrl);
            }
          }
        }
      } catch (e) {
        // JSON parse failed
      }

      // Dedupe
      return urls.filter(function(v, i, a) { return a.indexOf(v) === i; });
    });

    result.image_urls = imageUrls;

    // Extract description
    const descEl = await page.locator('.post-excerpt, .listing-post-content').first();
    const descText = await descEl.textContent().catch(() => null);
    if (descText) {
      result.description = descText.trim().substring(0, 4000);
    }

    // Try to extract mileage from title if not found in essentials
    // BaT titles often start with mileage: "4,300-Mile 2022 Porsche..."
    if (!result.mileage) {
      const titleEl = await page.locator('h1.post-title, h1').first();
      const titleText = await titleEl.textContent().catch(() => null);
      if (titleText) {
        const mileMatch = titleText.match(/^([\d,]+)[- ]?(?:Mile|K)/i);
        if (mileMatch) {
          const miles = mileMatch[1].replace(/,/g, '');
          const parsed = parseInt(miles);
          // Handle "K" suffix (e.g., "4K-Mile")
          if (mileMatch[0].toLowerCase().includes('k') && parsed < 1000) {
            result.mileage = parsed * 1000;
          } else {
            result.mileage = parsed;
          }
        }
      }
    }

    // Extract comment count from page
    const pageText = await page.content();
    const commentMatch = pageText.match(/(\d+)\s*comments?/i);
    if (commentMatch) {
      result.comment_count = parseInt(commentMatch[1]);
    }

    // Extract bid count
    const bidMatch = pageText.match(/(\d+)\s*bids?/i);
    if (bidMatch) {
      result.bid_count = parseInt(bidMatch[1]);
    }

    return result;
  } catch (error: any) {
    console.log(`    ⚠️ Failed to extract details: ${error.message}`);
    return {};
  }
}

/**
 * Extract detailed data from a Cars & Bids listing page
 */
async function extractCarsAndBidsDetails(page: Page, url: string): Promise<Partial<DetailedAuctionProfile>> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    return await page.evaluate(() => {
      const result: any = {};

      // Extract specs from the spec table
      const specRows = document.querySelectorAll('.quick-facts tr, .specs tr, [class*="spec"] tr');
      for (const row of Array.from(specRows)) {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const key = cells[0]?.textContent?.toLowerCase().trim() || '';
          const value = cells[1]?.textContent?.trim() || '';

          if (key.includes('vin')) result.vin = value;
          if (key.includes('mileage') || key.includes('miles')) {
            const m = value.match(/[\d,]+/);
            if (m) result.mileage = parseInt(m[0].replace(/,/g, ''));
          }
          if (key.includes('engine')) result.engine = value;
          if (key.includes('transmission')) result.transmission = value;
          if (key.includes('exterior')) result.exterior_color = value;
          if (key.includes('interior')) result.interior_color = value;
          if (key.includes('location')) result.location = value;
          if (key.includes('seller')) result.seller_username = value;
        }
      }

      // Extract all gallery images
      const imageUrls: string[] = [];
      const galleryImages = document.querySelectorAll('.gallery img, .carousel img, [class*="gallery"] img');
      for (const img of Array.from(galleryImages)) {
        const src = (img as HTMLImageElement).src || (img as HTMLImageElement).getAttribute('data-src');
        if (src && src.includes('carsandbids.com') && !src.includes('logo') && !src.includes('icon')) {
          imageUrls.push(src);
        }
      }
      result.image_urls = [...new Set(imageUrls)];

      // Extract description
      const descEl = document.querySelector('.description, .vehicle-description, [class*="description"]');
      if (descEl) {
        result.description = descEl.textContent?.trim().substring(0, 4000) || null;
      }

      // Comment count
      const commentEl = document.querySelector('.comments-count, [class*="comment-count"]');
      if (commentEl) {
        const m = commentEl.textContent?.match(/(\d+)/);
        if (m) result.comment_count = parseInt(m[1]);
      }

      return result;
    });
  } catch (error: any) {
    console.log(`    ⚠️ Failed to extract details: ${error.message}`);
    return {};
  }
}

// Auction sources configuration
const AUCTION_SOURCES = {
  'Bring a Trailer': {
    url: 'https://bringatrailer.com/',
    extract: async (page: Page): Promise<AuctionProfile[]> => {
      await page.goto('https://bringatrailer.com/', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);

      // Scroll to load more
      for (let i = 0; i < 5; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i * 600);
        await page.waitForTimeout(500);
      }

      return await page.evaluate(() => {
        const profiles: any[] = [];

        // BaT uses listing-card class
        const cards = document.querySelectorAll('.listing-card');

        for (const card of Array.from(cards)) {
          const linkEl = card.querySelector('a') as HTMLAnchorElement;
          const titleEl = card.querySelector('h3, .listing-card-title, .title');
          const imgEl = card.querySelector('img') as HTMLImageElement;

          const title = titleEl?.textContent?.trim() || '';
          const url = linkEl?.href || '';

          if (!title || !url || !url.includes('/listing/')) continue;

          // Get all text for parsing
          const cardText = card.textContent || '';

          // Parse bid - look for $ followed by numbers
          const bidMatch = cardText.match(/\$\s*([\d,]+)/);
          const bid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null;

          // Parse bid count
          const bidsMatch = cardText.match(/(\d+)\s*bids?/i);
          const bidCount = bidsMatch ? parseInt(bidsMatch[1]) : null;

          // Time remaining - BaT shows formats like "6 days", "23 hours", "5d 12h"
          const timeMatch = cardText.match(/(\d+)\s*d(?:ays?)?\s*(?:(\d+)\s*h(?:ours?)?)?|(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in)?)?|(\d+)\s*m(?:in)?/i);
          const timeRemaining = timeMatch ? timeMatch[0].trim() : null;

          // Reserve status
          let reserve = null;
          if (cardText.toLowerCase().includes('no reserve')) reserve = 'no_reserve';
          else if (cardText.toLowerCase().includes('reserve met')) reserve = 'reserve_met';

          profiles.push({
            source: 'Bring a Trailer',
            url,
            title,
            current_bid: bid,
            bid_count: bidCount,
            time_remaining: timeRemaining,
            reserve_status: reserve,
            image_url: imgEl?.src || null,
          });
        }

        return profiles;
      });
    }
  },

  'Cars & Bids': {
    url: 'https://carsandbids.com/',
    extract: async (page: Page): Promise<AuctionProfile[]> => {
      await page.goto('https://carsandbids.com/', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);

      // Scroll
      for (let i = 0; i < 5; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i * 500);
        await page.waitForTimeout(400);
      }

      return await page.evaluate(() => {
        const profiles: any[] = [];

        // Try multiple selector patterns
        const cards = document.querySelectorAll('li.auction-item, .auction-card, [class*="auction-item"]');

        for (const card of Array.from(cards)) {
          const linkEl = card.querySelector('a[href*="/auctions/"]') as HTMLAnchorElement;
          const titleEl = card.querySelector('.auction-title, h2, h3, [class*="title"]');
          const imgEl = card.querySelector('img') as HTMLImageElement;
          const bidEl = card.querySelector('.current-bid, [class*="bid"], [class*="price"]');
          const timeEl = card.querySelector('.time-left, [class*="time"], [class*="ending"]');

          const title = titleEl?.textContent?.trim() || '';
          const url = linkEl?.href || '';

          if (!url || !url.includes('/auctions/')) continue;

          const cardText = card.textContent || '';

          // Parse bid
          const bidText = bidEl?.textContent || cardText;
          const bidMatch = bidText.match(/\$\s*([\d,]+)/);
          const bid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null;

          // Bid count
          const bidsMatch = cardText.match(/(\d+)\s*bids?/i);
          const bidCount = bidsMatch ? parseInt(bidsMatch[1]) : null;

          // Time
          const timeText = timeEl?.textContent?.trim() || '';

          // Reserve
          let reserve = null;
          if (cardText.toLowerCase().includes('no reserve')) reserve = 'no_reserve';

          profiles.push({
            source: 'Cars & Bids',
            url,
            title: title || url.split('/').pop()?.replace(/-/g, ' ') || '',
            current_bid: bid,
            bid_count: bidCount,
            time_remaining: timeText || null,
            reserve_status: reserve,
            image_url: imgEl?.src || null,
          });
        }

        return profiles;
      });
    }
  },

  'PCarMarket': {
    url: 'https://www.pcarmarket.com/',
    extract: async (page: Page): Promise<AuctionProfile[]> => {
      await page.goto('https://www.pcarmarket.com/auctions/', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);

      // Scroll to load more
      for (let i = 0; i < 3; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i * 500);
        await page.waitForTimeout(400);
      }

      return await page.evaluate(() => {
        const profiles: any[] = [];
        const seen = new Set<string>();

        // PCarMarket structure: individual auction links contain the listing info
        // The parent wrapper contains ALL listings, so we need to extract data directly from each link/tile
        const auctionLinks = document.querySelectorAll('a[href*="/auction/"]');

        for (const link of Array.from(auctionLinks)) {
          const linkEl = link as HTMLAnchorElement;
          const url = linkEl.href;

          // Skip if already seen or not a real auction page
          if (!url || seen.has(url)) continue;
          if (url.includes('/auctions/') || url === 'https://www.pcarmarket.com/auction/') continue;
          if (!url.match(/\/auction\/[a-z0-9-]+$/i)) continue;
          seen.add(url);

          // Get the immediate card for this specific listing
          // Each listing tile should be a direct child pattern
          const tile = link.closest('.pcar-listing-tile--tile') ||
                       link.closest('[class*="tile"]:not([class*="wrapper"])') ||
                       link;

          // Find image associated with this link
          const imgEl = tile.querySelector('img') as HTMLImageElement ||
                       link.querySelector('img') as HTMLImageElement;

          // Extract title from URL path (most reliable for PCarMarket)
          const urlPath = url.split('/auction/').pop() || '';
          let title = urlPath
            .replace(/-(\d+)$/, '') // Remove trailing ID
            .replace(/-/g, ' ')
            .replace(/\b(\w)/g, c => c.toUpperCase()); // Title case

          // Try to get more specific title from link text if available
          const linkTitle = linkEl.textContent?.trim() || '';
          if (linkTitle.length > 15 && !linkTitle.includes('High Bid') && !linkTitle.includes('Ends In')) {
            // Use link text if it looks like a title
            const cleanTitle = linkTitle.split('Ends In')[0].split('High Bid')[0].trim();
            if (cleanTitle.length > 15) {
              title = cleanTitle;
            }
          }

          // For bid and time, we need to look at the tile structure more carefully
          // PCarMarket shows format like "High Bid$XX,XXX" per listing
          // Since the wrapper combines text, we'll extract from the URL-based listing detail later
          // For now, set bid to null and let the marketplace handle it

          let bid: number | null = null;
          let timeRemaining: string | null = null;

          // Try to parse from the immediate tile only (not the wrapper)
          if (tile !== link) {
            const tileText = tile.textContent || '';
            // Look for bid at the start of the text (before next listing's title)
            const bidMatch = tileText.match(/High\s*Bid\s*\$\s*([\d,]+)/i);
            if (bidMatch) {
              const bidVal = parseInt(bidMatch[1].replace(/,/g, ''));
              // Validate it's reasonable (not concatenated with year)
              if (bidVal < 50000000) {
                bid = bidVal;
              }
            }

            // Time remaining
            const timeMatch = tileText.match(/Ends\s*In\s*(\d+D)?\s*(\d+H)?\s*(\d+M)?/i);
            if (timeMatch) {
              timeRemaining = timeMatch[0].replace('Ends In', '').trim();
            }
          }

          profiles.push({
            source: 'PCarMarket',
            url,
            title,
            current_bid: bid,
            bid_count: null,
            time_remaining: timeRemaining,
            reserve_status: null,
            image_url: imgEl?.src || imgEl?.getAttribute('data-src') || null,
          });
        }

        return profiles;
      });
    }
  },

  'Collecting Cars': {
    url: 'https://collectingcars.com/',
    extract: async (page: Page): Promise<AuctionProfile[]> => {
      await page.goto('https://collectingcars.com/', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);

      // Scroll
      for (let i = 0; i < 5; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i * 500);
        await page.waitForTimeout(400);
      }

      return await page.evaluate(() => {
        const profiles: any[] = [];

        const cards = document.querySelectorAll('[class*="listing-tile"], [class*="auction-card"], .auction-item');

        for (const card of Array.from(cards)) {
          const linkEl = card.querySelector('a') as HTMLAnchorElement;
          const titleEl = card.querySelector('h2, h3, [class*="title"]');
          const imgEl = card.querySelector('img') as HTMLImageElement;

          const title = titleEl?.textContent?.trim() || '';
          const url = linkEl?.href || '';

          if (!url || !url.includes('collectingcars.com')) continue;

          const cardText = card.textContent || '';

          // Parse bid (supports multiple currencies)
          const bidMatch = cardText.match(/[£€$A]?\$?\s*([\d,]+)/);
          const bid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null;

          // Bid count
          const bidsMatch = cardText.match(/(\d+)\s*bids?/i);
          const bidCount = bidsMatch ? parseInt(bidsMatch[1]) : null;

          // Time
          const timeMatch = cardText.match(/(\d+:\d+:\d+|\d+[dhm])/i);
          const timeRemaining = timeMatch ? timeMatch[0] : null;

          profiles.push({
            source: 'Collecting Cars',
            url,
            title,
            current_bid: bid,
            bid_count: bidCount,
            time_remaining: timeRemaining,
            reserve_status: null,
            image_url: imgEl?.src || imgEl?.getAttribute('data-src') || null,
          });
        }

        return profiles;
      });
    }
  },

  'Broad Arrow Auctions': {
    url: 'https://www.broadarrowauctions.com/vehicles',
    extract: async (page: Page): Promise<AuctionProfile[]> => {
      // Broad Arrow uses /vehicles page for available lots
      await page.goto('https://www.broadarrowauctions.com/vehicles', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(4000);

      // Scroll to trigger lazy loading
      for (let i = 0; i < 8; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i * 600);
        await page.waitForTimeout(500);
      }

      return await page.evaluate(() => {
        const profiles: any[] = [];
        const seen = new Set<string>();

        // Broad Arrow uses a.vehicle-card for lot cards
        const cards = document.querySelectorAll('a.vehicle-card, a[href*="/vehicles/"]');

        for (const card of Array.from(cards).slice(0, 30)) {
          const linkEl = card as HTMLAnchorElement;
          const url = linkEl.href;

          // Skip if not a vehicle detail page or already seen
          if (!url || seen.has(url) || !url.includes('/vehicles/') || url === 'https://www.broadarrowauctions.com/vehicles') continue;
          seen.add(url);

          const imgEl = card.querySelector('img') as HTMLImageElement;
          const cardText = card.textContent || '';

          // Parse title - format is "YEAR\nMAKE\nMODEL"
          const lines = cardText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

          // Find year (4 digit number 1900-2030)
          const yearLine = lines.find(l => /^(19|20)\d{2}$/.test(l));
          const year = yearLine ? parseInt(yearLine) : null;

          // Make and model are typically the lines after year
          const yearIdx = yearLine ? lines.indexOf(yearLine) : -1;
          const make = yearIdx >= 0 && lines[yearIdx + 1] ? lines[yearIdx + 1] : null;
          const model = yearIdx >= 0 && lines[yearIdx + 2] ? lines[yearIdx + 2] : null;

          // Construct title
          const title = [year, make, model].filter(Boolean).join(' ') || lines.slice(0, 3).join(' ');

          // Look for estimate
          const estimateMatch = cardText.match(/Estimate[:\s]*\$?\s*([\d,]+)/i);
          const estimate = estimateMatch ? parseInt(estimateMatch[1].replace(/,/g, '')) : null;

          profiles.push({
            source: 'Broad Arrow Auctions',
            url,
            title: title.replace(/\s+/g, ' ').trim(),
            current_bid: estimate,
            bid_count: null,
            time_remaining: null,
            reserve_status: null,
            image_url: imgEl?.src || imgEl?.getAttribute('data-src') || null,
          });
        }

        return profiles;
      });
    }
  },

  'RM Sothebys': {
    url: 'https://rmsothebys.com/ps00/inventory/',
    extract: async (page: Page): Promise<AuctionProfile[]> => {
      await page.goto('https://rmsothebys.com/ps00/inventory/', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);

      return await page.evaluate(() => {
        const profiles: any[] = [];

        const cards = document.querySelectorAll('.search-result, [class*="vehicle-card"], .lot-card');

        for (const card of Array.from(cards)) {
          const linkEl = card.querySelector('a') as HTMLAnchorElement;
          const titleEl = card.querySelector('h2, h3, .lot-title, [class*="title"]');
          const imgEl = card.querySelector('img') as HTMLImageElement;

          const title = titleEl?.textContent?.trim() || '';
          const url = linkEl?.href || '';

          if (!url) continue;

          const cardText = card.textContent || '';

          // Estimate
          const estimateMatch = cardText.match(/\$\s*([\d,]+)/);
          const estimate = estimateMatch ? parseInt(estimateMatch[1].replace(/,/g, '')) : null;

          profiles.push({
            source: 'RM Sothebys',
            url,
            title,
            current_bid: estimate,
            bid_count: null,
            time_remaining: null,
            reserve_status: null,
            image_url: imgEl?.src || null,
          });
        }

        return profiles;
      });
    }
  },

  'Gooding & Company': {
    url: 'https://www.goodingco.com/lots/',
    extract: async (page: Page): Promise<AuctionProfile[]> => {
      // Gooding uses /lots/ page for current auction inventory
      await page.goto('https://www.goodingco.com/lots/', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);

      // Scroll to load more
      for (let i = 0; i < 5; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i * 500);
        await page.waitForTimeout(400);
      }

      return await page.evaluate(() => {
        const profiles: any[] = [];
        const seen = new Set<string>();

        // Gooding uses vehicleCard-module--appVehicleCard--* classes for cards
        const cards = document.querySelectorAll('[class*="vehicleCard-module"], [class*="VehicleCard"], .vehicle-card, a[href*="/lot/"]');

        for (const card of Array.from(cards)) {
          // Get the link
          const linkEl = (card.tagName === 'A' ? card : card.querySelector('a[href*="/lot/"]')) as HTMLAnchorElement;
          const url = linkEl?.href || '';

          if (!url || seen.has(url) || !url.includes('/lot/')) continue;
          seen.add(url);

          const imgEl = card.querySelector('img') as HTMLImageElement;

          // Extract title from URL (most reliable for Gooding)
          // URL format: /lot/yyyy-make-model-description
          const urlPath = url.split('/lot/').pop() || '';
          let title = urlPath
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

          // Try to find better title from text content
          const cardText = card.textContent || '';
          // Clean text - remove HTML-like content
          const cleanText = cardText.replace(/<[^>]*>/g, '').replace(/Previous|Next|srcset|picture|source/gi, '');

          // Look for year followed by make/model pattern
          const yearMakeMatch = cleanText.match(/\b(19[0-9]{2}|20[0-2][0-9])\s+([A-Z][a-zA-Z\-]+(?:\s+[A-Z][a-zA-Z\-]+)*)/);
          if (yearMakeMatch && yearMakeMatch[0].length > 10) {
            title = yearMakeMatch[0].trim();
          }

          // Parse estimate/bid - Gooding shows estimates
          const estimateMatch = cardText.match(/\$\s*([\d,]+)/);
          let estimate: number | null = null;
          if (estimateMatch) {
            const val = parseInt(estimateMatch[1].replace(/,/g, ''));
            if (val >= 1000 && val <= 100000000) {
              estimate = val;
            }
          }

          // Skip if title still contains HTML markup
          if (title.includes('<') || title.includes('srcset') || title.includes('Previous')) {
            continue;
          }

          profiles.push({
            source: 'Gooding & Company',
            url,
            title: title.replace(/\s+/g, ' ').trim(),
            current_bid: estimate,
            bid_count: null,
            time_remaining: null,
            reserve_status: null,
            image_url: imgEl?.src || imgEl?.getAttribute('data-src') || null,
          });
        }

        return profiles;
      });
    }
  },

  'SBX Cars': {
    url: 'https://www.sbxcars.com/',
    extract: async (page: Page): Promise<AuctionProfile[]> => {
      await page.goto('https://www.sbxcars.com/', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);

      // Scroll
      for (let i = 0; i < 3; i++) {
        await page.evaluate((y) => window.scrollTo(0, y), i * 500);
        await page.waitForTimeout(400);
      }

      return await page.evaluate(() => {
        const profiles: any[] = [];
        const seen = new Set<string>();

        // SBX uses various card patterns - look for actual vehicle cards
        const cards = document.querySelectorAll('[class*="listing-card"], [class*="vehicle-card"], [class*="auction-card"], .car-card');

        for (const card of Array.from(cards)) {
          const linkEl = card.querySelector('a[href*="/vehicle/"], a[href*="/auction/"], a[href*="/listing/"]') as HTMLAnchorElement;
          if (!linkEl) continue;

          const url = linkEl.href;

          // Skip navigation links and duplicates
          if (!url || seen.has(url) || url.includes('/auctions') && url.endsWith('/auctions')) continue;
          seen.add(url);

          const imgEl = card.querySelector('img') as HTMLImageElement;

          // Get title - clean up whitespace and newlines
          const titleEl = card.querySelector('h2, h3, h4, [class*="title"], [class*="name"]');
          let title = titleEl?.textContent || '';

          // Clean up title - remove excessive whitespace, newlines, tabs
          title = title.replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

          // Filter out navigation items like "Auctions(33)"
          if (title.match(/^Auctions?\s*\(\d+\)/i) || title.length < 10) continue;

          // Remove trailing "Ad" or similar
          title = title.replace(/\s+Ad$/i, '').trim();

          const cardText = card.textContent || '';

          // Parse bid - look for reasonable amounts
          let bid: number | null = null;
          const dollarMatches = cardText.match(/\$\s*([\d,]+)/g);
          if (dollarMatches) {
            for (const match of dollarMatches) {
              const val = parseInt(match.replace(/[$,\s]/g, ''));
              // Reasonable range
              if (val >= 1000 && val <= 50000000) {
                bid = val;
                break;
              }
            }
          }

          const bidsMatch = cardText.match(/(\d+)\s*bids?/i);
          const bidCount = bidsMatch ? parseInt(bidsMatch[1]) : null;

          // Time remaining
          const timeMatch = cardText.match(/(\d+)\s*d(?:ays?)?\s*(\d+)?\s*h?|(\d+)\s*h(?:ours?)?\s*(\d+)?\s*m?|ends?\s+in\s+(\d+)/i);
          const timeRemaining = timeMatch ? timeMatch[0].trim() : null;

          profiles.push({
            source: 'SBX Cars',
            url,
            title,
            current_bid: bid,
            bid_count: bidCount,
            time_remaining: timeRemaining,
            reserve_status: null,
            image_url: imgEl?.src || null,
          });
        }

        return profiles;
      });
    }
  },
};

// Parse year from title
function parseYear(title: string): number | null {
  const match = title.match(/\b(19[1-9]\d|20[0-2]\d)\b/);
  return match ? parseInt(match[1]) : null;
}

// Parse make from title
function parseMake(title: string): string | null {
  const makes = [
    'Porsche', 'Ferrari', 'Lamborghini', 'Mercedes-Benz', 'Mercedes', 'BMW', 'Audi',
    'Chevrolet', 'Chevy', 'Ford', 'Dodge', 'Plymouth', 'Pontiac', 'Buick', 'Cadillac', 'GMC',
    'Jaguar', 'Aston Martin', 'Bentley', 'Rolls-Royce', 'Maserati', 'Alfa Romeo', 'Lancia',
    'Toyota', 'Nissan', 'Honda', 'Mazda', 'Datsun', 'Lexus', 'Acura', 'Subaru', 'Mitsubishi',
    'Jeep', 'Land Rover', 'Range Rover', 'McLaren', 'Lotus', 'MG', 'Triumph', 'Austin-Healey',
    'Shelby', 'AC', 'DeLorean', 'Tucker', 'Studebaker', 'Packard', 'Hudson', 'Nash',
  ];

  for (const make of makes) {
    if (new RegExp(`\\b${make.replace('-', '[-\\s]?')}\\b`, 'i').test(title)) {
      if (make === 'Chevy') return 'Chevrolet';
      return make;
    }
  }
  return null;
}

// Parse model from title
function parseModel(title: string, make: string | null): string | null {
  if (!make) return null;
  const parts = title.split(new RegExp(make, 'i'));
  if (parts.length < 2) return null;

  const afterMake = parts[1].trim();
  const model = afterMake.split(/[,\-–]|\s{2,}/)[0]
    .replace(/^\s*[-–]\s*/, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ')
    .replace(/[^\w\s\-\/]/g, '')
    .trim();

  return model.length > 1 ? model : null;
}

// Platform mapping for external_listings
const SOURCE_TO_PLATFORM: Record<string, string> = {
  'Bring a Trailer': 'bat',
  'Cars & Bids': 'cars_and_bids',
  'PCarMarket': 'pcarmarket',
  'Collecting Cars': 'collecting_cars',
  'Broad Arrow Auctions': 'broad_arrow',
  'RM Sothebys': 'rmsothebys',
  'Gooding & Company': 'gooding',
  'SBX Cars': 'sbx',
};

const PLATFORM_ORG_IDS: Record<string, string> = {
  'bat': 'bd035ea4-75f0-4b17-ad02-aee06283343f',
  'cars_and_bids': '822cae29-f80e-4859-9c48-a1485a543152',
  'pcarmarket': 'f7c80592-6725-448d-9b32-2abf3e011cf8',
  'collecting_cars': '0d435048-f2c5-47ba-bba0-4c18c6d58686',
  'broad_arrow': 'bf7f8e55-4abc-45dc-aae0-1df86a9f365a',
  'rmsothebys': '5761f2bf-d37f-4b24-aa38-0d8c95ea2ae1',
  'gooding': '98a2e93e-b814-4fda-b48a-0bb5440b7d00',
  'sbx': '37b84b5e-ee28-410a-bea5-8d4851e39525',
};

// Parse time remaining to calculate end date
function parseEndDate(timeRemaining: string | null): Date | null {
  if (!timeRemaining) return null;

  const now = new Date();
  const lower = timeRemaining.toLowerCase();

  // Parse formats like "6 days", "3d", "2h", "45m", "23:54:04", "6d 2h"
  let totalMinutes = 0;

  // Days
  const daysMatch = lower.match(/(\d+)\s*d(?:ays?)?/i);
  if (daysMatch) totalMinutes += parseInt(daysMatch[1]) * 24 * 60;

  // Hours
  const hoursMatch = lower.match(/(\d+)\s*h(?:ours?)?/i);
  if (hoursMatch) totalMinutes += parseInt(hoursMatch[1]) * 60;

  // Minutes
  const minsMatch = lower.match(/(\d+)\s*m(?:ins?|inutes?)?/i);
  if (minsMatch) totalMinutes += parseInt(minsMatch[1]);

  // Time format HH:MM:SS or HH:MM
  const timeMatch = lower.match(/(\d+):(\d+)(?::(\d+))?/);
  if (timeMatch && !daysMatch && !hoursMatch) {
    totalMinutes = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
  }

  if (totalMinutes <= 0) return null;

  return new Date(now.getTime() + totalMinutes * 60 * 1000);
}

// Save profile to database + external_listings
// Returns vehicleId if successful, null if failed
async function saveProfile(profile: AuctionProfile): Promise<string | null> {
  const year = parseYear(profile.title);
  const make = parseMake(profile.title);
  const model = parseModel(profile.title, make);
  const endDate = parseEndDate(profile.time_remaining);

  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('listing_url', profile.url)
    .limit(1);

  const vehicleData = {
    year,
    make: make || 'Unknown',
    model: model || 'Unknown',
    listing_url: profile.url,
    listing_title: profile.title,
    listing_source: 'auction_extractor',
    primary_image_url: profile.image_url,
    high_bid: profile.current_bid,
    bid_count: profile.bid_count,
    auction_end_date: endDate?.toISOString() || null,
    auction_source: profile.source,
    reserve_status: profile.reserve_status,
    sale_status: 'auction_live',
    updated_at: new Date().toISOString(),
  };

  let vehicleId: string | null = null;

  if (existing && existing.length > 0) {
    vehicleId = existing[0].id;
    const { error } = await supabase
      .from('vehicles')
      .update(vehicleData)
      .eq('id', vehicleId);
    if (error) return null;
  } else {
    const { data: created, error } = await supabase
      .from('vehicles')
      .insert(vehicleData)
      .select('id')
      .single();
    if (error || !created) return null;
    vehicleId = created.id;
  }

  // Also create/update external_listing for marketplace
  const platform = SOURCE_TO_PLATFORM[profile.source];
  const orgId = platform ? PLATFORM_ORG_IDS[platform] : null;

  if (platform && orgId && vehicleId) {
    try {
      const { data: existingListing } = await supabase
        .from('external_listings')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('platform', platform)
        .limit(1);

      const listingData = {
        vehicle_id: vehicleId,
        organization_id: orgId,
        platform: platform,
        listing_url: profile.url,
        listing_status: 'active' as const,
        current_bid: profile.current_bid,
        bid_count: profile.bid_count || 0,
        end_date: endDate?.toISOString() || null,
        metadata: {
          source: 'auction_extractor',
          reserve_status: profile.reserve_status,
          title: profile.title,
          image_url: profile.image_url,
          time_remaining: profile.time_remaining,
        },
        updated_at: new Date().toISOString(),
      };

      if (existingListing && existingListing.length > 0) {
        await supabase
          .from('external_listings')
          .update(listingData)
          .eq('id', existingListing[0].id);
      } else {
        await supabase
          .from('external_listings')
          .insert(listingData);
      }
    } catch (e) {
      // Non-fatal - platform may not be in constraint yet
    }
  }

  return vehicleId;
}

// Save detailed profile data (VIN, mileage, images, etc.)
async function saveDetailedData(
  vehicleId: string,
  details: Partial<DetailedAuctionProfile>
): Promise<void> {
  // Update vehicle with detailed specs
  const updateData: Record<string, any> = {};

  if (details.vin) updateData.vin = details.vin;
  if (details.mileage) updateData.mileage = details.mileage;
  if (details.transmission) updateData.transmission = details.transmission;
  if (details.engine) updateData.engine_size = details.engine;
  if (details.exterior_color) updateData.color = details.exterior_color;
  if (details.interior_color) updateData.interior_color = details.interior_color;
  if (details.location) updateData.bat_location = details.location;
  if (details.seller_username) updateData.bat_seller = details.seller_username;
  if (details.description) updateData.description = details.description;
  if (details.comment_count !== undefined && details.comment_count !== null) {
    updateData.bat_comments = details.comment_count;
  }
  if (details.view_count !== undefined && details.view_count !== null) {
    updateData.bat_views = details.view_count;
  }
  if (details.bid_count !== undefined && details.bid_count !== null) {
    updateData.bid_count = details.bid_count;
  }
  if (details.current_bid !== undefined && details.current_bid !== null) {
    updateData.high_bid = details.current_bid;
  }

  if (Object.keys(updateData).length > 0) {
    updateData.updated_at = new Date().toISOString();
    await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicleId);
  }

  // Save images to vehicle_images table
  if (details.image_urls && details.image_urls.length > 0) {
    // Delete existing images for this vehicle to avoid duplicates
    await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', vehicleId);

    // Insert new images - must satisfy vehicle_images_attribution_check
    const nowIso = new Date().toISOString();
    const imageRecords = details.image_urls.slice(0, 100).map((url, idx) => ({
      vehicle_id: vehicleId,
      image_url: url,
      source_url: url,
      display_order: idx,
      position: idx,
      source: 'bat_import', // Required for attribution check
      is_external: true,
      is_approved: true,
      approval_status: 'auto_approved',
      redaction_level: 'none',
      is_primary: idx === 0,
      created_at: nowIso,
      updated_at: nowIso,
    }));

    if (imageRecords.length > 0) {
      await supabase
        .from('vehicle_images')
        .insert(imageRecords);
    }

    // Update primary image if we have images
    if (details.image_urls.length > 0) {
      await supabase
        .from('vehicles')
        .update({ primary_image_url: details.image_urls[0] })
        .eq('id', vehicleId);
    }
  }
}

// Get detail extraction function for a source
function getDetailExtractor(source: string): ((page: Page, url: string) => Promise<Partial<DetailedAuctionProfile>>) | null {
  switch (source) {
    case 'Bring a Trailer':
      return extractBatListingDetails;
    case 'Cars & Bids':
      return extractCarsAndBidsDetails;
    default:
      return null;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('COMPREHENSIVE AUCTION EXTRACTOR');
  console.log('Target: 8+ solid profiles per source');
  console.log('='.repeat(70));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });

  const results: { source: string; extracted: number; saved: number; profiles: AuctionProfile[] }[] = [];

  for (const [sourceName, config] of Object.entries(AUCTION_SOURCES)) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`SOURCE: ${sourceName}`);
    console.log(`URL: ${config.url}`);
    console.log('─'.repeat(70));

    try {
      const page = await context.newPage();
      const profiles = await config.extract(page);
      await page.close();

      // Dedupe and clean
      const seen = new Set<string>();
      const unique = profiles.filter(p => {
        if (!p.url || seen.has(p.url)) return false;
        seen.add(p.url);
        return p.title && p.title.length > 5;
      });

      console.log(`Extracted: ${unique.length} profiles`);

      if (unique.length === 0) {
        console.log('⚠️  NO PROFILES EXTRACTED - needs selector fix');
        results.push({ source: sourceName, extracted: 0, saved: 0, profiles: [] });
        continue;
      }

      // Save up to TARGET_COUNT
      let saved = 0;
      const savedProfiles: AuctionProfile[] = [];

      // Get detail extractor for this source
      const detailExtractor = FETCH_DETAILS ? getDetailExtractor(sourceName) : null;
      let detailPage: Page | null = null;

      if (detailExtractor) {
        detailPage = await context.newPage();
        console.log(`  📋 Detail extraction enabled for ${sourceName}`);
      }

      for (const profile of unique.slice(0, TARGET_COUNT)) {
        const year = parseYear(profile.title);
        const make = parseMake(profile.title);

        console.log(`\n  ${saved + 1}. ${profile.title.substring(0, 60)}...`);
        console.log(`     Year: ${year || '?'} | Make: ${make || '?'}`);
        if (profile.current_bid) console.log(`     Bid: $${profile.current_bid.toLocaleString()}`);
        if (profile.bid_count) console.log(`     Bids: ${profile.bid_count}`);
        if (profile.time_remaining) console.log(`     Time: ${profile.time_remaining}`);
        if (profile.reserve_status) console.log(`     Reserve: ${profile.reserve_status}`);

        const vehicleId = await saveProfile(profile);
        if (vehicleId) {
          saved++;
          savedProfiles.push(profile);
          console.log(`     ✅ Saved`);

          // Fetch and save detailed data
          if (detailExtractor && detailPage && vehicleId) {
            console.log(`     📥 Fetching details...`);
            try {
              const details = await detailExtractor(detailPage, profile.url);
              if (details && (details.image_urls?.length || details.vin || details.mileage)) {
                await saveDetailedData(vehicleId, details);
                const imageCount = details.image_urls?.length || 0;
                console.log(`     ✅ Details: ${imageCount} images, VIN: ${details.vin || 'N/A'}, Miles: ${details.mileage || 'N/A'}`);
              } else {
                console.log(`     ⚠️ No additional details found`);
              }
            } catch (err: any) {
              console.log(`     ⚠️ Detail extraction failed: ${err.message}`);
            }
          }
        } else {
          console.log(`     ❌ Failed to save`);
        }
      }

      if (detailPage) {
        await detailPage.close();
      }

      const status = saved >= TARGET_COUNT ? '✅ TARGET MET' : saved > 0 ? '⚠️ PARTIAL' : '❌ FAILED';
      console.log(`\n${status}: ${saved}/${TARGET_COUNT} profiles saved`);

      results.push({ source: sourceName, extracted: unique.length, saved, profiles: savedProfiles });

    } catch (error: any) {
      console.log(`❌ ERROR: ${error.message}`);
      results.push({ source: sourceName, extracted: 0, saved: 0, profiles: [] });
    }
  }

  await browser.close();

  // Final Report
  console.log('\n' + '='.repeat(70));
  console.log('EXTRACTION REPORT');
  console.log('='.repeat(70));

  let totalExtracted = 0;
  let totalSaved = 0;
  let sourcesComplete = 0;

  for (const r of results) {
    const status = r.saved >= TARGET_COUNT ? '✅' : r.saved > 0 ? '⚠️' : '❌';
    console.log(`${status} ${r.source}: ${r.saved}/${r.extracted} (target: ${TARGET_COUNT})`);
    totalExtracted += r.extracted;
    totalSaved += r.saved;
    if (r.saved >= TARGET_COUNT) sourcesComplete++;
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`Total: ${totalSaved} profiles saved from ${totalExtracted} extracted`);
  console.log(`Sources meeting target (${TARGET_COUNT}+): ${sourcesComplete}/${results.length}`);
  console.log('='.repeat(70));
}

main().catch(console.error);
