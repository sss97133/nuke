#!/usr/bin/env node

/**
 * Bring a Trailer Direct User Profile Checker
 * 
 * This script directly checks for a user profile on Bring a Trailer
 * by attempting to access their profile URL.
 */

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

// Configuration
const BAT_BASE_URL = 'https://bringatrailer.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36';

/**
 * Format a username for a URL (lowercase, remove spaces)
 */
function formatUsernameForUrl(username) {
  return username.toLowerCase().replace(/\s+/g, '');
}

/**
 * Try different variations of a username
 */
function getUsernameVariations(username) {
  return [
    username,
    username.toLowerCase(),
    username.toLowerCase().replace(/\s+/g, ''),
    username.toLowerCase().replace(/\s+/g, '-'),
    // For "Viva Las Vegas Autos" specific variations
    'vivalasvegasautos',
    'viva-las-vegas-autos',
    'vivalasvegas'
  ];
}

/**
 * Check if a user profile exists and get their information
 */
async function checkUserProfile(username) {
  const variations = getUsernameVariations(username);
  
  console.log(`Checking ${variations.length} username variations for "${username}"...`);
  
  for (const variation of variations) {
    try {
      const profileUrl = `${BAT_BASE_URL}/member/${variation}`;
      console.log(`Trying profile URL: ${profileUrl}`);
      
      const response = await fetch(profileUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html',
          'Cache-Control': 'no-cache'
        }
      });
      
      if (response.ok) {
        console.log(`✅ Found profile for "${variation}"!`);
        const html = await response.text();
        
        // Parse the HTML to extract profile information
        const dom = new JSDOM(html);
        const document = dom.window.document;
        
        // Check if there's a list of auctions
        const auctionElements = document.querySelectorAll('.auction-list-item');
        console.log(`Found ${auctionElements.length} auctions listed on profile page`);
        
        return {
          username: variation,
          profileUrl,
          exists: true,
          auctionCount: auctionElements.length,
          html: html.substring(0, 1000) // Just store a preview for debugging
        };
      } else {
        console.log(`❌ Profile not found for "${variation}" (Status: ${response.status})`);
      }
    } catch (error) {
      console.error(`Error checking profile for "${variation}":`, error.message);
    }
  }
  
  return {
    username,
    exists: false,
    message: 'No profile found with any username variation'
  };
}

// Check for dealer page as well
async function checkDealerPage(username) {
  const variations = getUsernameVariations(username);
  
  console.log(`\nChecking dealer pages for "${username}"...`);
  
  for (const variation of variations) {
    try {
      // Try both dealer and dealership endpoints
      const urls = [
        `${BAT_BASE_URL}/dealer/${variation}`,
        `${BAT_BASE_URL}/dealership/${variation}`
      ];
      
      for (const url of urls) {
        console.log(`Trying dealer URL: ${url}`);
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html',
            'Cache-Control': 'no-cache'
          }
        });
        
        if (response.ok) {
          console.log(`✅ Found dealer page at ${url}!`);
          const html = await response.text();
          
          // Parse the HTML to extract dealer information
          const dom = new JSDOM(html);
          const document = dom.window.document;
          
          // Check for listed cars
          const listingElements = document.querySelectorAll('.auction-list-item, .list-item');
          console.log(`Found ${listingElements.length} vehicle listings on dealer page`);
          
          return {
            username: variation,
            dealerUrl: url,
            exists: true,
            listingCount: listingElements.length
          };
        } else {
          console.log(`❌ Dealer page not found at ${url} (Status: ${response.status})`);
        }
      }
    } catch (error) {
      console.error(`Error checking dealer page for "${variation}":`, error.message);
    }
  }
  
  return {
    username,
    exists: false,
    message: 'No dealer page found with any username variation'
  };
}

// Main function to check both user profile and dealer page
async function checkBaTPresence(username) {
  console.log(`Checking Bring a Trailer presence for "${username}"...`);
  
  const profileResult = await checkUserProfile(username);
  const dealerResult = await checkDealerPage(username);
  
  return {
    username,
    timestamp: new Date().toISOString(),
    profileFound: profileResult.exists,
    profileDetails: profileResult,
    dealerPageFound: dealerResult.exists,
    dealerDetails: dealerResult
  };
}

// Execute when run directly
const username = process.argv[2] || 'vivalasvegasautos';

if (!username) {
  console.error('Please provide a username to check');
  process.exit(1);
}

checkBaTPresence(username)
  .then(result => {
    console.log('\n===== SUMMARY =====');
    console.log(`User "${username}" on Bring a Trailer:`);
    
    if (result.profileFound) {
      console.log(`✅ User profile found: ${result.profileDetails.profileUrl}`);
      console.log(`Auctions found on profile: ${result.profileDetails.auctionCount}`);
    } else {
      console.log('❌ No user profile found');
    }
    
    if (result.dealerPageFound) {
      console.log(`✅ Dealer page found: ${result.dealerDetails.dealerUrl}`);
      console.log(`Listings found on dealer page: ${result.dealerDetails.listingCount}`);
    } else {
      console.log('❌ No dealer page found');
    }
    
    if (!result.profileFound && !result.dealerPageFound) {
      console.log('👉 This user/dealer could not be found on Bring a Trailer with any variations tried.');
      console.log('They may not exist, or might be listed under a completely different name.');
    }
  })
  .catch(error => {
    console.error('Error checking BaT presence:', error);
  });
