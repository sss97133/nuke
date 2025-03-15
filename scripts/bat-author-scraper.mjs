#!/usr/bin/env node

/**
 * Bring a Trailer Author Page Scraper
 * 
 * This script directly accesses BaT author pages to extract vehicle listings.
 * It's specifically designed to work with the vivalasvegasautos author page.
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
 * Get the direct author URL for a username
 */
function getAuthorUrl(username) {
  return `${BAT_BASE_URL}/author/${encodeURIComponent(username)}/`;
}

/**
 * Fetch and parse the author page
 */
async function fetchAuthorPage(username) {
  try {
    const authorUrl = getAuthorUrl(username);
    console.log(`Fetching author page: ${authorUrl}`);
    
    const response = await fetch(authorUrl, {
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
    return { html, url: authorUrl };
  } catch (error) {
    console.error(`Error fetching author page for ${username}:`, error);
    throw error;
  }
}

/**
 * Extract vehicle listings from the author page HTML
 */
function extractVehicleListings(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  // Find all main posts (each post is a vehicle listing)
  const postElements = document.querySelectorAll('article.post');
  console.log(`Found ${postElements.length} post elements on author page`);
  
  const listings = [];
  
  postElements.forEach((postElement, index) => {
    try {
      // Extract basic vehicle information
      const titleElement = postElement.querySelector('.post-title a');
      const title = titleElement ? titleElement.textContent.trim() : '';
      const url = titleElement ? titleElement.getAttribute('href') : '';
      
      // Extract image
      const imageElement = postElement.querySelector('.post-image img');
      const imageUrl = imageElement ? imageElement.getAttribute('src') : '';
      
      // Extract post date
      const dateElement = postElement.querySelector('.post-date');
      const dateText = dateElement ? dateElement.textContent.trim() : '';
      
      // Extract price (might be in a different element)
      let priceText = '';
      const priceElement = postElement.querySelector('.post-price') || 
                          postElement.querySelector('.tag-sold');
      if (priceElement) {
        priceText = priceElement.textContent.trim();
      }
      
      // Check if sold
      const isSold = priceText.includes('Sold') || 
                    postElement.classList.contains('is-sold') ||
                    postElement.classList.contains('tag-sold') ||
                    postElement.innerHTML.includes('tag-sold');
      
      // Extract price value if sold
      let price = 0;
      if (isSold && priceText) {
        const priceMatch = priceText.match(/\$([0-9,]+)/);
        if (priceMatch) {
          price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
      }
      
      // Extract make and model from title or metadata
      let make = '';
      let model = '';
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
            // Model would be everything after the make, but this is very crude
            break;
          }
        }
      }
      
      // Check if the post has comments
      let commentCount = 0;
      const commentElement = postElement.querySelector('.post-comments-count');
      if (commentElement) {
        const commentText = commentElement.textContent.trim();
        const commentMatch = commentText.match(/\d+/);
        if (commentMatch) {
          commentCount = parseInt(commentMatch[0], 10);
        }
      }
      
      // Create listing object
      const listing = {
        title,
        url,
        date: dateText,
        price,
        priceText,
        isSold,
        imageUrl,
        commentCount,
        year,
        make,
        source: 'bat_author_page'
      };
      
      listings.push(listing);
      
      console.log(`Listing ${index + 1}: ${title}`);
      console.log(`  URL: ${url}`);
      console.log(`  Date: ${dateText}`);
      console.log(`  Sold: ${isSold}`);
      if (price > 0) {
        console.log(`  Price: $${price.toLocaleString()}`);
      }
      console.log('---');
    } catch (error) {
      console.error(`Error parsing listing ${index}:`, error);
    }
  });
  
  return listings;
}

/**
 * Categorize listings by decade
 */
function categorizeByDecade(listings) {
  const byDecade = {};
  
  listings.forEach(listing => {
    if (listing.year) {
      const decade = Math.floor(parseInt(listing.year, 10) / 10) * 10;
      byDecade[decade] = byDecade[decade] || [];
      byDecade[decade].push(listing);
    }
  });
  
  return byDecade;
}

/**
 * Categorize listings by make
 */
function categorizeByMake(listings) {
  const byMake = {};
  
  listings.forEach(listing => {
    if (listing.make) {
      byMake[listing.make] = byMake[listing.make] || [];
      byMake[listing.make].push(listing);
    } else {
      byMake['Unknown'] = byMake['Unknown'] || [];
      byMake['Unknown'].push(listing);
    }
  });
  
  return byMake;
}

/**
 * Create analysis from listings
 */
function analyzeListings(listings, username) {
  // Find sold listings
  const soldListings = listings.filter(listing => listing.isSold);
  
  // Calculate total sale value
  const totalValue = soldListings.reduce((sum, listing) => sum + (listing.price || 0), 0);
  
  // Categorize by decade and make
  const byDecade = categorizeByDecade(soldListings);
  const byMake = categorizeByMake(soldListings);
  
  // Create analysis object
  return {
    username,
    count: soldListings.length,
    totalListings: listings.length,
    totalValue,
    byMake,
    byDecade,
    listings: soldListings,
    allListings: listings,
    // Include metadata for the multi-source connector framework
    metadata: {
      source: 'bat_author',
      confidence: 0.95,
      timestamp: new Date().toISOString(),
      query: { type: 'author_page', username }
    }
  };
}

/**
 * Save analysis to file
 */
async function saveAnalysisToFile(analysis, username) {
  try {
    // Create output directory if it doesn't exist
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `${username}_author_${timestamp}.json`;
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
 * Main function
 */
async function main() {
  // Get username from command line
  const usernameArg = process.argv[2] || 'vivalasvegasautos';
  
  if (!usernameArg) {
    console.error('Please provide a username to analyze');
    process.exit(1);
  }
  
  try {
    console.log(`Analyzing BaT author page for "${usernameArg}"...`);
    
    // Fetch and parse the author page
    const { html } = await fetchAuthorPage(usernameArg);
    
    // Extract vehicle listings
    const listings = extractVehicleListings(html);
    
    if (listings.length > 0) {
      // Create analysis from listings
      const analysis = analyzeListings(listings, usernameArg);
      
      // Output results
      console.log(`\n📊 Analysis Results for ${usernameArg}:`);
      console.log(`Total listings found: ${analysis.totalListings}`);
      console.log(`Vehicles sold by this user: ${analysis.count}`);
      console.log(`Total sales value: $${analysis.totalValue.toLocaleString()}`);
      
      // Save to file
      await saveAnalysisToFile(analysis, usernameArg);
      
      // Display categorized results
      console.log('\n📋 Vehicles Sold by Make:');
      for (const [make, makeListings] of Object.entries(analysis.byMake)) {
        console.log(`  ${make}: ${makeListings.length}`);
      }
      
      console.log('\n📅 Vehicles Sold by Decade:');
      for (const [decade, decadeListings] of Object.entries(analysis.byDecade)) {
        console.log(`  ${decade}s: ${decadeListings.length}`);
      }
    } else {
      console.log(`No listings found on the author page for ${usernameArg}`);
    }
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the script
main().catch(console.error);
