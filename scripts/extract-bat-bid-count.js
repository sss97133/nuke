#!/usr/bin/env node
/**
 * Extract bid count from BaT listing
 */

const batUrl = process.argv[2] || 'https://bringatrailer.com/listing/1964-jaguar-xke-series-1-roadster-5/';

async function extractBidCount() {
  console.log(`🔍 Fetching: ${batUrl}\n`);
  
  const response = await fetch(batUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
  });

  const html = await response.text();

  // Method 1: Look for explicit "X bids" text
  const explicitBids = html.match(/(\d+)\s+bids?\s*(?:placed|total|so far)?/i);
  if (explicitBids) {
    console.log(`✅ Found explicit bid count: ${explicitBids[1]}`);
    return parseInt(explicitBids[1]);
  }

  // Method 2: Count bid entries in comments section
  // BaT shows each bid as a comment entry
  const commentMatches = html.match(/<article[^>]*class=[^>]*comment[^>]*>/gi);
  if (commentMatches) {
    // Filter for actual bid comments (not regular comments)
    // Bids usually have specific classes or data attributes
    let bidCount = 0;
    for (const comment of commentMatches) {
      // Check if this comment contains bid-related data
      const commentIndex = html.indexOf(comment);
      const commentSection = html.substring(commentIndex, commentIndex + 2000);
      
      // Look for bid indicators: USD $, bid amount, bid button
      if (commentSection.match(/USD\s*\$[\d,]+|Place Bid|bid\s*amount/i)) {
        bidCount++;
      }
    }
    if (bidCount > 0) {
      console.log(`✅ Counted bid entries in comments: ${bidCount}`);
      return bidCount;
    }
  }

  // Method 3: Look for bid history or bid list
  const bidHistory = html.match(/bid[^>]*history[^>]*>[\s\S]{0,2000}/i);
  if (bidHistory) {
    const bidEntries = bidHistory[0].match(/USD\s*\$[\d,]+/gi);
    if (bidEntries) {
      console.log(`✅ Found bid history entries: ${bidEntries.length}`);
      return bidEntries.length;
    }
  }

  // Method 4: Count unique bid amounts (each unique amount = one bid)
  const allBidAmounts = [...html.matchAll(/USD\s*\$([\d,]+)/gi)];
  const uniqueBids = new Set(allBidAmounts.map(m => m[1].replace(/,/g, '')));
  
  // Filter out the current bid (it appears multiple times)
  const currentBidMatch = html.match(/Current Bid[^>]*>.*?USD\s*\$([\d,]+)/i);
  if (currentBidMatch) {
    const currentBid = currentBidMatch[1].replace(/,/g, '');
    uniqueBids.delete(currentBid);
    uniqueBids.add(currentBid); // Add it back as one bid
  }
  
  if (uniqueBids.size > 0) {
    console.log(`✅ Counted unique bid amounts: ${uniqueBids.size}`);
    return uniqueBids.size;
  }

  // Method 5: Look for data attributes or JSON data
  const jsonData = html.match(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (jsonData) {
    try {
      const data = JSON.parse(jsonData[1]);
      if (data.bidCount || data.bids || data.bid_count) {
        const count = data.bidCount || data.bids?.length || data.bid_count;
        console.log(`✅ Found in JSON data: ${count}`);
        return parseInt(count);
      }
    } catch (e) {
      // Not valid JSON
    }
  }

  // Method 6: Look for specific BaT bid count element
  const bidCountElement = html.match(/<[^>]*class=[^>]*bid[^>]*count[^>]*>[\s\S]*?(\d+)[\s\S]*?<\/[^>]*>/i);
  if (bidCountElement) {
    console.log(`✅ Found in bid count element: ${bidCountElement[1]}`);
    return parseInt(bidCountElement[1]);
  }

  console.log('❌ Could not determine bid count');
  return null;
}

extractBidCount()
  .then(count => {
    if (count !== null) {
      console.log(`\n📊 Bid Count: ${count}`);
      process.exit(0);
    } else {
      console.log('\n⚠️  Could not extract bid count');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });

