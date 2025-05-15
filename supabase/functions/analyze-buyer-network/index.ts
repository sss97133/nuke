import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.14.0';
import { corsHeaders } from '../_shared/cors.ts';

interface BuyerAnalysisParams {
  marketplace?: string;        // Optional specific marketplace to analyze
  vehicleCategory?: string;    // Optional vehicle category filter
  timeRange?: [string, string]; // Date range for analysis
  minTransactionValue?: number; // Minimum transaction value to consider
}

interface BuyerPattern {
  buyerId: string;             // Anonymous identifier
  transactionCount: number;    // Number of transactions
  firstTransaction: Date;      // First known transaction
  lastTransaction: Date;       // Last known transaction
  vehicleCategories: Record<string, number>; // Categories and counts
  priceRange: [number, number]; // Min and max prices paid
  averagePrice: number;        // Average price paid
  isWhale: boolean;            // High-value or high-volume buyer
  whaleScore: number;          // 0-100 measure of whale activity
  activityTrend: 'increasing' | 'stable' | 'decreasing'; // Recent trend
  specializations: string[];   // Vehicle types they focus on
}

interface BuyerCommunityProfile {
  marketplace: string;
  timeRange: [Date, Date];
  activeCollectors: number;    // Count of repeat buyers
  buyerRetention: number;      // % of buyers who purchase again
  newBuyerRate: number;        // Growth rate of new buyers
  priceTrends: {
    average: number;
    trend: 'up' | 'stable' | 'down';
    percentChange: number;
  };
  categoryDistribution: Record<string, number>; // Vehicle categories by popularity
  whaleMetrics: {
    count: number;             // Number of whales
    influence: number;         // % of market value driven by whales
    activity: 'increasing' | 'stable' | 'decreasing';
    preferredCategories: string[];
  };
  confidenceScore: number;     // 0-100 data reliability score
}

/**
 * Collects buyer patterns from a specific marketplace and vehicle category
 * Uses real transaction data, not mock data per project requirements
 */
async function collectBuyerPatterns(
  supabase: any,
  marketplace: string,
  vehicleCategory?: string,
  timeRange?: [string, string],
  minTransactionValue = 0
): Promise<{
  buyerPatterns: BuyerPattern[];
  marketMetrics: Record<string, any>;
}> {
  // Default to looking back 2 years if no range specified
  const defaultStart = new Date();
  defaultStart.setFullYear(defaultStart.getFullYear() - 2);
  
  const startDate = timeRange?.[0] ? new Date(timeRange[0]) : defaultStart;
  const endDate = timeRange?.[1] ? new Date(timeRange[1]) : new Date();
  
  // Get transaction data from our captures and vehicle_timeline_events tables
  let query = supabase
    .from('vehicle_timeline_events')
    .select(`
      id,
      vehicle_id,
      event_date,
      data,
      source,
      user_id,
      vehicles(make, model, year)
    `)
    .eq('event_type', 'transaction')
    .gte('event_date', startDate.toISOString())
    .lte('event_date', endDate.toISOString())
    .order('event_date', { ascending: false });

  // Filter by marketplace if specified
  if (marketplace) {
    query = query.eq('source', marketplace);
  }
  
  // Get transaction data
  const { data: transactions, error } = await query;
  
  if (error) {
    console.error('Error fetching transaction data:', error);
    return { 
      buyerPatterns: [],
      marketMetrics: { error: error.message }
    };
  }
  
  // Process transactions to identify buyer patterns
  const buyerMap: Record<string, BuyerPattern> = {};
  const pricePoints: number[] = [];
  let totalTransactions = 0;
  
  // Process each transaction to build buyer profiles
  for (const tx of transactions) {
    // Skip transactions without price data
    if (!tx.data?.price || tx.data.price < minTransactionValue) continue;
    
    totalTransactions++;
    pricePoints.push(tx.data.price);
    
    // Get or create buyer record (using anonymous ID)
    const buyerId = tx.data.buyer_id || tx.user_id || `anon-${tx.data.buyer_identifier || crypto.randomUUID()}`;
    if (!buyerMap[buyerId]) {
      buyerMap[buyerId] = {
        buyerId,
        transactionCount: 0,
        firstTransaction: new Date(tx.event_date),
        lastTransaction: new Date(tx.event_date),
        vehicleCategories: {},
        priceRange: [tx.data.price, tx.data.price],
        averagePrice: tx.data.price,
        isWhale: false,
        whaleScore: 0,
        activityTrend: 'stable',
        specializations: []
      };
    }
    
    const buyer = buyerMap[buyerId];
    buyer.transactionCount += 1;
    
    // Update date range
    const txDate = new Date(tx.event_date);
    if (txDate < buyer.firstTransaction) {
      buyer.firstTransaction = txDate;
    }
    if (txDate > buyer.lastTransaction) {
      buyer.lastTransaction = txDate;
    }
    
    // Update price range and average
    const totalValue = buyer.averagePrice * (buyer.transactionCount - 1) + tx.data.price;
    buyer.averagePrice = totalValue / buyer.transactionCount;
    
    if (tx.data.price < buyer.priceRange[0]) {
      buyer.priceRange[0] = tx.data.price;
    }
    if (tx.data.price > buyer.priceRange[1]) {
      buyer.priceRange[1] = tx.data.price;
    }
    
    // Update vehicle category tracking
    const vehicleType = tx.vehicles ? 
      `${tx.vehicles.make} ${tx.vehicles.model}`.toLowerCase() : 
      (tx.data.vehicle_type || 'unknown');
    
    if (!buyer.vehicleCategories[vehicleType]) {
      buyer.vehicleCategories[vehicleType] = 0;
    }
    buyer.vehicleCategories[vehicleType] += 1;
  }
  
  // Calculate market-wide metrics
  const averagePrice = pricePoints.length > 0 ? 
    pricePoints.reduce((sum, price) => sum + price, 0) / pricePoints.length : 
    0;
    
  // Calculate "whale" buyers (top 5% by transaction count or value)
  const buyerPatterns = Object.values(buyerMap);
  
  // Sort by transaction count to find high-volume buyers
  buyerPatterns.sort((a, b) => b.transactionCount - a.transactionCount);
  const whaleThresholdCount = Math.max(3, Math.floor(buyerPatterns.length * 0.05));
  
  // Sort by average price to find high-value buyers
  buyerPatterns.sort((a, b) => b.averagePrice - a.averagePrice);
  const whaleThresholdValue = Math.max(3, Math.floor(buyerPatterns.length * 0.05));
  
  // Mark whales and calculate their score
  for (let i = 0; i < buyerPatterns.length; i++) {
    const buyer = buyerPatterns[i];
    
    // High-value whale
    if (i < whaleThresholdValue) {
      buyer.isWhale = true;
      buyer.whaleScore += 50;
    }
    
    // Identify specializations (categories representing >25% of purchases)
    const totalPurchases = buyer.transactionCount;
    buyer.specializations = Object.entries(buyer.vehicleCategories)
      .filter(([_, count]) => count / totalPurchases > 0.25)
      .map(([category]) => category);
    
    // Calculate activity trend based on frequency
    if (buyer.transactionCount < 2) {
      buyer.activityTrend = 'stable';
    } else {
      const daysBetweenFirstLast = 
        (buyer.lastTransaction.getTime() - buyer.firstTransaction.getTime()) / 
        (1000 * 60 * 60 * 24);
      const averageDaysPerPurchase = daysBetweenFirstLast / (buyer.transactionCount - 1);
      const daysSinceLastPurchase = 
        (new Date().getTime() - buyer.lastTransaction.getTime()) / 
        (1000 * 60 * 60 * 24);
      
      if (daysSinceLastPurchase < averageDaysPerPurchase * 0.8) {
        buyer.activityTrend = 'increasing';
      } else if (daysSinceLastPurchase > averageDaysPerPurchase * 1.5) {
        buyer.activityTrend = 'decreasing';
      }
    }
  }
  
  // Sort back by whale score for final output
  buyerPatterns.sort((a, b) => b.whaleScore - a.whaleScore);
  
  // Calculate overall market metrics
  const uniqueBuyers = buyerPatterns.length;
  const repeatBuyers = buyerPatterns.filter(b => b.transactionCount > 1).length;
  const whales = buyerPatterns.filter(b => b.isWhale).length;
  
  // Calculate price trend
  const recentEnd = new Date();
  const recentStart = new Date();
  recentStart.setMonth(recentStart.getMonth() - 6);
  
  const olderEnd = new Date(recentStart);
  const olderStart = new Date(olderEnd);
  olderStart.setMonth(olderStart.getMonth() - 6);
  
  const recentPrices = pricePoints.filter((_, i) => {
    const txDate = new Date(transactions[i].event_date);
    return txDate >= recentStart && txDate <= recentEnd;
  });
  
  const olderPrices = pricePoints.filter((_, i) => {
    const txDate = new Date(transactions[i].event_date);
    return txDate >= olderStart && txDate <= olderEnd;
  });
  
  const recentAverage = recentPrices.length > 0 ?
    recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length : 0;
    
  const olderAverage = olderPrices.length > 0 ?
    olderPrices.reduce((sum, p) => sum + p, 0) / olderPrices.length : 0;
    
  const percentChange = olderAverage > 0 ?
    ((recentAverage - olderAverage) / olderAverage) * 100 : 0;
    
  // Gather category preferences from whales
  const whalePreferences = new Map<string, number>();
  buyerPatterns
    .filter(b => b.isWhale)
    .forEach(whale => {
      Object.entries(whale.vehicleCategories).forEach(([category, count]) => {
        whalePreferences.set(
          category, 
          (whalePreferences.get(category) || 0) + count
        );
      });
    });
  
  // Convert to sorted array of categories
  const whaleCategoryPreferences = [...whalePreferences.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);
    
  // Calculate data confidence based on sample size
  let confidenceScore = Math.min(100, Math.max(10, 
    Math.floor(50 * Math.log10(totalTransactions + 1))
  ));
  
  // If we have very few transactions, confidence is low
  if (totalTransactions < 10) confidenceScore = Math.min(confidenceScore, 25);
  
  // Calculate category distribution across all transactions
  const categoryDistribution: Record<string, number> = {};
  buyerPatterns.forEach(buyer => {
    Object.entries(buyer.vehicleCategories).forEach(([category, count]) => {
      if (!categoryDistribution[category]) categoryDistribution[category] = 0;
      categoryDistribution[category] += count;
    });
  });
  
  // Return results
  return {
    buyerPatterns,
    marketMetrics: {
      totalTransactions,
      uniqueBuyers,
      repeatBuyers,
      buyerRetention: uniqueBuyers > 0 ? repeatBuyers / uniqueBuyers : 0,
      averagePrice,
      priceTrend: {
        recent: recentAverage,
        older: olderAverage,
        percentChange,
        trend: percentChange > 2 ? 'up' : (percentChange < -2 ? 'down' : 'stable')
      },
      categoryDistribution,
      whaleMetrics: {
        count: whales,
        influence: totalTransactions > 0 ? 
          buyerPatterns.filter(b => b.isWhale)
            .reduce((sum, whale) => sum + whale.transactionCount, 0) / totalTransactions : 0,
        activity: buyerPatterns.filter(b => b.isWhale && b.activityTrend === 'increasing').length >
                 buyerPatterns.filter(b => b.isWhale && b.activityTrend === 'decreasing').length ?
                 'increasing' : 'decreasing',
        preferredCategories: whaleCategoryPreferences.slice(0, 5)
      },
      confidenceScore
    }
  };
}

/**
 * Main edge function to analyze buyer community for a given marketplace or category
 */
async function analyzeBuyerNetwork(req: Request) {
  // Set up CORS headers for browser clients
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    const { marketplace, vehicleCategory, timeRange, minTransactionValue } = await req.json() as BuyerAnalysisParams;
    
    // Create Supabase client using environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    // Collect buyer patterns data
    const { buyerPatterns, marketMetrics } = await collectBuyerPatterns(
      supabase,
      marketplace || '',
      vehicleCategory,
      timeRange,
      minTransactionValue || 0
    );
    
    // Create buyer community profile from collected data
    const communityProfile: BuyerCommunityProfile = {
      marketplace: marketplace || 'all',
      timeRange: [
        timeRange?.[0] ? new Date(timeRange[0]) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        timeRange?.[1] ? new Date(timeRange[1]) : new Date()
      ],
      activeCollectors: marketMetrics.repeatBuyers || 0,
      buyerRetention: marketMetrics.buyerRetention || 0,
      newBuyerRate: 0, // Would need historical data to calculate
      priceTrends: {
        average: marketMetrics.averagePrice || 0,
        trend: marketMetrics.priceTrend?.trend || 'stable',
        percentChange: marketMetrics.priceTrend?.percentChange || 0
      },
      categoryDistribution: marketMetrics.categoryDistribution || {},
      whaleMetrics: marketMetrics.whaleMetrics || {
        count: 0,
        influence: 0,
        activity: 'stable',
        preferredCategories: []
      },
      confidenceScore: marketMetrics.confidenceScore || 0
    };
    
    // Store analysis results if we have reasonable confidence
    if (communityProfile.confidenceScore > 30) {
      await supabase
        .from('marketplace_analysis')
        .insert({
          marketplace: communityProfile.marketplace,
          analysis_date: new Date().toISOString(),
          profile: communityProfile,
          raw_metrics: marketMetrics,
          buyer_patterns: buyerPatterns.map(bp => ({
            transaction_count: bp.transactionCount,
            price_range: bp.priceRange,
            average_price: bp.averagePrice,
            is_whale: bp.isWhale,
            activity_trend: bp.activityTrend,
            specializations: bp.specializations
          }))
        })
        .select('id');
    }
    
    // Return full result to caller
    return new Response(
      JSON.stringify({
        success: true,
        communityProfile,
        topBuyers: buyerPatterns.slice(0, 50).map(bp => ({
          transactionCount: bp.transactionCount,
          priceRange: bp.priceRange,
          averagePrice: bp.averagePrice,
          isWhale: bp.isWhale,
          activityTrend: bp.activityTrend,
          specializations: bp.specializations
        }))
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
  } catch (error) {
    console.error('Error in analyzeBuyerNetwork:', error.message);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
}

// Serve the edge function
serve(analyzeBuyerNetwork);
