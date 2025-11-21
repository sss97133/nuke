/**
 * PRICING SERVICE - Smart Vehicle Pricing with Verification Hierarchy
 * 
 * PHILOSOPHY:
 * - Verified owner data > unverified data
 * - Sale price (actual) > asking price (intent) > estimated value (speculation)
 * - Recent data > old data
 * - High-quality sources > low-quality sources
 * - Market listings (Craigslist, BaT, eBay, etc.) > manual entry
 * 
 * TRUTH HIERARCHY (highest to lowest):
 * 1. Verified owner's actual sale price (TRUTH)
 * 2. Verified owner's asking price (INTENT)
 * 3. Recent market listing price from comments/posts (MARKET SIGNAL)
 * 4. Manual asking_price field (USER INPUT)
 * 5. Current_value / appraised value (ESTIMATE)
 * 6. Purchase price (HISTORICAL)
 * 
 * AI AUTOMATION GUIDELINES:
 * When AI extracts prices from comments, it should:
 * - Parse URLs from known marketplaces (Craigslist, BaT, eBay Motors, Cars & Bids, etc.)
 * - Extract price from comment text or fetch from URL
 * - Store with source metadata (url, platform, date, confidence)
 * - Update asking_price if extracted price is newer and higher confidence
 * - Mark as "market_verified" vs "user_entered"
 */

import { supabase } from '../lib/supabase';

export interface PriceSource {
  value: number;
  source: 'sale_price' | 'asking_price' | 'market_listing' | 'current_value' | 'purchase_price' | 'msrp';
  verified: boolean;
  confidence: 'high' | 'medium' | 'low';
  date?: string;
  url?: string;
  platform?: string;
  metadata?: Record<string, any>;
}

export interface VehiclePricing {
  displayPrice: number | null;
  priceSource: PriceSource | null;
  allSources: PriceSource[];
  isForSale: boolean;
  priceHistory: Array<{ date: string; price: number; source: string }>;
}

/**
 * Known marketplace patterns for AI extraction
 */
export const MARKETPLACE_PATTERNS = {
  craigslist: /craigslist\.org\/.*\/(\d+)\.html/,
  bringatrailer: /bringatrailer\.com\/listing\//,
  ebay: /ebay\.com\/itm\//,
  carsandbids: /carsandbids\.com\/auctions\//,
  facebook: /facebook\.com\/marketplace\/item\//,
  autotrader: /autotrader\.com\//,
  cargurus: /cargurus\.com\//,
};

/**
 * Extract price from comment text using AI-ready patterns
 * This function provides the groundwork for AI automation
 */
export function extractPriceFromComment(commentText: string): {
  price: number | null;
  platform: string | null;
  url: string | null;
  confidence: 'high' | 'medium' | 'low';
} {
  // Check for marketplace URLs
  for (const [platform, pattern] of Object.entries(MARKETPLACE_PATTERNS)) {
    if (pattern.test(commentText)) {
      const urlMatch = commentText.match(/(https?:\/\/[^\s]+)/);
      const url = urlMatch ? urlMatch[1] : null;
      
      // Try to extract price from text near the URL
      // Patterns: $149,000 | $149000 | 149k | 149K
      const pricePatterns = [
        /\$\s?([\d,]+)(?:\.\d{2})?/,  // $149,000 or $149000
        /(\d+)k/i,                     // 149k
      ];
      
      for (const pricePattern of pricePatterns) {
        const match = commentText.match(pricePattern);
        if (match) {
          const priceStr = match[1].replace(/,/g, '');
          let price = parseFloat(priceStr);
          
          // Handle 'k' notation
          if (commentText.match(/k/i)) {
            price *= 1000;
          }
          
          return {
            price,
            platform,
            url,
            confidence: 'high',
          };
        }
      }
      
      // Found marketplace URL but no price in comment
      return {
        price: null,
        platform,
        url,
        confidence: 'medium',
      };
    }
  }
  
  // No marketplace found, try standalone price extraction
  const standalonePrice = commentText.match(/\$\s?([\d,]+)(?:\.\d{2})?/);
  if (standalonePrice) {
    const price = parseFloat(standalonePrice[1].replace(/,/g, ''));
    return {
      price,
      platform: null,
      url: null,
      confidence: 'low',
    };
  }
  
  return {
    price: null,
    platform: null,
    url: null,
    confidence: 'low',
  };
}

/**
 * Get the best price for display based on verification hierarchy
 * 
 * @param vehicleData - Vehicle data from database
 * @param isVerifiedOwner - Whether current user is verified owner
 * @param recentComments - Recent comments that might contain market listings
 */
export async function getSmartPrice(
  vehicleId: string,
  vehicleData: any,
  isVerifiedOwner: boolean = false
): Promise<VehiclePricing> {
  const sources: PriceSource[] = [];
  
  // 1. HIGHEST PRIORITY: Actual sale price
  if (vehicleData.sale_price && vehicleData.sale_price > 0) {
    sources.push({
      value: vehicleData.sale_price,
      source: 'sale_price',
      verified: isVerifiedOwner,
      confidence: isVerifiedOwner ? 'high' : 'medium',
      metadata: { label: 'Sold Price (Actual)' },
    });
  }
  
  // 2. SECOND PRIORITY: Recent market listings from comments
  const { data: comments } = await supabase
    .from('vehicle_comments')
    .select('comment_text, created_at, user_id')
    .eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (comments && comments.length > 0) {
    for (const comment of comments) {
      const extracted = extractPriceFromComment(comment.comment_text);
      if (extracted.price && extracted.platform) {
        sources.push({
          value: extracted.price,
          source: 'market_listing',
          verified: false,
          confidence: extracted.confidence,
          date: comment.created_at,
          url: extracted.url || undefined,
          platform: extracted.platform,
          metadata: { 
            label: `${extracted.platform.charAt(0).toUpperCase() + extracted.platform.slice(1)} Listing`,
            fromComment: true,
          },
        });
      }
    }
  }
  
  // 3. THIRD PRIORITY: Owner's asking price (manual entry)
  if (vehicleData.asking_price && vehicleData.asking_price > 0) {
    sources.push({
      value: vehicleData.asking_price,
      source: 'asking_price',
      verified: isVerifiedOwner,
      confidence: isVerifiedOwner ? 'high' : 'medium',
      metadata: { label: 'Asking Price' },
    });
  }
  
  // 4. FOURTH PRIORITY: Current value / appraisal
  if (vehicleData.current_value && vehicleData.current_value > 0) {
    sources.push({
      value: vehicleData.current_value,
      source: 'current_value',
      verified: false,
      confidence: 'low',
      metadata: { label: 'Estimated Value' },
    });
  }
  
  // 5. LOWEST PRIORITY: Purchase price (historical context only)
  if (vehicleData.purchase_price && vehicleData.purchase_price > 0) {
    sources.push({
      value: vehicleData.purchase_price,
      source: 'purchase_price',
      verified: isVerifiedOwner,
      confidence: 'low',
      metadata: { label: 'Purchase Price' },
    });
  }
  
  // Select the best price based on hierarchy
  const bestSource = sources.length > 0 ? sources[0] : null;
  
  return {
    displayPrice: bestSource?.value || null,
    priceSource: bestSource,
    allSources: sources,
    isForSale: vehicleData.is_for_sale || false,
    priceHistory: [], // TODO: Implement price history tracking
  };
}

/**
 * AI AUTOMATION PLAYBOOK
 * 
 * When AI processes vehicle comments:
 * 
 * 1. SCAN for marketplace URLs:
 *    - Craigslist, BaT, eBay Motors, Cars & Bids, Facebook Marketplace
 *    - Extract URL and platform
 * 
 * 2. EXTRACT price from:
 *    - Comment text near the URL
 *    - Page content if URL is accessible
 *    - Use GPT Vision for screenshot prices
 * 
 * 3. VALIDATE extracted price:
 *    - Check if reasonable for vehicle year/make/model
 *    - Compare against current asking_price
 *    - Flag if >50% difference for human review
 * 
 * 4. STORE with metadata:
 *    {
 *      vehicle_id: uuid,
 *      price: number,
 *      source: 'market_listing',
 *      platform: 'craigslist',
 *      url: string,
 *      extracted_at: timestamp,
 *      confidence: 'high' | 'medium' | 'low',
 *      verified_by_owner: boolean,
 *      comment_id: uuid (reference)
 *    }
 * 
 * 5. UPDATE vehicle asking_price IF:
 *    - New price is more recent (within 30 days)
 *    - Confidence is 'high'
 *    - Price is reasonable (not outlier)
 *    - OR: owner explicitly confirms in comment
 * 
 * 6. TRACK price changes:
 *    - Build price_history table
 *    - Record: date, price, source, platform, confidence
 *    - Enable trending analysis (-24.1% 30D, etc.)
 * 
 * EDGE CASES:
 * - Multiple listings at different prices → use most recent
 * - Listing expired/sold → mark as historical
 * - Owner overrides market price → owner wins
 * - Conflicting sources → verified owner > market > estimate
 */

/**
 * Calculate price change percentage for trending
 */
export function calculatePriceChange(
  currentPrice: number,
  previousPrice: number
): {
  amount: number;
  percentage: number;
  direction: 'up' | 'down' | 'stable';
} {
  const amount = currentPrice - previousPrice;
  const percentage = (amount / previousPrice) * 100;
  
  return {
    amount,
    percentage,
    direction: amount > 0 ? 'up' : amount < 0 ? 'down' : 'stable',
  };
}

/**
 * Format price for display with appropriate labels
 */
export function formatPriceDisplay(pricing: VehiclePricing): string {
  if (!pricing.displayPrice) return '—';
  
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pricing.displayPrice);
  
  return formatted;
}

/**
 * Get price label/tooltip for transparency
 */
export function getPriceLabel(pricing: VehiclePricing): string {
  if (!pricing.priceSource) return 'No price data';
  
  const source = pricing.priceSource;
  const labels: Record<string, string> = {
    sale_price: 'Sold Price',
    asking_price: 'Asking Price',
    market_listing: `${source.platform || 'Market'} Listing`,
    current_value: 'Estimated Value',
    purchase_price: 'Purchase Price',
    msrp: 'MSRP',
  };
  
  const verified = source.verified ? ' (Verified Owner)' : '';
  return labels[source.source] + verified;
}
