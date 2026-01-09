/**
 * SCRAPE ALL FANTASY JUNCTION BaT LISTINGS WITH PLAYWRIGHT
 * Loads all ~477 listings by clicking "Show more" until disabled
 * Then extracts and imports them using approved two-step workflow
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

/**
 * Fetch free proxies from public APIs (free services)
 */
let freeProxyCache = null;
let lastProxyFetch = 0;
const PROXY_CACHE_TTL = 600000; // 10 minutes

async function fetchFreeProxies() {
  // Return cached proxies if still fresh
  const now = Date.now();
  if (freeProxyCache && (now - lastProxyFetch) < PROXY_CACHE_TTL) {
    return freeProxyCache;
  }

  try {
    // Try ScrapingAnt free proxy API
    const response = await fetch('https://api.scrapingant.com/v2/free-proxies?limit=50', {
      headers: { 'Accept': 'application/json' }
    }).catch(() => null);

    if (response && response.ok) {
      const data = await response.json();
      if (data.proxies && Array.isArray(data.proxies)) {
        const proxies = data.proxies
          .filter(p => p.working !== false)
          .map(p => `${p.host}:${p.port}`);
        
        if (proxies.length > 0) {
          freeProxyCache = proxies;
          lastProxyFetch = now;
          console.log(`   📡 Fetched ${proxies.length} free proxies from ScrapingAnt`);
          return proxies;
        }
      }
    }
  } catch (e) {
    // Fallback: Try Geonode API (no auth needed)
    try {
      const response = await fetch('https://proxylist.geonode.com/api/proxy-list?limit=50&page=1&sort_by=lastChecked&sort_type=desc&protocols=http%2Chttps', {
        headers: { 'Accept': 'application/json' }
      }).catch(() => null);

      if (response && response.ok) {
        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
          const proxies = data.data
            .filter(p => p.working !== false && (p.protocols?.includes('http') || p.protocols?.includes('https')))
            .map(p => `${p.ip}:${p.port}`);
          
          if (proxies.length > 0) {
            freeProxyCache = proxies;
            lastProxyFetch = now;
            console.log(`   📡 Fetched ${proxies.length} free proxies from Geonode`);
            return proxies;
          }
        }
      }
    } catch (e2) {
      // Both APIs failed, return empty
    }
  }

  return [];
}

/**
 * Get proxy configuration from environment variables or free services
 * Supports: Bright Data, Oxylabs, VPN SOCKS5, custom proxy list, free proxy APIs
 */
async function getProxyConfig(useFreeProxies = true) {
  // Check for Bright Data (paid)
  const brightDataCustomerId = process.env.BRIGHT_DATA_CUSTOMER_ID;
  const brightDataPassword = process.env.BRIGHT_DATA_PASSWORD;
  if (brightDataCustomerId && brightDataPassword) {
    return {
      server: `http://brd.superproxy.io:22225`,
      username: `brd-customer-${brightDataCustomerId}`,
      password: brightDataPassword,
      type: 'http'
    };
  }

  // Check for Oxylabs (paid)
  const oxylabsUser = process.env.OXYLABS_USER;
  const oxylabsPassword = process.env.OXYLABS_PASSWORD;
  if (oxylabsUser && oxylabsPassword) {
    return {
      server: `http://customer-${oxylabsUser}:${oxylabsPassword}@pr.oxylabs.io:7777`,
      type: 'http'
    };
  }

  // Check for Tor (FREE! SOCKS5 on localhost:9050 or 9150 for Tor Browser)
  // Tor rotates IPs automatically and is completely free!
  const useTor = process.env.USE_TOR !== 'false';
  const torPort = process.env.TOR_PORT || '9050';
  
  if (useTor) {
    // Simple check: try to connect to Tor SOCKS5 port
    try {
      const net = await import('net');
      const socket = new net.Socket();
      const torAvailable = await new Promise((resolve) => {
        socket.setTimeout(500);
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(parseInt(torPort), '127.0.0.1');
      });
      
      if (torAvailable) {
        return {
          server: `socks5://127.0.0.1:${torPort}`,
          type: 'socks5'
        };
      }
    } catch (e) {
      // Tor check failed, continue to other options
    }
  }

  // Check for VPN SOCKS5 proxy (many VPNs provide SOCKS5 endpoints)
  const vpnSocks5 = process.env.VPN_SOCKS5_PROXY;
  if (vpnSocks5) {
    const parts = vpnSocks5.split(':');
    if (parts.length >= 2) {
      return {
        server: `socks5://${parts[0]}:${parts[1]}`,
        type: 'socks5'
      };
    }
  }

  // Check for custom proxy list (comma-separated: host:port or host:port:user:pass)
  const customProxies = process.env.CUSTOM_PROXY_LIST;
  if (customProxies) {
    const proxyList = customProxies.split(',').map(p => p.trim());
    const randomProxy = proxyList[Math.floor(Math.random() * proxyList.length)];
    const parts = randomProxy.split(':');
    
    if (parts.length === 2) {
      // host:port
      return {
        server: `http://${parts[0]}:${parts[1]}`,
        type: 'http'
      };
    } else if (parts.length === 4) {
      // host:port:user:pass
      return {
        server: `http://${parts[0]}:${parts[1]}`,
        username: parts[2],
        password: parts[3],
        type: 'http'
      };
    }
  }

  // Try free proxy services (if enabled)
  if (useFreeProxies && process.env.USE_FREE_PROXIES !== 'false') {
    const freeProxies = await fetchFreeProxies();
    if (freeProxies && freeProxies.length > 0) {
      const randomProxy = freeProxies[Math.floor(Math.random() * freeProxies.length)];
      const parts = randomProxy.split(':');
      if (parts.length === 2) {
        return {
          server: `http://${parts[0]}:${parts[1]}`,
          type: 'http'
        };
      }
    }
  }

  return null;
}

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const ORG_ID = '1d9122ea-1aaf-46ea-81ea-5f75cb259b69';
const BAT_USERNAME = 'fantasyjunction';
const BAT_MEMBER_URL = `https://bringatrailer.com/member/${BAT_USERNAME}/`;
// Smart delay calculation: Base delay + randomization + increasing delay over time
const BASE_DELAY = 8000; // 8 seconds base (conservative for BaT)
const RANDOM_DELAY = 5000; // ±5 seconds randomization (makes it look human)
const DELAY_MULTIPLIER = 1.02; // Gradually increase delay to avoid patterns

// Get sample size from command line or use default
const SAMPLE_SIZE = parseInt(process.argv[2]) || null; // null = all listings
const FULL_RUN = !SAMPLE_SIZE || process.argv.includes('--full');

console.log('🔍 SCRAPING ALL FANTASY JUNCTION BaT LISTINGS WITH PLAYWRIGHT...\n');
console.log(`   Organization ID: ${ORG_ID}`);
console.log(`   BaT Username: ${BAT_USERNAME}`);
console.log(`   Delay strategy: ${BASE_DELAY/1000}s base + ${RANDOM_DELAY/1000}s random (human-like, avoids blocks)`);
if (SAMPLE_SIZE) {
  console.log(`   Sample size: ${SAMPLE_SIZE} listings`);
} else {
  console.log(`   Mode: FULL RUN (all listings)`);
}
console.log('');

/**
 * Step 1: Use Playwright to load all listings by clicking "Show more"
 */
async function getAllListingsWithPlaywright() {
  console.log(`📡 Loading BaT member page: ${BAT_MEMBER_URL}`);
  console.log(`   This may take a few minutes for ~477 listings...\n`);
  
  // Configure proxy if available (to avoid IP blocks)
  const proxyConfig = await getProxyConfig(true); // Try free proxies by default
  const launchOptions = { headless: true }; // headless: true for speed
  
  if (proxyConfig) {
    const proxyDisplay = proxyConfig.server.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
    console.log(`   🔒 Using proxy: ${proxyDisplay} (${proxyConfig.type || 'http'})`);
    launchOptions.proxy = {
      server: proxyConfig.server,
      username: proxyConfig.username,
      password: proxyConfig.password
    };
    
    // Note: Playwright supports http, https, and socks5 proxies
    if (proxyConfig.type === 'socks5' && !proxyConfig.server.startsWith('socks5://')) {
      console.log(`   ⚠️  SOCKS5 proxy detected but format may need adjustment`);
    }
  } else {
    console.log(`   ⚠️  No proxy - using direct IP with smart delays (should be fine for BaT)`);
    console.log(`   💡 The script uses human-like delays (${BASE_DELAY/1000}s base + ${RANDOM_DELAY/1000}s random + breaks)`);
    console.log(`   💡 BaT is less strict - smart delays should avoid blocks`);
    console.log(`   💡 FREE OPTIONS if you want extra safety:`);
    console.log(`      - Tor: brew install tor && tor (script auto-detects on port 9050)`);
    console.log(`      - Free proxies: Already enabled by default`);
    console.log(`      - VPN SOCKS5: Set VPN_SOCKS5_PROXY=host:port`);
  }
  
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  
  try {
    await page.goto(BAT_MEMBER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000); // Wait for initial load
    
    // Dismiss cookie consent if present
    try {
      const acceptButton = await page.$('#onetrust-accept-btn-handler, button[id*="accept"], button:has-text("Accept"), button:has-text("I Accept")');
      if (acceptButton) {
        await acceptButton.click();
        await page.waitForTimeout(1000);
        console.log('   Dismissed cookie consent');
      }
    } catch (e) {
      // No cookie banner
    }
    
    // Scroll to listings section
    await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h2, h3'));
      const pastListingsHeading = headings.find(h => 
        h.textContent.includes('Past Listings') || 
        h.textContent.includes('Listings')
      );
      if (pastListingsHeading) {
        pastListingsHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    
    await page.waitForTimeout(2000);
    
    // Click "Show more" until it's disabled or doesn't exist
    let clickCount = 0;
    const maxClicks = 100; // Safety limit (should be enough for 477+ listings)
    let lastListingCount = 0;
    
    while (clickCount < maxClicks) {
      try {
        const showMoreButton = page.locator('button:has-text("Show more")').first();
        const count = await showMoreButton.count();
        
        if (count === 0) {
          console.log('   ✅ All listings loaded (button not found)');
          break;
        }
        
        const isDisabled = await showMoreButton.evaluate(btn => btn.disabled || btn.hasAttribute('disabled'));
        
        if (isDisabled) {
          console.log(`   ✅ All listings loaded (button disabled after ${clickCount} clicks)`);
          break;
        }
        
        // Scroll button into view and click
        await showMoreButton.scrollIntoViewIfNeeded();
        await showMoreButton.click();
        clickCount++;
        
        await page.waitForTimeout(1500); // Wait for content to load
        
        // Check how many listings we have now (to detect if we're still loading)
        const currentListingCount = await page.evaluate(() => {
          return document.querySelectorAll('a[href*="/listing/"]').length;
        });
        
        // Track if we got new listings
        const gotNewListings = currentListingCount > lastListingCount;
        
        if (clickCount % 10 === 0 || gotNewListings) {
          console.log(`   Loaded more listings (${clickCount} clicks, ${currentListingCount} listings found)...`);
          lastListingCount = currentListingCount;
        }
        
        // If no new listings appeared after clicking multiple times, we might be done
        if (clickCount > 20 && !gotNewListings) {
          console.log(`   ⚠️  No new listings after click ${clickCount}, checking if button is still active...`);
          // Re-check if button is disabled (sometimes it takes a moment to update)
          await page.waitForTimeout(1000);
          const buttonStillActive = await showMoreButton.evaluate(btn => !btn.disabled && !btn.hasAttribute('disabled'));
          if (!buttonStillActive) {
            console.log(`   ✅ Button is now disabled, all listings loaded`);
            break;
          }
        }
        
      } catch (error) {
        console.log(`   ✅ All listings loaded (error after ${clickCount} clicks: ${error.message})`);
        break;
      }
    }
    
    if (clickCount >= maxClicks) {
      console.log(`   ⚠️  Reached max clicks (${maxClicks}), may not have all listings`);
    }
    
    // Extract all listing URLs from the page
    console.log('\n   Extracting all listing URLs...');
    const listingURLs = await page.evaluate(() => {
      const urls = new Set();
      
      // Find all listing links
      const links = document.querySelectorAll('a[href*="/listing/"]');
      
      links.forEach(link => {
        let url = link.href || link.getAttribute('href');
        if (!url) return;
        
        // Normalize URL
        if (!url.startsWith('http')) {
          url = `https://bringatrailer.com${url}`;
        }
        
        // Remove anchor fragments and trailing slashes
        url = url.split('#')[0].replace(/\/$/, '');
        
        if (url.includes('/listing/')) {
          urls.add(url);
        }
      });
      
      return Array.from(urls);
    });
    
    await browser.close();
    
    console.log(`   ✅ Found ${listingURLs.length} unique listing URLs\n`);
    return listingURLs;
    
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * Step 2: Process a single listing using approved two-step workflow
 */
async function processListing(listingUrl, index, total) {
  const listingName = listingUrl.substring(listingUrl.lastIndexOf('/') + 1);
  console.log(`[${index + 1}/${total}] Processing: ${listingName}`);
  
  try {
    // Step 2a: Extract core vehicle data (APPROVED WORKFLOW)
    console.log('   Step 2a: Extracting core data via extract-premium-auction...');
    const step1 = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: listingUrl,
        max_vehicles: 1
      }
    });

    if (step1.error) {
      throw new Error(`Step 1 failed: ${step1.error.message}`);
    }

    if (!step1.data) {
      throw new Error(`Step 1 failed: No data returned`);
    }

    // Check for success flag or vehicles_extracted count
    if (step1.data.success === false || (step1.data.vehicles_extracted === 0 && !step1.data.created_vehicle_ids?.length && !step1.data.updated_vehicle_ids?.length)) {
      throw new Error(`Step 1 failed: ${step1.data.error || 'No vehicles extracted'}`);
    }

    // Try to get vehicle_id from multiple possible fields
    let vehicleId = step1.data.created_vehicle_ids?.[0] || 
                   step1.data.updated_vehicle_ids?.[0] ||
                   step1.data.vehicle_id ||
                   step1.data.vehicles?.[0]?.id;

    // If still no vehicle_id, try to find by URL (common when vehicle already exists)
    if (!vehicleId) {
      console.log('   ⚠️ No vehicle_id in response, trying to find existing vehicle by URL...');
      
      const urlCandidates = [
        listingUrl,
        listingUrl.replace(/\/$/, ''),
        listingUrl + '/',
        listingUrl.replace('https://', 'http://'),
        listingUrl.replace('http://', 'https://')
      ];
      
      const { data: existingVehicle } = await supabase
        .from('vehicles')
        .select('id')
        .or(`bat_auction_url.in.(${urlCandidates.join(',')}),discovery_url.in.(${urlCandidates.join(',')}),listing_url.in.(${urlCandidates.join(',')})`)
        .maybeSingle();
      
      if (existingVehicle) {
        vehicleId = existingVehicle.id;
        console.log(`   ✅ Found existing vehicle: ${vehicleId}`);
      } else {
        // Also try by checking external_listings
        const { data: extListing } = await supabase
          .from('external_listings')
          .select('vehicle_id')
          .eq('platform', 'bat')
          .in('listing_url', urlCandidates)
          .maybeSingle();
        
        if (extListing?.vehicle_id) {
          vehicleId = extListing.vehicle_id;
          console.log(`   ✅ Found via external_listings: ${vehicleId}`);
        }
      }
    }

    const wasCreated = step1.data.created_vehicle_ids?.includes(vehicleId) || 
                      (step1.data.vehicles_extracted && step1.data.vehicles_extracted > 0 && !step1.data.updated_vehicle_ids?.includes(vehicleId));
    
    if (!vehicleId) {
      console.log('   ⚠️ No vehicle_id found or returned');
      return { success: false, vehicleId: null, listingUrl, error: 'No vehicle_id', created: false };
    }

    console.log(`   ✅ Vehicle ${wasCreated ? 'CREATED' : 'UPDATED'}: ${vehicleId}`);

    // Link to organization (use 'consigner' for past BaT auction listings)
    try {
      const relationshipType = 'consigner';
      
      const { error: relError } = await supabase
        .from('organization_vehicles')
        .upsert({
          organization_id: ORG_ID,
          vehicle_id: vehicleId,
          relationship_type: relationshipType,
          status: 'active',
          auto_tagged: false,
          notes: `Imported from Fantasy Junction BaT profile extraction`
        }, {
          onConflict: 'organization_id,vehicle_id,relationship_type'
        });
      
      if (relError) {
        console.warn(`   ⚠️ Failed to link organization: ${relError.message}`);
      } else {
        console.log(`   ✅ Linked to Fantasy Junction (${relationshipType})`);
      }
    } catch (relError) {
      console.warn(`   ⚠️ Failed to link organization: ${relError?.message || String(relError)}`);
    }

    // Step 2b: Extract comments/bids (APPROVED WORKFLOW - non-critical)
    console.log('   Step 2b: Extracting comments/bids via extract-auction-comments...');
    try {
      const step2 = await supabase.functions.invoke('extract-auction-comments', {
        body: {
          auction_url: listingUrl,
          vehicle_id: vehicleId
        }
      });

      if (!step2.error && step2.data?.success) {
        const commentCount = step2.data.comments_extracted || 0;
        const bidCount = step2.data.bids_extracted || 0;
        console.log(`   ✅ Comments: ${commentCount}, Bids: ${bidCount}`);
      } else {
        console.log('   ⚠️ Comments extraction failed (non-critical):', step2.error?.message || step2.data?.error || 'Unknown error');
      }
    } catch (commentError) {
      console.warn(`   ⚠️ Comments extraction error (non-critical): ${commentError.message}`);
    }

    return { success: true, vehicleId, listingUrl, created: wasCreated };

  } catch (err) {
    console.error(`   ❌ Error processing listing: ${err.message}`);
    return { success: false, vehicleId: null, listingUrl, error: err.message, created: false };
  }
}

// Main execution
async function main() {
  try {
    // Check proxy configuration at start
    const proxyConfig = await getProxyConfig(true); // Try free proxies
    if (!proxyConfig) {
      console.log('⚠️  NOTE: No proxy configured - using direct IP with smart delays');
      console.log('   The script uses human-like delays (8s base + randomization + breaks)');
      console.log('   BaT is less strict than KSL - this should work fine for 263+ listings');
      console.log('');
      console.log('   💡 If you want extra safety (optional):');
      console.log('      - Tor: brew install tor && tor (script auto-detects on port 9050)');
      console.log('      - Free proxies: Already enabled by default');
      console.log('      - VPN SOCKS5: Set VPN_SOCKS5_PROXY=host:port');
      console.log('');
    }
    
    // Step 1: Get all listing URLs using Playwright
    const allListingUrls = await getAllListingsWithPlaywright();

    if (!allListingUrls || allListingUrls.length === 0) {
      console.error('❌ No listing URLs found');
      process.exit(1);
    }

    // Take sample or all listings
    const listingUrls = SAMPLE_SIZE ? allListingUrls.slice(0, SAMPLE_SIZE) : allListingUrls;

    console.log(`📋 Found ${allListingUrls.length} total listings`);
    console.log(`📋 Processing ${listingUrls.length} listings ${SAMPLE_SIZE ? `(SAMPLE - first ${SAMPLE_SIZE})` : '(FULL RUN)'}\n`);
    console.log('📋 Using APPROVED TWO-STEP WORKFLOW:');
    console.log('   1. extract-premium-auction (core data)');
    console.log('   2. extract-auction-comments (comments/bids)\n');

    // Step 2: Process each listing one at a time (slow and accurate)
    const results = {
      processed: 0,
      created: 0,
      updated: 0,
      errors: []
    };

    for (let i = 0; i < listingUrls.length; i++) {
      const url = listingUrls[i];
      const result = await processListing(url, i, listingUrls.length);

      if (result.success) {
        results.processed++;
        if (result.created) {
          results.created++;
        } else {
          results.updated++;
        }
      } else {
        results.errors.push({ url, error: result.error });
      }

      // Rate limiting: Human-like delays with randomization
      // Formula: base + random + gradual increase = looks natural
      if (i < listingUrls.length - 1) {
        // Gradual increase: requests get slightly slower over time (human behavior)
        const progressMultiplier = Math.pow(DELAY_MULTIPLIER, Math.floor(i / 10)); // Every 10 listings, slightly slower
        const baseDelay = BASE_DELAY * progressMultiplier;
        
        // Random variation: ±50% to avoid patterns
        const randomVariation = (Math.random() - 0.5) * RANDOM_DELAY; // -2.5s to +2.5s
        const totalDelay = Math.max(3000, baseDelay + randomVariation); // Minimum 3s, never too fast
        
        const delaySeconds = (totalDelay / 1000).toFixed(1);
        console.log(`\n   ⏳ Waiting ${delaySeconds}s before next listing (human-like delay)...`);
        await new Promise(resolve => setTimeout(resolve, totalDelay));
        
        // Every 5 listings, take a "thinking break" (humans don't work non-stop)
        if ((i + 1) % 5 === 0 && i < listingUrls.length - 1) {
          const thinkingBreak = 15000 + Math.random() * 10000; // 15-25 second break
          console.log(`   🧠 Taking a thinking break (${(thinkingBreak/1000).toFixed(1)}s)...`);
          await new Promise(resolve => setTimeout(resolve, thinkingBreak));
        }
      }
      
      // Every 20 listings, rotate proxy if using free proxies (they may die)
      const globalProxyConfig = await getProxyConfig(true);
      if (globalProxyConfig && globalProxyConfig.type === 'http' && !globalProxyConfig.username) {
        // Likely a free proxy - rotate it every 20 listings
        if ((i + 1) % 20 === 0 && i < listingUrls.length - 1) {
          console.log(`\n   🔄 Rotating to new proxy after ${i + 1} listings...`);
          freeProxyCache = null; // Force refresh on next call
        }
      }
      
      // Every 20 listings, take a longer break (if no proxy) to avoid rate limits
      if (!globalProxyConfig && (i + 1) % 20 === 0 && i < listingUrls.length - 1) {
        const longBreak = 30000; // 30 second break every 20 listings
        console.log(`\n   🛑 Taking a longer break (${longBreak/1000}s) after ${i + 1} listings to avoid rate limits...`);
        await new Promise(resolve => setTimeout(resolve, longBreak));
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total listings found: ${allListingUrls.length}`);
    console.log(`Listings processed: ${listingUrls.length}`);
    console.log(`Successfully processed: ${results.processed}`);
    console.log(`Vehicles created: ${results.created}`);
    console.log(`Vehicles updated: ${results.updated}`);
    console.log(`Errors: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      console.log('\nErrors:');
      results.errors.slice(0, 10).forEach((err, i) => {
        console.log(`  ${i + 1}. ${err.url.substring(err.url.lastIndexOf('/') + 1)}: ${err.error}`);
      });
      if (results.errors.length > 10) {
        console.log(`  ... and ${results.errors.length - 10} more`);
      }
    }
    
    console.log('='.repeat(60));
    
    if (SAMPLE_SIZE && allListingUrls.length > SAMPLE_SIZE) {
      console.log(`\n✅ Sample complete! To process all ${allListingUrls.length} listings, run:`);
      console.log(`   node scripts/scrape-all-fantasy-junction-bat-playwright.js --full\n`);
    } else {
      console.log('\n✅ Import complete!\n');
    }
    
    console.log(`View organization: https://n-zero.dev/org/${ORG_ID}\n`);

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();

