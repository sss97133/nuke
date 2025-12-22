#!/usr/bin/env node
/**
 * SCRAPE ALL PCARMARKET GALLERY IMAGES
 * 
 * Extracts ALL images from PCarMarket auction gallery
 * Uses Playwright for JavaScript rendering and multiple extraction methods
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

// Try to import Playwright
let playwright = null;
try {
  playwright = await import('playwright');
} catch (e) {
  console.warn('⚠️  Playwright not available - install with: npm install playwright');
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Extract ALL images from PCarMarket page using Playwright
 */
async function extractAllImages(url) {
  console.log(`\n🔍 Extracting ALL images from: ${url}\n`);
  
  let images = new Set();
  let html = '';
  
  try {
    // Method 1: Use Playwright if available (best for JavaScript-rendered pages)
    if (playwright) {
      console.log('   🌐 Using Playwright for full page rendering...');
      const browser = await playwright.chromium.launch({ headless: true });
      const page = await browser.newPage();
      
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(3000); // Wait for gallery to load
        
        // Scroll through gallery to load lazy-loaded images
        console.log('   📜 Scrolling through gallery to load all images...');
        await page.evaluate(async () => {
          let scrollHeight = document.documentElement.scrollHeight;
          const viewportHeight = window.innerHeight;
          let currentPosition = 0;
          
          // Scroll slowly to trigger lazy loading
          while (currentPosition < scrollHeight) {
            window.scrollTo(0, currentPosition);
            await new Promise(resolve => setTimeout(resolve, 200));
            currentPosition += viewportHeight * 0.8;
            
            // Check if new content loaded
            const newScrollHeight = document.documentElement.scrollHeight;
            if (newScrollHeight > scrollHeight) {
              scrollHeight = newScrollHeight;
            }
          }
          
          // Scroll to bottom
          window.scrollTo(0, document.documentElement.scrollHeight);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Scroll back to top
          window.scrollTo(0, 0);
          await new Promise(resolve => setTimeout(resolve, 500));
        });
        
        // Click through gallery navigation/load more buttons
        try {
          for (let attempt = 0; attempt < 20; attempt++) {
            const loadMoreButton = await page.$('button:has-text("Load more"), button:has-text("Show more"), button:has-text("More"), a:has-text("Load more"), [aria-label*="more"], [aria-label*="next"]');
            if (!loadMoreButton) break;
            
            const isVisible = await loadMoreButton.isVisible();
            const isDisabled = await loadMoreButton.isDisabled().catch(() => false);
            
            if (!isVisible || isDisabled) break;
            
            await loadMoreButton.click();
            await page.waitForTimeout(1500);
            console.log(`   📄 Loaded more images (attempt ${attempt + 1})...`);
          }
        } catch (e) {
          // Ignore load more button errors
        }
        
        // Scroll through gallery carousel if it exists
        try {
          const carousel = await page.$('[class*="carousel"], [class*="slider"], [class*="gallery"]');
          if (carousel) {
            console.log('   🎠 Navigating gallery carousel...');
            // Click next buttons in carousel
            for (let i = 0; i < 50; i++) {
              const nextButton = await page.$('button[aria-label*="next"], button[aria-label*="Next"], [class*="next"]');
              if (!nextButton) break;
              const visible = await nextButton.isVisible().catch(() => false);
              if (!visible) break;
              await nextButton.click();
              await page.waitForTimeout(300);
            }
          }
        } catch (e) {
          // Ignore carousel errors
        }
        
        // Extract images from page
        html = await page.content();
        
        // Extract auction time data
        console.log('   ⏰ Extracting auction time data...');
        const timeData = await page.evaluate(() => {
          const data = {
            end_date: null,
            start_date: null,
            countdown_text: null
          };
          
          // Look for countdown elements
          const countdownEl = document.querySelector('[class*="countdown"], [class*="timer"], [class*="time-remaining"], [id*="countdown"]');
          if (countdownEl) {
            data.countdown_text = countdownEl.textContent || '';
          }
          
          // Look for date/time elements
          const dateEls = document.querySelectorAll('[class*="date"], [class*="time"], [class*="end"], [class*="auction"]');
          dateEls.forEach(el => {
            const text = el.textContent?.toLowerCase() || '';
            if (text.includes('end') || text.includes('clos')) {
              // Try to extract date
              const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
              if (dateMatch && !data.end_date) {
                const date = new Date(`${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`);
                if (!isNaN(date.getTime())) {
                  data.end_date = date.toISOString();
                }
              }
            }
          });
          
          // Look for data attributes
          const dataEnd = document.querySelector('[data-end], [data-end-time], [data-auction-end]');
          if (dataEnd) {
            const endTime = dataEnd.getAttribute('data-end') || 
                           dataEnd.getAttribute('data-end-time') || 
                           dataEnd.getAttribute('data-auction-end');
            if (endTime) {
              try {
                const parsed = new Date(endTime);
                if (!isNaN(parsed.getTime())) {
                  data.end_date = parsed.toISOString();
                }
              } catch (e) {}
            }
          }
          
          // Look in script tags for JSON
          document.querySelectorAll('script[type="application/json"]').forEach(script => {
            try {
              const json = JSON.parse(script.textContent || '{}');
              const findDate = (obj, path = '') => {
                if (typeof obj !== 'object' || obj === null) return;
                for (const [key, value] of Object.entries(obj)) {
                  const fullPath = path ? `${path}.${key}` : key;
                  if ((key.toLowerCase().includes('end') || key.toLowerCase().includes('date')) && typeof value === 'string') {
                    try {
                      const parsed = new Date(value);
                      if (!isNaN(parsed.getTime()) && !data.end_date) {
                        data.end_date = parsed.toISOString();
                      }
                    } catch (e) {}
                  }
                  if (typeof value === 'object') findDate(value, fullPath);
                }
              };
              findDate(json);
            } catch (e) {}
          });
          
          return data;
        });
        
        if (timeData.end_date || timeData.countdown_text) {
          console.log(`   ✅ Found time data: ${timeData.end_date || timeData.countdown_text}`);
        }
        
        // Extract from DOM - all image sources
        const pageImages = await page.$$eval('img', (imgs) => {
          return imgs.map(img => {
            return img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || '';
          }).filter(src => {
            // Only CloudFront CDN images (actual photos), exclude SVGs and logos
            return src && 
                   (src.includes('d2niwqq19lf86s.cloudfront.net') || src.includes('cloudfront.net')) &&
                   !src.includes('.svg') &&
                   !src.includes('logo') &&
                   (src.match(/\.(jpg|jpeg|png|webp)$/i) || src.includes('cloudfront.net'));
          });
        });
        
        // Also try to extract from gallery containers, data attributes, and any source
        const galleryImages = await page.evaluate(() => {
          const images = new Set();
          
          // Look for all img elements and all possible src attributes
          document.querySelectorAll('img').forEach(img => {
            const sources = [
              img.src,
              img.getAttribute('data-src'),
              img.getAttribute('data-lazy-src'),
              img.getAttribute('data-original'),
              img.getAttribute('data-full'),
              img.getAttribute('srcset')?.split(' ')[0]
            ].filter(Boolean);
            
            sources.forEach(src => {
              if (src.includes('d2niwqq19lf86s.cloudfront.net') && !src.includes('.svg')) {
                images.add(src.split('?')[0]);
              }
            });
          });
          
          // Look for background images
          document.querySelectorAll('[style*="background-image"]').forEach(el => {
            const style = el.getAttribute('style') || '';
            const match = style.match(/url\(["']?([^"')]+)["']?\)/);
            if (match && match[1].includes('cloudfront.net')) {
              images.add(match[1].split('?')[0]);
            }
          });
          
          // Look for JSON data in script tags (gallery arrays)
          document.querySelectorAll('script').forEach(script => {
            const content = script.textContent || '';
            const jsonMatches = content.matchAll(/"([^"]*d2niwqq19lf86s\.cloudfront\.net[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
            for (const match of jsonMatches) {
              if (!match[1].includes('.svg')) {
                images.add(match[1].split('?')[0]);
              }
            }
          });
          
          return Array.from(images);
        });
        
        // Combine both methods
        galleryImages.forEach(img => {
          if (img) {
            const cleanUrl = img.split('?')[0];
            images.add(cleanUrl);
          }
        });
        
        console.log(`   ✅ Additional methods found ${galleryImages.length} images`);
        
        pageImages.forEach(img => {
          if (img) {
            const cleanUrl = img.split('?')[0];
            images.add(cleanUrl);
          }
        });
        
        console.log(`   ✅ Playwright found ${pageImages.length} images from DOM`);
        if (pageImages.length > 0) {
          console.log(`   Sample URLs: ${pageImages.slice(0, 3).join(', ')}`);
        }
        
        await browser.close();
      } catch (error) {
        await browser.close();
        throw error;
      }
    }
    
    // Method 2: Try Firecrawl if available
    if (images.size === 0) {
      const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
      if (FIRECRAWL_API_KEY) {
        console.log('   Using Firecrawl for JavaScript rendering...');
        try {
          const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: url,
              formats: ['html'],
              waitFor: 5000,
              mobile: false,
            }),
          });

          if (firecrawlResponse.ok) {
            const firecrawlData = await firecrawlResponse.json();
            html = firecrawlData.data?.html || '';
            console.log('   ✅ Firecrawl rendered page');
          }
        } catch (e) {
          console.log('   ⚠️  Firecrawl failed');
        }
      }
      
      // Fallback: Direct fetch
      if (!html) {
        console.log('   Using direct fetch...');
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        html = await response.text();
      }
    }
    
    // If we didn't get images from Playwright, extract from HTML
    if (images.size === 0 && html) {
      console.log('\n   📸 Extracting images from HTML using multiple methods...\n');
      
      // Method 1: Standard img src tags
    const imgSrcMatches = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
    let count1 = 0;
    for (const match of imgSrcMatches) {
      const src = match[1];
      if (src.includes('cloudfront.net') || src.includes('pcarmarket') || src.match(/\.(jpg|jpeg|png|webp)$/i)) {
        const fullUrl = src.startsWith('http') ? src : new URL(src, url).href;
        if (images.add(fullUrl)) count1++;
      }
    }
    console.log(`   Method 1 (img src): Found ${count1} images`);
    
    // Method 2: data-src (lazy loading)
    const dataSrcMatches = html.matchAll(/data-src=["']([^"']+)["']/gi);
    let count2 = 0;
    for (const match of dataSrcMatches) {
      const src = match[1];
      if (src.includes('cloudfront.net') || src.includes('pcarmarket') || src.match(/\.(jpg|jpeg|png|webp)$/i)) {
        const fullUrl = src.startsWith('http') ? src : new URL(src, url).href;
        if (images.add(fullUrl)) count2++;
      }
    }
    console.log(`   Method 2 (data-src): Found ${count2} additional images`);
    
    // Method 3: data-lazy-src
    const lazySrcMatches = html.matchAll(/data-lazy-src=["']([^"']+)["']/gi);
    let count3 = 0;
    for (const match of lazySrcMatches) {
      const src = match[1];
      if (src.includes('cloudfront.net') || src.includes('pcarmarket') || src.match(/\.(jpg|jpeg|png|webp)$/i)) {
        const fullUrl = src.startsWith('http') ? src : new URL(src, url).href;
        if (images.add(fullUrl)) count3++;
      }
    }
    console.log(`   Method 3 (data-lazy-src): Found ${count3} additional images`);
    
    // Method 4: Extract from JSON/JavaScript arrays
    const jsonMatches = html.matchAll(/"([^"]*https?:\/\/[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
    let count4 = 0;
    for (const match of jsonMatches) {
      const imgUrl = match[1];
      if (imgUrl.includes('cloudfront.net') || imgUrl.includes('pcarmarket')) {
        if (images.add(imgUrl)) count4++;
      }
    }
    console.log(`   Method 4 (JSON arrays): Found ${count4} additional images`);
    
    // Method 5: Extract from background-image CSS
    const bgMatches = html.matchAll(/background-image:\s*url\(["']?([^"')]+)["']?\)/gi);
    let count5 = 0;
    for (const match of bgMatches) {
      const src = match[1];
      if ((src.includes('cloudfront.net') || src.includes('pcarmarket')) && src.match(/\.(jpg|jpeg|png|webp)$/i)) {
        const fullUrl = src.startsWith('http') ? src : new URL(src, url).href;
        if (images.add(fullUrl)) count5++;
      }
    }
    console.log(`   Method 5 (background-image): Found ${count5} additional images`);
    
    // Method 6: Extract gallery API endpoints or photo URLs
    const galleryMatches = html.matchAll(/(https?:\/\/[^"'\s]*\/galleries\/[^"'\s]*\.(?:jpg|jpeg|png|webp))/gi);
    let count6 = 0;
    for (const match of galleryMatches) {
      if (images.add(match[1])) count6++;
    }
    console.log(`   Method 6 (gallery URLs): Found ${count6} additional images`);
    
    // Method 7: Look for image CDN patterns
    const cdnMatches = html.matchAll(/(https?:\/\/d2niwqq19lf86s\.cloudfront\.net[^"'\s<>]+\.(?:jpg|jpeg|png|webp))/gi);
    let count7 = 0;
    for (const match of cdnMatches) {
      // Clean up URL (remove query params that might be thumbnails, get full size)
      let imgUrl = match[1].split('?')[0];
      if (images.add(imgUrl)) count7++;
    }
    console.log(`   Method 7 (CDN patterns): Found ${count7} additional images`);
    
    // Filter out thumbnails and duplicates
    const finalImages = Array.from(images)
      .filter(url => {
        // Filter out obvious thumbnails
        if (url.includes('thumb') || url.includes('thumbnail') || url.includes('-150x') || url.includes('-300x')) {
          return false;
        }
        // Only include cloudfront or pcarmarket images
        return url.includes('cloudfront.net') || url.includes('pcarmarket.com');
      })
      .map(url => {
        // Remove thumbnail query params to get full size
        return url.split('?')[0].split('&')[0];
      })
      .filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates
    
    console.log(`\n   ✅ Total unique images found: ${finalImages.length}\n`);
    
    return finalImages;
    }
    
    // Return images from Playwright if we have them
    if (images.size > 0) {
      console.log(`\n   🔍 Filtering ${images.size} found images...`);
      
      const allUrls = Array.from(images);
      console.log(`   Sample URLs before filter: ${allUrls.slice(0, 5).join('\n      ')}`);
      
      // Extract base image filenames from thumbnail URLs and construct full-size URLs
      const baseImages = new Set();
      
      allUrls.forEach(url => {
        if (!url.includes('cloudfront.net')) return;
        if (url.includes('.svg') || url.includes('logo') || url.includes('icon')) return;
        
        // Pattern: /galleries/photos/uploads/galleries/54235-.../.thumbnails/filename.webp/filename-tiny-2048x0.webp
        // We want: /galleries/photos/uploads/galleries/54235-.../filename.webp
        const thumbnailMatch = url.match(/(\/galleries\/photos\/uploads\/galleries\/[^\/]+)\/.thumbnails\/([^\/]+\.(?:jpg|jpeg|png|webp))/);
        if (thumbnailMatch) {
          const basePath = thumbnailMatch[1];
          const filename = thumbnailMatch[2];
          const fullUrl = `https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads${basePath}/${filename}`;
          baseImages.add(fullUrl);
        } else {
          // Direct image URL (not thumbnail)
          const cleanUrl = url.split('?')[0].split('#')[0].split('&')[0];
          if (!cleanUrl.includes('thumbnails') && !cleanUrl.includes('-tiny-') && !cleanUrl.match(/-[\d]+x[\d]+/)) {
            baseImages.add(cleanUrl);
          }
        }
      });
      
      const finalImages = Array.from(baseImages)
        .filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates
      
      console.log(`   ✅ After filtering: ${finalImages.length} vehicle photos\n`);
      
      return finalImages;
    }
    
    return [];
    
  } catch (error) {
    console.error('   ❌ Error extracting images:', error.message);
    return [];
  }
}

/**
 * Import all images to vehicle
 */
async function importAllImages(vehicleId, imageUrls) {
  if (!imageUrls || imageUrls.length === 0) {
    console.log('   No images to import');
    return;
  }
  
  console.log(`\n📥 Importing ${imageUrls.length} images to vehicle ${vehicleId}...\n`);
  
  // Get user_id
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('user_id, uploaded_by')
    .eq('id', vehicleId)
    .single();
  
  const userId = vehicle?.user_id || vehicle?.uploaded_by || '0b9f107a-d124-49de-9ded-94698f63c1c4';
  
  // Delete existing PCarMarket images
  await supabase
    .from('vehicle_images')
    .delete()
    .eq('vehicle_id', vehicleId)
    .eq('source', 'pcarmarket_listing');
  
  // Import in batches
  const batchSize = 50;
  let imported = 0;
  
  for (let i = 0; i < imageUrls.length; i += batchSize) {
    const batch = imageUrls.slice(i, i + batchSize);
    const imageInserts = batch.map((url, idx) => ({
      vehicle_id: vehicleId,
      image_url: url,
      user_id: userId,
      category: 'general',
      image_category: 'exterior',
      source: 'pcarmarket_listing',
      is_primary: (i + idx) === 0,
      filename: `pcarmarket_${i + idx}.jpg`
    }));
    
    const { error } = await supabase
      .from('vehicle_images')
      .insert(imageInserts);
    
    if (error) {
      console.error(`   ❌ Batch ${Math.floor(i/batchSize) + 1} error:`, error.message);
    } else {
      imported += batch.length;
      console.log(`   ✅ Batch ${Math.floor(i/batchSize) + 1}: ${batch.length} images (${imported}/${imageUrls.length})`);
    }
  }
  
  console.log(`\n✅ Imported ${imported} images\n`);
}

// Main
async function main() {
  const url = process.argv[2];
  const vehicleId = process.argv[3];
  
  if (!url) {
    console.log('Usage: node scripts/scrape-pcarmarket-all-images.js <auction_url> [vehicle_id]');
    console.log('\nExample:');
    console.log('  node scripts/scrape-pcarmarket-all-images.js https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2 e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8');
    process.exit(1);
  }
  
  const images = await extractAllImages(url);
  
  if (images.length > 0) {
    console.log(`\n📊 Found ${images.length} images:\n`);
    images.slice(0, 10).forEach((img, i) => {
      console.log(`   ${i + 1}. ${img.substring(0, 80)}...`);
    });
    if (images.length > 10) {
      console.log(`   ... and ${images.length - 10} more`);
    }
    
    if (vehicleId) {
      await importAllImages(vehicleId, images);
    } else {
      console.log('\n💡 To import these images, provide a vehicle_id:');
      console.log(`   node scripts/scrape-pcarmarket-all-images.js ${url} <vehicle_id>`);
    }
  } else {
    console.log('\n❌ No images found');
  }
}

main();

