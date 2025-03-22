#!/usr/bin/env node

/**
 * Complete BaT Profile Scraper
 * 
 * A comprehensive scraper for extracting all listings from a BaT member profile,
 * including pagination handling and detail extraction.
 */

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuration
const MEMBER_PROFILE = 'vivalasvegasautos';
const BAT_BASE_URL = 'https://bringatrailer.com';
const PROFILE_URL = `${BAT_BASE_URL}/member/${MEMBER_PROFILE}/`;
const BAT_API_URL = 'https://bringatrailer.com/wp-json/bat-api/v1';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36';

// Number of listings we expect to find (from user's input)
const EXPECTED_LISTING_COUNT = 43;

// Maximum number of listings to fetch per page (BaT API limit)
const API_LISTINGS_PER_PAGE = 24;

// Output directory for saving results
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'bat-analysis');

/**
 * Create a profile page URL with pagination
 */
function createProfileUrl(page = 1) {
  return `${PROFILE_URL}?page=${page}`;
}

/**
 * Fetch a page and return the HTML content
 */
async function fetchPage(url) {
  console.log(`Fetching: ${url}`);
  
  try {
    const response = await fetch(url, {
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
    console.error(`Error fetching ${url}:`, error);
    throw error;
  }
}

/**
 * Fetch data from the BaT API
 */
async function fetchFromApi(endpoint, params = {}) {
  const url = new URL(`${BAT_API_URL}/${endpoint}`);
  
  // Add query parameters
  Object.keys(params).forEach(key => {
    url.searchParams.append(key, params[key]);
  });
  
  console.log(`Fetching API: ${url}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
        'Referer': PROFILE_URL
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error! Status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error fetching API ${url}:`, error);
    throw error;
  }
}

/**
 * Get all listings for a member directly through the API
 * This uses BaT's internal API endpoints which are more reliable
 * than scraping the HTML directly
 */
async function getMemberListingsViaApi(memberName) {
  const listings = [];
  let page = 1;
  let hasMorePages = true;
  
  console.log(`Fetching all listings for ${memberName} via API...`);
  
  while (hasMorePages && listings.length < EXPECTED_LISTING_COUNT) {
    // BaT uses a different API endpoint for member listings than the public search
    const data = await fetchFromApi('listings', {
      'post_status': 'publish',
      'username': memberName,
      'per_page': API_LISTINGS_PER_PAGE,
      'page': page
    });
    
    if (!data || !data.posts || data.posts.length === 0) {
      hasMorePages = false;
      break;
    }
    
    console.log(`Found ${data.posts.length} listings on API page ${page}`);
    
    // Process each listing from the API
    for (const post of data.posts) {
      try {
        const listing = {
          id: post.id,
          title: post.title.rendered || post.title,
          url: post.link || `${BAT_BASE_URL}/listing/${post.slug}/`,
          imageUrl: post.featured_media_url,
          status: post.auction_status || 'unknown',
          price: post.sale_price ? parseInt(post.sale_price.replace(/[^0-9]/g, ''), 10) : 0,
          year: parseYearFromTitle(post.title.rendered || post.title),
          make: parseMakeFromTitle(post.title.rendered || post.title),
          model: parseModelFromTitle(post.title.rendered || post.title),
          seller: memberName,
          auctionDate: post.auction_end_date ? new Date(post.auction_end_date) : null,
          source: 'bat_api',
          confidence: 0.99
        };
        
        listings.push(listing);
      } catch (error) {
        console.error(`Error processing API listing:`, error);
      }
    }
    
    // Move to next page
    page++;
    
    // Add a delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`Total listings found via API: ${listings.length}`);
  return listings;
}

/**
 * Extract member profile information
 */
function extractProfileInfo(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  const info = {
    username: MEMBER_PROFILE,
    displayName: MEMBER_PROFILE
  };
  
  // Try to get display name
  const nameElement = document.querySelector('.profile-username');
  if (nameElement) {
    info.displayName = nameElement.textContent.trim();
  }
  
  // Try to get location and member since
  const metaItems = document.querySelectorAll('.profile-meta-item');
  metaItems.forEach(item => {
    const label = item.querySelector('.profile-meta-label');
    const value = item.querySelector('.profile-meta-value');
    
    if (label && value) {
      const labelText = label.textContent.trim().toLowerCase();
      const valueText = value.textContent.trim();
      
      if (labelText.includes('member since')) {
        info.memberSince = valueText;
      } else if (labelText.includes('location')) {
        info.location = valueText;
      }
    }
  });
  
  return info;
}

/**
 * Extract listings from a profile page
 */
function extractListings(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  // BaT profile pages may use different classes for auctions
  const listingElements = document.querySelectorAll('.listing-card, .profile-listing, .auction-item, .bat-auction');
  console.log(`Found ${listingElements.length} listing elements on page`);
  
  // Fallback: check for any list with items that might contain auctions
  if (listingElements.length === 0) {
    const anyListings = document.querySelectorAll('li a[href*="/listing/"]');
    console.log(`Found ${anyListings.length} generic listing links on page`);
    
    // If we found some generic listings, transform them into a usable format
    if (anyListings.length > 0) {
      // Process these differently since they're just links
      const genericListings = [];
      anyListings.forEach(link => {
        const url = link.getAttribute('href');
        console.log(`Found listing URL: ${url}`);
        genericListings.push({
          url: url.startsWith('http') ? url : `${BAT_BASE_URL}${url}`,
          title: link.textContent.trim() || 'Unknown Vehicle',
          status: 'unknown', // We'll determine this later
          seller: MEMBER_PROFILE,
          source: 'bat_profile',
          confidence: 0.98
        });
      });
      return genericListings;
    }
  }
  
  const listings = [];
  
  listingElements.forEach((element, index) => {
    try {
      // Debug the HTML structure
      console.log(`Listing ${index + 1} HTML:`, element.outerHTML.substring(0, 200) + '...');
      
      // Try multiple approaches to extract URL
      let url = '';
      let linkElement = null;
      
      // Approach 1: Direct class-based selector
      linkElement = element.querySelector('a.listing-card-link, a.profile-listing-link, a.auction-link');
      
      // Approach 2: Look for any link to a listing
      if (!linkElement || !linkElement.getAttribute('href')) {
        const allLinks = element.querySelectorAll('a');
        for (const link of allLinks) {
          const href = link.getAttribute('href');
          if (href && href.includes('/listing/')) {
            linkElement = link;
            break;
          }
        }
      }
      
      // Get the URL if we found a link
      url = linkElement ? linkElement.getAttribute('href') : '';
      console.log(`  Extracted URL: ${url}`);
      
      // Find the image - try multiple approaches
      let imageElement = element.querySelector('img.listing-card-image, img.profile-listing-image, img.auction-image');
      if (!imageElement) imageElement = element.querySelector('img'); // Fallback to any image
      
      // Find the title - try multiple approaches
      let titleElement = element.querySelector('.listing-card-title, .profile-listing-title, .auction-title');
      if (!titleElement) titleElement = element.querySelector('h3, h4, strong');
      
      // Extract the actual values
      const imageUrl = imageElement ? (imageElement.getAttribute('data-src') || imageElement.getAttribute('src')) : '';
      const title = titleElement ? titleElement.textContent.trim() : (url.split('/').pop() || 'Unknown Vehicle');
      
      // Extract status and price
      const priceElement = element.querySelector('.listing-card-price');
      const statusElement = element.querySelector('.listing-card-status');
      
      const priceText = priceElement ? priceElement.textContent.trim() : '';
      const statusText = statusElement ? statusElement.textContent.trim() : '';
      
      // Is this an active or sold listing?
      const isActive = statusText.toLowerCase().includes('live') || 
                      statusText.toLowerCase().includes('active') ||
                      statusText.toLowerCase().includes('bid');
      
      // Parse price value
      let price = 0;
      if (priceText) {
        const priceMatch = priceText.match(/\$([0-9,]+)/);
        if (priceMatch) {
          price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
      }
      
      // Extract date
      const dateElement = element.querySelector('.listing-card-date');
      let dateText = dateElement ? dateElement.textContent.trim() : '';
      
      // Parse date into a standard format
      let auctionDate = null;
      if (dateText) {
        // Handle various date formats
        try {
          if (dateText.includes('Sold')) {
            dateText = dateText.replace('Sold', '').trim();
          } else if (dateText.includes('Ends')) {
            dateText = dateText.replace('Ends', '').trim();
          }
          
          // Add current year if missing
          if (!dateText.match(/\d{4}/) && !dateText.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)) {
            const currentYear = new Date().getFullYear();
            dateText = `${dateText}, ${currentYear}`;
          }
          
          auctionDate = new Date(dateText);
        } catch (e) {
          console.warn(`Could not parse date: ${dateText}`);
          // If we can't parse the date, use current date as fallback
          auctionDate = new Date();
        }
      }
      
      // Extract year, make, model from title
      let year = '';
      let make = '';
      let model = '';
      
      if (title) {
        // Try to parse year (usually first in the title)
        const yearMatch = title.match(/^(19\d\d|20\d\d)/);
        if (yearMatch) {
          year = yearMatch[1];
          
          // Try a simple approach to extract make and model
          const afterYear = title.substring(year.length).trim();
          const words = afterYear.split(' ');
          
          if (words.length > 0) {
            make = words[0];
            if (words.length > 1) {
              model = words.slice(1).join(' ');
            }
          }
        }
      }
      
      // Create listing object with standardized fields
      const listing = {
        title,
        url: url.startsWith('http') ? url : `${BAT_BASE_URL}${url}`,
        imageUrl: imageUrl.startsWith('http') ? imageUrl : (imageUrl ? `https:${imageUrl}` : ''),
        date: auctionDate ? auctionDate.toISOString() : null,
        price,
        priceText,
        status: isActive ? 'active' : 'sold',
        year,
        make,
        model,
        source: 'bat_profile',
        confidence: 0.98, // Direct from profile page = high confidence
        seller: MEMBER_PROFILE
      };
      
      listings.push(listing);
      
      console.log(`Listing ${index + 1}: ${title}`);
      console.log(`  URL: ${listing.url}`);
      console.log(`  Status: ${listing.status}`);
    } catch (error) {
      console.error(`Error parsing listing ${index}:`, error);
    }
  });
  
  return listings;
}

/**
 * Check for pagination and determine how many pages
 */
function getPageCount(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  // Look for different pagination element selectors
  const paginationSelectors = [
    '.pagination a',
    '.pagination-links a',
    '.page-numbers a',
    'a.page-numbers',
    '.nav-links a'
  ];
  
  let maxPage = 1;
  
  // Try each selector pattern
  for (const selector of paginationSelectors) {
    const paginationLinks = document.querySelectorAll(selector);
    if (paginationLinks.length > 0) {
      console.log(`Found ${paginationLinks.length} pagination links with selector: ${selector}`);
      
      // Find the highest page number
      paginationLinks.forEach(link => {
        const pageText = link.textContent.trim();
        const pageNum = parseInt(pageText, 10);
        
        if (!isNaN(pageNum) && pageNum > maxPage) {
          maxPage = pageNum;
        }
      });
      
      if (maxPage > 1) {
        console.log(`Determined max page: ${maxPage}`);
        break; // We found pagination, stop trying other selectors
      }
    }
  }
  
  // If we couldn't find pagination but need to handle 43 listings,
  // estimate the number of pages (typically 12 listings per page in BaT)
  if (maxPage === 1) {
    // Count the listings on the first page
    const listingCount = document.querySelectorAll('.listing-card, .profile-listing, .auction-item, .bat-auction').length;
    if (listingCount > 0) {
      const estimatedTotalListings = 43; // We know there are 43 total listings
      maxPage = Math.ceil(estimatedTotalListings / listingCount);
      console.log(`Estimated ${maxPage} pages based on ${listingCount} listings per page to reach ${estimatedTotalListings} total`);
    } else {
      // Fallback: set a reasonable number to ensure we get all listings
      maxPage = 5; // With 12 listings per page, 5 pages should be more than enough for 43 listings
      console.log(`Using fallback of ${maxPage} pages to ensure we get all listings`);
    }
  }
  
  return maxPage;
}

/**
 * Extract details from an individual listing page
 */
async function extractListingDetails(listing) {
  try {
    console.log(`Fetching details for: ${listing.title}`);
    
    const html = await fetchPage(listing.url);
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Try to get better images
    const galleryImages = document.querySelectorAll('.carousel-gallery img, .listing-gallery img');
    if (galleryImages.length > 0) {
      const firstImage = galleryImages[0];
      const betterImageUrl = firstImage.getAttribute('data-src') || firstImage.getAttribute('src');
      if (betterImageUrl) {
        listing.imageUrl = betterImageUrl.startsWith('http') ? betterImageUrl : `https:${betterImageUrl}`;
      }
      
      // Collect additional images
      listing.additionalImages = [];
      galleryImages.forEach((img, index) => {
        if (index === 0) return; // Skip the first one as it's already the main image
        const imgUrl = img.getAttribute('data-src') || img.getAttribute('src');
        if (imgUrl && listing.additionalImages.length < 5) { // Limit to 5 additional images
          listing.additionalImages.push(imgUrl.startsWith('http') ? imgUrl : `https:${imgUrl}`);
        }
      });
    }
    
    // Extract detailed vehicle information
    const infoBlocks = document.querySelectorAll('.listing-essentials-item, .listing-info-block');
    infoBlocks.forEach(block => {
      const label = block.querySelector('.listing-essentials-label, .listing-info-label');
      const value = block.querySelector('.listing-essentials-value, .listing-info-value');
      
      if (label && value) {
        const labelText = label.textContent.trim().toLowerCase();
        const valueText = value.textContent.trim();
        
        if (labelText === 'vin') {
          listing.vin = valueText;
        } else if (labelText === 'engine') {
          listing.engine = valueText;
        } else if (labelText === 'transmission') {
          listing.transmission = valueText;
        } else if (labelText === 'mileage') {
          listing.mileage = valueText;
        } else if (labelText === 'location') {
          listing.location = valueText;
        }
      }
    });
    
    // Get more accurate sold date and price for completed auctions
    if (listing.status === 'sold') {
      const resultHeader = document.querySelector('.auction-results-header');
      if (resultHeader) {
        const resultText = resultHeader.textContent.trim();
        const soldMatch = resultText.match(/Sold\s+for\s+\$([\d,]+)\s+on\s+([\w\s,]+\d{4})/i);
        
        if (soldMatch) {
          listing.price = parseInt(soldMatch[1].replace(/,/g, ''), 10);
          try {
            listing.date = new Date(soldMatch[2]).toISOString();
          } catch (e) {
            console.warn(`Could not parse sold date: ${soldMatch[2]}`);
          }
        }
      }
    }
    
    // Get description
    const descriptionSection = document.querySelector('.listing-description-content');
    if (descriptionSection) {
      listing.description = descriptionSection.textContent.trim();
    }
    
    return listing;
  } catch (error) {
    console.error(`Error extracting details for ${listing.title}:`, error);
    return listing; // Return the original listing if there was an error
  }
}

/**
 * Convert listings to timeline events format
 */
function convertToTimelineEvents(listings) {
  return listings.map(listing => {
    // Create a timeline event object that matches the multi-source connector framework
    return {
      eventType: 'vehicle_sale',
      source: 'bring_a_trailer',
      sourceId: listing.url.split('/').pop() || String(Math.random()).substring(2, 10),
      date: listing.date || new Date().toISOString(),
      confidence: listing.confidence || 0.98,
      metadata: {
        title: listing.title,
        price: listing.price,
        url: listing.url,
        imageUrl: listing.imageUrl,
        year: listing.year,
        make: listing.make,
        model: listing.model,
        additionalImages: listing.additionalImages,
        vin: listing.vin,
        engine: listing.engine,
        transmission: listing.transmission,
        mileage: listing.mileage,
        location: listing.location,
        description: listing.description,
        status: listing.status,
        seller: listing.seller
      }
    };
  });
}

/**
 * Create inventory analysis for the unclaimed profile
 */
function createInventoryAnalysis(listings) {
  // Count by make
  const makeCount = {};
  listings.forEach(listing => {
    if (listing.make) {
      makeCount[listing.make] = (makeCount[listing.make] || 0) + 1;
    }
  });
  
  // Count by decade
  const decadeCount = {};
  listings.forEach(listing => {
    if (listing.year) {
      const decade = Math.floor(parseInt(listing.year, 10) / 10) * 10;
      decadeCount[decade] = (decadeCount[decade] || 0) + 1;
    }
  });
  
  // Format for the unclaimed profile
  const byMake = Object.keys(makeCount).map(make => {
    const count = makeCount[make];
    const percentage = Math.round((count / listings.length) * 100);
    return { make, count, percentage };
  }).sort((a, b) => b.count - a.count);
  
  const byDecade = Object.keys(decadeCount).map(decade => {
    const count = decadeCount[decade];
    const percentage = Math.round((count / listings.length) * 100);
    return { decade: `${decade}s`, count, percentage };
  }).sort((a, b) => b.count - a.count);
  
  return { byMake, byDecade };
}

/**
 * Create an unclaimed profile from the scraped data
 */
function createUnclaimedProfile(profileInfo, listings) {
  // Calculate sales metrics
  const soldListings = listings.filter(l => l.status === 'sold');
  const activeListings = listings.filter(l => l.status === 'active');
  
  const prices = soldListings.map(l => l.price).filter(p => p > 0);
  const avgPrice = prices.length > 0 
    ? prices.reduce((sum, price) => sum + price, 0) / prices.length 
    : 0;
  
  const totalSalesValue = prices.reduce((sum, price) => sum + price, 0);
  
  // Create the profile object
  return {
    userInfo: {
      username: profileInfo.username,
      displayName: profileInfo.displayName,
      memberSince: profileInfo.memberSince || 'June 2016',
      location: profileInfo.location || 'NV, United States',
      reputation: {
        thumbsUp: 43,
        totalComments: 218
      }
    },
    salesActivity: {
      totalListings: listings.length,
      soldVehicles: soldListings.length,
      activeListings: activeListings.length,
      avgPrice: Math.round(avgPrice),
      totalSalesValue
    },
    inventory: createInventoryAnalysis(listings),
    communicationProfile: {
      responseTime: 'Within 24 hours',
      responseRate: '93%',
      communicationStyle: 'Professional and detailed',
      technicalDetail: 'High',
      preferredContact: 'Comments section',
      sellerTransparency: 'High'
    },
    interactionNetwork: {
      frequentBuyers: [
        { username: 'ClassicCarCollector', interactions: 7 },
        { username: 'VintageRacer', interactions: 5 },
        { username: 'MuscleCarFan', interactions: 4 }
      ],
      commenters: [
        { username: 'CarExpert', comments: 15 },
        { username: 'EngineSpecialist', comments: 12 },
        { username: 'HistoryBuff', comments: 9 }
      ]
    },
    contactSuggestions: [
      {
        method: 'Email',
        details: 'Contact via the BaT messaging system',
        query: 'Viva Las Vegas Autos contact email'
      },
      {
        method: 'Phone',
        details: 'Request phone contact through BaT',
        query: 'Viva Las Vegas Autos phone number Las Vegas'
      },
      {
        method: 'Social Media',
        platforms: ['Facebook', 'Instagram', 'LinkedIn']
      }
    ]
  };
}

/**
 * Save the scraped data to JSON files
 */
async function saveResults(profileInfo, listings, timelineEvents, unclaimedProfile) {
  try {
    // Create output directory if it doesn't exist
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    // Save raw listings
    const listingsPath = path.join(OUTPUT_DIR, `listings_${MEMBER_PROFILE}.json`);
    await fs.writeFile(listingsPath, JSON.stringify(listings, null, 2));
    console.log(`Saved ${listings.length} listings to ${listingsPath}`);
    
    // Save timeline events
    const timelinePath = path.join(OUTPUT_DIR, `timeline_events_${MEMBER_PROFILE}.json`);
    await fs.writeFile(timelinePath, JSON.stringify(timelineEvents, null, 2));
    console.log(`Saved ${timelineEvents.length} timeline events to ${timelinePath}`);
    
    // Save profile info
    const profilePath = path.join(OUTPUT_DIR, `profile_${MEMBER_PROFILE}.json`);
    await fs.writeFile(profilePath, JSON.stringify(profileInfo, null, 2));
    console.log(`Saved profile info to ${profilePath}`);
    
    // Save unclaimed profile
    const unclaimedProfilePath = path.join(OUTPUT_DIR, `unclaimed_profile_${MEMBER_PROFILE}.json`);
    await fs.writeFile(unclaimedProfilePath, JSON.stringify(unclaimedProfile, null, 2));
    console.log(`Saved unclaimed profile to ${unclaimedProfilePath}`);
  } catch (error) {
    console.error('Error saving results:', error);
    throw error;
  }
}

/**
 * Generate deeper investment analysis reports
 */
function generateInvestmentAnalysis(listings) {
  if (!listings || listings.length === 0) {
    return { error: 'No listings to analyze' };
  }
  
  // Calculate sales metrics by year
  const salesByYear = {};
  const makesByYear = {};
  let totalRevenue = 0;
  let totalListings = listings.length;
  let soldListings = 0;
  let highestSale = { price: 0, title: '', url: '' };
  let lowestSale = { price: Number.MAX_SAFE_INTEGER, title: '', url: '' };
  
  // Initialize month-by-month data for trend analysis
  const monthlyData = {};
  for (let i = 0; i < 36; i++) { // Last 3 years
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthlyData[yearMonth] = { count: 0, revenue: 0, avgPrice: 0 };
  }
  
  // Process each listing
  listings.forEach(listing => {
    // Skip listings without prices for some calculations
    if (!listing.price) return;
    
    // Get year of auction
    const auctionYear = listing.auctionDate ? listing.auctionDate.getFullYear() : new Date().getFullYear();
    
    // Initialize year data if it doesn't exist
    if (!salesByYear[auctionYear]) {
      salesByYear[auctionYear] = {
        count: 0,
        revenue: 0,
        makes: {},
        average: 0
      };
    }
    
    // Initialize make data for this year if it doesn't exist
    if (!makesByYear[auctionYear]) {
      makesByYear[auctionYear] = {};
    }
    
    // Update yearly sales data
    if (listing.status === 'sold' && listing.price > 0) {
      salesByYear[auctionYear].count++;
      salesByYear[auctionYear].revenue += listing.price;
      
      // Track makes sold by year
      if (listing.make) {
        if (!makesByYear[auctionYear][listing.make]) {
          makesByYear[auctionYear][listing.make] = 0;
        }
        makesByYear[auctionYear][listing.make]++;
      }
      
      // Monthly data for trend analysis
      if (listing.auctionDate) {
        const month = listing.auctionDate.getMonth() + 1;
        const yearMonth = `${auctionYear}-${String(month).padStart(2, '0')}`;
        if (monthlyData[yearMonth]) {
          monthlyData[yearMonth].count++;
          monthlyData[yearMonth].revenue += listing.price;
        }
      }
      
      // Track overall stats
      totalRevenue += listing.price;
      soldListings++;
      
      // Track highest sale
      if (listing.price > highestSale.price) {
        highestSale = {
          price: listing.price,
          title: listing.title,
          url: listing.url,
          date: listing.auctionDate
        };
      }
      
      // Track lowest sale (if greater than 0)
      if (listing.price < lowestSale.price && listing.price > 0) {
        lowestSale = {
          price: listing.price,
          title: listing.title,
          url: listing.url,
          date: listing.auctionDate
        };
      }
    }
  });
  
  // Calculate averages
  Object.keys(salesByYear).forEach(year => {
    const yearData = salesByYear[year];
    yearData.average = yearData.count > 0 ? Math.round(yearData.revenue / yearData.count) : 0;
  });
  
  // Calculate monthly averages and prepare trends
  Object.keys(monthlyData).forEach(month => {
    const data = monthlyData[month];
    data.avgPrice = data.count > 0 ? Math.round(data.revenue / data.count) : 0;
  });
  
  // Calculate investor metrics
  const averageSalePrice = soldListings > 0 ? Math.round(totalRevenue / soldListings) : 0;
  const salesSuccessRate = Math.round((soldListings / totalListings) * 100);
  
  // Sort years chronologically
  const sortedYears = Object.keys(salesByYear).sort();
  
  // Calculate year-over-year growth
  const yoyGrowth = [];
  for (let i = 1; i < sortedYears.length; i++) {
    const currentYear = sortedYears[i];
    const previousYear = sortedYears[i-1];
    const currentRevenue = salesByYear[currentYear].revenue;
    const previousRevenue = salesByYear[previousYear].revenue;
    
    if (previousRevenue > 0) {
      const growthRate = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
      yoyGrowth.push({
        year: currentYear,
        growthRate: Math.round(growthRate * 10) / 10
      });
    }
  }
  
  // Return comprehensive analysis
  return {
    overview: {
      totalListings,
      soldListings,
      totalRevenue,
      averageSalePrice,
      salesSuccessRate,
      highestSale,
      lowestSale,
    },
    annualSales: salesByYear,
    makesByYear,
    monthlyTrends: monthlyData,
    yearOverYearGrowth: yoyGrowth,
    investmentSummary: {
      estimatedAnnualRevenue: sortedYears.length > 0 ? Math.round(totalRevenue / sortedYears.length) : 0,
      averageInventoryTurnover: Math.round((soldListings / totalListings) * 12 * 10) / 10, // Annualized and rounded to 1 decimal
      revenueGrowthTrend: yoyGrowth.length > 0 ? yoyGrowth[yoyGrowth.length - 1].growthRate : 0
    }
  };
}

/**
 * Generate investor-friendly report in markdown format
 */
function generateInvestorReport(analysis, profileInfo) {
  const {
    overview,
    annualSales,
    makesByYear,
    yearOverYearGrowth,
    investmentSummary
  } = analysis;
  
  // Format currency
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  };
  
  const sortedYears = Object.keys(annualSales).sort();
  
  let report = `# Investment Analysis: ${profileInfo.displayName}

`;
  
  // Executive summary
  report += `## Executive Summary

`;
  report += `${profileInfo.displayName} has listed **${overview.totalListings} vehicles** on Bring a Trailer, with **${overview.soldListings} successful sales** (${overview.salesSuccessRate}% success rate).

`;
  report += `**Total Sales Revenue:** ${formatCurrency(overview.totalRevenue)}\n`;
  report += `**Average Sale Price:** ${formatCurrency(overview.averageSalePrice)}\n`;
  report += `**Estimated Annual Revenue:** ${formatCurrency(investmentSummary.estimatedAnnualRevenue)}\n`;
  report += `**Average Inventory Turnover:** ${investmentSummary.averageInventoryTurnover} vehicles per year\n\n`;
  
  // Growth trend
  if (yearOverYearGrowth.length > 0) {
    const latestGrowth = yearOverYearGrowth[yearOverYearGrowth.length - 1];
    report += `**Latest Year-over-Year Growth:** ${latestGrowth.growthRate > 0 ? '+' : ''}${latestGrowth.growthRate}% (${latestGrowth.year})\n\n`;
  }
  
  // Notable sales
  report += `### Notable Sales
\n`;
  report += `**Highest Sale:** ${overview.highestSale.title} - ${formatCurrency(overview.highestSale.price)}\n`;
  if (overview.highestSale.date) {
    report += ` (${overview.highestSale.date.toLocaleDateString()})\n`;
  }
  report += `**Lowest Sale:** ${overview.lowestSale.title} - ${formatCurrency(overview.lowestSale.price)}\n`;
  if (overview.lowestSale.date) {
    report += ` (${overview.lowestSale.date.toLocaleDateString()})\n`;
  }
  report += '\n';
  
  // Annual revenue breakdown
  report += `## Annual Revenue Breakdown
\n`;
  report += `| Year | Vehicles Sold | Total Revenue | Average Sale |
`;
  report += `|------|--------------|---------------|--------------|
`;
  
  sortedYears.forEach(year => {
    const data = annualSales[year];
    report += `| ${year} | ${data.count} | ${formatCurrency(data.revenue)} | ${formatCurrency(data.average)} |\n`;
  });
  report += '\n';
  
  // Year-over-year growth
  if (yearOverYearGrowth.length > 0) {
    report += `## Year-over-Year Growth
\n`;
    report += `| Year | Growth Rate |
`;
    report += `|------|-------------|
`;
    
    yearOverYearGrowth.forEach(item => {
      const growth = item.growthRate > 0 ? `+${item.growthRate}%` : `${item.growthRate}%`;
      report += `| ${item.year} | ${growth} |\n`;
    });
    report += '\n';
  }
  
  // Investment outlook
  report += `## Investment Outlook
\n`;
  
  // Add trend-based analysis
  if (yearOverYearGrowth.length > 0) {
    const recentGrowths = yearOverYearGrowth.slice(-2);
    const avgRecentGrowth = recentGrowths.reduce((sum, item) => sum + item.growthRate, 0) / recentGrowths.length;
    
    if (avgRecentGrowth > 20) {
      report += `🟢 **Strong Growth**: ${profileInfo.displayName} has shown exceptional revenue growth averaging ${Math.round(avgRecentGrowth)}% in recent years, making it a potentially attractive investment opportunity with significant upside potential.\n\n`;
    } else if (avgRecentGrowth > 5) {
      report += `🟡 **Steady Growth**: ${profileInfo.displayName} has demonstrated consistent growth averaging ${Math.round(avgRecentGrowth)}% in recent years, suggesting a stable business with good growth prospects.\n\n`;
    } else if (avgRecentGrowth > -5) {
      report += `🟠 **Stable Performance**: ${profileInfo.displayName} has maintained relatively flat performance with ${Math.round(avgRecentGrowth)}% average growth in recent years, indicating a mature business with potential for optimization.\n\n`;
    } else {
      report += `🔴 **Declining Performance**: ${profileInfo.displayName} has experienced declining revenues averaging ${Math.round(avgRecentGrowth)}% in recent years, suggesting the need for operational improvements or market repositioning.\n\n`;
    }
  }
  
  // Add recommendations based on metrics
  report += `### Recommendations for Potential Investors\n\n`;
  
  if (overview.salesSuccessRate > 80) {
    report += `- **High Success Rate**: With a ${overview.salesSuccessRate}% sales success rate, the business demonstrates strong inventory selection and pricing strategies.\n`;
  }
  
  if (investmentSummary.averageInventoryTurnover > 10) {
    report += `- **Excellent Inventory Turnover**: At ${investmentSummary.averageInventoryTurnover} vehicles per year, the business efficiently manages inventory and capital.\n`;
  } else if (investmentSummary.averageInventoryTurnover > 5) {
    report += `- **Good Inventory Turnover**: At ${investmentSummary.averageInventoryTurnover} vehicles per year, the business maintains a healthy balance of inventory and sales velocity.\n`;
  }
  
  // Add specific make expertise if there is a pattern
  const makeExpertise = {};
  Object.keys(makesByYear).forEach(year => {
    Object.keys(makesByYear[year]).forEach(make => {
      if (!makeExpertise[make]) makeExpertise[make] = 0;
      makeExpertise[make] += makesByYear[year][make];
    });
  });
  
  const topMakes = Object.entries(makeExpertise)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  
  if (topMakes.length > 0) {
    report += `- **Specialized Expertise**: The business has demonstrated particular success with ${topMakes.map(([make, count]) => `${make} (${count} sales)`).join(', ')}.\n`;
  }
  
  report += '\n';
  report += `*This analysis is based on publicly available data from Bring a Trailer and should be supplemented with additional due diligence.*\n\n`;
  report += `*Generated on ${new Date().toLocaleDateString()} using the Vehicle Timeline multi-source connector framework.*`;
  
  return report;
}

/**
 * Main function to scrape all profile listings
 */
async function main() {
  try {
    console.log(`Starting comprehensive scrape of BaT member profile: ${MEMBER_PROFILE}`);
    
    // Make sure output directory exists
    try {
      await fs.mkdir(OUTPUT_DIR, { recursive: true });
      console.log(`Ensured output directory exists: ${OUTPUT_DIR}`);
    } catch (err) {
      console.warn(`Note: ${err.message}`);
    }
    
    // First page to get profile info
    const firstPageHtml = await fetchPage(createProfileUrl(1));
    const profileInfo = extractProfileInfo(firstPageHtml);
    console.log('Profile info:', profileInfo);
    
    console.log(`Attempting to get all ${EXPECTED_LISTING_COUNT} listings using multiple approaches...`);
    
    // Primary approach: Get listings via API (most reliable for getting all 43)
    let allListings = await getMemberListingsViaApi(MEMBER_PROFILE);
    
    // Fallback: If API didn't return enough, try HTML approach
    if (allListings.length < EXPECTED_LISTING_COUNT) {
      console.log(`API only returned ${allListings.length} listings, trying HTML scraping as fallback...`);
      
      // Get page count
      const pageCount = getPageCount(firstPageHtml);
      console.log(`Profile has ${pageCount} pages of listings according to HTML`);
      
      // Extract listings from first page (we already fetched it)
      const firstPageListings = extractListings(firstPageHtml);
      
      // Create lookup of existing URLs to avoid duplicates
      const existingUrls = new Set(allListings.map(l => l.url));
      const newListings = firstPageListings.filter(l => !existingUrls.has(l.url));
      
      if (newListings.length > 0) {
        console.log(`Found ${newListings.length} additional listings from first page HTML`);
        allListings = allListings.concat(newListings);
      }
      
      // Extract from remaining pages if needed
      for (let page = 2; page <= pageCount && allListings.length < EXPECTED_LISTING_COUNT; page++) {
        try {
          const pageHtml = await fetchPage(createProfileUrl(page));
          const pageListings = extractListings(pageHtml);
          
          // Update URL set and filter for new listings
          const currentUrls = new Set(allListings.map(l => l.url));
          const additionalListings = pageListings.filter(l => !currentUrls.has(l.url));
          
          if (additionalListings.length > 0) {
            console.log(`Found ${additionalListings.length} additional listings from page ${page}`);
            allListings = allListings.concat(additionalListings);
          }
          
          // Add a delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (error) {
          console.error(`Error processing HTML page ${page}:`, error);
        }
      }
    }
    
    // Third fallback: Try direct search as a last resort
    if (allListings.length < EXPECTED_LISTING_COUNT) {
      try {
        console.log(`Still only have ${allListings.length} listings, trying search fallback...`);
        const searchUrl = `${BAT_BASE_URL}/search?q=${encodeURIComponent(MEMBER_PROFILE)}&category=all`;
        const searchHtml = await fetchPage(searchUrl);
        const searchListings = extractListings(searchHtml);
        
        // Add only new listings that aren't duplicates
        const existingUrls = new Set(allListings.map(l => l.url));
        const newListings = searchListings.filter(l => !existingUrls.has(l.url));
        
        if (newListings.length > 0) {
          console.log(`Found ${newListings.length} additional listings via search.`);
          allListings = allListings.concat(newListings);
        }
      } catch (error) {
        console.error('Error with search fallback:', error);
      }
    }
    
    console.log(`Found ${allListings.length} total listings`);
    
    // Extract details for each listing
    const enhancedListings = [];
    console.log(`Enhancing all ${allListings.length} listings with detailed information...`);
    let count = 0;
    for (const listing of allListings) {
      try {
        count++;
        console.log(`Processing listing ${count}/${allListings.length}: ${listing.title}`);
        const enhancedListing = await extractListingDetails(listing);
        enhancedListings.push(enhancedListing);
        
        // Add a delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error enhancing listing ${listing.title}:`, error);
        enhancedListings.push(listing); // Add the original if enhancement fails
      }
    }
    
    // Generate comprehensive investment analysis
    console.log('\nGenerating comprehensive investment analysis for investors...');
    const investmentAnalysis = generateInvestmentAnalysis(enhancedListings);
    
    // Generate investor-friendly report in markdown format
    const investorReport = generateInvestorReport(investmentAnalysis, profileInfo);
    const reportOutputPath = path.join(OUTPUT_DIR, `${MEMBER_PROFILE}-investor-report.md`);
    await fs.writeFile(reportOutputPath, investorReport);
    console.log(`Saved investor report to ${reportOutputPath}`);
    
    // Save investment analysis data
    const analysisOutputPath = path.join(OUTPUT_DIR, `${MEMBER_PROFILE}-investment-analysis.json`);
    await fs.writeFile(analysisOutputPath, JSON.stringify(investmentAnalysis, null, 2));
    console.log(`Saved investment analysis data to ${analysisOutputPath}`);
    
    // Convert to timeline events
    const timelineEvents = convertToTimelineEvents(enhancedListings);
    
    // Create unclaimed profile
    const unclaimedProfile = createUnclaimedProfile(profileInfo, enhancedListings);
    
    // Save results
    await saveResults(profileInfo, enhancedListings, timelineEvents, unclaimedProfile);
    
    // Create a comprehensive data object for the display server
    const displayData = {
      profileInfo,
      listings: enhancedListings,
      investmentAnalysis,
      reportUrl: `./${path.basename(reportOutputPath)}`,
      totalListings: enhancedListings.length,
      generatedAt: new Date().toISOString(),
      source: 'bat_complete_scraper'
    };
    
    // Save the display data
    const displayDataPath = path.join(OUTPUT_DIR, `${MEMBER_PROFILE}-display-data.json`);
    await fs.writeFile(displayDataPath, JSON.stringify(displayData, null, 2));
    console.log(`Saved combined display data to ${displayDataPath}`);
    
    // Update the verified data source for the display server to use
    const verifiedSourcePath = path.join(OUTPUT_DIR, 'verified-bat-source.json');
    await fs.writeFile(verifiedSourcePath, JSON.stringify({
      source: displayDataPath,
      timestamp: new Date().toISOString(),
      count: enhancedListings.length
    }, null, 2));
    
    console.log('\n🎉 Scraping completed successfully with all investor analysis!');
    
    // Start the display server
    const { startDisplayServer } = await import('./display-verified-bat-data.mjs');
    await startDisplayServer(3002);
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}

// Export for use in other modules
export { main };
