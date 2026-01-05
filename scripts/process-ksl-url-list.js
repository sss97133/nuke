#!/usr/bin/env node
/**
 * Process list of KSL URLs and import with Playwright
 * Usage: node scripts/process-ksl-url-list.js data/ksl-listing-urls.json [--dry-run] [--limit N]
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '../nuke_frontend/.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const isDryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find(arg => arg.startsWith('--limit'));
const maxVehicles = limitArg ? parseInt(limitArg.split('=')[1]) : null;
const urlFile = process.argv[2];

if (!urlFile) {
  console.error('Usage: node scripts/process-ksl-url-list.js <url-file.json> [--dry-run] [--limit N]');
  process.exit(1);
}

const urls = JSON.parse(fs.readFileSync(urlFile, 'utf8'));
console.log(`📋 Loaded ${urls.length} URLs from ${urlFile}\n`);

async function launchBrowser() {
  return await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
}

async function scrapeListing(browser, url) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
    timezoneId: 'America/Denver',
    geolocation: { latitude: 40.7608, longitude: -111.8910 },
  });
  
  const page = await context.newPage();
  
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });
  
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(10000);
    
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
      
      const result = { title, images: [] };
      
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
    return data;
    
  } catch (error) {
    await context.close();
    return null;
  }
}

async function main() {
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE IMPORT'}\n`);
  
  const toProcess = maxVehicles ? urls.slice(0, maxVehicles) : urls;
  console.log(`Processing: ${toProcess.length} URLs\n`);
  
  const stats = { total: 0, created: 0, existing: 0, failed: 0, images: 0 };
  const browser = await launchBrowser();
  
  for (let i = 0; i < toProcess.length; i++) {
    const url = toProcess[i];
    stats.total++;
    
    console.log(`\n[${i + 1}/${toProcess.length}] ${url}`);
    
    const data = await scrapeListing(browser, url);
    
    if (!data || !data.year || !data.make) {
      stats.failed++;
      console.log(`   ❌ Failed`);
      continue;
    }
    
    console.log(`   📊 ${data.year} ${data.make} ${data.model}`);
    console.log(`   📸 ${data.images.length} images`);
    if (data.vin) console.log(`   🔑 ${data.vin}`);
    
    const { data: existing } = await supabase.from('vehicles').select('id').eq('discovery_url', url).maybeSingle();
    
    if (existing) {
      stats.existing++;
      console.log(`   ⏭️  Exists`);
    } else if (isDryRun) {
      stats.created++;
      console.log(`   [DRY RUN] Would create`);
    } else {
      const { data: newVehicle, error } = await supabase.from('vehicles').insert({
        year: data.year,
        make: data.make.toLowerCase(),
        model: data.model.toLowerCase(),
        vin: data.vin || null,
        mileage: data.mileage || null,
        asking_price: data.asking_price || null,
        profile_origin: 'ksl_import',
        discovery_source: 'ksl_manual_batch',
        discovery_url: url,
        origin_metadata: { ksl_title: data.title, scraped_at: new Date().toISOString(), image_count: data.images.length },
        is_public: true,
        status: 'active',
      }).select('id').single();
      
      if (error) {
        stats.failed++;
        console.log(`   ❌ ${error.message}`);
      } else {
        stats.created++;
        stats.images += data.images.length;
        console.log(`   ✅ Created: ${newVehicle.id}`);
        
        if (data.images.length > 0) {
          await supabase.functions.invoke('backfill-images', {
            body: { vehicle_id: newVehicle.id, image_urls: data.images.slice(0, 50), source: 'ksl_listing', source_url: url }
          });
          console.log(`   ✅ Images uploaded`);
        }
      }
    }
    
    if (i < toProcess.length - 1) {
      const wait = 12000 + Math.random() * 8000;
      console.log(`   ⏸️  ${Math.round(wait/1000)}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  
  await browser.close();
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total: ${stats.total} | Created: ${stats.created} | Existing: ${stats.existing} | Failed: ${stats.failed}`);
  console.log(`Images: ${stats.images} | Success: ${((stats.created + stats.existing) / stats.total * 100).toFixed(1)}%`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(console.error);

