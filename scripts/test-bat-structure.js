#!/usr/bin/env node
/**
 * Test script to inspect BaT listing structure for dates and comments
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://bringatrailer.com/listing/1987-gmc-suburban-13/';

async function inspectBatListing() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Dismiss cookie consent
    try {
      const acceptButton = await page.$('#onetrust-accept-btn-handler, button[id*="accept"]');
      if (acceptButton) await acceptButton.click();
      await page.waitForTimeout(1000);
    } catch {}
    
    console.log('=== INSPECTING BaT LISTING STRUCTURE ===\n');
    
    // Check for dates
    const dateInfo = await page.evaluate(() => {
      const info = {};
      
      // Look for date-related elements
      info.dateElements = Array.from(document.querySelectorAll('time, [datetime], [class*="date"]')).map(el => ({
        tag: el.tagName,
        class: el.className,
        datetime: el.getAttribute('datetime'),
        text: el.textContent?.trim().substring(0, 100)
      }));
      
      // Look for auction info sections
      info.auctionInfo = Array.from(document.querySelectorAll('[class*="auction"], [class*="listing-info"], [class*="metadata"]')).map(el => ({
        class: el.className,
        text: el.textContent?.trim().substring(0, 200)
      }));
      
      // Get all text that might contain dates
      const bodyText = document.body.textContent || '';
      info.datePatterns = {
        'sold for on': bodyText.match(/sold\s+for[^0-9]*on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i),
        'auction ended': bodyText.match(/Auction\s+ended\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i),
        'listed on': bodyText.match(/Listed\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i),
        'started': bodyText.match(/Started\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)
      };
      
      return info;
    });
    
    console.log('DATE ELEMENTS:', JSON.stringify(dateInfo.dateElements, null, 2));
    console.log('\nAUCTION INFO SECTIONS:', JSON.stringify(dateInfo.auctionInfo, null, 2));
    console.log('\nDATE PATTERNS:', JSON.stringify(dateInfo.datePatterns, null, 2));
    
    // Check for comments
    const commentInfo = await page.evaluate(() => {
      const info = {};
      
      // Find all comment-like elements
      info.commentContainers = Array.from(document.querySelectorAll('[class*="comment"], [id*="comment"]')).map(el => ({
        tag: el.tagName,
        id: el.id,
        class: el.className,
        text: el.textContent?.trim().substring(0, 200)
      }));
      
      // Find all member links (commenters)
      info.memberLinks = Array.from(document.querySelectorAll('a[href*="/member/"]')).map(link => ({
        href: link.getAttribute('href'),
        text: link.textContent?.trim(),
        parent: link.parentElement?.tagName,
        parentClass: link.parentElement?.className
      }));
      
      // Look for comment structure
      info.commentStructure = Array.from(document.querySelectorAll('article, [class*="comment-item"], li[class*="comment"]')).map(el => ({
        tag: el.tagName,
        class: el.className,
        hasMemberLink: !!el.querySelector('a[href*="/member/"]'),
        text: el.textContent?.trim().substring(0, 150)
      }));
      
      return info;
    });
    
    console.log('\n=== COMMENT STRUCTURE ===');
    console.log('COMMENT CONTAINERS:', JSON.stringify(commentInfo.commentContainers.slice(0, 5), null, 2));
    console.log('\nMEMBER LINKS (first 10):', JSON.stringify(commentInfo.memberLinks.slice(0, 10), null, 2));
    console.log('\nCOMMENT STRUCTURE (first 5):', JSON.stringify(commentInfo.commentStructure.slice(0, 5), null, 2));
    
    // Take a screenshot for reference
    await page.screenshot({ path: 'bat-listing-structure.png', fullPage: true });
    console.log('\n📸 Screenshot saved to bat-listing-structure.png');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

inspectBatListing().catch(console.error);

