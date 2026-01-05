#!/usr/bin/env node
/**
 * Playwright KSL Scraping Microservice
 * HTTP server that bypasses PerimeterX using aggressive stealth techniques
 * 
 * Usage:
 *   node scripts/playwright-ksl-server.js
 *   
 * Then call:
 *   POST http://localhost:3001/scrape
 *   Body: { "url": "https://cars.ksl.com/listing/12345" }
 */

import express from 'express';
import { chromium } from 'playwright';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'playwright-ksl-scraper' });
});

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  
  if (!url || !url.includes('ksl.com')) {
    return res.status(400).json({ error: 'Invalid KSL URL' });
  }
  
  console.log(`🔍 Scraping: ${url}`);
  const startTime = Date.now();
  
  let browser;
  try {
    browser = await chromium.launch({
      headless: false, // Visible browser bypasses detection
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
      ],
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/Denver', // MST (KSL is in Utah)
      geolocation: { latitude: 40.7608, longitude: -111.8910 }, // Salt Lake City
      permissions: ['geolocation'],
    });
    
    const page = await context.newPage();
    
    // Remove webdriver flags
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });
    
    // Navigate and wait for PerimeterX challenge
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000); // PerimeterX challenge resolution
    
    // Human-like scrolling
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight / 2) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    
    await page.waitForTimeout(2000);
    
    // Extract data
    const data = await page.evaluate(() => {
      const result = {
        title: document.title,
        html: document.documentElement.outerHTML,
        images: [],
      };
      
      // Extract all vehicle images
      const imgElements = document.querySelectorAll('img');
      const seen = new Set();
      
      imgElements.forEach(img => {
        const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
        if (src && 
            (src.includes('ksl.com') || src.includes('ksldigital.com') || src.includes('image.ksldigital.com')) &&
            !src.includes('logo') && 
            !src.includes('icon') &&
            !src.includes('svg') &&
            !src.includes('weather') &&
            !seen.has(src)) {
          seen.add(src);
          result.images.push(src);
        }
      });
      
      return result;
    });
    
    await browser.close();
    
    const duration = Date.now() - startTime;
    
    // Check if blocked
    const isBlocked = data.title.includes('denied') || 
                     data.title.includes('Blocked') ||
                     data.html.includes('PerimeterX');
    
    if (isBlocked) {
      console.log(`❌ Blocked (${duration}ms)`);
      return res.status(403).json({
        success: false,
        error: 'PerimeterX block detected',
        duration
      });
    }
    
    console.log(`✅ Success: ${data.images.length} images (${duration}ms)`);
    
    res.json({
      success: true,
      data: {
        title: data.title,
        html: data.html,
        images: data.images,
      },
      duration
    });
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (browser) await browser.close();
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Playwright KSL Scraper running on http://localhost:${PORT}`);
  console.log(`   POST /scrape - Scrape a KSL listing`);
  console.log(`   GET  /health - Health check`);
});

