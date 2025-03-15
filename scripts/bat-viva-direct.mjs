#!/usr/bin/env node

/**
 * Direct BaT Auction Scraper for Viva Las Vegas Autos
 * 
 * This script attempts to find auctions specifically related to Viva Las Vegas Autos
 * by searching for completed auctions with specific keywords.
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

/**
 * Create a search URL for finding completed auctions with a specific keyword
 */
function createSearchUrl(keyword, page = 1) {
  // Use status:sold to find only completed auctions
  return `${BAT_BASE_URL}/search?q=${encodeURIComponent(keyword)}+status%3Asold&page=${page}`;
}

/**
 * Fetch and parse search results
 */
async function fetchSearchResults(keyword, page = 1) {
  try {
    const searchUrl = createSearchUrl(keyword, page);
    console.log(`Fetching search results: ${searchUrl}`);
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Get total result count
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    let totalResults = 0;
    const resultsCountElement = document.querySelector('.search-results-count');
    if (resultsCountElement) {
      const countText = resultsCountElement.textContent.trim();
      const match = countText.match(/(\d+)/);
      if (match) {
        totalResults = parseInt(match[1], 10);
      }
    }
    
    return { html, url: searchUrl, totalResults };
  } catch (error) {
    console.error(`Error fetching search results for ${keyword} (page ${page}):`, error);
    throw error;
  }
}

/**
 * Extract auctions from search results HTML
 */
function extractAuctions(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  // BaT uses different CSS classes for search results, try different selectors
  const listingElements = document.querySelectorAll('.list-item, .auctions-item, .auction-list-item');
  console.log(`Found ${listingElements.length} listing elements on page`);
  
  const auctions = [];
  
  listingElements.forEach((element, index) => {
    try {
      // Extract title and URL
      const titleElement = element.querySelector('.list-item-title a, .auctions-item-title a, .auction-title a');
      const title = titleElement ? titleElement.textContent.trim() : '';
      const url = titleElement ? titleElement.getAttribute('href') : '';
      
      // Extract price
      const priceElement = element.querySelector('.list-item-price, .auctions-item-price, .auction-result');
      const priceText = priceElement ? priceElement.textContent.trim() : '';
      
      // Extract date
      const dateElement = element.querySelector('.list-item-date, .auctions-item-date, .auction-date');
      const dateText = dateElement ? dateElement.textContent.trim() : '';
      
      // Extract seller info if available
      let sellerInfo = 'Unknown';
      const detailElements = element.querySelectorAll('.list-item-detail, .auction-details p, .auction-meta');
      detailElements.forEach(detail => {
        const detailText = detail.textContent.trim();
        if (detailText.includes('Seller:') || detailText.includes('seller')) {
          sellerInfo = detailText;
        }
      });
      
      // Parse price value
      let price = 0;
      if (priceText) {
        const priceMatch = priceText.match(/\$([0-9,]+)/);
        if (priceMatch) {
          price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
      }
      
      // Extract make and year if possible
      let make = '';
      let year = '';
      
      if (title) {
        // Try to parse year
        const yearMatch = title.match(/^(19\d\d|20\d\d)/);
        if (yearMatch) {
          year = yearMatch[1];
        }
        
        // Try to extract make (very basic approach)
        const commonMakes = [
          'Aston Martin', 'Alfa Romeo', 'Acura', 'Audi', 'BMW', 'Bentley', 'Bugatti',
          'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Citroen', 'Dodge', 
          'Ferrari', 'Fiat', 'Ford', 'GMC', 'Honda', 'Hyundai', 'Infiniti',
          'Jaguar', 'Jeep', 'Kia', 'Lamborghini', 'Land Rover', 'Lexus', 'Lincoln',
          'Lotus', 'Maserati', 'Mazda', 'McLaren', 'Mercedes-Benz', 'Mercedes', 'Mercury',
          'Mini', 'Mitsubishi', 'Nissan', 'Oldsmobile', 'Peugeot', 'Plymouth',
          'Pontiac', 'Porsche', 'RAM', 'Renault', 'Rolls-Royce', 'Saab', 'Saturn',
          'Scion', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Triumph', 'Volkswagen', 'VW', 'Volvo'
        ];
        
        for (const potentialMake of commonMakes) {
          if (title.includes(potentialMake)) {
            make = potentialMake;
            break;
          }
        }
      }
      
      // Create auction object
      const auction = {
        title,
        url: url.startsWith('http') ? url : `${BAT_BASE_URL}${url}`,
        date: dateText,
        price,
        priceText,
        sellerInfo,
        year,
        make,
        source: 'bat_search',
        isVivaLasVegas: sellerInfo.toLowerCase().includes('viva') || 
                       sellerInfo.toLowerCase().includes('vegas')
      };
      
      auctions.push(auction);
      
      console.log(`Auction ${index + 1}: ${title}`);
      console.log(`  URL: ${auction.url}`);
      console.log(`  Price: ${priceText}`);
      console.log(`  Seller: ${sellerInfo}`);
      if (auction.isVivaLasVegas) {
        console.log(`  ✅ Likely Viva Las Vegas Autos listing`);
      }
      console.log('---');
    } catch (error) {
      console.error(`Error parsing auction ${index}:`, error);
    }
  });
  
  return auctions;
}

/**
 * Categorize auctions by decade
 */
function categorizeByDecade(auctions) {
  const byDecade = {};
  
  auctions.forEach(auction => {
    if (auction.year) {
      const decade = Math.floor(parseInt(auction.year, 10) / 10) * 10;
      byDecade[decade] = byDecade[decade] || [];
      byDecade[decade].push(auction);
    }
  });
  
  return byDecade;
}

/**
 * Categorize auctions by make
 */
function categorizeByMake(auctions) {
  const byMake = {};
  
  auctions.forEach(auction => {
    if (auction.make) {
      byMake[auction.make] = byMake[auction.make] || [];
      byMake[auction.make].push(auction);
    } else {
      byMake['Unknown'] = byMake['Unknown'] || [];
      byMake['Unknown'].push(auction);
    }
  });
  
  return byMake;
}

/**
 * Create analysis from auctions
 */
function analyzeAuctions(auctions, keyword) {
  // Filter auctions related to Viva Las Vegas
  const vivaAuctions = auctions.filter(auction => auction.isVivaLasVegas);
  
  // Calculate total sale value
  const totalValue = vivaAuctions.reduce((sum, auction) => sum + (auction.price || 0), 0);
  
  // Categorize by decade and make
  const byDecade = categorizeByDecade(vivaAuctions);
  const byMake = categorizeByMake(vivaAuctions);
  
  // Create analysis object
  return {
    keyword,
    count: vivaAuctions.length,
    totalResults: auctions.length,
    totalValue,
    byMake,
    byDecade,
    listings: vivaAuctions,
    allListings: auctions,
    // Include metadata for the multi-source connector framework
    metadata: {
      source: 'bat_search',
      confidence: 0.85,
      timestamp: new Date().toISOString(),
      query: { type: 'keyword_search', keyword }
    }
  };
}

/**
 * Save analysis to file
 */
async function saveAnalysisToFile(analysis, keyword) {
  try {
    // Create output directory if it doesn't exist
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `${keyword.replace(/\s+/g, '_')}_direct_${timestamp}.json`;
    const filePath = path.join(OUTPUT_DIR, filename);
    
    await fs.writeFile(filePath, JSON.stringify(analysis, null, 2));
    console.log(`Analysis saved to ${filePath}`);
    
    return filePath;
  } catch (error) {
    console.error('Error saving analysis to file:', error);
    throw error;
  }
}

/**
 * Main function to search for and analyze auctions
 */
async function main() {
  // Get keyword from command line or use default
  const keyword = process.argv[2] || 'viva las vegas';
  
  try {
    console.log(`Searching for completed auctions with keyword: "${keyword}"...`);
    
    // Fetch first page to get total results
    const { html, totalResults } = await fetchSearchResults(keyword);
    
    // Extract auctions
    const auctions = extractAuctions(html);
    
    // Calculate total pages (BaT shows 50 results per page)
    const totalPages = Math.ceil(totalResults / 50);
    console.log(`Found ${totalResults} total results across ${totalPages} pages`);
    
    // Fetch additional pages if needed (limit to 5 pages to avoid excessive requests)
    const maxPages = Math.min(totalPages, 5);
    let allAuctions = [...auctions];
    
    for (let page = 2; page <= maxPages; page++) {
      console.log(`Fetching page ${page} of ${maxPages}...`);
      const pageResult = await fetchSearchResults(keyword, page);
      const pageAuctions = extractAuctions(pageResult.html);
      allAuctions = [...allAuctions, ...pageAuctions];
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`\nTotal auctions found: ${allAuctions.length}`);
    
    // Filter and analyze auctions
    const vivaAuctions = allAuctions.filter(auction => auction.isVivaLasVegas);
    console.log(`Auctions related to Viva Las Vegas: ${vivaAuctions.length}`);
    
    if (vivaAuctions.length > 0) {
      // Create analysis
      const analysis = analyzeAuctions(allAuctions, keyword);
      
      // Output results
      console.log(`\n📊 Analysis Results for "${keyword}" (Viva Las Vegas Autos):`);
      console.log(`Vehicles sold by Viva Las Vegas: ${analysis.count}`);
      console.log(`Total sales value: $${analysis.totalValue.toLocaleString()}`);
      
      // Save to file
      await saveAnalysisToFile(analysis, keyword);
      
      // Display categorized results
      console.log('\n📋 Vehicles Sold by Make:');
      for (const [make, makeAuctions] of Object.entries(analysis.byMake)) {
        console.log(`  ${make}: ${makeAuctions.length}`);
      }
      
      console.log('\n📅 Vehicles Sold by Decade:');
      for (const [decade, decadeAuctions] of Object.entries(analysis.byDecade)) {
        console.log(`  ${decade}s: ${decadeAuctions.length}`);
      }
    } else {
      console.log(`No auctions related to Viva Las Vegas found in the search results.`);
    }
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the script
main().catch(console.error);
