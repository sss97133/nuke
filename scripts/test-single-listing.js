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
      
      // Test comment extraction
      data.comments = [];
      const usernameDivs = document.querySelectorAll('div.comment-user-name');
      
      usernameDivs.forEach((usernameDiv, index) => {
        const commentContainer = usernameDiv.closest('div[class*="comment"], article, li') || usernameDiv.parentElement;
        const usernameLink = usernameDiv.querySelector('a[href*="/member/"]');
        
        if (usernameLink) {
          const userUrl = usernameLink.getAttribute('href');
          const username = userUrl?.match(/\/member\/([^\/\?]+)/)?.[1] || usernameLink.textContent?.trim();
          
          const textEl = commentContainer.querySelector('div[class*="comment-text"], p');
          const commentText = textEl?.textContent?.trim() || '';
          
          const timeDiv = commentContainer.querySelector('div.comment-datetime');
          const timeText = timeDiv?.textContent?.trim() || '';
          
          if (commentText && username) {
            data.comments.push({
              username,
              text: commentText.substring(0, 100),
              timestamp: timeText
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

