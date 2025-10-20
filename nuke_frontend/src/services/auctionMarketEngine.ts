/**
 * Auction Market Engine
 * Real-time order matching, price discovery, and market mechanics
 * NYSE-style opening/closing auctions with continuous intraday trading
 */

import { supabase } from '../lib/supabase';

// =====================================================
// TYPES & INTERFACES
// =====================================================

export type OrderType = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'active' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';
export type TimeInForce = 'day' | 'gtc' | 'fok' | 'ioc';
export type TradeType = 'market' | 'limit' | 'auction' | 'opening' | 'closing';

export interface MarketOrder {
  id: string;
  offering_id: string;
  user_id: string;
  order_type: OrderType;
  status: OrderStatus;
  shares_requested: number;
  shares_filled: number;
  price_per_share: number;
  total_value: number;
  time_in_force: TimeInForce;
  first_fill_time?: string;
  last_fill_time?: string;
  average_fill_price?: number;
  created_at: string;
}

export interface MarketTrade {
  id: string;
  offering_id: string;
  buyer_id: string;
  seller_id: string;
  shares_traded: number;
  price_per_share: number;
  total_value: number;
  trade_type: TradeType;
  nuke_commission_amount: number;
  executed_at: string;
}

export interface PriceDiscoveryResult {
  equilibrium_price: number;
  equilibrium_volume: number;
  orders_matched: number;
  total_value: number;
  bids_collected: number;
  asks_collected: number;
}

export interface OrderBookSnapshot {
  offering_id: string;
  highest_bid: number;
  lowest_ask: number;
  bid_ask_spread: number;
  buy_side_depth: number;
  sell_side_depth: number;
  weighted_mid_price: number;
}

export interface MarketImpact {
  initial_price: number;
  price_after_order: number;
  price_change_pct: number;
  impact_cost_per_share: number;
}

// =====================================================
// CORE MARKET ENGINE
// =====================================================

export class AuctionMarketEngine {
  /**
   * Place a buy or sell order
   */
  static async placeOrder(
    offeringId: string,
    userId: string,
    orderType: OrderType,
    sharesRequested: number,
    pricePerShare: number,
    timeInForce: TimeInForce = 'day'
  ): Promise<{ order: MarketOrder; trades: MarketTrade[] }> {
    try {
      // Validate order
      if (sharesRequested <= 0) throw new Error('Shares requested must be positive');
      if (pricePerShare <= 0) throw new Error('Price must be positive');

      // Create order
      const { data: order, error: orderError } = await supabase
        .from('market_orders')
        .insert({
          offering_id: offeringId,
          user_id: userId,
          order_type: orderType,
          status: 'active',
          shares_requested: sharesRequested,
          shares_filled: 0,
          price_per_share: pricePerShare,
          total_value: sharesRequested * pricePerShare,
          time_in_force: timeInForce,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Attempt to match order with existing orders
      const trades = await this.matchOrderBook(order);

      return { order, trades };
    } catch (error) {
      console.error('Failed to place order:', error);
      throw error;
    }
  }

  /**
   * Match order against existing order book
   * Returns any trades executed and updates orders
   */
  static async matchOrderBook(newOrder: MarketOrder): Promise<MarketTrade[]> {
    try {
      const { offering_id, order_type, shares_requested, price_per_share, user_id } = newOrder;

      // Fetch opposite side of book
      const oppositeType = order_type === 'buy' ? 'sell' : 'buy';
      const sortOrder = order_type === 'buy' ? 'asc' : 'desc'; // Buyers want lower prices, sellers want higher

      const { data: oppositeOrders, error: fetchError } = await supabase
        .from('market_orders')
        .select('*')
        .eq('offering_id', offering_id)
        .eq('order_type', oppositeType)
        .eq('status', 'active')
        .order('price_per_share', { ascending: sortOrder })
        .limit(100);

      if (fetchError) throw fetchError;

      const trades: MarketTrade[] = [];
      let sharesRemaining = shares_requested;
      let averageFillPrice = 0;
      let totalValueFilled = 0;

      // Match against opposite orders
      for (const oppositeOrder of oppositeOrders || []) {
        if (sharesRemaining === 0) break;

        // Check price match
        const priceMatches =
          order_type === 'buy'
            ? price_per_share >= oppositeOrder.price_per_share
            : price_per_share <= oppositeOrder.price_per_share;

        if (!priceMatches) break;

        // Calculate shares to trade
        const oppositeSharesAvailable =
          oppositeOrder.shares_requested - oppositeOrder.shares_filled;
        const sharesToTrade = Math.min(sharesRemaining, oppositeSharesAvailable);

        // Execute trade
        const tradePricePerShare = oppositeOrder.price_per_share; // Take initiator's price (aggressive)
        const tradeValue = sharesToTrade * tradePricePerShare;
        const commission = tradeValue * 0.02; // 2% Nuke commission

        const { data: trade, error: tradeError } = await supabase
          .from('market_trades')
          .insert({
            offering_id,
            buyer_id: order_type === 'buy' ? user_id : oppositeOrder.user_id,
            seller_id: order_type === 'sell' ? user_id : oppositeOrder.user_id,
            shares_traded: sharesToTrade,
            price_per_share: tradePricePerShare,
            total_value: tradeValue,
            buy_order_id: order_type === 'buy' ? newOrder.id : oppositeOrder.id,
            sell_order_id: order_type === 'sell' ? newOrder.id : oppositeOrder.id,
            trade_type: 'market',
            nuke_commission_pct: 2.0,
            nuke_commission_amount: commission,
            executed_at: new Date().toISOString()
          })
          .select()
          .single();

        if (tradeError) throw tradeError;
        trades.push(trade);

        // Update opposite order
        const newSharesFilled = oppositeOrder.shares_filled + sharesToTrade;
        const newStatus =
          newSharesFilled === oppositeOrder.shares_requested ? 'filled' : 'partially_filled';

        await supabase
          .from('market_orders')
          .update({
            shares_filled: newSharesFilled,
            status: newStatus,
            last_fill_time: new Date().toISOString()
          })
          .eq('id', oppositeOrder.id);

        // Update tracking
        sharesRemaining -= sharesToTrade;
        totalValueFilled += tradeValue;
        averageFillPrice = totalValueFilled / (shares_requested - sharesRemaining);
      }

      // Update original order
      if (sharesRemaining < shares_requested) {
        const sharesFilled = shares_requested - sharesRemaining;
        const newStatus = sharesFilled === shares_requested ? 'filled' : 'partially_filled';

        await supabase
          .from('market_orders')
          .update({
            shares_filled: sharesFilled,
            status: newStatus,
            average_fill_price: averageFillPrice,
            last_fill_time: new Date().toISOString()
          })
          .eq('id', newOrder.id);
      }

      // Update offering market data
      await this.updateOfferingMarketData(offering_id);

      return trades;
    } catch (error) {
      console.error('Failed to match order book:', error);
      return [];
    }
  }

  /**
   * Price Discovery via Double Auction (Sotheby's/NYSE model)
   * Collects all bids and asks, finds equilibrium price
   */
  static async executePriceDiscovery(
    offeringId: string,
    eventType: 'opening_auction' | 'closing_auction'
  ): Promise<PriceDiscoveryResult | null> {
    try {
      // Fetch all active orders
      const { data: allOrders, error: ordersError } = await supabase
        .from('market_orders')
        .select('*')
        .eq('offering_id', offeringId)
        .eq('status', 'active')
        .order('price_per_share', { ascending: false });

      if (ordersError) throw ordersError;

      const bids = (allOrders || []).filter(o => o.order_type === 'buy').sort((a, b) => b.price_per_share - a.price_per_share);
      const asks = (allOrders || []).filter(o => o.order_type === 'sell').sort((a, b) => a.price_per_share - b.price_per_share);

      if (bids.length === 0 || asks.length === 0) {
        return null; // No price discovery if only one side
      }

      // Find equilibrium price where cumulative volume matches
      let equilibriumPrice = 0;
      let equilibriumVolume = 0;
      let ordersMatched = 0;

      for (let i = 0; i < Math.min(bids.length, asks.length); i++) {
        const bid = bids[i];
        const ask = asks[i];

        if (bid.price_per_share >= ask.price_per_share) {
          equilibriumPrice = ask.price_per_share; // Take the ask price
          const shares = Math.min(
            bid.shares_requested - bid.shares_filled,
            ask.shares_requested - ask.shares_filled
          );
          equilibriumVolume += shares;
          ordersMatched += 2;
        } else {
          break; // No more matches
        }
      }

      // Execute all matches at equilibrium price
      if (equilibriumPrice > 0) {
        const trades: MarketTrade[] = [];

        for (let i = 0; i < ordersMatched / 2; i++) {
          const bid = bids[i];
          const ask = asks[i];

          const bidSharesAvailable = bid.shares_requested - bid.shares_filled;
          const askSharesAvailable = ask.shares_requested - ask.shares_filled;
          const sharesToTrade = Math.min(bidSharesAvailable, askSharesAvailable);

          const tradeValue = sharesToTrade * equilibriumPrice;
          const commission = tradeValue * 0.02;

          const { data: trade } = await supabase
            .from('market_trades')
            .insert({
              offering_id: offeringId,
              buyer_id: bid.user_id,
              seller_id: ask.user_id,
              shares_traded: sharesToTrade,
              price_per_share: equilibriumPrice,
              total_value: tradeValue,
              buy_order_id: bid.id,
              sell_order_id: ask.id,
              trade_type: eventType === 'opening_auction' ? 'opening' : 'closing',
              nuke_commission_pct: 2.0,
              nuke_commission_amount: commission,
              executed_at: new Date().toISOString()
            })
            .select()
            .single();

          if (trade) trades.push(trade);
        }

        // Record price discovery event
        await supabase.from('price_discovery_events').insert({
          offering_id: offeringId,
          event_type: eventType,
          bids_collected: bids.length,
          asks_collected: asks.length,
          equilibrium_price: equilibriumPrice,
          equilibrium_volume: equilibriumVolume,
          orders_matched: ordersMatched,
          total_value: equilibriumVolume * equilibriumPrice
        });

        // Update offering price
        await supabase
          .from('vehicle_offerings')
          .update({
            current_share_price: equilibriumPrice,
            [eventType === 'opening_auction' ? 'opening_price' : 'closing_price']: equilibriumPrice,
            status: eventType === 'closing_auction' ? 'closed' : 'trading'
          })
          .eq('id', offeringId);

        return {
          equilibrium_price: equilibriumPrice,
          equilibrium_volume: equilibriumVolume,
          orders_matched: ordersMatched,
          total_value: equilibriumVolume * equilibriumPrice,
          bids_collected: bids.length,
          asks_collected: asks.length
        };
      }

      return null;
    } catch (error) {
      console.error('Price discovery failed:', error);
      throw error;
    }
  }

  /**
   * Calculate market impact of a new order
   * Shows how much price will move based on order size
   */
  static async calculateMarketImpact(
    offeringId: string,
    orderType: OrderType,
    sharesRequested: number,
    pricePerShare: number
  ): Promise<MarketImpact> {
    try {
      const { data: offering } = await supabase
        .from('vehicle_offerings')
        .select('current_share_price')
        .eq('id', offeringId)
        .single();

      const initialPrice = offering?.current_share_price || pricePerShare;

      // Simple impact model: larger orders move price more
      const orderSizeRatio = sharesRequested / 1000; // Total shares
      const priceMovement = initialPrice * orderSizeRatio * 0.05; // 5% impact per size unit

      const priceAfterOrder =
        orderType === 'buy'
          ? initialPrice + priceMovement
          : initialPrice - priceMovement;

      const priceChangePercent = ((priceAfterOrder - initialPrice) / initialPrice) * 100;
      const impactCostPerShare = Math.abs(priceAfterOrder - pricePerShare);

      return {
        initial_price: initialPrice,
        price_after_order: priceAfterOrder,
        price_change_pct: priceChangePercent,
        impact_cost_per_share: impactCostPerShare
      };
    } catch (error) {
      console.error('Failed to calculate market impact:', error);
      throw error;
    }
  }

  /**
   * Get current order book (bid/ask levels)
   */
  static async getOrderBook(offeringId: string, depth: number = 10): Promise<OrderBookSnapshot> {
    try {
      const { data: orders, error } = await supabase
        .from('market_orders')
        .select('*')
        .eq('offering_id', offeringId)
        .eq('status', 'active')
        .order('price_per_share', { ascending: false });

      if (error) throw error;

      const bids = (orders || [])
        .filter(o => o.order_type === 'buy')
        .slice(0, depth)
        .map(o => o.price_per_share);

      const asks = (orders || [])
        .filter(o => o.order_type === 'sell')
        .slice(0, depth)
        .map(o => o.price_per_share);

      const highestBid = Math.max(...bids, 0);
      const lowestAsk = Math.min(...asks, Infinity);
      const bidAskSpread = lowestAsk === Infinity ? 0 : lowestAsk - highestBid;
      const weightedMidPrice = (highestBid + lowestAsk) / 2;

      return {
        offering_id: offeringId,
        highest_bid: highestBid,
        lowest_ask: lowestAsk === Infinity ? highestBid : lowestAsk,
        bid_ask_spread: bidAskSpread,
        buy_side_depth: bids.length,
        sell_side_depth: asks.length,
        weighted_mid_price: weightedMidPrice
      };
    } catch (error) {
      console.error('Failed to get order book:', error);
      throw error;
    }
  }

  /**
   * Update offering market data (called after each trade)
   */
  private static async updateOfferingMarketData(offeringId: string): Promise<void> {
    try {
      const orderBook = await this.getOrderBook(offeringId);

      await supabase
        .from('vehicle_offerings')
        .update({
          highest_bid: orderBook.highest_bid,
          lowest_ask: orderBook.lowest_ask,
          bid_ask_spread: orderBook.bid_ask_spread,
          updated_at: new Date().toISOString()
        })
        .eq('id', offeringId);
    } catch (error) {
      console.error('Failed to update offering market data:', error);
    }
  }

  /**
   * Cancel an order
   */
  static async cancelOrder(orderId: string, userId: string): Promise<boolean> {
    try {
      const { data: order, error: fetchError } = await supabase
        .from('market_orders')
        .select('*')
        .eq('id', orderId)
        .eq('user_id', userId)
        .single();

      if (fetchError) throw fetchError;
      if (!order) throw new Error('Order not found');
      if (order.status === 'filled') throw new Error('Cannot cancel filled order');

      const { error: updateError } = await supabase
        .from('market_orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', orderId);

      if (updateError) throw updateError;

      return true;
    } catch (error) {
      console.error('Failed to cancel order:', error);
      return false;
    }
  }

  /**
   * Get user portfolio value
   */
  static async getPortfolioValue(userId: string): Promise<number> {
    try {
      const { data: holdings, error } = await supabase
        .from('share_holdings')
        .select(
          `
          shares_owned,
          current_mark,
          vehicle_offerings (current_share_price)
        `
        )
        .eq('holder_id', userId);

      if (error) throw error;

      return (holdings || []).reduce((total, holding) => {
        return total + holding.shares_owned * (holding.current_mark || 0);
      }, 0);
    } catch (error) {
      console.error('Failed to get portfolio value:', error);
      return 0;
    }
  }

  /**
   * Get daily P&L
   */
  static async getDailyPnL(userId: string, date: Date = new Date()): Promise<number> {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const { data: trades, error } = await supabase
        .from('market_trades')
        .select('*')
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .gte('executed_at', startOfDay.toISOString());

      if (error) throw error;

      return (trades || []).reduce((total, trade) => {
        const amount = trade.buyer_id === userId ? -trade.total_value : trade.total_value;
        return total + amount - trade.nuke_commission_amount;
      }, 0);
    } catch (error) {
      console.error('Failed to get daily P&L:', error);
      return 0;
    }
  }
}
