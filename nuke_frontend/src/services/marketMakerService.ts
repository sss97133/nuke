/**
 * Market Maker Service
 * Provides liquidity and maintains fair pricing across all markets
 */

import { supabase } from '../lib/supabase';
import { AuctionMarketEngine } from './auctionMarketEngine';

export interface MarketMakerConfig {
  offering_id: string;
  symbol: string;
  target_spread_pct: number; // Target bid-ask spread as percentage
  max_position_size: number; // Maximum shares to hold
  rebalance_threshold: number; // When to rebalance position
  min_liquidity_requirement: number; // Minimum shares to maintain on each side
  volatility_adjustment: boolean; // Adjust spreads based on volatility
  enabled: boolean;
}

export interface MarketMakerPosition {
  offering_id: string;
  symbol: string;
  shares_owned: number;
  average_cost: number;
  market_value: number;
  unrealized_pnl: number;
  target_price: number;
  fair_value: number;
  bid_price: number;
  ask_price: number;
  bid_size: number;
  ask_size: number;
  last_updated: string;
}

export interface LiquidityMetrics {
  offering_id: string;
  bid_ask_spread: number;
  bid_ask_spread_pct: number;
  market_depth_bid: number;
  market_depth_ask: number;
  liquidity_score: number; // 0-100
  volume_24h: number;
  price_volatility: number;
  last_trade_time: string | null;
}

// =====================================================
// MARKET MAKER SERVICE
// =====================================================

export class MarketMakerService {
  private static instance: MarketMakerService | null = null;
  private configs: Map<string, MarketMakerConfig> = new Map();
  private positions: Map<string, MarketMakerPosition> = new Map();
  private liquidityMetrics: Map<string, LiquidityMetrics> = new Map();
  private isRunning: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;

  static getInstance(): MarketMakerService {
    if (!this.instance) {
      this.instance = new MarketMakerService();
    }
    return this.instance;
  }

  /**
   * Initialize market maker for all active offerings
   */
  async initialize() {
    try {
      await this.loadConfigurations();
      await this.loadPositions();
      await this.calculateLiquidityMetrics();
      
      // Start market making loop
      this.start();
      
      console.log('Market Maker Service initialized');
    } catch (error) {
      console.error('Failed to initialize Market Maker Service:', error);
    }
  }

  /**
   * Load market maker configurations
   */
  private async loadConfigurations() {
    try {
      // Create default configs for all active offerings
      const { data: offerings, error } = await supabase
        .from('vehicle_offerings')
        .select(`
          id,
          vehicle_id,
          current_share_price,
          total_shares,
          vehicles!inner(
            make,
            model,
            year
          )
        `)
        .eq('status', 'trading');

      if (error) throw error;

      for (const offering of offerings || []) {
        const symbol = `${offering.vehicles.year} ${offering.vehicles.make} ${offering.vehicles.model}`;
        
        const config: MarketMakerConfig = {
          offering_id: offering.id,
          symbol,
          target_spread_pct: 0.5, // 0.5% spread
          max_position_size: Math.floor(offering.total_shares * 0.05), // 5% of total shares
          rebalance_threshold: Math.floor(offering.total_shares * 0.02), // 2% threshold
          min_liquidity_requirement: 10, // Minimum 10 shares on each side
          volatility_adjustment: true,
          enabled: true
        };

        this.configs.set(offering.id, config);
      }
    } catch (error) {
      console.error('Failed to load configurations:', error);
    }
  }

  /**
   * Load current positions
   */
  private async loadPositions() {
    try {
      // In a real implementation, this would load from a market maker account
      // For now, initialize with zero positions
      for (const [offeringId, config] of this.configs) {
        const position: MarketMakerPosition = {
          offering_id: offeringId,
          symbol: config.symbol,
          shares_owned: 0,
          average_cost: 0,
          market_value: 0,
          unrealized_pnl: 0,
          target_price: 0,
          fair_value: 0,
          bid_price: 0,
          ask_price: 0,
          bid_size: config.min_liquidity_requirement,
          ask_size: config.min_liquidity_requirement,
          last_updated: new Date().toISOString()
        };

        this.positions.set(offeringId, position);
      }
    } catch (error) {
      console.error('Failed to load positions:', error);
    }
  }

  /**
   * Calculate liquidity metrics for all offerings
   */
  private async calculateLiquidityMetrics() {
    try {
      for (const [offeringId] of this.configs) {
        const metrics = await this.calculateOfferingLiquidity(offeringId);
        this.liquidityMetrics.set(offeringId, metrics);
      }
    } catch (error) {
      console.error('Failed to calculate liquidity metrics:', error);
    }
  }

  /**
   * Calculate liquidity metrics for a specific offering
   */
  private async calculateOfferingLiquidity(offeringId: string): Promise<LiquidityMetrics> {
    try {
      // Get current offering data
      const { data: offering } = await supabase
        .from('vehicle_offerings')
        .select('*')
        .eq('id', offeringId)
        .single();

      if (!offering) {
        throw new Error(`Offering ${offeringId} not found`);
      }

      // Get recent trades for volatility calculation
      const { data: trades } = await supabase
        .from('market_trades')
        .select('price_per_share, executed_at, shares_traded, total_value')
        .eq('offering_id', offeringId)
        .gte('executed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('executed_at', { ascending: false });

      // Calculate metrics
      const bidAskSpread = (offering.lowest_ask || 0) - (offering.highest_bid || 0);
      const bidAskSpreadPct = offering.current_share_price > 0 
        ? (bidAskSpread / offering.current_share_price) * 100 
        : 0;

      const volume24h = (trades || []).reduce((sum, trade) => sum + Number(trade.total_value), 0);
      const priceVolatility = this.calculatePriceVolatility(trades || []);

      // Calculate liquidity score (0-100)
      const spreadScore = Math.max(0, 100 - (bidAskSpreadPct * 100)); // Lower spread = higher score
      const volumeScore = Math.min(100, (volume24h / 10000) * 100); // $10k volume = 100 score
      const liquidityScore = (spreadScore * 0.6) + (volumeScore * 0.4);

      const lastTradeTime = (trades || []).length > 0 ? trades[0].executed_at : null;

      return {
        offering_id: offeringId,
        bid_ask_spread: bidAskSpread,
        bid_ask_spread_pct: bidAskSpreadPct,
        market_depth_bid: offering.buy_side_depth || 0,
        market_depth_ask: offering.sell_side_depth || 0,
        liquidity_score: liquidityScore,
        volume_24h: volume24h,
        price_volatility: priceVolatility,
        last_trade_time: lastTradeTime
      };
    } catch (error) {
      console.error(`Failed to calculate liquidity for ${offeringId}:`, error);
      return {
        offering_id: offeringId,
        bid_ask_spread: 0,
        bid_ask_spread_pct: 0,
        market_depth_bid: 0,
        market_depth_ask: 0,
        liquidity_score: 0,
        volume_24h: 0,
        price_volatility: 0,
        last_trade_time: null
      };
    }
  }

  /**
   * Calculate price volatility from recent trades
   */
  private calculatePriceVolatility(trades: any[]): number {
    if (trades.length < 2) return 0;

    const prices = trades.map(t => Number(t.price_per_share));
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
    const standardDeviation = Math.sqrt(variance);
    
    return mean > 0 ? (standardDeviation / mean) * 100 : 0; // Return as percentage
  }

  /**
   * Start market making loop
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.marketMakingLoop();
    }, 30000); // Run every 30 seconds

    console.log('Market Maker started');
  }

  /**
   * Stop market making
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('Market Maker stopped');
  }

  /**
   * Main market making loop
   */
  private async marketMakingLoop() {
    try {
      for (const [offeringId, config] of this.configs) {
        if (!config.enabled) continue;

        await this.makeMarket(offeringId);
      }
    } catch (error) {
      console.error('Error in market making loop:', error);
    }
  }

  /**
   * Make market for a specific offering
   */
  private async makeMarket(offeringId: string) {
    try {
      const config = this.configs.get(offeringId);
      const position = this.positions.get(offeringId);
      const metrics = this.liquidityMetrics.get(offeringId);

      if (!config || !position || !metrics) return;

      // Get current market data
      const { data: offering } = await supabase
        .from('vehicle_offerings')
        .select('*')
        .eq('id', offeringId)
        .single();

      if (!offering) return;

      // Calculate fair value
      const fairValue = await this.calculateFairValue(offeringId);
      
      // Calculate target spread based on volatility
      let targetSpread = config.target_spread_pct;
      if (config.volatility_adjustment && metrics.price_volatility > 5) {
        targetSpread *= (1 + metrics.price_volatility / 100); // Increase spread for volatile assets
      }

      // Calculate bid and ask prices
      const halfSpread = (fairValue * targetSpread) / 200; // Divide by 200 (100 for percentage, 2 for half)
      const bidPrice = fairValue - halfSpread;
      const askPrice = fairValue + halfSpread;

      // Determine sizes based on position and inventory
      const inventoryRatio = position.shares_owned / config.max_position_size;
      
      // Adjust sizes based on inventory (sell more if long, buy more if short)
      let bidSize = config.min_liquidity_requirement;
      let askSize = config.min_liquidity_requirement;

      if (inventoryRatio > 0.5) {
        // Too long - increase ask size, decrease bid size
        askSize = Math.floor(askSize * (1 + inventoryRatio));
        bidSize = Math.max(1, Math.floor(bidSize * (1 - inventoryRatio)));
      } else if (inventoryRatio < -0.5) {
        // Too short - increase bid size, decrease ask size
        bidSize = Math.floor(bidSize * (1 + Math.abs(inventoryRatio)));
        askSize = Math.max(1, Math.floor(askSize * (1 - Math.abs(inventoryRatio))));
      }

      // Update position
      position.fair_value = fairValue;
      position.bid_price = bidPrice;
      position.ask_price = askPrice;
      position.bid_size = bidSize;
      position.ask_size = askSize;
      position.last_updated = new Date().toISOString();

      // Place or update orders (in a real implementation)
      await this.placeMarketMakerOrders(offeringId, bidPrice, askPrice, bidSize, askSize);

      // Update metrics
      await this.updateLiquidityMetrics(offeringId);

    } catch (error) {
      console.error(`Failed to make market for ${offeringId}:`, error);
    }
  }

  /**
   * Calculate fair value for an offering
   */
  private async calculateFairValue(offeringId: string): Promise<number> {
    try {
      // Get recent trades for VWAP calculation
      const { data: trades } = await supabase
        .from('market_trades')
        .select('price_per_share, shares_traded, executed_at')
        .eq('offering_id', offeringId)
        .gte('executed_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Last hour
        .order('executed_at', { ascending: false })
        .limit(50);

      if (!trades || trades.length === 0) {
        // No recent trades, use current price
        const { data: offering } = await supabase
          .from('vehicle_offerings')
          .select('current_share_price')
          .eq('id', offeringId)
          .single();

        return Number(offering?.current_share_price || 0);
      }

      // Calculate Volume-Weighted Average Price (VWAP)
      let totalValue = 0;
      let totalVolume = 0;

      for (const trade of trades) {
        const value = Number(trade.price_per_share) * Number(trade.shares_traded);
        totalValue += value;
        totalVolume += Number(trade.shares_traded);
      }

      return totalVolume > 0 ? totalValue / totalVolume : Number(trades[0].price_per_share);
    } catch (error) {
      console.error(`Failed to calculate fair value for ${offeringId}:`, error);
      return 0;
    }
  }

  /**
   * Place market maker orders (simplified implementation)
   */
  private async placeMarketMakerOrders(
    offeringId: string, 
    bidPrice: number, 
    askPrice: number, 
    bidSize: number, 
    askSize: number
  ) {
    try {
      // In a real implementation, this would:
      // 1. Cancel existing market maker orders
      // 2. Place new bid and ask orders
      // 3. Use a dedicated market maker account with special privileges
      
      console.log(`Market making for ${offeringId}: Bid ${bidPrice.toFixed(4)} x ${bidSize}, Ask ${askPrice.toFixed(4)} x ${askSize}`);
      
      // For now, just update the offering with synthetic bid/ask
      await supabase
        .from('vehicle_offerings')
        .update({
          highest_bid: bidPrice,
          lowest_ask: askPrice,
          bid_ask_spread: askPrice - bidPrice,
          buy_side_depth: bidSize,
          sell_side_depth: askSize
        })
        .eq('id', offeringId);

    } catch (error) {
      console.error(`Failed to place market maker orders for ${offeringId}:`, error);
    }
  }

  /**
   * Update liquidity metrics
   */
  private async updateLiquidityMetrics(offeringId: string) {
    try {
      const metrics = await this.calculateOfferingLiquidity(offeringId);
      this.liquidityMetrics.set(offeringId, metrics);
    } catch (error) {
      console.error(`Failed to update liquidity metrics for ${offeringId}:`, error);
    }
  }

  /**
   * Get market maker positions
   */
  getPositions(): MarketMakerPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get liquidity metrics
   */
  getLiquidityMetrics(): LiquidityMetrics[] {
    return Array.from(this.liquidityMetrics.values());
  }

  /**
   * Get position for specific offering
   */
  getPosition(offeringId: string): MarketMakerPosition | null {
    return this.positions.get(offeringId) || null;
  }

  /**
   * Get liquidity metrics for specific offering
   */
  getOfferingLiquidity(offeringId: string): LiquidityMetrics | null {
    return this.liquidityMetrics.get(offeringId) || null;
  }

  /**
   * Update configuration
   */
  async updateConfig(offeringId: string, config: Partial<MarketMakerConfig>) {
    const existingConfig = this.configs.get(offeringId);
    if (existingConfig) {
      const updatedConfig = { ...existingConfig, ...config };
      this.configs.set(offeringId, updatedConfig);
    }
  }

  /**
   * Enable/disable market making for an offering
   */
  async setEnabled(offeringId: string, enabled: boolean) {
    await this.updateConfig(offeringId, { enabled });
  }

  /**
   * Get overall market health score
   */
  getMarketHealthScore(): number {
    const metrics = Array.from(this.liquidityMetrics.values());
    if (metrics.length === 0) return 0;

    const avgLiquidityScore = metrics.reduce((sum, m) => sum + m.liquidity_score, 0) / metrics.length;
    const activeMarkets = metrics.filter(m => m.volume_24h > 100).length;
    const marketCoverage = activeMarkets / metrics.length;

    return (avgLiquidityScore * 0.7) + (marketCoverage * 30); // Weighted average
  }

  /**
   * Get summary statistics
   */
  getSummaryStats() {
    const positions = Array.from(this.positions.values());
    const metrics = Array.from(this.liquidityMetrics.values());

    return {
      total_positions: positions.length,
      total_shares_owned: positions.reduce((sum, p) => sum + p.shares_owned, 0),
      total_market_value: positions.reduce((sum, p) => sum + p.market_value, 0),
      total_unrealized_pnl: positions.reduce((sum, p) => sum + p.unrealized_pnl, 0),
      average_spread_pct: metrics.reduce((sum, m) => sum + m.bid_ask_spread_pct, 0) / metrics.length,
      total_volume_24h: metrics.reduce((sum, m) => sum + m.volume_24h, 0),
      market_health_score: this.getMarketHealthScore(),
      enabled_markets: Array.from(this.configs.values()).filter(c => c.enabled).length,
      last_updated: new Date().toISOString()
    };
  }
}
