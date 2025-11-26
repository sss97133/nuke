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

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    await page.goto(VIVA_BAT_PROFILE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Click "Show more" until all listings are loaded
    let showMoreClicked = 0;
    while (true) {
      try {
        const showMoreButton = await page.$('button:has-text("Show more"), button:has-text("Load more")');
        if (!showMoreButton) break;
        
        const isDisabled = await showMoreButton.isDisabled();
        if (isDisabled) break;
        
        await showMoreButton.click();
        await page.waitForTimeout(2000);
        showMoreClicked++;
        console.log(`   Loaded more listings (${showMoreClicked})...`);
      } catch (e) {
        break;
      }
    }

    // Extract all listing URLs and basic info
    const listings = await page.$$eval('a[href*="/listing/"]', (links) => {
      return links
        .map(link => {
          const href = link.getAttribute('href');
          if (!href || !href.includes('/listing/')) return null;
          
          const fullUrl = href.startsWith('http') ? href : `https://bringatrailer.com${href}`;
          const text = link.textContent?.trim() || '';
          
          return {
            url: fullUrl,
            title: text,
            element: link
          };
        })
        .filter(Boolean)
        .filter((item, index, self) => 
          index === self.findIndex(t => t.url === item.url)
        );
    });

    console.log(`\n📋 Found ${listings.length} unique listings\n`);

    // Now scrape each listing for detailed data
    const scrapedData = [];
    
    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      console.log(`[${i + 1}/${listings.length}] Scraping: ${listing.title}`);
      
      try {
        await page.goto(listing.url, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        const listingData = await page.evaluate(() => {
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
            /Final\s+Bid[:\s]*\$?([\d,]+)/i
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
            /([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+for\s+\$[\d,]+/i
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
            data.year = yearMatch[0];
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

        scrapedData.push({
          ...listingData,
          url: listing.url,
          scraped_at: new Date().toISOString()
        });

        console.log(`   ✅ Price: $${listingData.sale_price?.toLocaleString() || 'N/A'}, Date: ${listingData.sale_date || 'N/A'}`);
        
      } catch (error) {
        console.error(`   ❌ Error scraping ${listing.url}:`, error.message);
      }
    }

    console.log(`\n📊 Scraped ${scrapedData.length} listings\n`);
    console.log('Summary:');
    console.log(`   - With sale price: ${scrapedData.filter(d => d.sale_price).length}`);
    console.log(`   - With sale date: ${scrapedData.filter(d => d.sale_date).length}`);
    console.log(`   - With seller: ${scrapedData.filter(d => d.seller).length}`);
    console.log(`   - With buyer: ${scrapedData.filter(d => d.buyer).length}`);

    // Save to database or file
    const fs = await import('fs');
    fs.writeFileSync(
      'viva-bat-listings.json',
      JSON.stringify(scrapedData, null, 2)
    );
    
    console.log('\n💾 Saved to viva-bat-listings.json');
    console.log(`\n✅ Complete! Found ${scrapedData.length} listings from Viva's BaT profile`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

scrapeVivaListings().catch(console.error);

