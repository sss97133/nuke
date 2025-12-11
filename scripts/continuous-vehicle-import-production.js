#!/usr/bin/env node

/**
 * Production-Grade Continuous Vehicle Import System
 * 
 * Runs 24/7, importing vehicles from all sources using best practices:
 * - Intelligent rate limiting per domain
 * - Exponential backoff retry logic
 * - User agent rotation
 * - Error recovery and health monitoring
 * - Automatic queue processing
 * 
 * Based on research from:
 * - Intelligent Crawler System docs
 * - Scraping best practices
 * - Rate limit handling strategies
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Rate limiting configuration (per domain, in milliseconds)
const RATE_LIMITS = {
  'craigslist.org': 2000,      // 2 seconds
  'ksl.com': 3000,             // 3 seconds (bot protection)
  'facebook.com': 5000,        // 5 seconds (aggressive protection)
  'bringatrailer.com': 2000,  // 2 seconds
  'hemmings.com': 1500,       // 1.5 seconds
  'classic.com': 1000,        // 1 second
  'autotrader.com': 3000,      // 3 seconds
  'cars.com': 3000,           // 3 seconds
  'carsandbids.com': 2000,    // 2 seconds
  'searchtempest.com': 2000,  // 2 seconds
  'classiccars.com': 2000,    // 2 seconds
  'default': 2000              // Default 2 seconds
};

// User agent rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
];

// Rate limit tracking
const rateLimitTracker = new Map();

// Comprehensive source list - ALL vehicle types
const SOURCES = [
  // Craigslist - Multiple regions and categories
  { 
    url: 'https://sfbay.craigslist.org/search/cta?query=classic+car&sort=date',
    name: 'Craigslist SF - Classic Cars',
    type: 'classifieds',
    priority: 8
  },
  { 
    url: 'https://losangeles.craigslist.org/search/cta?query=vintage&sort=date',
    name: 'Craigslist LA - Vintage',
    type: 'classifieds',
    priority: 8
  },
  { 
    url: 'https://newyork.craigslist.org/search/cta?query=1970&sort=date',
    name: 'Craigslist NYC - 1970s',
    type: 'classifieds',
    priority: 7
  },
  { 
    url: 'https://chicago.craigslist.org/search/cta?query=1980&sort=date',
    name: 'Craigslist Chicago - 1980s',
    type: 'classifieds',
    priority: 7
  },
  { 
    url: 'https://atlanta.craigslist.org/search/cta?query=truck&sort=date',
    name: 'Craigslist Atlanta - Trucks',
    type: 'classifieds',
    priority: 8
  },
  { 
    url: 'https://dallas.craigslist.org/search/cta?query=muscle+car&sort=date',
    name: 'Craigslist Dallas - Muscle Cars',
    type: 'classifieds',
    priority: 7
  },
  
  // KSL Cars - Multiple categories
  { 
    url: 'https://cars.ksl.com/v2/search/category/Classic',
    name: 'KSL - Classic Cars',
    type: 'classifieds',
    priority: 9
  },
  { 
    url: 'https://cars.ksl.com/v2/search/category/Truck',
    name: 'KSL - Trucks',
    type: 'classifieds',
    priority: 9
  },
  { 
    url: 'https://cars.ksl.com/v2/search/yearFrom/1970/yearTo/1990',
    name: 'KSL - 1970-1990',
    type: 'classifieds',
    priority: 8
  },
  
  // Bring a Trailer
  { 
    url: 'https://bringatrailer.com/auctions/',
    name: 'BaT - Recent Auctions',
    type: 'auction',
    priority: 9
  },
  { 
    url: 'https://bringatrailer.com/chevrolet/',
    name: 'BaT - Chevrolet',
    type: 'auction',
    priority: 8
  },
  { 
    url: 'https://bringatrailer.com/ford/',
    name: 'BaT - Ford',
    type: 'auction',
    priority: 8
  },
  
  // Hemmings
  { 
    url: 'https://www.hemmings.com/classifieds/cars-for-sale',
    name: 'Hemmings - All Listings',
    type: 'marketplace',
    priority: 8
  },
  
  // Classic.com
  { 
    url: 'https://classic.com/search?q=classic+car',
    name: 'Classic.com - Classic Cars',
    type: 'marketplace',
    priority: 7
  },
  
  // AutoTrader Classics
  { 
    url: 'https://classics.autotrader.com/classic-cars-for-sale',
    name: 'AT Classics - All',
    type: 'marketplace',
    priority: 7
  },
  
  // ClassicCars.com
  { 
    url: 'https://classiccars.com/listings/find',
    name: 'ClassicCars.com - All',
    type: 'marketplace',
    priority: 7
  },
  
  // Cars & Bids
  { 
    url: 'https://carsandbids.com/past-auctions',
    name: 'C&B - Past Auctions',
    type: 'auction',
    priority: 6
  },
];

// Statistics tracking
const stats = {
  totalCycles: 0,
  totalScraped: 0,
  totalAddedToQueue: 0,
  totalErrors: 0,
  startTime: new Date(),
  lastCycleTime: null,
  sourceStats: new Map()
};

/**
 * Get rate limit delay for a domain
 */
function getRateLimitDelay(domain) {
  const lastRequest = rateLimitTracker.get(domain) || 0;
  const rateLimit = RATE_LIMITS[domain] || RATE_LIMITS['default'];
  const timeSinceLastRequest = Date.now() - lastRequest;
  
  if (timeSinceLastRequest < rateLimit) {
    return rateLimit - timeSinceLastRequest;
  }
  return 0;
}

/**
 * Update rate limit tracking
 */
function updateRateLimitTracking(domain) {
  rateLimitTracker.set(domain, Date.now());
}

/**
 * Intelligent fetch with rate limiting and retry logic
 */
async function intelligentFetch(url, maxRetries = 3) {
  const domain = new URL(url).hostname.replace('www.', '');
  const rateLimitDelay = getRateLimitDelay(domain);
  
  if (rateLimitDelay > 0) {
    console.log(`⏳ Rate limiting ${domain}: waiting ${rateLimitDelay}ms`);
    await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
  }
  
  // Random user agent
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  
  // Human-like random delay
  const humanDelay = Math.random() * 1000 + 500; // 500-1500ms
  await new Promise(resolve => setTimeout(resolve, humanDelay));
  
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 30000 // 30 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      updateRateLimitTracking(domain);
      return response;
      
    } catch (error) {
      lastError = error;
      console.error(`❌ Fetch attempt ${attempt}/${maxRetries} failed for ${domain}:`, error.message);
      
      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = 5000 * attempt; // 5s, 10s, 15s
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

/**
 * Extract listing URLs from HTML using regex (no DOM parsing needed)
 */
function extractListingURLs(html, baseUrl) {
  const urls = new Set();
  const base = new URL(baseUrl);
  
  // Regex patterns for listing URLs
  const patterns = [
    // Craigslist
    /href=["']([^"']*\/cto\/d\/[^"']+)["']/gi,
    /href=["']([^"']*\/ctd\/d\/[^"']+)["']/gi,
    // Bring a Trailer
    /href=["']([^"']*bringatrailer\.com\/listing\/[^"']+)["']/gi,
    // Hemmings
    /href=["']([^"']*hemmings\.com\/classifieds\/[^"']+)["']/gi,
    // Classic.com
    /href=["']([^"']*classic\.com\/[^"']+)["']/gi,
    // Cars & Bids
    /href=["']([^"']*carsandbids\.com\/auctions\/[^"']+)["']/gi,
    // Generic listing patterns
    /href=["']([^"']*\/listing\/[^"']+)["']/gi,
    /href=["']([^"']*\/auctions\/[^"']+)["']/gi
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let url = match[1];
      
      // Convert relative URLs to absolute
      if (url.startsWith('/')) {
        url = `${base.origin}${url}`;
      } else if (!url.startsWith('http')) {
        continue; // Skip invalid URLs
      }
      
      // Filter out non-listing URLs
      if (url.includes('/cto/d/') || 
          url.includes('/ctd/d/') ||
          url.includes('/listing/') ||
          url.includes('/classifieds/') ||
          url.includes('/auctions/')) {
        urls.add(url);
      }
    }
  }
  
  return Array.from(urls);
}

/**
 * Add listing to import queue
 */
async function addToImportQueue(listingUrl, sourceName, sourceType) {
  try {
    // Check if already in queue
    const { data: existing } = await supabase
      .from('import_queue')
      .select('id')
      .eq('discovery_url', listingUrl)
      .limit(1);
    
    if (existing && existing.length > 0) {
      return { added: false, reason: 'already_queued' };
    }
    
    // Check if vehicle already exists
    const { data: existingVehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', listingUrl)
      .limit(1);
    
    if (existingVehicle && existingVehicle.length > 0) {
      return { added: false, reason: 'already_exists' };
    }
    
    // Add to queue
    const { error } = await supabase
      .from('import_queue')
      .insert({
        discovery_url: listingUrl,
        source: sourceName,
        source_type: sourceType,
        status: 'pending',
        attempts: 0
      });
    
    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return { added: false, reason: 'duplicate' };
      }
      throw error;
    }
    
    return { added: true };
    
  } catch (error) {
    console.error(`❌ Error adding to queue:`, error.message);
    return { added: false, reason: 'error', error: error.message };
  }
}

/**
 * Scrape a source
 */
async function scrapeSource(source) {
  const { url, name, type, priority } = source;
  let scrapedCount = 0;
  let addedCount = 0;
  
  try {
    console.log(`\n🔍 Scraping: ${name} (Priority: ${priority})`);
    
    const response = await intelligentFetch(url);
    const html = await response.text();
    
    const listingUrls = extractListingURLs(html, url);
    console.log(`   Found ${listingUrls.length} listings`);
    
    for (const listingUrl of listingUrls) {
      scrapedCount++;
      const result = await addToImportQueue(listingUrl, name, type);
      
      if (result.added) {
        addedCount++;
      }
      
      // Small delay between queue additions
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Update source stats
    const sourceStat = stats.sourceStats.get(name) || { scraped: 0, added: 0, errors: 0 };
    sourceStat.scraped += scrapedCount;
    sourceStat.added += addedCount;
    stats.sourceStats.set(name, sourceStat);
    
    console.log(`   ✅ Added ${addedCount} new listings to queue`);
    
    return { scrapedCount, addedCount, success: true };
    
  } catch (error) {
    console.error(`   ❌ Error scraping ${name}:`, error.message);
    
    const sourceStat = stats.sourceStats.get(name) || { scraped: 0, added: 0, errors: 0 };
    sourceStat.errors++;
    stats.sourceStats.set(name, sourceStat);
    
    stats.totalErrors++;
    return { scrapedCount, addedCount: 0, success: false, error: error.message };
  }
}

/**
 * Process import queue
 */
async function processImportQueue() {
  try {
    console.log('\n⚡ Triggering import queue processor...');
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ batch_size: 50 })
    });
    
    const result = await response.json();
    console.log('   Import queue result:', result);
    
    return result;
    
  } catch (error) {
    console.error('   ❌ Failed to trigger import queue:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Print statistics
 */
function printStats() {
  const uptime = Math.floor((Date.now() - stats.startTime.getTime()) / 1000 / 60); // minutes
  const avgCycleTime = stats.lastCycleTime ? 
    Math.floor((Date.now() - stats.lastCycleTime.getTime()) / 1000 / 60) : 0;
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 STATISTICS');
  console.log('='.repeat(60));
  console.log(`Total Cycles: ${stats.totalCycles}`);
  console.log(`Uptime: ${uptime} minutes`);
  console.log(`Total Scraped: ${stats.totalScraped}`);
  console.log(`Total Added to Queue: ${stats.totalAddedToQueue}`);
  console.log(`Total Errors: ${stats.totalErrors}`);
  console.log(`Avg Cycle Time: ${avgCycleTime} minutes`);
  console.log('\n📈 Source Performance:');
  
  for (const [source, stat] of stats.sourceStats.entries()) {
    const successRate = stat.scraped > 0 ? 
      Math.round((stat.added / stat.scraped) * 100) : 0;
    console.log(`  ${source}: ${stat.added} added / ${stat.scraped} scraped (${successRate}% success, ${stat.errors} errors)`);
  }
  
  console.log('='.repeat(60) + '\n');
}

/**
 * Main loop - runs continuously
 */
async function main() {
  console.log('🚀 Starting Production Continuous Vehicle Import System');
  console.log('   Running 24/7 - Press Ctrl+C to stop\n');
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    printStats();
    process.exit(0);
  });
  
  while (true) {
    const cycleStart = Date.now();
    stats.totalCycles++;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 CYCLE #${stats.totalCycles} - ${new Date().toISOString()}`);
    console.log('='.repeat(60));
    
    // Sort sources by priority (highest first)
    const sortedSources = [...SOURCES].sort((a, b) => b.priority - a.priority);
    
    let totalScraped = 0;
    let totalAdded = 0;
    
    // Scrape all sources
    for (const source of sortedSources) {
      const result = await scrapeSource(source);
      totalScraped += result.scrapedCount;
      totalAdded += result.addedCount;
      
      // Delay between sources
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    stats.totalScraped += totalScraped;
    stats.totalAddedToQueue += totalAdded;
    stats.lastCycleTime = new Date();
    
    console.log(`\n✅ Cycle complete: ${totalScraped} scraped, ${totalAdded} added to queue`);
    
    // Process import queue
    await processImportQueue();
    
    // Print stats every 5 cycles
    if (stats.totalCycles % 5 === 0) {
      printStats();
    }
    
    // Wait before next cycle (5 minutes)
    const cycleDuration = Date.now() - cycleStart;
    const waitTime = Math.max(0, (5 * 60 * 1000) - cycleDuration); // 5 minutes minus cycle time
    
    console.log(`\n😴 Waiting ${Math.floor(waitTime / 1000 / 60)} minutes before next cycle...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
}

// Start the system
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

