#!/usr/bin/env node

/**
 * Bring a Trailer Auction Page Checker
 * 
 * This script directly checks individual auction pages for 
 * mentions of Viva Las Vegas Autos.
 */

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuration
const BAT_BASE_URL = 'https://bringatrailer.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36';

// Output directory for saving results
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'bat-analysis');

// Keyword variations to search for
const VIVA_KEYWORDS = [
  'viva las vegas',
  'vivalasvegasautos',
  'viva las vegas auto',
  'viva las vegas autos',
  'viva vegas',
  'las vegas auto'
];

/**
 * Fetch and parse a specific auction page
 */
async function fetchAuctionPage(auctionUrl) {
  try {
    console.log(`Fetching auction: ${auctionUrl}`);
    
    const response = await fetch(auctionUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    return await response.text();
  } catch (error) {
    console.error(`Error fetching auction page ${auctionUrl}:`, error);
    throw error;
  }
}

/**
 * Parse auction HTML to extract details
 */
function parseAuctionPage(html, auctionUrl) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  // Extract auction title
  const titleElement = document.querySelector('.post-title');
  const title = titleElement ? titleElement.textContent.trim() : '';
  
  // Extract sold price
  const priceElement = document.querySelector('.post-price-display');
  const priceText = priceElement ? priceElement.textContent.trim() : '';
  let price = 0;
  if (priceText) {
    const priceMatch = priceText.match(/\$([0-9,]+)/);
    if (priceMatch) {
      price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    }
  }
  
  // Extract auction date
  const dateElement = document.querySelector('.post-date');
  const dateText = dateElement ? dateElement.textContent.trim() : '';
  
  // Extract seller information
  let sellerInfo = 'Unknown';
  const sellerElements = document.querySelectorAll('.post-meta p');
  sellerElements.forEach(element => {
    const text = element.textContent.trim();
    if (text.includes('Seller:')) {
      sellerInfo = text;
    }
  });
  
  // Check seller username
  let sellerUsername = '';
  const sellerMatch = sellerInfo.match(/Seller: ([a-zA-Z0-9_-]+)/);
  if (sellerMatch) {
    sellerUsername = sellerMatch[1];
  }
  
  // Extract auction description
  const descriptionElement = document.querySelector('.post-excerpt, .post-content');
  const description = descriptionElement ? descriptionElement.textContent.trim() : '';
  
  // Check if any Viva Las Vegas keywords are in the description or seller info
  const isVivaLasVegas = VIVA_KEYWORDS.some(keyword => 
    description.toLowerCase().includes(keyword.toLowerCase()) || 
    sellerInfo.toLowerCase().includes(keyword.toLowerCase()) ||
    sellerUsername.toLowerCase().includes('viva') ||
    sellerUsername.toLowerCase().includes('vegas')
  );
  
  return {
    title,
    price,
    priceText,
    date: dateText,
    sellerInfo,
    sellerUsername,
    url: auctionUrl,
    isVivaLasVegas,
    vivaKeywordsFound: VIVA_KEYWORDS.filter(keyword => 
      description.toLowerCase().includes(keyword.toLowerCase()) || 
      sellerInfo.toLowerCase().includes(keyword.toLowerCase())
    ),
    // Store only a short preview of the description to avoid huge objects
    descriptionPreview: description.substring(0, 300) + '...',
    descriptionLength: description.length
  };
}

/**
 * Generate some sample auction IDs to check
 * BaT auction IDs tend to be 6-7 digits
 */
function generateAuctionIds(count = 10) {
  // BaT auction IDs are roughly sequential
  // Recent auctions in 2025 would be around 100000-120000
  const baseId = 100000;
  const ids = [];
  
  for (let i = 0; i < count; i++) {
    // Generate some IDs with small gaps between them
    ids.push(baseId + i * 100);
  }
  
  return ids;
}

/**
 * Save results to file
 */
async function saveResultsToFile(results) {
  try {
    // Create output directory if it doesn't exist
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `bat_auction_check_${timestamp}.json`;
    const filePath = path.join(OUTPUT_DIR, filename);
    
    await fs.writeFile(filePath, JSON.stringify(results, null, 2));
    console.log(`Results saved to ${filePath}`);
    
    return filePath;
  } catch (error) {
    console.error('Error saving results to file:', error);
    throw error;
  }
}

/**
 * Main function to check auctions for Viva Las Vegas
 */
async function main() {
  try {
    // Get auction IDs to check - either from command line or generate them
    let auctionIds = [];
    const providedIds = process.argv.slice(2);
    
    if (providedIds.length > 0) {
      auctionIds = providedIds;
      console.log(`Using ${auctionIds.length} provided auction IDs`);
    } else {
      // Without specific IDs, we'll try some sample auction IDs
      // We'll use known auction prefixes and recent ID ranges
      
      // Try some recent auction IDs in different ranges
      const baseRanges = [75000, 90000, 100000, 110000, 120000];
      
      baseRanges.forEach(base => {
        for (let i = 0; i < 3; i++) {
          auctionIds.push(base + i * 500);
        }
      });
      
      // Also try some specific auction formats that BaT uses
      const formatIds = [
        "1967-toyota-2000gt",
        "1956-porsche-356a-speedster",
        "1973-porsche-911-carrera-rs-lightweight",
        "1-of-6-1953-fiat-8v-supersonic-by-ghia",
        "1968-lamborghini-miura-p400",
        "1961-ferrari-250-gt-cabriolet",
        "2005-ford-gt-6",
        "1957-mercedes-benz-300sl-roadster",
        "2018-bugatti-chiron",
        "1967-toyota-land-cruiser-fj45-long-bed-pickup"
      ];
      
      auctionIds = [...auctionIds, ...formatIds];
      console.log(`Generated ${auctionIds.length} auction IDs to check`);
    }
    
    // Process each auction ID
    const results = [];
    let vivaCount = 0;
    
    for (const id of auctionIds) {
      try {
        // Format the auction URL
        const auctionUrl = isNaN(id) 
          ? `${BAT_BASE_URL}/listing/${id}/` 
          : `${BAT_BASE_URL}/listing/${id}/`;
        
        // Fetch and parse the auction page
        const html = await fetchAuctionPage(auctionUrl);
        const auction = parseAuctionPage(html, auctionUrl);
        
        console.log(`Auction: ${auction.title}`);
        console.log(`  Seller: ${auction.sellerInfo}`);
        console.log(`  Price: ${auction.priceText}`);
        
        if (auction.isVivaLasVegas) {
          console.log(`  ✅ Viva Las Vegas keywords found: ${auction.vivaKeywordsFound.join(', ')}`);
          vivaCount++;
        } else {
          console.log(`  ❌ No Viva Las Vegas keywords found`);
        }
        
        results.push(auction);
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (error) {
        console.error(`Error processing auction ID ${id}:`, error.message);
      }
    }
    
    // Summarize results
    console.log(`\n===== SUMMARY =====`);
    console.log(`Checked ${results.length} auctions`);
    console.log(`Found ${vivaCount} auctions related to Viva Las Vegas Autos`);
    
    if (vivaCount > 0) {
      console.log(`\nViva Las Vegas Autos auctions found:`);
      results.filter(auction => auction.isVivaLasVegas).forEach((auction, index) => {
        console.log(`${index + 1}. ${auction.title}`);
        console.log(`   Seller: ${auction.sellerInfo}`);
        console.log(`   Price: ${auction.priceText}`);
        console.log(`   URL: ${auction.url}`);
      });
      
      // Save results to file
      await saveResultsToFile({
        totalChecked: results.length,
        vivaCount,
        vivaAuctions: results.filter(auction => auction.isVivaLasVegas),
        allAuctions: results,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the script
main().catch(console.error);
