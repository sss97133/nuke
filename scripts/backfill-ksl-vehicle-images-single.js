#!/usr/bin/env node
/**
 * Backfill images for a single KSL vehicle
 * Usage: node scripts/backfill-ksl-vehicle-images-single.js <vehicle_id>
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
let SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
let SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

// Check nuke_frontend/.env.local if key not found
const envLocalPath = path.join(__dirname, '../nuke_frontend/.env.local');
if (!SUPABASE_SERVICE_KEY && fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=') || line.startsWith('SERVICE_ROLE_KEY=')) {
      SUPABASE_SERVICE_KEY = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
    }
    if (line.startsWith('FIRECRAWL_API_KEY=') || line.startsWith('VITE_FIRECRAWL_API_KEY=')) {
      process.env.FIRECRAWL_API_KEY = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
    }
    if (line.startsWith('VITE_SUPABASE_URL=') && !SUPABASE_URL.includes('qkgaybvrernstplzjaam')) {
      SUPABASE_URL = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
    }
  }
}

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  console.error('   Set it with: export SUPABASE_SERVICE_ROLE_KEY=your_key');
  console.error('   Or add it to nuke_frontend/.env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function backfillVehicleImages(vehicleId) {
  console.log(`\n🔍 Backfilling images for vehicle: ${vehicleId}\n`);

  // Get vehicle info
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata')
    .eq('id', vehicleId)
    .single();

  if (vehicleError || !vehicle) {
    console.error(`❌ Vehicle not found: ${vehicleError?.message}`);
    return;
  }

  console.log(`📋 Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`🔗 URL: ${vehicle.discovery_url || 'N/A'}\n`);

  if (!vehicle.discovery_url) {
    console.error('❌ No discovery_url found for vehicle');
    return;
  }

  // Check if already has images
  const { count: existingCount } = await supabase
    .from('vehicle_images')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId);

  if (existingCount > 0) {
    console.log(`⏭️  Vehicle already has ${existingCount} image(s)`);
    console.log(`   Use --force to re-scrape anyway\n`);
    if (!process.argv.includes('--force')) {
      return;
    }
  }

  // Scrape listing to get images using Firecrawl
  console.log(`📥 Scraping images from ${vehicle.discovery_url} using Firecrawl...`);
  
  // Get Firecrawl API key from environment
  let firecrawlKey = process.env.FIRECRAWL_API_KEY || process.env.VITE_FIRECRAWL_API_KEY;
  
  if (!firecrawlKey && fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      if (line.startsWith('FIRECRAWL_API_KEY=') || line.startsWith('VITE_FIRECRAWL_API_KEY=')) {
        firecrawlKey = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
        break;
      }
    }
  }
  
  if (!firecrawlKey) {
    console.log(`⚠️  FIRECRAWL_API_KEY not found - trying scrape-vehicle Edge Function (which should use Firecrawl)`);
  }
  
  try {
    let images = [];
    
    // For KSL, use Playwright (bypasses PerimeterX reliably)
    if (vehicle.discovery_url.includes('ksl.com')) {
      console.log(`🥷 Using Playwright with stealth to bypass PerimeterX...`);
      try {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({
          headless: true,
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
          timezoneId: 'America/Denver',
          geolocation: { latitude: 40.7608, longitude: -111.8910 },
          permissions: ['geolocation'],
        });
        
        const page = await context.newPage();
        
        // Anti-detection
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          window.chrome = { runtime: {} };
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        });
        
        await page.goto(vehicle.discovery_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(8000); // PerimeterX wait
        
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
        
        // Extract images
        images = await page.evaluate(() => {
          const result = [];
          const seen = new Set();
          
          document.querySelectorAll('img').forEach(img => {
            const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
            if (src && 
                (src.includes('ksldigital.com') || src.includes('image.ksl.com')) &&
                !src.includes('logo') && 
                !src.includes('icon') &&
                !src.includes('svg') &&
                !src.includes('weather') &&
                !seen.has(src)) {
              seen.add(src);
              result.push(src);
            }
          });
          
          return result;
        });
        
        await browser.close();
        
        if (images.length > 0) {
          console.log(`✅ Playwright extracted ${images.length} images`);
        }
      } catch (playwrightErr) {
        console.log(`⚠️  Playwright failed: ${playwrightErr.message}`);
      }
    }
    
    // Fallback: Use Firecrawl directly if API key is available and Playwright didn't work
    if (images.length === 0 && firecrawlKey && vehicle.discovery_url.includes('ksl.com')) {
      console.log(`🔥 Using Firecrawl API directly...`);
      try {
        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: vehicle.discovery_url,
            formats: ['html', 'extract'],
            extract: {
              schema: {
                type: 'object',
                properties: {
                  images: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
            },
            onlyMainContent: false,
            waitFor: 5000, // Wait longer for JS to render
            pageOptions: {
              waitFor: 5000,
            },
          }),
        });

        if (firecrawlResponse.ok) {
          const firecrawlData = await firecrawlResponse.json();
          if (firecrawlData?.success) {
            const extract = firecrawlData.data?.extract;
            const html = firecrawlData.data?.html || '';
            
            // Get images from extract first
            if (extract?.images && Array.isArray(extract.images)) {
              images = extract.images.filter(img => img && typeof img === 'string');
            }
            
            // Also extract from HTML if extract didn't have images (CRITICAL for KSL)
            if (images.length === 0 && html) {
              console.log(`   Extracting images from Firecrawl HTML (${html.length} chars)...`);
              
              // Try multiple patterns for KSL images
              const imgRegex = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["'][^>]*>/gi;
              // Also check for background-image styles
              const bgImgRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/gi;
              // Check for Next.js Image component data
              const nextImgRegex = /_next\/image\?url=([^"'\s&]+)/gi;
              
              const foundImages = new Set();
              let match;
              
              // Pattern 1: Standard img tags
              while ((match = imgRegex.exec(html)) !== null) {
                const src = match[1];
                if (src && 
                    (src.includes('ksl.com') || src.includes('ksldigital.com') || src.includes('image.ksldigital.com')) &&
                    !src.includes('logo') && 
                    !src.includes('icon') &&
                    !src.includes('avatar') &&
                    !src.includes('flag') &&
                    !src.includes('svg')) {
                  let fullUrl = src;
                  if (src.startsWith('/')) {
                    fullUrl = `https://cars.ksl.com${src}`;
                  } else if (src.startsWith('//')) {
                    fullUrl = `https:${src}`;
                  }
                  // Extract actual image URL from Next.js proxy URLs
                  if (fullUrl.includes('_next/image?url=')) {
                    try {
                      const urlObj = new URL(fullUrl);
                      const urlParam = urlObj.searchParams.get('url');
                      if (urlParam) {
                        fullUrl = decodeURIComponent(urlParam);
                      }
                    } catch (e) {
                      // Keep original if parsing fails
                    }
                  }
                  foundImages.add(fullUrl);
                }
              }
              
              // Pattern 2: Background images
              while ((match = bgImgRegex.exec(html)) !== null) {
                const src = match[1];
                if (src && (src.includes('ksl.com') || src.includes('ksldigital.com')) && !src.includes('logo')) {
                  let fullUrl = src.startsWith('http') ? src : `https://cars.ksl.com${src}`;
                  if (fullUrl.includes('_next/image?url=')) {
                    try {
                      const urlObj = new URL(fullUrl);
                      const urlParam = urlObj.searchParams.get('url');
                      if (urlParam) {
                        fullUrl = decodeURIComponent(urlParam);
                      }
                    } catch (e) {}
                  }
                  foundImages.add(fullUrl);
                }
              }
              
              // Pattern 3: Next.js Image URLs in data attributes or JSON
              while ((match = nextImgRegex.exec(html)) !== null) {
                try {
                  const encodedUrl = match[1];
                  const decodedUrl = decodeURIComponent(encodedUrl);
                  if (decodedUrl.includes('ksldigital.com') || decodedUrl.includes('ksl.com')) {
                    foundImages.add(decodedUrl);
                  }
                } catch (e) {
                  // Skip invalid URLs
                }
              }
              
              images = Array.from(foundImages);
              if (images.length > 0) {
                console.log(`   Found ${images.length} unique image URL(s) from HTML`);
              } else {
                console.log(`   No KSL image URLs found in HTML (may be blocked)`);
              }
            }
            
            if (images.length > 0) {
              console.log(`✅ Firecrawl found ${images.length} image(s)`);
            }
          }
        }
      } catch (firecrawlErr) {
        console.log(`⚠️  Firecrawl direct call failed: ${firecrawlErr.message}`);
      }
    }
    
    // Fallback to scrape-vehicle Edge Function (which also uses Firecrawl for KSL)
    if (images.length === 0) {
      console.log(`🔄 Trying scrape-vehicle Edge Function (uses Firecrawl for KSL)...`);
      try {
        const result = await supabase.functions.invoke('scrape-vehicle', {
          body: { url: vehicle.discovery_url },
          timeout: 90000
        });

        if (result.error) {
          console.log(`   Error: ${result.error.message}`);
        } else if (result.data) {
          const listingData = result.data?.data || result.data;
          images = listingData?.images || [];
          
          // Also try to extract from HTML if available
          if (images.length === 0 && listingData?.html) {
            console.log(`   Extracting images from HTML response...`);
            const html = listingData.html;
            const imgRegex = /<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
            const foundImages = new Set();
            let match;
            
            while ((match = imgRegex.exec(html)) !== null) {
              const src = match[1];
              if (src && 
                  (src.includes('ksl.com') || src.includes('ksldigital.com') || src.includes('image.ksldigital.com')) &&
                  !src.includes('logo') && 
                  !src.includes('icon') &&
                  !src.includes('avatar') &&
                  !src.includes('flag')) {
                let fullUrl = src;
                if (src.startsWith('/')) {
                  fullUrl = `https://cars.ksl.com${src}`;
                } else if (src.startsWith('//')) {
                  fullUrl = `https:${src}`;
                }
                // Extract actual image URL from Next.js proxy URLs
                if (fullUrl.includes('_next/image?url=')) {
                  try {
                    const urlObj = new URL(fullUrl);
                    const urlParam = urlObj.searchParams.get('url');
                    if (urlParam) {
                      fullUrl = decodeURIComponent(urlParam);
                    }
                  } catch (e) {
                    // Keep original if parsing fails
                  }
                }
                foundImages.add(fullUrl);
              }
            }
            
            images = Array.from(foundImages);
          }
          
          // Also check HTML field for images if images array is empty
          if (images.length === 0 && listingData?.html) {
            console.log(`   Extracting images from HTML in response...`);
            const html = listingData.html;
            const imgRegex = /<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
            const foundImages = new Set();
            let match;
            
            while ((match = imgRegex.exec(html)) !== null) {
              const src = match[1];
              if (src && 
                  (src.includes('ksl.com') || src.includes('ksldigital.com') || src.includes('image.ksldigital.com')) &&
                  !src.includes('logo') && 
                  !src.includes('icon') &&
                  !src.includes('avatar') &&
                  !src.includes('flag')) {
                let fullUrl = src;
                if (src.startsWith('/')) {
                  fullUrl = `https://cars.ksl.com${src}`;
                } else if (src.startsWith('//')) {
                  fullUrl = `https:${src}`;
                }
                // Extract actual image URL from Next.js proxy URLs
                if (fullUrl.includes('_next/image?url=')) {
                  try {
                    const urlObj = new URL(fullUrl);
                    const urlParam = urlObj.searchParams.get('url');
                    if (urlParam) {
                      fullUrl = decodeURIComponent(urlParam);
                    }
                  } catch (e) {
                    // Keep original if parsing fails
                  }
                }
                foundImages.add(fullUrl);
              }
            }
            
            images = Array.from(foundImages);
            if (images.length > 0) {
              console.log(`✅ Extracted ${images.length} image(s) from HTML response`);
            }
          }
          
          if (images.length > 0) {
            console.log(`✅ scrape-vehicle found ${images.length} image(s)`);
          } else {
            console.log(`   No images found. Source: ${listingData?.source || 'unknown'}, Version: ${listingData?._function_version || 'unknown'}`);
          }
        }
      } catch (e) {
        console.log(`⚠️  scrape-vehicle failed: ${e.message}`);
      }
    }

    // If no images found, try thumbnail fallback
    if (images.length === 0) {
      console.log(`⚠️  No images found from scraping`);
      
      // Try to get thumbnail from import_queue as last resort
      const { data: queueData } = await supabase
        .from('import_queue')
        .select('raw_data, thumbnail_url')
        .eq('listing_url', vehicle.discovery_url)
        .maybeSingle();
      
      const thumbnailUrl = queueData?.raw_data?.thumbnail_url || queueData?.thumbnail_url;
      if (thumbnailUrl) {
        console.log(`📸 Found thumbnail URL in import queue`);
        let actualImageUrl = thumbnailUrl;
        try {
          if (thumbnailUrl.includes('_next/image?url=')) {
            const urlObj = new URL(thumbnailUrl);
            const urlParam = urlObj.searchParams.get('url');
            if (urlParam) {
              actualImageUrl = decodeURIComponent(urlParam);
            }
          }
        } catch (e) {
          // Keep original if parsing fails
        }
        images = [actualImageUrl];
      }
    }

    if (images.length === 0) {
      console.log(`\n❌ No images found after all attempts`);
      return;
    }

    console.log(`✅ Found ${images.length} image(s)`);

    // Filter valid KSL image URLs
    const validImages = images
      .filter(url => url && typeof url === 'string')
      .filter(url => url.includes('ksl.com') || url.includes('image.ksldigital.com'))
      .filter(url => !url.includes('logo') && !url.includes('icon'))
      .slice(0, 50); // Limit to 50 images

    if (validImages.length === 0) {
      console.log(`⚠️  No valid KSL image URLs found`);
      return;
    }

    console.log(`📸 Processing ${validImages.length} valid image(s)...\n`);

    // Call backfill-images Edge Function
    const listedDate = vehicle.origin_metadata?.listed_date || null;
    
    console.log(`📤 Calling backfill-images function...`);
    
    const { data: backfillData, error: backfillError } = await supabase.functions.invoke('backfill-images', {
      body: {
        vehicle_id: vehicleId,
        image_urls: validImages,
        source: 'ksl_import',
        run_analysis: false, // Skip AI analysis for speed
        listed_date: listedDate,
        max_images: validImages.length
      },
      timeout: 120000 // 2 minutes
    });

    if (backfillError) {
      console.error(`❌ Backfill failed: ${backfillError.message}`);
      return;
    }

    console.log(`\n✅ Backfill complete!`);
    console.log(`   Uploaded: ${backfillData?.uploaded || 0}`);
    console.log(`   Skipped: ${backfillData?.skipped || 0}`);
    console.log(`   Failed: ${backfillData?.failed || 0}`);
    
    if (backfillData?.errors && backfillData.errors.length > 0) {
      console.log(`\n⚠️  Errors:`);
      backfillData.errors.slice(0, 5).forEach(err => {
        console.log(`   - ${err}`);
      });
    }

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    console.error(error.stack);
  }
}

// Main
const vehicleId = process.argv[2];

if (!vehicleId) {
  console.error('Usage: node scripts/backfill-ksl-vehicle-images-single.js <vehicle_id> [--force]');
  process.exit(1);
}

backfillVehicleImages(vehicleId)
  .then(() => {
    console.log('\n✨ Done!\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

