#!/usr/bin/env node
/**
 * Scrape all BaT listings from Viva Las Vegas Autos profile
 * Improves scraper and extracts all 50+ listings
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const VIVA_BAT_PROFILE = 'https://bringatrailer.com/member/vivalasvegasautos/';

async function scrapeVivaListings() {
  console.log('🚀 Scraping Viva Las Vegas Autos BaT listings...\n');
  console.log(`Profile: ${VIVA_BAT_PROFILE}\n`);

  const browser = await chromium.launch({ 
    headless: false,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  try {
    console.log('   Navigating to profile page...');
    await page.goto(VIVA_BAT_PROFILE, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    await page.waitForTimeout(3000);

    // Load all listings by scrolling and clicking "Show more"
    let previousCount = 0;
    let currentCount = 0;
    let showMoreClicked = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 100;
    
    while (scrollAttempts < maxScrollAttempts) {
      // Count current listings
      currentCount = await page.$$eval('a[href*="/listing/"]', links => {
        return links.filter(link => {
          const href = link.getAttribute('href');
          return href && href.includes('/listing/') && !href.includes('#comment');
        }).length;
      });
      
      if (currentCount === previousCount && showMoreClicked > 0) {
        // No new listings loaded, we're done
        break;
      }
      
      previousCount = currentCount;
      
      // Try to find and click "Show more" button
      try {
        const showMoreButton = await page.$(
          'button:has-text("Show more"), ' +
          'button:has-text("Load more"), ' +
          'button[class*="show"], ' +
          'button[class*="load"]'
        );
        
        if (showMoreButton) {
          const isVisible = await showMoreButton.isVisible().catch(() => false);
          const isDisabled = await showMoreButton.evaluate(btn => btn.disabled).catch(() => true);
          
          if (isVisible && !isDisabled) {
            await showMoreButton.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            await showMoreButton.click();
            await page.waitForTimeout(2000);
            showMoreClicked++;
            console.log(`   Clicked "Show more" (${showMoreClicked}), found ${currentCount} listings...`);
            continue;
          }
        }
      } catch (e) {
        // Button not found or not clickable, try scrolling
      }
      
      // Scroll to bottom to trigger lazy loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
      scrollAttempts++;
      
      if (scrollAttempts % 10 === 0) {
        console.log(`   Scrolled ${scrollAttempts} times, found ${currentCount} listings...`);
      }
    }
    
    console.log(`\n   Final count: ${currentCount} listings found\n`);

    // Extract all listing URLs and basic info - filter out comment URLs
    const listings = await page.$$eval('a[href*="/listing/"]', (links) => {
      return links
        .map(link => {
          const href = link.getAttribute('href');
          if (!href || !href.includes('/listing/')) return null;
          
          // Filter out comment URLs and hash fragments
          if (href.includes('#comment-') || href.includes('#comment')) return null;
          
          // Get clean URL without hash
          const cleanHref = href.split('#')[0];
          const fullUrl = cleanHref.startsWith('http') ? cleanHref : `https://bringatrailer.com${cleanHref}`;
          const text = link.textContent?.trim() || '';
          
          return {
            url: fullUrl,
            title: text
          };
        })
        .filter(Boolean)
        .filter((item, index, self) => 
          index === self.findIndex(t => t.url === item.url)
        );
    });

    console.log(`\n📋 Found ${listings.length} unique listings\n`);

    // Now scrape each listing for detailed data using direct page scraping
    const scrapedData = [];
    
    console.log('\n📥 Scraping detailed data from each listing...\n');
    
    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      const displayTitle = listing.title || listing.url.split('/listing/')[1]?.split('/')[0] || 'Unknown';
      console.log(`[${i + 1}/${listings.length}] Scraping: ${displayTitle}`);
      
      try {
        const listingPage = await browser.newPage();
        
        try {
          await listingPage.goto(listing.url, { 
            waitUntil: 'domcontentloaded',
            timeout: 20000 
          });
          await listingPage.waitForTimeout(1000);

          const listingData = await listingPage.evaluate(() => {
            const data = {};
            
            // Title
            const titleEl = document.querySelector('h1');
            data.title = titleEl?.textContent?.trim() || '';
            
            // Get all text content
            const bodyText = document.body?.textContent || '';
            
            // Sale price - improved patterns
            const pricePatterns = [
              /Sold\s+for\s+(?:USD\s+)?\$?([\d,]+)/i,
              /sold\s+for\s+\$?([\d,]+)\s+on/i,
              /for\s+\$?([\d,]+)\s+on\s+[A-Za-z]+\s+\d+/i,
              /Sold\s+for\s+\$([\d,]+)/i,
              /Final\s+Bid[:\s]*\$?([\d,]+)/i,
              /Winning\s+Bid[:\s]*\$?([\d,]+)/i
            ];
            
            for (const pattern of pricePatterns) {
              const match = bodyText.match(pattern);
              if (match) {
                data.sale_price = parseInt(match[1].replace(/,/g, ''), 10);
                break;
              }
            }
            
            // Sale date - improved patterns
            const datePatterns = [
              /sold\s+for[^0-9]*on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
              /([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*\(Lot/i,
              /Sold\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
              /Auction\s+ended\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
              /Auction\s+Date[:\s]*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
            ];
            
            for (const pattern of datePatterns) {
              const match = bodyText.match(pattern);
              if (match) {
                try {
                  const date = new Date(match[1]);
                  if (!isNaN(date.getTime())) {
                    data.sale_date = date.toISOString().split('T')[0];
                  }
                } catch {}
                break;
              }
            }
            
            // Lot number
            const lotMatch = bodyText.match(/Lot\s+#?(\d{1,3}(?:,\d{3})*)/i);
            if (lotMatch) {
              data.lot_number = lotMatch[1].replace(/,/g, '');
            }
            
            // Seller
            const sellerPatterns = [
              /Sold\s+by\s+([A-Za-z0-9\s&]+?)(?:\s+on|\s+for|$)/i,
              /by\s+([A-Za-z0-9\s&]+?)\s+on\s+Bring\s+a\s+Trailer/i,
              /Consignor[:\s]+([A-Za-z0-9\s&]+)/i,
              /Seller[:\s]+([A-Za-z0-9\s&]+)/i
            ];
            
            for (const pattern of sellerPatterns) {
              const match = bodyText.match(pattern);
              if (match && match[1]) {
                data.seller = match[1].trim();
                break;
              }
            }
            
            // Buyer
            const buyerPatterns = [
              /Sold\s+to\s+([A-Za-z0-9\s&]+?)\s+for/i,
              /won\s+by\s+([A-Za-z0-9\s&]+?)(?:\s+for|$)/i,
              /Buyer[:\s]+([A-Za-z0-9\s&]+)/i,
              /Purchased\s+by\s+([A-Za-z0-9\s&]+)/i
            ];
            
            for (const pattern of buyerPatterns) {
              const match = bodyText.match(pattern);
              if (match && match[1]) {
                data.buyer = match[1].trim();
                break;
              }
            }
            
            // Year/Make/Model from title
            const yearMatch = data.title.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
              data.year = parseInt(yearMatch[0]);
            }
            
            const cleanTitle = data.title.replace(/^(No Reserve:|Modified|Restored):\s*/i, '');
            const parts = cleanTitle.split(/\s+/);
            let startIndex = 0;
            if (parts[0]?.match(/\b(19|20)\d{2}\b/)) {
              startIndex = 1;
            }
            if (parts.length > startIndex) {
              data.make = parts[startIndex];
              data.model = parts.slice(startIndex + 1).join(' ');
            }
            
            return data;
          });

          // Merge with listing card data
          const mergedData = {
            ...listingData,
            url: listing.url,
            title: listingData.title || listing.title,
            scraped_at: new Date().toISOString()
          };

          scrapedData.push(mergedData);

          const price = mergedData.sale_price;
          const date = mergedData.sale_date;
          console.log(`   ✅ Price: $${price?.toLocaleString() || 'N/A'}, Date: ${date || 'N/A'}`);
          
        } finally {
          await listingPage.close();
        }
        
      } catch (error) {
        console.error(`   ❌ Error scraping ${listing.url}:`, error.message);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log(`\n📊 Scraped ${scrapedData.length} listings\n`);
    console.log('Summary:');
    console.log(`   - With sale price: ${scrapedData.filter(d => d.sale_price).length}`);
    console.log(`   - With sale date: ${scrapedData.filter(d => d.sale_date).length}`);
    console.log(`   - With seller: ${scrapedData.filter(d => d.seller).length}`);
    console.log(`   - With buyer: ${scrapedData.filter(d => d.buyer).length}`);

    // Save to database or file
    const fs = await import('fs');
    const path = await import('path');
    const outputFile = path.join(process.cwd(), 'viva-bat-listings.json');
    
    fs.writeFileSync(
      outputFile,
      JSON.stringify(scrapedData, null, 2)
    );
    
    console.log('\n💾 Saved to viva-bat-listings.json');
    console.log(`\n✅ Complete! Found ${scrapedData.length} listings from Viva's BaT profile`);
    
    if (scrapedData.length > 0) {
      console.log(`\n📊 Sample of first listing:`);
      console.log(JSON.stringify(scrapedData[0], null, 2));
    }

  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    try {
      await browser.close();
    } catch (e) {
      // Browser already closed
    }
  }
}

scrapeVivaListings().catch(console.error);

