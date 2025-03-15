#!/usr/bin/env node

/**
 * Advanced Bring a Trailer Scraper
 * 
 * A comprehensive data collection tool for BaT that gathers:
 * - Complete vehicle listings (with pagination)
 * - User comments and social interactions
 * - Interaction network and engagement metrics
 * 
 * Integrates with the multi-source connector framework
 */

import nodeFetch from 'node-fetch';
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

// Target user
const TARGET_USER = {
  username: 'vivalasvegasautos',
  displayName: 'VivaLasVegasAutos',
  profileUrl: 'https://bringatrailer.com/member/vivalasvegasautos/',
  userId: '49132' // From the "Show more" button data-user-id attribute
};

/**
 * Fetches HTML content from URL with proper headers
 */
async function fetchPage(url) {
  try {
    console.log(`Fetching page: ${url}`);
    const response = await nodeFetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    
    return await response.text();
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return null;
  }
}

/**
 * Fetches all pages of a user's listings
 */
async function fetchAllListings(userId) {
  const listings = [];
  let page = 1;
  let hasMorePages = true;
  
  console.log(`Fetching all listings for user ID ${userId}...`);
  
  // First, fetch the main profile page
  const profileHtml = await fetchPage(TARGET_USER.profileUrl);
  if (!profileHtml) {
    console.error('Failed to fetch profile page');
    return [];
  }
  
  // Extract listings from first page
  const initialListings = extractListings(profileHtml);
  listings.push(...initialListings);
  console.log(`Found ${initialListings.length} listings on page 1`);
  
  // Fetch additional pages
  while (hasMorePages) {
    page++;
    const pageUrl = `${TARGET_USER.profileUrl}listings/page/${page}/`;
    const pageHtml = await fetchPage(pageUrl);
    
    if (!pageHtml) {
      console.log(`No more pages after page ${page-1}`);
      hasMorePages = false;
      continue;
    }
    
    const pageListings = extractListings(pageHtml);
    if (pageListings.length === 0) {
      console.log(`No more listings after page ${page-1}`);
      hasMorePages = false;
    } else {
      console.log(`Found ${pageListings.length} listings on page ${page}`);
      listings.push(...pageListings);
    }
    
    // Wait briefly to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`Total listings found: ${listings.length}`);
  return listings;
}

/**
 * Extract listings from HTML content
 */
function extractListings(html) {
  if (!html) return [];
  
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  const listingElements = document.querySelectorAll('.listing-card');
  const listings = [];
  
  listingElements.forEach(element => {
    try {
      // Extract listing data
      const titleElement = element.querySelector('.post-title a');
      if (!titleElement) return;
      
      const title = titleElement.textContent.trim();
      const url = titleElement.href;
      const listingIdMatch = url.match(/\/listing\/([^\/]+)\/?$/);
      const listingId = listingIdMatch ? listingIdMatch[1] : null;
      
      // Extract image
      const imageElement = element.querySelector('.listing-card-image');
      const imageUrl = imageElement ? 
        (imageElement.style.backgroundImage || '').replace(/url\(['"]?(.*?)['"]?\)/i, '$1') : 
        null;
      
      // Extract price/status
      const priceElement = element.querySelector('.stat-value');
      const statusElement = element.querySelector('.listing-status');
      let price = null;
      let status = 'unknown';
      
      if (priceElement) {
        const priceText = priceElement.textContent.trim();
        if (priceText.includes('Bid to')) {
          status = 'active';
          price = parseInt(priceText.replace(/[^0-9]/g, ''), 10);
        } else if (priceText.includes('Sold for')) {
          status = 'sold';
          price = parseInt(priceText.replace(/[^0-9]/g, ''), 10);
        } else if (priceText.includes('Reserve Not Met')) {
          status = 'reserve_not_met';
        }
      }
      
      // Extract date
      const dateElement = element.querySelector('.listing-date');
      const dateText = dateElement ? dateElement.textContent.trim() : '';
      const dateMatch = dateText.match(/on\s+(\d+\/\d+\/\d+)/);
      const dateString = dateMatch ? dateMatch[1] : null;
      
      // Parse vehicle info from title
      const yearMatch = title.match(/^(\d{4})/);
      let year = null;
      let make = null;
      let model = null;
      
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
        const remainingTitle = title.substring(yearMatch[0].length).trim();
        const makeModelParts = remainingTitle.split(' ');
        
        if (makeModelParts.length > 0) {
          make = makeModelParts[0];
          model = makeModelParts.slice(1).join(' ');
        }
      }
      
      listings.push({
        listingId,
        title,
        url: url.startsWith('http') ? url : `${BAT_BASE_URL}${url}`,
        imageUrl: imageUrl && imageUrl.startsWith('http') ? imageUrl : (imageUrl ? `${BAT_BASE_URL}${imageUrl}` : null),
        status,
        price,
        dateString,
        year,
        make,
        model,
        seller: TARGET_USER.displayName,
        sellerUsername: TARGET_USER.username
      });
    } catch (error) {
      console.error('Error extracting listing:', error);
    }
  });
  
  return listings;
}

/**
 * Fetch all comments for a user
 */
async function fetchAllComments(userId) {
  let comments = [];
  let page = 1;
  let hasMorePages = true;
  
  console.log(`Fetching all comments for user ID ${userId}...`);
  
  // First, fetch the main comments page
  const commentsUrl = `${TARGET_USER.profileUrl}comments/`;
  const commentsHtml = await fetchPage(commentsUrl);
  if (!commentsHtml) {
    console.error('Failed to fetch comments page');
    return [];
  }
  
  // Extract comments from first page
  const initialComments = extractComments(commentsHtml);
  comments.push(...initialComments);
  console.log(`Found ${initialComments.length} comments on page 1`);
  
  // Fetch additional pages
  while (hasMorePages) {
    page++;
    const pageUrl = `${TARGET_USER.profileUrl}comments/page/${page}/`;
    const pageHtml = await fetchPage(pageUrl);
    
    if (!pageHtml) {
      console.log(`No more comment pages after page ${page-1}`);
      hasMorePages = false;
      continue;
    }
    
    const pageComments = extractComments(pageHtml);
    if (pageComments.length === 0) {
      console.log(`No more comments after page ${page-1}`);
      hasMorePages = false;
    } else {
      console.log(`Found ${pageComments.length} comments on page ${page}`);
      comments.push(...pageComments);
    }
    
    // Wait briefly to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`Total comments found: ${comments.length}`);
  return comments;
}

/**
 * Extract comments from HTML content
 */
function extractComments(html) {
  if (!html) return [];
  
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  const commentElements = document.querySelectorAll('.comment-container');
  const comments = [];
  
  commentElements.forEach(element => {
    try {
      // Extract comment data
      const contentElement = element.querySelector('.comment-content');
      if (!contentElement) return;
      
      const content = contentElement.textContent.trim();
      
      // Extract listing info
      const listingElement = element.querySelector('.comment-listing a');
      const listingTitle = listingElement ? listingElement.textContent.trim() : null;
      const listingUrl = listingElement ? listingElement.href : null;
      
      // Extract timestamp
      const timeElement = element.querySelector('.comment-time');
      const timestamp = timeElement ? timeElement.textContent.trim() : null;
      
      // Extract interactions
      const likesElement = element.querySelector('.comment-likes');
      const likes = likesElement ? parseInt(likesElement.textContent.trim().replace(/[^0-9]/g, '') || '0', 10) : 0;
      
      // Extract comment ID
      const commentIdAttr = element.getAttribute('id');
      const commentId = commentIdAttr ? commentIdAttr.replace('comment-', '') : null;
      
      // Extract replies and mentions
      const mentions = [];
      const mentionElements = contentElement.querySelectorAll('.mention');
      mentionElements.forEach(mention => {
        const username = mention.textContent.trim().replace('@', '');
        mentions.push(username);
      });
      
      comments.push({
        commentId,
        content,
        timestamp,
        likes,
        listingTitle,
        listingUrl: listingUrl && listingUrl.startsWith('http') ? listingUrl : (listingUrl ? `${BAT_BASE_URL}${listingUrl}` : null),
        author: TARGET_USER.displayName,
        authorUsername: TARGET_USER.username,
        mentions
      });
    } catch (error) {
      console.error('Error extracting comment:', error);
    }
  });
  
  return comments;
}

/**
 * Analyze comment sentiment and communication style
 */
function analyzeComments(comments) {
  if (comments.length === 0) {
    return {
      totalComments: 0,
      avgLength: 0,
      sentiment: 'unknown',
      formality: 'unknown',
      topInteractions: []
    };
  }
  
  // Basic metrics
  const totalComments = comments.length;
  const totalLength = comments.reduce((sum, comment) => sum + comment.content.length, 0);
  const avgLength = totalLength / totalComments;
  
  // Track interactions
  const interactions = {};
  comments.forEach(comment => {
    comment.mentions.forEach(username => {
      interactions[username] = (interactions[username] || 0) + 1;
    });
  });
  
  // Sort interactions by frequency
  const topInteractions = Object.entries(interactions)
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  
  // Simple sentiment analysis based on keywords
  const positiveWords = ['great', 'nice', 'beautiful', 'excellent', 'good', 'love', 'perfect', 'thanks', 'appreciate'];
  const negativeWords = ['issue', 'problem', 'bad', 'wrong', 'mistake', 'disappointed', 'unfortunately', 'sorry'];
  
  let positiveScore = 0;
  let negativeScore = 0;
  
  comments.forEach(comment => {
    const lowerContent = comment.content.toLowerCase();
    positiveWords.forEach(word => {
      if (lowerContent.includes(word)) positiveScore++;
    });
    
    negativeWords.forEach(word => {
      if (lowerContent.includes(word)) negativeScore++;
    });
  });
  
  const sentimentRatio = positiveScore / (positiveScore + negativeScore + 0.1);
  let sentiment = 'neutral';
  if (sentimentRatio > 0.7) sentiment = 'very positive';
  else if (sentimentRatio > 0.6) sentiment = 'positive';
  else if (sentimentRatio < 0.3) sentiment = 'negative';
  else if (sentimentRatio < 0.4) sentiment = 'somewhat negative';
  
  // Analyze formality
  const formalIndicators = ['would', 'could', 'should', 'thank you', 'appreciate', 'regards', 'sincerely'];
  const informalIndicators = ['hey', 'yeah', 'cool', 'awesome', 'btw', 'lol', '!', '!!', '!!!'];
  
  let formalScore = 0;
  let informalScore = 0;
  
  comments.forEach(comment => {
    const lowerContent = comment.content.toLowerCase();
    formalIndicators.forEach(word => {
      if (lowerContent.includes(word)) formalScore++;
    });
    
    informalIndicators.forEach(word => {
      if (lowerContent.includes(word)) informalScore++;
    });
  });
  
  const formalityRatio = formalScore / (formalScore + informalScore + 0.1);
  let formality = 'neutral';
  if (formalityRatio > 0.7) formality = 'very formal';
  else if (formalityRatio > 0.6) formality = 'formal';
  else if (formalityRatio < 0.3) formality = 'informal';
  else if (formalityRatio < 0.4) formality = 'very informal';
  
  return {
    totalComments,
    avgLength,
    sentiment,
    formality,
    interactionStats: {
      uniqueInteractions: Object.keys(interactions).length,
      totalMentions: Object.values(interactions).reduce((sum, count) => sum + count, 0),
      topInteractions
    },
    sentimentMetrics: {
      positiveScore,
      negativeScore,
      sentimentRatio
    }
  };
}

/**
 * Build user interaction network
 */
function buildInteractionNetwork(comments) {
  const network = {
    nodes: {},
    edges: []
  };
  
  // Add central node for our target user
  network.nodes[TARGET_USER.username] = {
    id: TARGET_USER.username,
    label: TARGET_USER.displayName,
    type: 'seller',
    connections: 0
  };
  
  // Process all comments to build the network
  comments.forEach(comment => {
    // Process mentions in comments
    comment.mentions.forEach(username => {
      // Add node if it doesn't exist
      if (!network.nodes[username]) {
        network.nodes[username] = {
          id: username,
          label: username,
          type: 'user',
          connections: 0
        };
      }
      
      // Check if edge already exists
      const existingEdge = network.edges.find(edge => 
        (edge.from === TARGET_USER.username && edge.to === username) ||
        (edge.from === username && edge.to === TARGET_USER.username)
      );
      
      if (existingEdge) {
        existingEdge.weight += 1;
      } else {
        network.edges.push({
          from: TARGET_USER.username,
          to: username,
          weight: 1
        });
      }
      
      // Increment connection count
      network.nodes[TARGET_USER.username].connections += 1;
      network.nodes[username].connections += 1;
    });
  });
  
  return {
    nodes: Object.values(network.nodes),
    edges: network.edges
  };
}

/**
 * Create an unclaimed profile data structure
 */
function createUnclaimedProfile(listings, comments, analysis) {
  // Build a comprehensive profile
  const soldVehicles = listings.filter(listing => listing.status === 'sold');
  const totalSold = soldVehicles.length;
  const totalValue = soldVehicles.reduce((sum, listing) => sum + (listing.price || 0), 0);
  
  // Segment listings by make and year
  const byMake = {};
  const byDecade = {};
  
  listings.forEach(listing => {
    if (listing.make) {
      byMake[listing.make] = byMake[listing.make] || [];
      byMake[listing.make].push(listing);
    }
    
    if (listing.year) {
      const decade = Math.floor(listing.year / 10) * 10;
      byDecade[decade] = byDecade[decade] || [];
      byDecade[decade].push(listing);
    }
  });
  
  // Build contact suggestion
  const contactSuggestion = {
    methods: [
      {
        type: 'bat_message',
        details: 'Send a direct message on Bring a Trailer platform'
      },
      {
        type: 'dealer_lookup',
        details: 'The name suggests they may be a car dealership in Las Vegas. Search business records in Nevada.'
      }
    ],
    searchQueries: [
      'Viva Las Vegas Autos dealer Nevada',
      'Viva Las Vegas Auto Sales',
      'Las Vegas classic car dealer'
    ]
  };
  
  return {
    profileId: `bat_${TARGET_USER.username}`,
    source: 'bat',
    status: 'unclaimed',
    userInfo: {
      username: TARGET_USER.username,
      displayName: TARGET_USER.displayName,
      profileUrl: TARGET_USER.profileUrl,
      memberSince: 'June 2016', // From profile page
      location: 'NV, United States', // From profile page
      lastUpdated: new Date().toISOString()
    },
    salesActivity: {
      totalListings: listings.length,
      soldVehicles: totalSold,
      activeListings: listings.filter(listing => listing.status === 'active').length,
      totalSalesValue: totalValue,
      avgPrice: totalSold > 0 ? totalValue / totalSold : 0,
      mostRecentListing: listings.length > 0 ? listings[0] : null
    },
    inventory: {
      byMake: Object.entries(byMake).map(([make, items]) => ({
        make,
        count: items.length,
        percentage: Math.round(items.length / listings.length * 100)
      })),
      byDecade: Object.entries(byDecade).map(([decade, items]) => ({
        decade: `${decade}s`,
        count: items.length,
        percentage: Math.round(items.length / listings.length * 100)
      }))
    },
    communicationProfile: analysis,
    contactSuggestion,
    followers: {
      shouldNotify: true,
      potentialFollowers: analysis.interactionStats.topInteractions.map(i => i.username)
    }
  };
}

/**
 * Save data to file for caching/reference
 */
async function saveToFile(data, filename) {
  try {
    // Create output directory if it doesn't exist
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    const filePath = path.join(OUTPUT_DIR, filename);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    
    console.log(`Data saved to ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    console.error(`Error saving to file:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log('🔍 Advanced BaT Data Collection');
  console.log(`Target: ${TARGET_USER.displayName} (${TARGET_USER.username})`);
  console.log('--------------------------------------');
  
  try {
    // Step 1: Fetch all listings (with pagination)
    console.log('\n📋 Fetching all vehicle listings...');
    const listings = await fetchAllListings(TARGET_USER.userId);
    
    if (listings.length === 0) {
      console.error('No listings found. Exiting.');
      return;
    }
    
    await saveToFile(listings, `bat_${TARGET_USER.username}_listings.json`);
    
    // Step 2: Fetch all comments
    console.log('\n💬 Fetching user comments...');
    const comments = await fetchAllComments(TARGET_USER.userId);
    await saveToFile(comments, `bat_${TARGET_USER.username}_comments.json`);
    
    // Step 3: Analyze communication style
    console.log('\n🧠 Analyzing communication style...');
    const commentAnalysis = analyzeComments(comments);
    await saveToFile(commentAnalysis, `bat_${TARGET_USER.username}_comment_analysis.json`);
    
    // Step 4: Build interaction network
    console.log('\n🕸️ Building user interaction network...');
    const network = buildInteractionNetwork(comments);
    await saveToFile(network, `bat_${TARGET_USER.username}_network.json`);
    
    // Step 5: Create unclaimed profile
    console.log('\n👤 Creating unclaimed profile...');
    const profile = createUnclaimedProfile(listings, comments, commentAnalysis);
    await saveToFile(profile, `bat_${TARGET_USER.username}_profile.json`);
    
    // Output summary
    console.log('\n📊 Collection Summary:');
    console.log(`Total listings found: ${listings.length}`);
    console.log(`Total comments analyzed: ${comments.length}`);
    console.log(`User interaction network: ${network.nodes.length} nodes, ${network.edges.length} connections`);
    
    console.log('\n👥 Communication Profile:');
    console.log(`Style: ${commentAnalysis.formality}`);
    console.log(`Sentiment: ${commentAnalysis.sentiment}`);
    console.log(`Average comment length: ${Math.round(commentAnalysis.avgLength)} characters`);
    
    console.log('\n🔔 Notification Recipients:');
    console.log('Top users to notify of new listings:');
    commentAnalysis.interactionStats.topInteractions.slice(0, 5).forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.username} (${user.count} interactions)`);
    });
    
    console.log('\n✅ Data collection complete!');
    console.log(`All data saved to ${OUTPUT_DIR}`);
    
  } catch (error) {
    console.error('Error in main execution:', error);
  }
}

// Run the main function
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
