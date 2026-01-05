#!/usr/bin/env node
/**
 * Production Playwright Microservice for KSL Scraping
 * Bypasses PerimeterX with proven stealth techniques
 * 
 * Endpoints:
 *   POST /scrape-listing - Scrape single KSL listing detail page
 *   POST /scrape-search - Scrape search page for listing URLs
 *   GET /health - Health check
 * 
 * Deploy to Fly.io/Railway for production Edge Function integration
 */

import express from 'express';
import { chromium } from 'playwright';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Shared browser pool
let browserPool = [];
const MAX_BROWSERS = 3;

async function getBrowser() {
  // Clean up closed browsers
  browserPool = browserPool.filter(b => b.isConnected());
  
  // Create new browser if pool not full
  if (browserPool.length < MAX_BROWSERS) {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });
    browserPool.push(browser);
    return browser;
  }
  
  return browserPool[0];
}

async function createStealthPage(browser) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Denver',
    geolocation: { latitude: 40.7608, longitude: -111.8910 },
    permissions: ['geolocation'],
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
  
  return { page, context };
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'ksl-playwright-scraper',
    browsers: browserPool.length,
    uptime: process.uptime(),
  });
});

// Scrape single listing detail
app.post('/scrape-listing', async (req, res) => {
  const { url } = req.body;
  
  if (!url || !url.includes('ksl.com/listing/')) {
    return res.status(400).json({ error: 'Invalid KSL listing URL' });
  }
  
  console.log(`📄 Scraping listing: ${url}`);
  const startTime = Date.now();
  
  try {
    const browser = await getBrowser();
    const { page, context } = await createStealthPage(browser);
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(10000); // PerimeterX wait
    
    // Scroll to load gallery
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let total = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 100);
          total += 100;
          if (total >= document.body.scrollHeight / 2) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    await page.waitForTimeout(2000);
    
    const data = await page.evaluate(() => {
      const title = document.title.replace(' | KSL Cars', '').trim();
      const bodyText = document.body?.textContent || '';
      const result = { title, html: document.documentElement.outerHTML, images: [] };
      
      const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/);
      if (yearMatch) result.year = parseInt(yearMatch[0]);
      
      const afterYear = title.replace(/\b(19|20)\d{2}\b/, '').trim();
      const parts = afterYear.split(/\s+/);
      if (parts.length >= 2) {
        result.make = parts[0];
        result.model = parts.slice(1, 4).join(' ');
      }
      
      const priceMatch = bodyText.match(/\$(\d{1,3}(?:,\d{3})*)/);
      if (priceMatch) result.asking_price = parseInt(priceMatch[1].replace(/,/g, ''));
      
      const mileageMatch = bodyText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi)/i);
      if (mileageMatch) result.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
      
      const vinMatch = bodyText.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
      if (vinMatch) result.vin = vinMatch[1].toUpperCase();
      
      const locationMatch = title.match(/in\s+([^|]+)/);
      if (locationMatch) result.location = locationMatch[1].trim();
      
      const seen = new Set();
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.getAttribute('data-src');
        if (src && src.includes('ksldigital.com') && !src.includes('logo') && !src.includes('icon') && !src.includes('svg') && !src.includes('weather') && !seen.has(src)) {
          seen.add(src);
          result.images.push(src);
        }
      });
      
      return result;
    });
    
    await context.close();
    
    const duration = Date.now() - startTime;
    console.log(`✅ Success: ${data.images.length} images (${duration}ms)`);
    
    res.json({
      success: true,
      data,
      duration,
    });
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Scrape search page for URLs
app.post('/scrape-search', async (req, res) => {
  const { page_num = 1 } = req.body;
  const url = `https://cars.ksl.com/search/yearFrom/1964/yearTo/1991/page/${page_num}`;
  
  console.log(`🔍 Scraping search page ${page_num}`);
  const startTime = Date.now();
  
  try {
    const browser = await getBrowser();
    const { page, context } = await createStealthPage(browser);
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(12000); // Longer wait for search pages
    
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let total = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 100);
          total += 100;
          if (total >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    await page.waitForTimeout(2000);
    
    const listings = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      
      document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        const url = href.startsWith('/') ? `https://cars.ksl.com${href}` : href;
        const cleanUrl = url.split('?')[0].split('#')[0];
        
        if (seen.has(cleanUrl)) return;
        seen.add(cleanUrl);
        
        const match = href.match(/listing\/(\d+)/);
        if (!match) return;
        
        const card = link.closest('article, [class*="listing"], [class*="card"]');
        const title = card?.querySelector('h2, h3, h4, [class*="title"]')?.textContent?.trim() || '';
        
        results.push({
          url: cleanUrl,
          listing_id: match[1],
          title,
        });
      });
      
      return results;
    });
    
    await context.close();
    
    const duration = Date.now() - startTime;
    
    // Check if blocked
    const pageTitle = await page.title();
    const isBlocked = pageTitle.includes('denied') || pageTitle.includes('Blocked');
    
    if (isBlocked || listings.length === 0) {
      console.log(`❌ Blocked or empty (${duration}ms)`);
      return res.json({
        success: false,
        error: isBlocked ? 'PerimeterX block detected' : 'No listings found',
        page_num,
        duration,
      });
    }
    
    console.log(`✅ Success: ${listings.length} listings (${duration}ms)`);
    
    res.json({
      success: true,
      page_num,
      listings,
      duration,
    });
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Batch scrape search pages
app.post('/scrape-all-search', async (req, res) => {
  const { max_pages = 25 } = req.body;
  
  console.log(`📚 Scraping up to ${max_pages} search pages...`);
  
  const allListings = [];
  let emptyCount = 0;
  let successCount = 0;
  let failCount = 0;
  
  for (let pageNum = 1; pageNum <= max_pages && emptyCount < 2; pageNum++) {
    try {
      const browser = await getBrowser();
      const { page, context } = await createStealthPage(browser);
      
      const url = `https://cars.ksl.com/search/yearFrom/1964/yearTo/1991/page/${pageNum}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(15000); // Even longer wait for search
      
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let total = 0;
          const timer = setInterval(() => {
            window.scrollBy(0, 100);
            total += 100;
            if (total >= document.body.scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });
      
      await page.waitForTimeout(2000);
      
      const listings = await page.evaluate(() => {
        const results = [];
        const seen = new Set();
        
        document.querySelectorAll('a[href*="/listing/"]').forEach(link => {
          const href = link.getAttribute('href');
          if (!href) return;
          
          const url = href.startsWith('/') ? `https://cars.ksl.com${href}` : href;
          const cleanUrl = url.split('?')[0].split('#')[0];
          
          if (seen.has(cleanUrl)) return;
          seen.add(cleanUrl);
          
          const match = href.match(/listing\/(\d+)/);
          if (match) results.push({ url: cleanUrl, listing_id: match[1] });
        });
        
        return results;
      });
      
      await context.close();
      
      if (listings.length === 0) {
        emptyCount++;
        failCount++;
        console.log(`   Page ${pageNum}: Empty (${emptyCount}/2)`);
        if (emptyCount >= 2) break;
      } else {
        emptyCount = 0;
        successCount++;
        allListings.push(...listings);
        console.log(`   Page ${pageNum}: ${listings.length} listings (total: ${allListings.length})`);
      }
      
      // Long wait between search pages
      if (pageNum < max_pages) {
        await new Promise(r => setTimeout(r, 45000 + Math.random() * 15000)); // 45-60s
      }
      
    } catch (error) {
      failCount++;
      console.error(`   Page ${pageNum}: Error - ${error.message}`);
    }
  }
  
  const unique = Array.from(new Map(allListings.map(l => [l.url, l])).values());
  
  console.log(`\n✅ Complete: ${unique.length} URLs (${successCount} pages successful, ${failCount} failed)`);
  
  res.json({
    success: true,
    total_listings: unique.length,
    pages_scraped: successCount,
    pages_failed: failCount,
    listings: unique,
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await Promise.all(browserPool.map(b => b.close()));
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🥷 KSL Playwright Service Running
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  Port: ${PORT}
  Browsers: ${MAX_BROWSERS} max
  
  Endpoints:
    POST /scrape-listing
    POST /scrape-search  
    POST /scrape-all-search
    GET  /health
    
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
});

