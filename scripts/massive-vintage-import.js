#!/usr/bin/env node

/**
 * MASSIVE Vintage Vehicle Import System
 * 
 * Targets 10,000+ vintage vehicles by scraping:
 * - 50+ Craigslist cities with multiple search terms
 * - All major marketplaces
 * - All auction sites
 * - All dealer sites
 * - All classified sites
 * 
 * Optimized for high-volume import
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env.local');

try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });
} catch (error) {
  // .env.local not found, use system env vars
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Rate limits
const RATE_LIMITS = {
  'craigslist.org': 1500,
  'ksl.com': 3000,
  'facebook.com': 5000,
  'ebay.com': 2000,
  'bringatrailer.com': 2000,
  'hemmings.com': 1500,
  'classic.com': 1000,
  'autotrader.com': 3000,
  'cars.com': 3000,
  'default': 2000
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

const rateLimitTracker = new Map();

// ALL MAJOR CRAIGSLIST CITIES
const CRAIGSLIST_CITIES = [
  'sfbay', 'losangeles', 'newyork', 'chicago', 'atlanta', 'dallas', 'denver',
  'seattle', 'portland', 'phoenix', 'houston', 'miami', 'boston', 'philadelphia',
  'minneapolis', 'detroit', 'cleveland', 'cincinnati', 'pittsburgh', 'baltimore',
  'washingtondc', 'raleigh', 'charlotte', 'nashville', 'memphis', 'neworleans',
  'kansascity', 'stlouis', 'milwaukee', 'indianapolis', 'columbus', 'buffalo',
  'rochester', 'albany', 'providence', 'hartford', 'richmond', 'norfolk',
  'jacksonville', 'tampa', 'orlando', 'sacramento', 'fresno', 'sandiego',
  'orangecounty', 'inlandempire', 'ventura', 'santabarbara', 'stockton',
  'modesto', 'bakersfield', 'reno', 'lasvegas', 'saltlakecity', 'boise',
  'spokane', 'eugene', 'bend', 'tucson', 'albuquerque', 'oklahomacity',
  'tulsa', 'wichita', 'omaha', 'desmoines', 'fargo', 'grandrapids',
  'lansing', 'madison', 'greensboro', 'asheville', 'charleston', 'savannah',
  'mobile', 'birmingham', 'little rock', 'shreveport', 'austin', 'sanantonio',
  'elpaso', 'corpuschristi', 'lubbock', 'amarillo', 'wichitafalls', 'aberdeen',
  'anchorage', 'honolulu'
];

// SEARCH TERMS FOR VINTAGE VEHICLES
const SEARCH_TERMS = [
  'classic car', 'vintage car', 'antique car', 'muscle car', 'collector car',
  '1960', '1961', '1962', '1963', '1964', '1965', '1966', '1967', '1968', '1969',
  '1970', '1971', '1972', '1973', '1974', '1975', '1976', '1977', '1978', '1979',
  '1980', '1981', '1982', '1983', '1984', '1985', '1986', '1987', '1988', '1989',
  '1990', '1991', '1992', '1993', '1994', '1995', '1996', '1997', '1998', '1999',
  'corvette', 'mustang', 'camaro', 'charger', 'challenger', 'gto', 'firebird',
  'trans am', 'chevelle', 'nova', 'impala', 'bel air', 'c10', 'k10', 'c20', 'k20',
  'f150', 'f250', 'bronco', 'ranger', 'silverado', 'sierra', 'tacoma', 'tundra',
  'land cruiser', 'fj40', 'fj60', 'wrangler', 'cj5', 'cj7', 'blazer', 'suburban',
  'tahoe', 'yukon', 'pickup', 'truck', 'restored', 'project car', 'barn find'
];

// Generate Craigslist sources (cities × search terms, but limit to top combinations)
const generateCraigslistSources = () => {
  const sources = [];
  const topCities = CRAIGSLIST_CITIES.slice(0, 30); // Top 30 cities
  const topTerms = SEARCH_TERMS.slice(0, 20); // Top 20 terms
  
  for (const city of topCities) {
    for (const term of topTerms.slice(0, 5)) { // 5 terms per city
      sources.push({
        url: `https://${city}.craigslist.org/search/cta?query=${encodeURIComponent(term)}&sort=date`,
        name: `Craigslist ${city} - ${term}`,
        type: 'classifieds',
        priority: 7
      });
    }
  }
  
  return sources;
};

// MASSIVE SOURCE LIST
const SOURCES = [
  // Craigslist (generated)
  ...generateCraigslistSources(),
  
  // KSL Cars - Comprehensive
  { url: 'https://cars.ksl.com/v2/search/category/Classic', name: 'KSL Classic', type: 'classifieds', priority: 9 },
  { url: 'https://cars.ksl.com/v2/search/category/Truck', name: 'KSL Truck', type: 'classifieds', priority: 9 },
  { url: 'https://cars.ksl.com/v2/search/yearFrom/1960/yearTo/1979', name: 'KSL 1960s-70s', type: 'classifieds', priority: 9 },
  { url: 'https://cars.ksl.com/v2/search/yearFrom/1980/yearTo/1999', name: 'KSL 1980s-90s', type: 'classifieds', priority: 8 },
  { url: 'https://cars.ksl.com/v2/search/make/Chevrolet', name: 'KSL Chevrolet', type: 'classifieds', priority: 8 },
  { url: 'https://cars.ksl.com/v2/search/make/Ford', name: 'KSL Ford', type: 'classifieds', priority: 8 },
  { url: 'https://cars.ksl.com/v2/search/make/GMC', name: 'KSL GMC', type: 'classifieds', priority: 8 },
  { url: 'https://cars.ksl.com/v2/search/make/Dodge', name: 'KSL Dodge', type: 'classifieds', priority: 7 },
  { url: 'https://cars.ksl.com/v2/search/make/Toyota', name: 'KSL Toyota', type: 'classifieds', priority: 7 },
  
  // Bring a Trailer - All makes
  { url: 'https://bringatrailer.com/auctions/', name: 'BaT All', type: 'auction', priority: 10 },
  { url: 'https://bringatrailer.com/chevrolet/', name: 'BaT Chevrolet', type: 'auction', priority: 9 },
  { url: 'https://bringatrailer.com/ford/', name: 'BaT Ford', type: 'auction', priority: 9 },
  { url: 'https://bringatrailer.com/dodge/', name: 'BaT Dodge', type: 'auction', priority: 8 },
  { url: 'https://bringatrailer.com/porsche/', name: 'BaT Porsche', type: 'auction', priority: 8 },
  { url: 'https://bringatrailer.com/bmw/', name: 'BaT BMW', type: 'auction', priority: 8 },
  { url: 'https://bringatrailer.com/mercedes-benz/', name: 'BaT Mercedes', type: 'auction', priority: 8 },
  { url: 'https://bringatrailer.com/toyota/', name: 'BaT Toyota', type: 'auction', priority: 7 },
  { url: 'https://bringatrailer.com/jeep/', name: 'BaT Jeep', type: 'auction', priority: 7 },
  { url: 'https://bringatrailer.com/gmc/', name: 'BaT GMC', type: 'auction', priority: 7 },
  
  // Hemmings - All categories
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale', name: 'Hemmings All', type: 'marketplace', priority: 9 },
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet', name: 'Hemmings Chevy', type: 'marketplace', priority: 8 },
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/ford', name: 'Hemmings Ford', type: 'marketplace', priority: 8 },
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/dodge', name: 'Hemmings Dodge', type: 'marketplace', priority: 7 },
  
  // Classic.com
  { url: 'https://classic.com/search?q=classic+car', name: 'Classic.com All', type: 'marketplace', priority: 8 },
  { url: 'https://classic.com/search?q=chevrolet', name: 'Classic.com Chevy', type: 'marketplace', priority: 7 },
  { url: 'https://classic.com/search?q=ford', name: 'Classic.com Ford', type: 'marketplace', priority: 7 },
  
  // AutoTrader Classics
  { url: 'https://classics.autotrader.com/classic-cars-for-sale', name: 'AT Classics All', type: 'marketplace', priority: 8 },
  { url: 'https://classics.autotrader.com/classic-cars-for-sale/chevrolet', name: 'AT Classics Chevy', type: 'marketplace', priority: 7 },
  { url: 'https://classics.autotrader.com/classic-cars-for-sale/ford', name: 'AT Classics Ford', type: 'marketplace', priority: 7 },
  
  // ClassicCars.com
  { url: 'https://classiccars.com/listings/find', name: 'ClassicCars All', type: 'marketplace', priority: 8 },
  { url: 'https://classiccars.com/listings/find/chevrolet', name: 'ClassicCars Chevy', type: 'marketplace', priority: 7 },
  { url: 'https://classiccars.com/listings/find/ford', name: 'ClassicCars Ford', type: 'marketplace', priority: 7 },
  
  // Cars & Bids
  { url: 'https://carsandbids.com/past-auctions', name: 'C&B Past', type: 'auction', priority: 7 },
  { url: 'https://carsandbids.com/search?make=Chevrolet', name: 'C&B Chevy', type: 'auction', priority: 6 },
  { url: 'https://carsandbids.com/search?make=Ford', name: 'C&B Ford', type: 'auction', priority: 6 },
  
  // SearchTempest (Craigslist aggregator)
  { url: 'https://www.searchtempest.com/results.php?search=classic+car&category=cta', name: 'SearchTempest Classic', type: 'classifieds', priority: 6 },
  { url: 'https://www.searchtempest.com/results.php?search=vintage+car&category=cta', name: 'SearchTempest Vintage', type: 'classifieds', priority: 6 },
  { url: 'https://www.searchtempest.com/results.php?search=muscle+car&category=cta', name: 'SearchTempest Muscle', type: 'classifieds', priority: 6 },
];

const stats = {
  totalCycles: 0,
  totalScraped: 0,
  totalAddedToQueue: 0,
  totalErrors: 0,
  startTime: new Date(),
  sourceStats: new Map()
};

function getRateLimitDelay(domain) {
  const lastRequest = rateLimitTracker.get(domain) || 0;
  const rateLimit = RATE_LIMITS[domain] || RATE_LIMITS['default'];
  const timeSinceLastRequest = Date.now() - lastRequest;
  return timeSinceLastRequest < rateLimit ? rateLimit - timeSinceLastRequest : 0;
}

function updateRateLimitTracking(domain) {
  rateLimitTracker.set(domain, Date.now());
}

async function intelligentFetch(url, maxRetries = 3) {
  const domain = new URL(url).hostname.replace('www.', '');
  const delay = getRateLimitDelay(domain);
  
  if (delay > 0) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const humanDelay = Math.random() * 1000 + 500;
  await new Promise(resolve => setTimeout(resolve, humanDelay));
  
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 30000
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      updateRateLimitTracking(domain);
      return response;
      
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

function extractListingURLs(html, baseUrl) {
  const urls = new Set();
  const base = new URL(baseUrl);
  
  const patterns = [
    /href=["']([^"']*\/cto\/d\/[^"']+)["']/gi,
    /href=["']([^"']*\/ctd\/d\/[^"']+)["']/gi,
    /href=["']([^"']*bringatrailer\.com\/listing\/[^"']+)["']/gi,
    /href=["']([^"']*hemmings\.com\/classifieds\/[^"']+)["']/gi,
    /href=["']([^"']*classic\.com\/[^"']+)["']/gi,
    /href=["']([^"']*carsandbids\.com\/auctions\/[^"']+)["']/gi,
    /href=["']([^"']*\/listing\/[^"']+)["']/gi,
    /href=["']([^"']*\/auctions\/[^"']+)["']/gi
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let url = match[1];
      if (url.startsWith('/')) {
        url = `${base.origin}${url}`;
      } else if (!url.startsWith('http')) continue;
      
      if (url.includes('/cto/d/') || url.includes('/ctd/d/') ||
          url.includes('/listing/') || url.includes('/classifieds/') ||
          url.includes('/auctions/')) {
        urls.add(url);
      }
    }
  }
  
  return Array.from(urls);
}

async function addToImportQueue(listingUrl, sourceName, sourceType) {
  try {
    const { data: existing } = await supabase
      .from('import_queue')
      .select('id')
      .eq('listing_url', listingUrl)
      .limit(1);
    
    if (existing && existing.length > 0) {
      return { added: false, reason: 'already_queued' };
    }
    
    const { data: existingVehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', listingUrl)
      .limit(1);
    
    if (existingVehicle && existingVehicle.length > 0) {
      return { added: false, reason: 'already_exists' };
    }
    
    const { error } = await supabase
      .from('import_queue')
      .insert({
        listing_url: listingUrl,
        status: 'pending',
        attempts: 0
      });
    
    if (error) {
      if (error.code === '23505') return { added: false, reason: 'duplicate' };
      throw error;
    }
    
    return { added: true };
    
  } catch (error) {
    return { added: false, reason: 'error', error: error.message };
  }
}

async function scrapeSource(source) {
  const { url, name, type, priority } = source;
  let scrapedCount = 0;
  let addedCount = 0;
  
  try {
    console.log(`🔍 [${priority}] ${name}`);
    
    const response = await intelligentFetch(url);
    const html = await response.text();
    
    const listingUrls = extractListingURLs(html, url);
    console.log(`   Found ${listingUrls.length} listings`);
    
    for (const listingUrl of listingUrls) {
      scrapedCount++;
      const result = await addToImportQueue(listingUrl, name, type);
      if (result.added) addedCount++;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    const sourceStat = stats.sourceStats.get(name) || { scraped: 0, added: 0, errors: 0 };
    sourceStat.scraped += scrapedCount;
    sourceStat.added += addedCount;
    stats.sourceStats.set(name, sourceStat);
    
    console.log(`   ✅ Added ${addedCount} new`);
    
    return { scrapedCount, addedCount, success: true };
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    const sourceStat = stats.sourceStats.get(name) || { scraped: 0, added: 0, errors: 0 };
    sourceStat.errors++;
    stats.sourceStats.set(name, sourceStat);
    stats.totalErrors++;
    return { scrapedCount, addedCount: 0, success: false, error: error.message };
  }
}

async function processImportQueue() {
  try {
    // Process in larger batches for thousands of vehicles
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ batch_size: 200 })
    });
    
    const result = await response.json();
    console.log(`   ⚡ Queue processed: ${result.processed || 0} items`);
    return result;
  } catch (error) {
    console.error(`   ❌ Queue processing error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function printStats() {
  const uptime = Math.floor((Date.now() - stats.startTime.getTime()) / 1000 / 60);
  
  console.log('\n' + '='.repeat(70));
  console.log('📊 MASSIVE IMPORT STATISTICS');
  console.log('='.repeat(70));
  console.log(`Total Cycles: ${stats.totalCycles}`);
  console.log(`Uptime: ${uptime} minutes`);
  console.log(`Total Scraped: ${stats.totalScraped.toLocaleString()}`);
  console.log(`Total Added to Queue: ${stats.totalAddedToQueue.toLocaleString()}`);
  console.log(`Total Errors: ${stats.totalErrors}`);
  console.log(`Success Rate: ${stats.totalScraped > 0 ? Math.round((stats.totalAddedToQueue / stats.totalScraped) * 100) : 0}%`);
  console.log('\n📈 Top Sources:');
  
  const topSources = Array.from(stats.sourceStats.entries())
    .sort((a, b) => b[1].added - a[1].added)
    .slice(0, 10);
  
  for (const [source, stat] of topSources) {
    const successRate = stat.scraped > 0 ? Math.round((stat.added / stat.scraped) * 100) : 0;
    console.log(`  ${source}: ${stat.added.toLocaleString()} added / ${stat.scraped.toLocaleString()} scraped (${successRate}%)`);
  }
  
  console.log('='.repeat(70) + '\n');
}

async function main() {
  console.log('🚀 MASSIVE VINTAGE VEHICLE IMPORT SYSTEM');
  console.log(`   Target: 10,000+ vintage vehicles`);
  console.log(`   Sources: ${SOURCES.length} sources configured`);
  console.log(`   Running 24/7 - Press Ctrl+C to stop\n`);
  
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    printStats();
    process.exit(0);
  });
  
  while (true) {
    const cycleStart = Date.now();
    stats.totalCycles++;
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🔄 CYCLE #${stats.totalCycles} - ${new Date().toISOString()}`);
    console.log(`📋 Processing ${SOURCES.length} sources...`);
    console.log('='.repeat(70));
    
    const sortedSources = [...SOURCES].sort((a, b) => b.priority - a.priority);
    
    let totalScraped = 0;
    let totalAdded = 0;
    
    for (const source of sortedSources) {
      const result = await scrapeSource(source);
      totalScraped += result.scrapedCount;
      totalAdded += result.addedCount;
      // Reduced delay for faster processing (500ms instead of 1000ms)
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Process queue multiple times per cycle for thousands
    console.log(`\n⚡ Processing import queue (batch 1/3)...`);
    await processImportQueue();
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log(`⚡ Processing import queue (batch 2/3)...`);
    await processImportQueue();
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log(`⚡ Processing import queue (batch 3/3)...`);
    await processImportQueue();
    
    stats.totalScraped += totalScraped;
    stats.totalAddedToQueue += totalAdded;
    
    console.log(`\n✅ Cycle complete: ${totalScraped.toLocaleString()} scraped, ${totalAdded.toLocaleString()} added`);
    
    if (stats.totalCycles % 3 === 0) {
      printStats();
    }
    
    const cycleDuration = Date.now() - cycleStart;
    // Reduced to 5 minutes for faster import (thousands of vehicles)
    const waitTime = Math.max(0, (5 * 60 * 1000) - cycleDuration); // 5 minutes
    
    console.log(`\n😴 Waiting ${Math.floor(waitTime / 1000 / 60)} minutes before next cycle...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

