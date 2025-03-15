#!/usr/bin/env node

/**
 * Bring a Trailer Seller Search Tool
 * 
 * This script uses a direct seller: search on BaT to find all cars sold by a specific seller.
 */

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

// Configuration
const BAT_BASE_URL = 'https://bringatrailer.com';
const BAT_SEARCH_URL = `${BAT_BASE_URL}/search`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36';

/**
 * Searches BaT specifically for a seller using the seller: search operator
 */
async function searchBaTSeller(sellerName) {
  try {
    // Use the seller: prefix for targeted search
    const searchUrl = `${BAT_SEARCH_URL}?q=seller%3A${encodeURIComponent(sellerName)}`;
    console.log(`Searching BaT directly for seller: ${sellerName}`);
    console.log(`URL: ${searchUrl}`);
    
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
    
    // Parse the HTML to extract listings
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Check for search results count
    const resultsCountElement = document.querySelector('.search-results-count');
    let totalResults = 0;
    
    if (resultsCountElement) {
      const countText = resultsCountElement.textContent.trim();
      const match = countText.match(/(\d+)/);
      if (match) {
        totalResults = parseInt(match[1], 10);
      }
    }
    
    console.log(`Total search results: ${totalResults}`);
    
    // Get all listing cards
    const listingElements = document.querySelectorAll('.list-item');
    console.log(`Found ${listingElements.length} listings on this page`);
    
    const listings = [];
    
    // Process each listing
    listingElements.forEach((element, index) => {
      try {
        // Extract title
        const titleElement = element.querySelector('.list-item-title a');
        const title = titleElement ? titleElement.textContent.trim() : '';
        const url = titleElement ? `${BAT_BASE_URL}${titleElement.getAttribute('href')}` : '';
        
        // Extract price
        const priceElement = element.querySelector('.list-item-price');
        const priceText = priceElement ? priceElement.textContent.trim() : '';
        const price = priceText ? priceText.replace(/\$|,/g, '') : '';
        
        // Extract date and sold status
        const dateElement = element.querySelector('.list-item-date');
        const dateText = dateElement ? dateElement.textContent.trim() : '';
        const isSold = priceText.includes('Sold') || dateText.includes('Sold');
        
        // Extract seller info
        let sellerInfo = 'Unknown';
        const detailElements = element.querySelectorAll('.list-item-detail');
        detailElements.forEach(detail => {
          const detailText = detail.textContent.trim();
          if (detailText.includes('Seller:')) {
            sellerInfo = detailText;
          }
        });
        
        listings.push({
          title,
          url,
          price: isSold && price ? parseInt(price, 10) : 0,
          date: dateText,
          sellerInfo,
          isSold
        });
        
        console.log(`Listing ${index + 1}: ${title}`);
        console.log(`  Price: ${priceText}`);
        console.log(`  Seller Info: ${sellerInfo}`);
        console.log(`  URL: ${url}`);
        console.log('---');
      } catch (error) {
        console.error(`Error parsing listing:`, error);
      }
    });
    
    return {
      sellerName,
      totalResults,
      visibleListings: listingElements.length,
      listings,
      searchUrl
    };
  } catch (error) {
    console.error(`Error searching for seller ${sellerName}:`, error);
    throw error;
  }
}

/**
 * Try to find any sales from a specific seller
 */
async function findSellerSales(sellerName) {
  // Try different variants of the name
  const nameVariants = [
    sellerName,
    sellerName.toLowerCase(),
    sellerName.replace(/\s+/g, ''),
    sellerName.replace(/\s+/g, '-')
  ];
  
  // For vivalasvegasautos specifically, add these variants
  if (sellerName.toLowerCase().includes('viva') || sellerName.toLowerCase().includes('vegas')) {
    nameVariants.push('vivalasvegasautos');
    nameVariants.push('vivalasvegas');
    nameVariants.push('viva-las-vegas');
    nameVariants.push('viva_las_vegas');
  }
  
  console.log(`Trying ${nameVariants.length} name variants for ${sellerName}...`);
  
  for (const variant of nameVariants) {
    console.log(`\nChecking seller name variant: "${variant}"`);
    try {
      const result = await searchBaTSeller(variant);
      
      if (result.listings.length > 0) {
        console.log(`Success! Found ${result.listings.length} listings for seller variant "${variant}"`);
        return result;
      } else {
        console.log(`No listings found for seller variant "${variant}"`);
      }
    } catch (error) {
      console.error(`Error searching for variant "${variant}":`, error.message);
    }
  }
  
  // If we get here, none of the variants returned results
  return {
    sellerName,
    totalResults: 0,
    visibleListings: 0,
    listings: [],
    message: "No listings found for any name variants tried"
  };
}

/**
 * Try alternative search methods
 */
async function tryAlternativeSearch(sellerName) {
  try {
    console.log(`\nTrying alternative search without seller: prefix for "${sellerName}"...`);
    
    // Try a simple search without the seller: prefix
    const searchUrl = `${BAT_SEARCH_URL}?q=${encodeURIComponent(sellerName)}`;
    console.log(`URL: ${searchUrl}`);
    
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
    
    // Parse the HTML to extract listings
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Get all listing cards
    const listingElements = document.querySelectorAll('.list-item');
    console.log(`Found ${listingElements.length} listings on this page`);
    
    if (listingElements.length > 0) {
      console.log("\nSample listings from general search:");
      
      // Show a few sample listings
      for (let i = 0; i < Math.min(5, listingElements.length); i++) {
        const element = listingElements[i];
        const titleElement = element.querySelector('.list-item-title a');
        const title = titleElement ? titleElement.textContent.trim() : '';
        
        // Extract seller info
        let sellerInfo = 'Unknown';
        const detailElements = element.querySelectorAll('.list-item-detail');
        detailElements.forEach(detail => {
          const detailText = detail.textContent.trim();
          if (detailText.includes('Seller:')) {
            sellerInfo = detailText;
          }
        });
        
        console.log(`Listing ${i + 1}: ${title}`);
        console.log(`  Seller Info: ${sellerInfo}`);
      }
    }
    
    return {
      searchType: 'general',
      query: sellerName,
      listingsFound: listingElements.length,
      searchUrl
    };
  } catch (error) {
    console.error(`Error with alternative search:`, error);
    return {
      searchType: 'general',
      query: sellerName,
      listingsFound: 0,
      error: error.message
    };
  }
}

// Main function
async function main() {
  // Get seller name from command line
  const sellerName = process.argv[2] || 'vivalasvegasautos';
  
  if (!sellerName) {
    console.error('Please provide a seller name to search');
    process.exit(1);
  }
  
  console.log(`Searching for BaT listings from seller: ${sellerName}`);
  
  try {
    // Try direct seller search first
    const result = await findSellerSales(sellerName);
    
    if (result.listings.length === 0) {
      console.log('\nNo listings found with direct seller search. Trying alternative searches...');
      await tryAlternativeSearch(sellerName);
      
      // If we're specifically looking for vivalasvegasautos, try a direct URL approach
      if (sellerName.toLowerCase().includes('viva') || sellerName.toLowerCase().includes('vegas')) {
        console.log('\nTrying one more approach - direct URL for dealer/seller page...');
        
        // Try accessing a few potential direct URLs
        const urls = [
          'https://bringatrailer.com/dealer/viva-las-vegas-autos/',
          'https://bringatrailer.com/author/vivalasvegasautos/',
          'https://bringatrailer.com/result/?s=viva+las+vegas+autos&orderby=date'
        ];
        
        for (const url of urls) {
          console.log(`Checking URL: ${url}`);
          
          try {
            const response = await fetch(url, {
              headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html',
                'Cache-Control': 'no-cache'
              }
            });
            
            if (response.ok) {
              console.log(`✅ Success! Page exists at ${url}`);
            } else {
              console.log(`❌ Page not found at ${url} (Status: ${response.status})`);
            }
          } catch (error) {
            console.error(`Error checking URL ${url}:`, error.message);
          }
        }
      }
    }
    
    // Summarize findings
    console.log('\n===== SUMMARY =====');
    if (result.listings.length > 0) {
      console.log(`Found ${result.listings.length} listings from seller ${sellerName}`);
      
      // Calculate total sales
      const soldListings = result.listings.filter(listing => listing.isSold);
      const totalSales = soldListings.length;
      const totalValue = soldListings.reduce((sum, listing) => sum + (listing.price || 0), 0);
      
      console.log(`Total vehicles sold: ${totalSales}`);
      console.log(`Total sales value: $${totalValue.toLocaleString()}`);
    } else {
      console.log(`No listings found for seller ${sellerName} with any of the methods tried.`);
      console.log('This could be due to:');
      console.log('1. The seller name is different on BaT');
      console.log('2. BaT requires authentication to view seller history');
      console.log('3. The seller might be identified differently in BaT\'s system');
    }
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the script
main().catch(console.error);
