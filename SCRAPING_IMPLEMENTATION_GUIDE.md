# Smart Scraping Implementation Guide - Week by Week

**Goal:** Build the most accurate vehicle pricing system by scraping public data + AI image analysis  
**Timeline:** 4 weeks to revolutionary pricing  
**Philosophy:** Public data + smart analysis > expensive legacy APIs

## 🎯 **Week 1: Enhance BAT Scraper (You Already Have Foundation)**

### **Current BAT Scraper Enhancement**
Your existing scraper is good - let's make it comprehensive:

```typescript
// Enhanced BAT scraper - add to existing scrape-vehicle function
const enhancedBATScraper = {
  // Add these fields to your existing extraction:
  
  // Pricing signals
  hammer_price: extractHammerPrice(bodyText),      // "Sold for $28,500"
  reserve_met: extractReserveMet(bodyText),        // "Reserve met" vs "No reserve"
  bid_count: extractBidCount(bodyText),            // Number of bids = interest
  starting_bid: extractStartingBid(bodyText),      // Opening bid
  
  // Market signals  
  days_listed: extractDaysListed(bodyText),        // Time to sell
  view_count: extractViewCount(bodyText),          // Interest level
  seller_type: extractSellerType(bodyText),        // Dealer vs private vs estate
  
  // Condition signals
  condition_keywords: extractConditionKeywords(bodyText), // "restored", "original", "rust-free"
  modification_list: extractModifications(bodyText),      // Parsed mod list
  documentation_level: assessDocumentation(images.length), // Photo count = doc quality
  
  // Rarity signals
  production_numbers: extractProductionNumbers(bodyText), // "1 of 500 made"
  factory_options: extractFactoryOptions(bodyText),       // Rare options mentioned
  provenance: extractProvenance(bodyText)                 // Celebrity owned, etc.
};

// Add these extraction functions:
function extractHammerPrice(text: string): number | null {
  const patterns = [
    /Sold\s+for\s+\$?([\d,]+)/i,
    /Hammer\s+price[:\s]+\$?([\d,]+)/i,
    /Final\s+bid[:\s]+\$?([\d,]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''));
    }
  }
  return null;
}

function extractReserveMet(text: string): boolean | null {
  if (text.includes('Reserve met')) return true;
  if (text.includes('No reserve')) return true; // No reserve = always met
  if (text.includes('Reserve not met')) return false;
  return null;
}

function extractConditionKeywords(text: string): string[] {
  const keywords = [
    'restored', 'original', 'rust-free', 'numbers-matching', 'frame-off',
    'concours', 'show-quality', 'driver-quality', 'project', 'barn-find',
    'documented', 'matching-numbers', 'fresh-paint', 'rebuilt-engine'
  ];
  
  return keywords.filter(keyword => 
    text.toLowerCase().includes(keyword.replace('-', ' ')) ||
    text.toLowerCase().includes(keyword)
  );
}
```

### **Deploy Enhanced BAT Scraper**
```bash
# Update your existing scrape-vehicle function
cd /workspace/supabase/functions/scrape-vehicle
# Add the enhanced extraction functions above
supabase functions deploy scrape-vehicle
```

## 🎯 **Week 2: Add Hemmings Scraper**

### **Create Hemmings Scraper Function**
```typescript
// New file: /workspace/supabase/functions/scrape-hemmings/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'

serve(async (req) => {
  const { make, model, year } = await req.json();
  
  // Hemmings search URL pattern
  const searchUrl = `https://www.hemmings.com/classifieds/cars-for-sale/${make.toLowerCase()}/${model.toLowerCase()}?year_min=${year-2}&year_max=${year+2}`;
  
  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml'
    }
  });
  
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  const listings = scrapeHemmingsListings(doc);
  
  return new Response(JSON.stringify({
    success: true,
    source: 'Hemmings',
    listings,
    market_analysis: analyzeHemmingsMarket(listings)
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});

function scrapeHemmingsListings(doc: any): any[] {
  const listings: any[] = [];
  
  // Hemmings uses .listing-item class
  const listingElements = doc.querySelectorAll('.listing-item, .vehicle-listing');
  
  listingElements.forEach((listing: any) => {
    const data = {
      title: extractText(listing, 'h3, .listing-title'),
      price: extractPrice(listing, '.price, .listing-price'),
      mileage: extractMileage(listing, '.mileage, .odometer'),
      location: extractText(listing, '.location, .seller-location'),
      condition: extractCondition(listing),
      seller_type: extractSellerType(listing),
      days_listed: extractDaysListed(listing),
      images: extractImages(listing),
      description: extractText(listing, '.description, .listing-description')
    };
    
    if (data.price && data.price > 1000) {
      listings.push(data);
    }
  });
  
  return listings;
}

function analyzeHemmingsMarket(listings: any[]) {
  if (listings.length === 0) return null;
  
  const prices = listings.map(l => l.price).filter(p => p > 0);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const medianPrice = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];
  
  return {
    listing_count: listings.length,
    price_range: {
      low: Math.min(...prices),
      average: Math.round(avgPrice),
      median: Math.round(medianPrice),
      high: Math.max(...prices)
    },
    market_activity: listings.length > 10 ? 'high' : listings.length > 5 ? 'medium' : 'low',
    avg_days_listed: calculateAvgDaysListed(listings)
  };
}
```

## 🎯 **Week 3: Add Mecum Auction Scraper**

### **Mecum Results Scraper**
```typescript
// New file: /workspace/supabase/functions/scrape-mecum/index.ts
const scrapeMecumResults = async (searchParams: any) => {
  // Mecum has public results pages
  const resultsUrl = `https://www.mecum.com/lots/search-results/?year=${searchParams.year}&make=${searchParams.make}&model=${searchParams.model}`;
  
  const response = await fetch(resultsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AuctionBot/1.0)',
    }
  });
  
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  const auctionResults = [];
  const resultElements = doc.querySelectorAll('.lot-tile, .auction-result');
  
  resultElements.forEach((result: any) => {
    const data = {
      lot_number: extractText(result, '.lot-number'),
      hammer_price: extractHammerPrice(result),
      estimate_low: extractEstimate(result, 'low'),
      estimate_high: extractEstimate(result, 'high'),
      auction_date: extractAuctionDate(result),
      condition_grade: extractConditionGrade(result),
      mileage: extractMileage(result, '.mileage'),
      reserve_met: extractReserveMet(result),
      images: extractImages(result)
    };
    
    if (data.hammer_price && data.hammer_price > 0) {
      auctionResults.push(data);
    }
  });
  
  return {
    source: 'Mecum Auctions',
    results: auctionResults,
    market_trend: analyzeMecumTrend(auctionResults)
  };
};
```

## 🎯 **Week 4: Smart Pricing Algorithm**

### **Combine All Data Sources**
```typescript
// New file: /workspace/supabase/functions/calculate-smart-price/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  const { vehicle_id } = await req.json();
  
  // 1. Get vehicle data and images
  const vehicle = await getVehicleData(vehicle_id);
  
  // 2. Scrape market data from all sources
  const marketData = await Promise.all([
    scrapeBATData(vehicle),      // Your existing scraper
    scrapeHemmingsData(vehicle), // New scraper
    scrapeMecumData(vehicle),    // New scraper
    scrapeLocalListings(vehicle) // Craigslist, etc.
  ]);
  
  // 3. Analyze images with AI
  const imageAnalysis = await analyzeImagesForPricing(vehicle.images);
  
  // 4. Get user input/community data
  const userInput = await getUserPriceOpinions(vehicle_id);
  
  // 5. Calculate smart price
  const smartPrice = calculateRevolutionaryPrice({
    vehicle,
    marketData: marketData.flat(),
    imageAnalysis,
    userInput
  });
  
  return new Response(JSON.stringify(smartPrice), {
    headers: { 'Content-Type': 'application/json' }
  });
});

function calculateRevolutionaryPrice(data: any) {
  const { vehicle, marketData, imageAnalysis, userInput } = data;
  
  // Base price from market data
  const soldPrices = marketData
    .filter(d => d.hammer_price || d.sale_price)
    .map(d => d.hammer_price || d.sale_price);
  
  const listingPrices = marketData
    .filter(d => d.asking_price && !d.hammer_price)
    .map(d => d.asking_price);
  
  // Sold prices are more reliable than asking prices
  const basePrice = soldPrices.length > 0 
    ? calculateWeightedAverage(soldPrices, 1.0)
    : calculateWeightedAverage(listingPrices, 0.8); // Discount asking prices
  
  // Condition adjustments from AI
  const conditionMultiplier = calculateConditionMultiplier(imageAnalysis.condition);
  
  // Modification adjustments
  const modificationAdjustment = calculateModificationValue(imageAnalysis.modifications);
  
  // Rarity multiplier
  const rarityMultiplier = calculateRarityMultiplier(imageAnalysis.rarity);
  
  // User input weighting (Wikipedia model)
  const userWeighting = calculateUserWeighting(userInput);
  
  // Final calculation
  const adjustedPrice = (basePrice * conditionMultiplier) + modificationAdjustment;
  const finalPrice = adjustedPrice * rarityMultiplier * userWeighting;
  
  return {
    estimated_value: Math.round(finalPrice),
    confidence: calculateConfidence(marketData, imageAnalysis, userInput),
    breakdown: {
      market_base: Math.round(basePrice),
      condition_multiplier: conditionMultiplier,
      modification_adjustment: Math.round(modificationAdjustment),
      rarity_multiplier: rarityMultiplier,
      user_weighting: userWeighting
    },
    data_sources: [
      `${soldPrices.length} sold vehicles`,
      `${listingPrices.length} active listings`,
      `${imageAnalysis.image_count} images analyzed`,
      `${userInput.length} user opinions`
    ],
    comparable_sales: marketData.filter(d => d.hammer_price).slice(0, 5),
    market_trend: calculateMarketTrend(marketData),
    last_updated: new Date().toISOString()
  };
}
```

## 🛠️ **Enhanced Image Analysis for Pricing**

### **Condition Assessment AI**
```typescript
// Add to your existing image analysis
async function analyzeImagesForPricing(images: string[]) {
  const analyses = await Promise.all(images.map(async (imageUrl) => {
    // Your existing Rekognition analysis +
    const conditionScore = await assessConditionFromImage(imageUrl);
    const modificationAnalysis = await detectModifications(imageUrl);
    const qualityIndicators = await assessQualityIndicators(imageUrl);
    
    return {
      condition_score: conditionScore,
      modifications: modificationAnalysis,
      quality: qualityIndicators
    };
  }));
  
  return {
    overall_condition: calculateOverallCondition(analyses),
    modifications: aggregateModifications(analyses),
    documentation_quality: assessDocumentationQuality(analyses),
    image_count: images.length,
    pricing_confidence: calculateImageConfidence(analyses)
  };
}

function calculateConditionMultiplier(conditionScore: number): number {
  // Convert 1-10 condition score to price multiplier
  const multipliers = {
    10: 1.3,  // Concours condition = 30% premium
    9: 1.2,   // Excellent = 20% premium  
    8: 1.1,   // Very good = 10% premium
    7: 1.0,   // Good = baseline
    6: 0.95,  // Fair = 5% discount
    5: 0.85,  // Poor = 15% discount
    4: 0.7,   // Project = 30% discount
    3: 0.6,   // Rough = 40% discount
    2: 0.5,   // Parts car = 50% discount
    1: 0.3    // Scrap = 70% discount
  };
  
  return multipliers[Math.round(conditionScore)] || 0.8;
}
```

## 🚀 **Deployment & Testing**

### **Deploy All Functions**
```bash
# Deploy enhanced scrapers
supabase functions deploy scrape-vehicle       # Enhanced BAT
supabase functions deploy scrape-hemmings      # New Hemmings
supabase functions deploy scrape-mecum         # New Mecum  
supabase functions deploy calculate-smart-price # Smart pricing

# Set up cron jobs for regular scraping
# Add to your database:
INSERT INTO cron.job (schedule, command) VALUES 
('0 2 * * *', 'SELECT scrape_market_data_daily()'),  -- Daily at 2 AM
('0 */6 * * *', 'SELECT update_price_signals()');    -- Every 6 hours
```

### **Test Your 1974 Bronco**
```bash
# Test the complete pipeline
curl -X POST https://your-project.supabase.co/functions/v1/calculate-smart-price \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "eea40748-cdc1-4ae9-ade1-4431d14a7726"}'
```

## 📊 **Expected Results**

### **Before (Legacy APIs):**
```json
{
  "estimated_value": 15000,
  "confidence": 35,
  "sources": ["Generic book value"],
  "breakdown": "Year/make/model lookup"
}
```

### **After (Your Revolutionary System):**
```json
{
  "estimated_value": 28500,
  "confidence": 87,
  "sources": [
    "12 sold vehicles from BAT",
    "8 active listings from Hemmings", 
    "3 auction results from Mecum",
    "15 images analyzed",
    "4 user opinions"
  ],
  "breakdown": {
    "market_base": 25000,
    "condition_multiplier": 1.1,
    "modification_adjustment": 2000,
    "rarity_multiplier": 1.05,
    "user_weighting": 1.02
  },
  "market_trend": "rising",
  "comparable_sales": [
    {"source": "BAT", "price": 27500, "date": "2024-10-15"},
    {"source": "Mecum", "price": 29000, "date": "2024-09-22"}
  ]
}
```

## 🎯 **Success Metrics**

### **Week 1:** Enhanced BAT scraper collecting 50+ data points per vehicle
### **Week 2:** Hemmings scraper finding 20+ comparable listings  
### **Week 3:** Mecum scraper providing auction results for pricing validation
### **Week 4:** Smart pricing algorithm beating legacy APIs by 40%+ accuracy

---

**Ready to revolutionize vehicle pricing? Let's start with enhancing your BAT scraper this week!**