#!/usr/bin/env node

/**
 * Bring a Trailer User Sales Query Tool
 * 
 * This script fetches and analyzes vehicles sold by specific users on Bring a Trailer.
 * It integrates with the multi-source connector framework for vehicle data.
 */

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

// ES Module support for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BAT_BASE_URL = 'https://bringatrailer.com';
const BAT_SEARCH_URL = `${BAT_BASE_URL}/search`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36';

/**
 * Fetches search results for a specific username on BaT
 * @param {string} username - The BaT username to search for
 * @param {number} page - Page number for pagination
 * @returns {Promise<{html: string, totalResults: number}>} The search results HTML and total count
 */
async function fetchUserListings(username, page = 1, queryType = 'combined') {
  try {
    let query = username;
    
    // Try different search strategies
    if (queryType === 'combined') {
      query = `${username} seller:${username}`;
    } else if (queryType === 'seller_only') {
      query = `seller:${username}`;
    } else if (queryType === 'username_only') {
      query = username;
    } else if (queryType === 'viva') {
      // Special case for vivalasvegasautos - try with spaces
      query = 'viva las vegas autos';
    }
    
    const searchParams = new URLSearchParams({
      q: query,
      page: page
    });
    
    console.log(`Searching BaT with query: ${searchParams.toString()}`);
    
    const response = await fetch(`${BAT_SEARCH_URL}?${searchParams.toString()}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': BAT_BASE_URL,
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Parse total results from the response
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Get total results count
    const resultsCountElement = document.querySelector('.search-results-count');
    let totalResults = 0;
    
    if (resultsCountElement) {
      const countText = resultsCountElement.textContent.trim();
      const match = countText.match(/(\d+)/);
      if (match) {
        totalResults = parseInt(match[1], 10);
      }
    }
    
    return { html, totalResults };
  } catch (error) {
    console.error(`Error fetching BaT listings for user ${username}:`, error);
    throw error;
  }
}

/**
 * Parses vehicle listings from BaT search results HTML
 * @param {string} html - The HTML content to parse
 * @returns {Array<Object>} Array of vehicle listing objects
 */
function parseVehicleListings(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  // Select all listing cards
  const listingElements = document.querySelectorAll('.list-item');
  const listings = [];
  
  listingElements.forEach(element => {
    try {
      // Extract title, which contains year, make, model
      const titleElement = element.querySelector('.list-item-title a');
      const title = titleElement ? titleElement.textContent.trim() : '';
      const url = titleElement ? `${BAT_BASE_URL}${titleElement.getAttribute('href')}` : '';
      
      // Extract price
      const priceElement = element.querySelector('.list-item-price');
      const priceText = priceElement ? priceElement.textContent.trim() : '';
      const price = priceText ? priceText.replace(/\$|,/g, '') : '';
      
      // Extract date
      const dateElement = element.querySelector('.list-item-date');
      const dateText = dateElement ? dateElement.textContent.trim() : '';
      
      // Check if it's a sold vehicle (indicated by "Sold" text)
      const isSold = priceText.includes('Sold') || dateText.includes('Sold');
      
      // Check if listing mentions the username in the seller section
      const detailElements = element.querySelectorAll('.list-item-detail');
      let isSeller = false;
      let isSellerUsername = '';
      
      detailElements.forEach(detail => {
        const detailText = detail.textContent.trim();
        if (detailText.includes('Seller:')) {
          isSeller = true;
          // Extract seller username
          const sellerMatch = detailText.match(/Seller:\s*(\S+)/);
          if (sellerMatch) {
            isSellerUsername = sellerMatch[1];
          }
        }
      });
      
      // Vehicle identification - extract year, make, model
      const vehicleMatch = title.match(/(\d{4})\s+(.+?)(?:\s+(.+))?$/);
      const year = vehicleMatch ? vehicleMatch[1] : '';
      const make = vehicleMatch ? vehicleMatch[2] : '';
      const model = vehicleMatch && vehicleMatch[3] ? vehicleMatch[3] : '';
      
      listings.push({
        title,
        url,
        price: isSold ? parseInt(price, 10) || 0 : 0,
        date: dateText,
        isSold,
        isSeller,
        sellerUsername: isSellerUsername,
        year: parseInt(year, 10) || 0,
        make,
        model,
        confidence: 0.95, // High confidence for direct BaT data
        source: 'bat'
      });
    } catch (error) {
      console.error('Error parsing listing element:', error);
    }
  });
  
  return listings;
}

/**
 * Analyzes vehicle sales for a specific BaT user
 * @param {string} username - The BaT username to analyze
 * @param {string} searchType - The type of search to perform (combined, seller_only, username_only, viva)
 * @returns {Promise<{count: number, totalValue: number, listings: Array<Object>}>} Sales analysis
 */
async function analyzeUserSales(username, searchType = 'combined') {
  let allListings = [];
  let totalPages = 1;
  let currentPage = 1;
  let totalResults = 0;
  
  try {
    // Fetch first page to get total results
    const firstPageResult = await fetchUserListings(username, 1, searchType);
    totalResults = firstPageResult.totalResults;
    
    // Calculate total pages (BaT shows 25 results per page)
    totalPages = Math.ceil(totalResults / 25);
    
    // Parse first page listings
    const firstPageListings = parseVehicleListings(firstPageResult.html);
    allListings = [...firstPageListings];
    
    // If no results with the primary search and it's vivalasvegasautos, try alternative search
    if (totalResults === 0 && username.toLowerCase() === 'vivalasvegasautos' && searchType === 'combined') {
      console.log('No results found with combined search, trying alternative search for "viva las vegas"...');
      return analyzeUserSales(username, 'viva');
    }
    
    // Fetch additional pages if needed
    const maxPages = Math.min(totalPages, 10); // Limit to 10 pages to avoid excessive requests
    
    if (totalPages > 1) {
      console.log(`Found ${totalResults} total results across ${totalPages} pages. Fetching up to ${maxPages} pages...`);
      
      for (currentPage = 2; currentPage <= maxPages; currentPage++) {
        console.log(`Fetching page ${currentPage} of ${maxPages}...`);
        const pageResult = await fetchUserListings(username, currentPage, searchType);
        const pageListings = parseVehicleListings(pageResult.html);
        allListings = [...allListings, ...pageListings];
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Filter for sold vehicles by this user
    const soldByUser = allListings.filter(listing => 
      listing.isSold && 
      listing.sellerUsername.toLowerCase() === username.toLowerCase()
    );
    
    // Calculate total sales value
    const totalValue = soldByUser.reduce((sum, listing) => sum + listing.price, 0);
    
    // Group by make
    const byMake = soldByUser.reduce((acc, listing) => {
      acc[listing.make] = (acc[listing.make] || 0) + 1;
      return acc;
    }, {});
    
    // Group by year decade
    const byDecade = soldByUser.reduce((acc, listing) => {
      if (listing.year) {
        const decade = Math.floor(listing.year / 10) * 10;
        acc[`${decade}s`] = (acc[`${decade}s`] || 0) + 1;
      }
      return acc;
    }, {});
    
    return {
      username,
      count: soldByUser.length,
      totalResults,
      totalValue,
      byMake,
      byDecade,
      listings: soldByUser,
      // Include all raw listings for debugging
      rawListings: allListings,
      // Include metadata for the multi-source connector framework
      metadata: {
        source: 'bat',
        confidence: 0.95,
        timestamp: new Date().toISOString(),
        query: { type: 'user_search', username }
      }
    };
  } catch (error) {
    console.error(`Error analyzing sales for user ${username}:`, error);
    throw error;
  }
}

/**
 * Save analysis results to a JSON file
 * @param {Object} analysis - The analysis results
 * @param {string} username - The username used for the analysis
 */
async function saveAnalysisToFile(analysis, username) {
  try {
    const outputDir = path.join(__dirname, '../data/bat-analysis');
    
    // Create directory if it doesn't exist
    await fs.mkdir(outputDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `${username}_${timestamp}.json`;
    const outputPath = path.join(outputDir, filename);
    
    await fs.writeFile(outputPath, JSON.stringify(analysis, null, 2));
    console.log(`Analysis saved to ${outputPath}`);
    
    return outputPath;
  } catch (error) {
    console.error('Error saving analysis to file:', error);
  }
}

/**
 * Create interactive CLI
 */
function createCLI() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log('🚗 Bring a Trailer User Sales Analysis Tool 🚗');
  console.log('----------------------------------------------');
  
  rl.question('Enter BaT username to analyze: ', async (username) => {
    if (!username.trim()) {
      console.log('Username cannot be empty. Exiting...');
      rl.close();
      return;
    }
    
    try {
      console.log(`\nAnalyzing sales for user "${username}"...\n`);
      const analysis = await analyzeUserSales(username);
      
      console.log('\n📊 Analysis Results:');
      console.log(`Username: ${analysis.username}`);
      console.log(`Total vehicles found: ${analysis.totalResults}`);
      console.log(`Vehicles sold by this user: ${analysis.count}`);
      console.log(`Total sales value: $${analysis.totalValue.toLocaleString()}`);
      
      console.log('\nSales by Make:');
      Object.entries(analysis.byMake)
        .sort((a, b) => b[1] - a[1])
        .forEach(([make, count]) => {
          console.log(`  ${make}: ${count}`);
        });
      
      console.log('\nSales by Decade:');
      Object.entries(analysis.byDecade)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([decade, count]) => {
          console.log(`  ${decade}: ${count}`);
        });
      
      // Save analysis to file
      const filePath = await saveAnalysisToFile(analysis, username);
      
      console.log('\nTop 5 Most Valuable Sales:');
      analysis.listings
        .sort((a, b) => b.price - a.price)
        .slice(0, 5)
        .forEach((listing, index) => {
          console.log(`  ${index + 1}. ${listing.title} - $${listing.price.toLocaleString()}`);
        });
      
      rl.close();
    } catch (error) {
      console.error('Error during analysis:', error);
      rl.close();
    }
  });
}

// Execute main function if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Check if username was provided as command-line argument
  const usernameArg = process.argv[2];
  const searchType = process.argv[3] || 'combined';
  
  if (usernameArg) {
    console.log(`Analyzing ${usernameArg} with search type: ${searchType}`);
    // Run analysis with provided username
    analyzeUserSales(usernameArg, searchType)
      .then(async (analysis) => {
        console.log(`\n📊 Analysis Results for ${usernameArg}:`);
        console.log(`Total results found in search: ${analysis.totalResults}`);
        console.log(`Vehicles sold by this user: ${analysis.count}`);
        console.log(`Total sales value: $${analysis.totalValue.toLocaleString()}`);
        
        // Show all listings found regardless of seller attribution for debugging
        if (analysis.listings.length === 0 && analysis.totalResults > 0) {
          console.log('\nDebug: Showing all listings found in search results:');
          // Access the raw listings directly from the analysis object
          analysis.rawListings?.slice(0, 5).forEach((listing, i) => {
            console.log(`Listing ${i+1}: ${listing.title}`);
            console.log(`  Seller: ${listing.sellerUsername || 'Not identified'}`);
            console.log(`  Sold: ${listing.isSold}`);
          });
        }
        
        await saveAnalysisToFile(analysis, usernameArg);
      })
      .catch(console.error);
  } else {
    // Run interactive CLI
    createCLI();
  }
}

// Export functions for use in the multi-source connector framework
export { analyzeUserSales, fetchUserListings, parseVehicleListings };
