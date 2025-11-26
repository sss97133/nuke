#!/usr/bin/env node
/**
 * Test single listing extraction
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://bringatrailer.com/listing/1987-gmc-suburban-13/';

async function testExtraction() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Dismiss cookie consent
    try {
      const acceptButton = await page.$('#onetrust-accept-btn-handler');
      if (acceptButton) await acceptButton.click();
      await page.waitForTimeout(1000);
    } catch {}
    
    const result = await page.evaluate(() => {
      const data = {};
      
      // Test date extraction
      const dateSpan = document.querySelector('span.date');
      if (dateSpan) {
        const dateText = dateSpan.textContent?.trim() || '';
        const dateMatch = dateText.match(/on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
        if (dateMatch) {
          try {
            const date = new Date(dateMatch[1]);
            if (!isNaN(date.getTime())) {
              data.auction_end_date = date.toISOString().split('T')[0];
            }
          } catch {}
        }
      }
      
      // Test comment extraction - check what's actually on the page
      data.commentInfo = {
        usernameDivs: document.querySelectorAll('div.comment-user-name').length,
        commentContainers: document.querySelectorAll('[class*="comment"]').length,
        memberLinks: document.querySelectorAll('a[href*="/member/"]').length,
        commentDatetime: document.querySelectorAll('div.comment-datetime').length
      };
      
      data.comments = [];
      const usernameDivs = document.querySelectorAll('div.comment-user-name');
      
      console.log(`Found ${usernameDivs.length} comment username divs`);
      
      usernameDivs.forEach((usernameDiv, index) => {
        // Try multiple ways to find the comment container
        let commentContainer = usernameDiv.closest('div[class*="comment"]');
        if (!commentContainer) commentContainer = usernameDiv.parentElement;
        if (!commentContainer) commentContainer = usernameDiv.closest('article, li, div');
        
        const usernameLink = usernameDiv.querySelector('a[href*="/member/"]');
        
        if (usernameLink) {
          const userUrl = usernameLink.getAttribute('href');
          const username = userUrl?.match(/\/member\/([^\/\?]+)/)?.[1] || 
                         usernameLink.textContent?.trim().replace(/@/g, '').replace(/\s*\(The\s+Seller\)/i, '');
          
          // Try multiple selectors for comment text
          let commentText = '';
          const textSelectors = [
            'div[class*="comment-text"]',
            'div[class*="comment-content"]',
            'div[class*="comment-body"]',
            'p',
            'div:not(.comment-user-name):not(.comment-datetime)'
          ];
          
          for (const selector of textSelectors) {
            const textEl = commentContainer.querySelector(selector);
            if (textEl && textEl !== usernameDiv) {
              const text = textEl.textContent?.trim();
              if (text && text.length > 10 && !text.includes('@') && !text.match(/[A-Za-z]{3}\s+\d{1,2}\s+at/)) {
                commentText = text;
                break;
              }
            }
          }
          
          // Fallback: get all text from container
          if (!commentText || commentText.length < 10) {
            const allText = commentContainer.textContent || '';
            // Remove username and timestamp
            let cleanText = allText.replace(new RegExp(username || '', 'gi'), '');
            cleanText = cleanText.replace(/@/g, '');
            cleanText = cleanText.replace(/[A-Za-z]{3}\s+\d{1,2}\s+at\s+\d{1,2}:\d{2}\s+[AP]M/gi, '');
            cleanText = cleanText.trim();
            if (cleanText.length > 10) {
              commentText = cleanText;
            }
          }
          
          const timeDiv = commentContainer.querySelector('div.comment-datetime');
          const timeText = timeDiv?.textContent?.trim() || '';
          
          if (username) {
            data.comments.push({
              username,
              text: commentText.substring(0, 150),
              timestamp: timeText,
              hasText: commentText.length > 10
            });
          }
        }
      });
      
      return data;
    });
    
    console.log(JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

testExtraction().catch(console.error);

