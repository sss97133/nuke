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
    
    // Dismiss cookie consent banner if present
    try {
      const acceptButton = await page.$('#onetrust-accept-btn-handler, button[id*="accept"], button:has-text("Accept"), button:has-text("I Accept")');
      if (acceptButton) {
        await acceptButton.click();
        await page.waitForTimeout(1000);
        console.log('   Dismissed cookie consent');
      }
    } catch (e) {
      // No cookie banner or already dismissed
    }

    // Load all listings by clicking "Show more" button (like archive script)
    let showMoreClicked = 0;
    while (true) {
      try {
        const btn = await page.$('button:has-text("Show more")');
        if (!btn) {
          console.log(`   No "Show more" button found`);
          break;
        }
        
        const disabled = await btn.evaluate(b => b.disabled);
        if (disabled) {
          console.log(`   "Show more" button is disabled`);
          break;
        }
        
        await btn.click();
        await page.waitForTimeout(2000);
        showMoreClicked++;
        console.log(`   Clicked "Show more" (${showMoreClicked})...`);
      } catch (e) {
        console.log(`   Error: ${e.message}`);
        break;
      }
    }
    
    console.log(`\n   Loaded all listings (${showMoreClicked} clicks)\n`);

    // Extract all listing URLs - use card-based extraction like archive script
    const listings = await page.$$eval('.past-listing-card, div[class*="listing"], a[href*="/listing/"]', (elements) => {
      const seen = new Set();
      const results = [];
      
      for (const el of elements) {
        // If it's a card, find the link inside
        let link = el.tagName === 'A' ? el : el.querySelector('a[href*="/listing/"]');
        if (!link) continue;
        
        const href = link.getAttribute('href');
        if (!href || !href.includes('/listing/') || href.includes('#comment')) continue;
        
        const cleanHref = href.split('#')[0];
        const fullUrl = cleanHref.startsWith('http') ? cleanHref : `https://bringatrailer.com${cleanHref}`;
        
        if (seen.has(fullUrl)) continue;
        seen.add(fullUrl);
        
        // Try to get title from heading or link text
        const heading = el.querySelector('h2, h3, h4, [class*="title"]');
        const title = heading?.textContent?.trim() || link.textContent?.trim() || '';
        
        results.push({
          url: fullUrl,
          title: title
        });
      }
      
      return results;
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
          await listingPage.waitForTimeout(2000);
          
          // Scroll to load comments (they may be lazy-loaded)
          await listingPage.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await listingPage.waitForTimeout(2000);
          
          // Scroll back up
          await listingPage.evaluate(() => {
            window.scrollTo(0, 0);
          });
          await listingPage.waitForTimeout(1000);

          const listingData = await listingPage.evaluate(() => {
            const data = {};
            
            // Title
            const titleEl = document.querySelector('h1');
            data.title = titleEl?.textContent?.trim() || '';
            
            // Get all text content
            const bodyText = document.body?.textContent || '';
            
            // Extract auction start date and end date
            // BaT shows sale date as "on MM/DD/YY" in a span.date element
            const dateSpan = document.querySelector('span.date');
            if (dateSpan) {
              const dateText = dateSpan.textContent?.trim() || '';
              // Match "on 10/28/25" or "on October 28, 2025"
              const dateMatch = dateText.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i) || 
                               dateText.match(/on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
              if (dateMatch) {
                try {
                  const date = new Date(dateMatch[1]);
                  if (!isNaN(date.getTime())) {
                    data.auction_end_date = date.toISOString().split('T')[0];
                    data.sale_date = data.auction_end_date;
                  }
                } catch {}
              }
            }
            
            // Also look for date patterns in body text
            const endDatePatterns = [
              /Sold\s+for[^0-9]*on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
              /Sold\s+for[^0-9]*on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
              /Auction\s+ended\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
            ];
            
            for (const pattern of endDatePatterns) {
              const match = bodyText.match(pattern);
              if (match && !data.auction_end_date) {
                try {
                  const date = new Date(match[1]);
                  if (!isNaN(date.getTime())) {
                    data.auction_end_date = date.toISOString().split('T')[0];
                    data.sale_date = data.auction_end_date;
                  }
                } catch {}
                break;
              }
            }
            
            // Try to find start date (listing date) - usually earlier than end date
            // Look for "Listed" or "Posted" patterns
            const startDatePatterns = [
              /Listed\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
              /Listed\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
              /Posted\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
              /Posted\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
            ];
            
            for (const pattern of startDatePatterns) {
              const match = bodyText.match(pattern);
              if (match) {
                try {
                  const date = new Date(match[1]);
                  if (!isNaN(date.getTime())) {
                    data.auction_start_date = date.toISOString().split('T')[0];
                  }
                } catch {}
                break;
              }
            }
            
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
            
            // Auction end date / Sale date - improved patterns
            const endDatePatterns = [
              /Auction\s+ended\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
              /sold\s+for[^0-9]*on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
              /([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*\(Lot/i,
              /Sold\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
              /Auction\s+Date[:\s]*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
              /Ended\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
              /Closed\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
            ];
            
            for (const pattern of endDatePatterns) {
              const match = bodyText.match(pattern);
              if (match) {
                try {
                  const date = new Date(match[1]);
                  if (!isNaN(date.getTime())) {
                    data.auction_end_date = date.toISOString().split('T')[0];
                    data.sale_date = data.auction_end_date; // Also set sale_date for compatibility
                  }
                } catch {}
                break;
              }
            }
            
            // Try to find end date in meta tags or structured data
            const metaEndDate = document.querySelector('meta[property*="end"], meta[name*="end"], [data-end-date]');
            if (metaEndDate) {
              const endValue = metaEndDate.getAttribute('content') || metaEndDate.getAttribute('data-end-date');
              if (endValue) {
                try {
                  const date = new Date(endValue);
                  if (!isNaN(date.getTime())) {
                    data.auction_end_date = date.toISOString().split('T')[0];
                    data.sale_date = data.auction_end_date;
                  }
                } catch {}
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
            
            // Extract all comments with usernames and timestamps
            // BaT comment structure: comments are in divs with comment-user-name and comment-datetime
            data.comments = [];
            
            // Find all comment containers - BaT uses div.comment-user-name to identify comments
            const usernameDivs = document.querySelectorAll('div.comment-user-name');
            
            usernameDivs.forEach((usernameDiv, index) => {
              try {
                // Get the comment container (parent of username div)
                const commentContainer = usernameDiv.closest('div[class*="comment"], article, li') || usernameDiv.parentElement;
                
                // Extract username from member link
                const usernameLink = usernameDiv.querySelector('a[href*="/member/"]');
                let username = null;
                let userUrl = null;
                
                if (usernameLink) {
                  userUrl = usernameLink.getAttribute('href');
                  const linkText = usernameLink.textContent?.trim();
                  // Extract username from URL or text (remove @ and "The Seller" etc)
                  username = userUrl?.match(/\/member\/([^\/\?]+)/)?.[1] ||
                           linkText?.replace(/@/g, '').replace(/\s*\(The\s+Seller\)/i, '').trim() ||
                           null;
                }
                
                // Extract comment text - look for comment body/content
                let commentText = '';
                
                // BaT comment text is usually in a p tag or specific div
                // Try to find elements that contain actual comment text (not author info)
                const allElements = commentContainer.querySelectorAll('p, div');
                for (const el of allElements) {
                  const text = el.textContent?.trim() || '';
                  // Skip if it's author likes, timestamp, or username
                  if (text.includes("This author's likes") || 
                      text.match(/[A-Za-z]{3}\s+\d{1,2}\s+at\s+\d{1,2}:\d{2}\s+[AP]M/) ||
                      text === username ||
                      text.length < 15 ||
                      text.match(/^\d+$/)) {
                    continue;
                  }
                  // Found substantial text that looks like a comment
                  if (text.length > 20) {
                    commentText = text;
                    break;
                  }
                }
                
                // Fallback: clean all text from container
                if (!commentText || commentText.length < 10) {
                  const allText = commentContainer.textContent || '';
                  let cleanText = allText;
                  // Remove username
                  if (username) {
                    cleanText = cleanText.replace(new RegExp(username, 'gi'), '').trim();
                    cleanText = cleanText.replace(/@/g, '').trim();
                  }
                  // Remove author likes pattern
                  cleanText = cleanText.replace(/This author's likes:[\d,]+/gi, '').trim();
                  // Remove timestamp patterns
                  cleanText = cleanText.replace(/[A-Za-z]{3}\s+\d{1,2}\s+at\s+\d{1,2}:\d{2}\s+[AP]M/gi, '').trim();
                  cleanText = cleanText.replace(/\(The\s+Seller\)/gi, '').trim();
                  cleanText = cleanText.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '').trim();
                  // Remove multiple newlines
                  cleanText = cleanText.replace(/\n\s*\n+/g, '\n').trim();
                  if (cleanText.length > 10) {
                    commentText = cleanText;
                  }
                }
                
                // Extract timestamp from comment-datetime div
                let timestamp = null;
                const timeDiv = commentContainer.querySelector('div.comment-datetime');
                if (timeDiv) {
                  const timeText = timeDiv.textContent?.trim();
                  // Parse "Oct 28 at 10:45 PM" format
                  const timeMatch = timeText.match(/([A-Za-z]{3})\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s+(AM|PM)/i);
                  if (timeMatch) {
                    try {
                      const month = timeMatch[1];
                      const day = parseInt(timeMatch[2]);
                      const hour = parseInt(timeMatch[3]);
                      const minute = parseInt(timeMatch[4]);
                      const ampm = timeMatch[5].toUpperCase();
                      
                      // Get current year (or infer from context)
                      const currentYear = new Date().getFullYear();
                      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      const monthIndex = monthNames.findIndex(m => m.toLowerCase() === month.toLowerCase());
                      
                      if (monthIndex !== -1) {
                        let hour24 = hour;
                        if (ampm === 'PM' && hour !== 12) hour24 += 12;
                        if (ampm === 'AM' && hour === 12) hour24 = 0;
                        
                        const date = new Date(currentYear, monthIndex, day, hour24, minute);
                        // If date is in future, assume previous year
                        if (date > new Date()) {
                          date.setFullYear(currentYear - 1);
                        }
                        timestamp = date.toISOString();
                      }
                    } catch {}
                  }
                }
                
                // Extract comment ID
                const commentId = commentContainer.id || 
                                commentContainer.getAttribute('data-comment-id') ||
                                `comment-${index}`;
                
                // Only add if we have meaningful content
                if (commentText && commentText.length > 5 && username) {
                  data.comments.push({
                    id: commentId,
                    username: username,
                    user_url: userUrl,
                    text: commentText,
                    timestamp: timestamp,
                    index: index
                  });
                }
              } catch (e) {
                // Skip this comment if extraction fails
              }
            });
            
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
    console.log(`   - With auction start date: ${scrapedData.filter(d => d.auction_start_date).length}`);
    console.log(`   - With auction end date: ${scrapedData.filter(d => d.auction_end_date).length}`);
    console.log(`   - With seller: ${scrapedData.filter(d => d.seller).length}`);
    console.log(`   - With buyer: ${scrapedData.filter(d => d.buyer).length}`);
    
    const totalComments = scrapedData.reduce((sum, d) => sum + (d.comments?.length || 0), 0);
    const uniqueUsernames = new Set();
    scrapedData.forEach(d => {
      if (d.comments) {
        d.comments.forEach(c => {
          if (c.username) uniqueUsernames.add(c.username);
        });
      }
    });
    
    console.log(`   - Total comments: ${totalComments}`);
    console.log(`   - Unique BaT usernames: ${uniqueUsernames.size}`);

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

