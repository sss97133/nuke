#!/usr/bin/env node
/**
 * PCARMARKET.COM LISTING SCRAPER
 * 
 * Scrapes vehicle listings from pcarmarket.com listing pages
 * Similar to BaT scraper but adapted for PCarMarket structure
 * 
 * Usage:
 *   node scripts/scrape-pcarmarket-listings.js <url>
 * 
 * Example:
 *   node scripts/scrape-pcarmarket-listings.js https://www.pcarmarket.com/
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Playwright is optional - will be loaded dynamically if available
let playwright = null;

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase key not found in environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BASE_URL = 'https://www.pcarmarket.com';

/**
 * Scrape listing page to extract vehicle listings
 */
async function scrapeListingPage(url) {
  console.log(`📋 Scraping listing page: ${url}\n`);
  
  // Load Playwright if not already loaded
  if (!playwright) {
    try {
      playwright = await import('playwright');
    } catch (e) {
      console.error('❌ Playwright required for listing page scraping');
      console.error('   Install with: npm install playwright');
      console.error('   Or use the Edge Function: supabase functions invoke import-pcarmarket-listing');
      return [];
    }
  }
  
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    // Click "Load more" or pagination until all listings are loaded
    let loadedMore = 0;
    while (true) {
      try {
        const loadMoreButton = await page.$('button:has-text("Load more"), button:has-text("Show more"), a:has-text("Load more")');
        if (!loadMoreButton) break;
        
        const isDisabled = await loadMoreButton.isDisabled().catch(() => false);
        const isVisible = await loadMoreButton.isVisible().catch(() => false);
        if (isDisabled || !isVisible) break;
        
        await loadMoreButton.click();
        await page.waitForTimeout(2000);
        loadedMore++;
        console.log(`   Loaded more listings (${loadedMore})...`);
      } catch (e) {
        break;
      }
    }
    
    // Extract all listing elements
    const listings = await page.$$eval('a[href*="/auction/"]', (links) => {
      const seen = new Set();
      return links
        .map(link => {
          const href = link.getAttribute('href');
          if (!href || !href.includes('/auction/')) return null;
          
          const fullUrl = href.startsWith('http') ? href : `https://www.pcarmarket.com${href}`;
          if (seen.has(fullUrl)) return null;
          seen.add(fullUrl);
          
          // Extract title
          const titleEl = link.querySelector('h4.text-base, h4.font-semibold');
          const title = titleEl?.textContent?.trim() || link.textContent?.trim() || '';
          
          // Extract image
          const imgEl = link.querySelector('img');
          const imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || null;
          
          // Extract bid amount and status
          let bidAmount = null;
          let status = null;
          
          // Check for final bid (sold)
          const finalBidEl = link.querySelector('span.font-semibold.text-green-700');
          if (finalBidEl) {
            const bidText = finalBidEl.textContent?.trim() || '';
            bidAmount = bidText.replace(/[^0-9]/g, '');
            status = 'sold';
          } else {
            // Check for high bid (unsold)
            const highBidEl = link.querySelector('span.font-semibold.text-gray-900');
            if (highBidEl) {
              const bidText = highBidEl.textContent?.trim() || '';
              bidAmount = bidText.replace(/[^0-9]/g, '');
              status = 'unsold';
            }
          }
          
          return {
            url: fullUrl,
            title,
            imageUrl,
            bidAmount: bidAmount ? parseInt(bidAmount) : null,
            status: status || 'unknown',
            slug: href.match(/\/auction\/([^\/]+)/)?.[1] || null
          };
        })
        .filter(Boolean);
    });
    
    await browser.close();
    
    console.log(`   Found ${listings.length} unique listings\n`);
    return listings;
    
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * Scrape individual auction page for detailed vehicle information
 */
async function scrapeAuctionPage(url) {
  console.log(`🔍 Scraping auction page: ${url}`);
  
  // Load Playwright if not already loaded
  if (!playwright) {
    try {
      playwright = await import('playwright');
    } catch (e) {
      console.error('❌ Playwright required for auction page scraping');
      console.error('   Install with: npm install playwright');
      console.error('   Or use the Edge Function: supabase functions invoke import-pcarmarket-listing');
      return null;
    }
  }
  
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    
    // Extract detailed vehicle data
    const vehicleData = await page.evaluate(() => {
      const data = {
        title: null,
        description: null,
        year: null,
        make: null,
        model: null,
        trim: null,
        vin: null,
        mileage: null,
        color: null,
        transmission: null,
        engine: null,
        seller: null,
        sellerUsername: null,
        buyer: null,
        buyerUsername: null,
        salePrice: null,
        saleDate: null,
        auctionEndDate: null,
        bidCount: null,
        viewCount: null,
        images: [],
        comments: [],
        location: null
      };
      
      // Extract title (usually in h1 or specific title element)
      const titleEl = document.querySelector('h1, [class*="title"], [class*="heading"]');
      data.title = titleEl?.textContent?.trim() || null;
      
      // Try to parse year, make, model from title
      if (data.title) {
        const yearMatch = data.title.match(/(\d{4})\s*[-–]\s*Mile/);
        if (yearMatch) {
          data.year = parseInt(yearMatch[1]);
        }
        
        // Common make/model patterns in titles
        const makeModelPatterns = [
          /(\d{4})\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+([A-Z0-9]+(?:\s+[A-Z0-9\-\s]+)?)/,
          /(\d{4})\s+([A-Z][a-z]+)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
        ];
        
        for (const pattern of makeModelPatterns) {
          const match = data.title.match(pattern);
          if (match) {
            data.year = data.year || parseInt(match[1]);
            data.make = match[2]?.toLowerCase();
            data.model = match[3]?.toLowerCase();
            break;
          }
        }
      }
      
      // Extract description
      const descEl = document.querySelector('[class*="description"], [class*="about"], .prose');
      data.description = descEl?.textContent?.trim() || null;
      
      // Extract VIN (usually in a specs section)
      const vinMatch = document.body.textContent?.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      data.vin = vinMatch ? vinMatch[1] : null;
      
      // Extract mileage (look for patterns like "5k-Mile", "5,000 miles", etc.)
      const mileageMatches = [
        ...(document.body.textContent?.match(/(\d+(?:,\d+)?)\s*(?:k-)?(?:Mile|mile|miles)/gi) || []),
        ...(document.body.textContent?.match(/(\d+)k-Mile/gi) || [])
      ];
      if (mileageMatches.length > 0) {
        const mileageText = mileageMatches[0].replace(/[^0-9kK]/g, '');
        if (mileageText.includes('k') || mileageText.includes('K')) {
          data.mileage = parseInt(mileageText) * 1000;
        } else {
          data.mileage = parseInt(mileageText.replace(/,/g, ''));
        }
      }
      
      // Extract images
      const imgElements = document.querySelectorAll('img[src*="d2niwqq19lf86s.cloudfront.net"], img[src*="pcarmarket"], img[class*="gallery"], img[class*="image"]');
      data.images = Array.from(imgElements)
        .map(img => img.getAttribute('src') || img.getAttribute('data-src'))
        .filter(Boolean)
        .map(url => url.startsWith('http') ? url : `${window.location.origin}${url}`);
      
      // Extract sale price and status
      const finalBidEl = document.querySelector('span.font-semibold.text-green-700, [class*="final-bid"], [class*="sold-price"]');
      if (finalBidEl) {
        const priceText = finalBidEl.textContent?.trim() || '';
        data.salePrice = parseInt(priceText.replace(/[^0-9]/g, '')) || null;
      }
      
      // Extract seller/buyer info (if available)
      const sellerEl = document.querySelector('[class*="seller"], [class*="consignor"], a[href*="/member/"], a[href*="/seller/"]');
      if (sellerEl) {
        data.seller = sellerEl.textContent?.trim() || null;
        const sellerHref = sellerEl.getAttribute('href');
        if (sellerHref) {
          const usernameMatch = sellerHref.match(/\/(?:member|seller)\/([^\/]+)/);
          data.sellerUsername = usernameMatch ? usernameMatch[1] : null;
        }
      }
      
      // Extract auction dates (if visible)
      const dateEls = document.querySelectorAll('[class*="date"], [class*="end"], [class*="sold"]');
      for (const el of Array.from(dateEls)) {
        const text = el.textContent?.toLowerCase();
        if (text.includes('sold') || text.includes('ended')) {
          // Try to parse date
          const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (dateMatch) {
            data.saleDate = new Date(`${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`).toISOString();
            data.auctionEndDate = data.saleDate;
          }
        }
      }
      
      return data;
    });
    
    await browser.close();
    
    // Enhance with URL parsing
    const urlMatch = url.match(/\/auction\/([^\/]+)/);
    if (urlMatch) {
      vehicleData.slug = urlMatch[1];
      vehicleData.auctionId = urlMatch[1].split('-').pop();
    }
    
    console.log(`   ✅ Extracted: ${vehicleData.title || 'Unknown'}\n`);
    return vehicleData;
    
  } catch (error) {
    await browser.close();
    console.error(`   ❌ Error scraping ${url}:`, error.message);
    return null;
  }
}

/**
 * Parse vehicle data from listing info
 */
function parseVehicleFromListing(listing, detailedData = null) {
  const data = detailedData || {};
  
  // Parse title for year/make/model
  const title = data.title || listing.title || '';
  let year = data.year || null;
  let make = data.make || null;
  let model = data.model || null;
  
  // Enhanced title parsing
  if (title && !year) {
    const yearMatch = title.match(/(\d{4})/);
    if (yearMatch) {
      year = parseInt(yearMatch[1]);
      if (year >= 1885 && year <= new Date().getFullYear() + 1) {
        // Valid year
      } else {
        year = null;
      }
    }
  }
  
  if (title && (!make || !model)) {
    // Common patterns: "5k-Mile 2002 Aston Martin DB7 V12 Vantage Coupe"
    const parts = title.split(/\s+/).filter(p => !p.match(/^[\d,]+k?-?Mile$/i) && !p.match(/^MP:/));
    if (parts.length >= 3) {
      const yearIndex = parts.findIndex(p => /^\d{4}$/.test(p));
      if (yearIndex >= 0 && yearIndex < parts.length - 1) {
        if (!make) {
          // Usually make is 1-2 words after year
          make = parts.slice(yearIndex + 1, yearIndex + 3).join(' ').toLowerCase();
        }
        if (!model && yearIndex + 3 < parts.length) {
          // Model is everything after make
          model = parts.slice(yearIndex + 3).join(' ').toLowerCase();
        }
      } else if (!make && !model) {
        // Fallback: assume first two words after year/number are make, rest is model
        const nonNumericStart = parts.findIndex(p => !/^\d+/.test(p));
        if (nonNumericStart >= 0) {
          make = parts.slice(nonNumericStart, nonNumericStart + 2).join(' ').toLowerCase();
          if (nonNumericStart + 2 < parts.length) {
            model = parts.slice(nonNumericStart + 2).join(' ').toLowerCase();
          }
        }
      }
    }
  }
  
  return {
    year,
    make: make || null,
    model: model || null,
    trim: data.trim || null,
    vin: data.vin || null,
    mileage: data.mileage || null,
    color: data.color || null,
    transmission: data.transmission || null,
    engine: data.engine || null,
    salePrice: data.salePrice || (listing.status === 'sold' ? listing.bidAmount : null),
    saleDate: data.saleDate || null,
    auctionEndDate: data.auctionEndDate || null,
    auctionOutcome: listing.status === 'sold' ? 'sold' : (listing.status === 'unsold' ? null : null),
    title: title,
    description: data.description || null,
    seller: data.seller || null,
    sellerUsername: data.sellerUsername || null,
    buyer: data.buyer || null,
    buyerUsername: data.buyerUsername || null,
    images: data.images || (listing.imageUrl ? [listing.imageUrl] : []),
    url: listing.url,
    slug: listing.slug || data.slug || null,
    auctionId: data.auctionId || null,
    bidCount: data.bidCount || null,
    viewCount: data.viewCount || null,
    location: data.location || null
  };
}

/**
 * Main execution
 */
async function main() {
  const url = process.argv[2] || BASE_URL;
  
  console.log('🚀 PCARMARKET.COM LISTING SCRAPER\n');
  console.log(`Target URL: ${url}\n`);
  
  try {
    // Step 1: Scrape listing page
    const listings = await scrapeListingPage(url);
    
    if (listings.length === 0) {
      console.log('❌ No listings found');
      return;
    }
    
    // Step 2: Optionally scrape detailed data from first few listings
    console.log(`\n📊 Found ${listings.length} listings`);
    console.log('\nSample listings:');
    listings.slice(0, 5).forEach((listing, i) => {
      console.log(`  ${i + 1}. ${listing.title}`);
      console.log(`     URL: ${listing.url}`);
      console.log(`     Status: ${listing.status}, Bid: $${listing.bidAmount || 'N/A'}`);
    });
    
    // Step 3: Save to JSON file for review
    const fs = await import('fs');
    const outputFile = `data/pcarmarket/listings_${Date.now()}.json`;
    fs.mkdirSync('data/pcarmarket', { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(listings, null, 2));
    console.log(`\n✅ Saved ${listings.length} listings to ${outputFile}`);
    
    // Step 4: Optionally scrape detailed data
    if (process.argv.includes('--detailed')) {
      console.log('\n🔍 Scraping detailed data for first 3 listings...\n');
      for (let i = 0; i < Math.min(3, listings.length); i++) {
        const listing = listings[i];
        const detailed = await scrapeAuctionPage(listing.url);
        if (detailed) {
          const vehicleData = parseVehicleFromListing(listing, detailed);
          console.log(`\n📋 Parsed Vehicle Data:`);
          console.log(JSON.stringify(vehicleData, null, 2));
        }
        await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limiting
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { scrapeListingPage, scrapeAuctionPage, parseVehicleFromListing };

