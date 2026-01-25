/**
 * Real-time Trading WebSocket Hook
 *
 * Uses Supabase Realtime to subscribe to:
 * - Order book changes (market_orders)
 * - Trade executions (market_trades)
 * - NBBO updates (nbbo_cache)
 *
 * Returns live market data for a specific offering
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Types
export interface OrderBookLevel {
  price: number;
  shares: number;
  orderCount: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];  // Sorted high to low
  asks: OrderBookLevel[];  // Sorted low to high
}

export interface Trade {
  id: string;
  price: number;
  shares: number;
  side: 'buy' | 'sell';  // Aggressor side
  timestamp: Date;
  buyerId?: string;
  sellerId?: string;
}

export interface NBBO {
  bestBid: number | null;
  bestBidSize: number;
  bestAsk: number | null;
  bestAskSize: number;
  spread: number | null;
  spreadPct: number | null;
  midPrice: number | null;
  lastTradePrice: number | null;
  lastTradeSize: number | null;
  lastTradeTime: Date | null;
}

export interface TradingWebSocketState {
  orderBook: OrderBook;
  recentTrades: Trade[];
  nbbo: NBBO;
  isConnected: boolean;
  lastUpdate: Date | null;
  error: string | null;
}

interface UseTradingWebSocketOptions {
  maxTrades?: number;       // Max trades to keep in memory (default 100)
  orderBookDepth?: number;  // Max levels per side (default 10)
}

export function useTradingWebSocket(
  offeringId: string | null,
  options: UseTradingWebSocketOptions = {}
): TradingWebSocketState & {
  refresh: () => Promise<void>;
} {
  const { maxTrades = 100, orderBookDepth = 10 } = options;

  const [state, setState] = useState<TradingWebSocketState>({
    orderBook: { bids: [], asks: [] },
    recentTrades: [],
    nbbo: {
      bestBid: null,
      bestBidSize: 0,
      bestAsk: null,
      bestAskSize: 0,
      spread: null,
      spreadPct: null,
      midPrice: null,
      lastTradePrice: null,
      lastTradeSize: null,
      lastTradeTime: null,
    },
    isConnected: false,
    lastUpdate: null,
    error: null,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);

  // Build order book from raw orders
  const buildOrderBook = useCallback((orders: any[]): OrderBook => {
    const bidMap = new Map<number, { shares: number; count: number }>();
    const askMap = new Map<number, { shares: number; count: number }>();

    orders.forEach(order => {
      if (order.status !== 'active' && order.status !== 'partially_filled') return;
      const available = order.shares_requested - order.shares_filled;
      if (available <= 0) return;

      const map = order.order_type === 'buy' ? bidMap : askMap;
      const existing = map.get(order.price_per_share) || { shares: 0, count: 0 };
      map.set(order.price_per_share, {
        shares: existing.shares + available,
        count: existing.count + 1,
      });
    });

    const bids = Array.from(bidMap.entries())
      .map(([price, data]) => ({ price, shares: data.shares, orderCount: data.count }))
      .sort((a, b) => b.price - a.price)
      .slice(0, orderBookDepth);

    const asks = Array.from(askMap.entries())
      .map(([price, data]) => ({ price, shares: data.shares, orderCount: data.count }))
      .sort((a, b) => a.price - b.price)
      .slice(0, orderBookDepth);

    return { bids, asks };
  }, [orderBookDepth]);

  // Fetch initial data
  const refresh = useCallback(async () => {
    if (!offeringId) return;

    try {
      // Fetch orders for order book
      const { data: orders, error: ordersError } = await supabase
        .from('market_orders')
        .select('*')
        .eq('offering_id', offeringId)
        .in('status', ['active', 'partially_filled']);

      if (ordersError) throw ordersError;

      // Fetch recent trades
      const { data: trades, error: tradesError } = await supabase
        .from('market_trades')
        .select('*')
        .eq('offering_id', offeringId)
        .order('executed_at', { ascending: false })
        .limit(maxTrades);

      if (tradesError) throw tradesError;

      // Fetch NBBO
      const { data: nbboData, error: nbboError } = await supabase
        .from('nbbo_cache')
        .select('*')
        .eq('offering_id', offeringId)
        .maybeSingle();

      // Build state
      const orderBook = buildOrderBook(orders || []);

      const recentTrades: Trade[] = (trades || []).map(t => ({
        id: t.id,
        price: t.price_per_share,
        shares: t.shares_traded,
        side: t.trade_type === 'market' ? 'buy' : 'sell',  // Simplified
        timestamp: new Date(t.executed_at),
        buyerId: t.buyer_id,
        sellerId: t.seller_id,
      }));

      const nbbo: NBBO = nbboData ? {
        bestBid: nbboData.best_bid,
        bestBidSize: nbboData.best_bid_size || 0,
        bestAsk: nbboData.best_ask,
        bestAskSize: nbboData.best_ask_size || 0,
        spread: nbboData.spread,
        spreadPct: nbboData.spread_pct,
        midPrice: nbboData.mid_price,
        lastTradePrice: nbboData.last_trade_price,
        lastTradeSize: nbboData.last_trade_size,
        lastTradeTime: nbboData.last_trade_time ? new Date(nbboData.last_trade_time) : null,
      } : {
        bestBid: orderBook.bids[0]?.price || null,
        bestBidSize: orderBook.bids[0]?.shares || 0,
        bestAsk: orderBook.asks[0]?.price || null,
        bestAskSize: orderBook.asks[0]?.shares || 0,
        spread: orderBook.bids[0] && orderBook.asks[0]
          ? orderBook.asks[0].price - orderBook.bids[0].price
          : null,
        spreadPct: null,
        midPrice: orderBook.bids[0] && orderBook.asks[0]
          ? (orderBook.bids[0].price + orderBook.asks[0].price) / 2
          : null,
        lastTradePrice: recentTrades[0]?.price || null,
        lastTradeSize: recentTrades[0]?.shares || null,
        lastTradeTime: recentTrades[0]?.timestamp || null,
      };

      setState(prev => ({
        ...prev,
        orderBook,
        recentTrades,
        nbbo,
        lastUpdate: new Date(),
        error: null,
      }));
    } catch (err) {
      console.error('Failed to refresh trading data:', err);
      setState(prev => ({
        ...prev,
        error: (err as Error).message,
      }));
    }
  }, [offeringId, maxTrades, buildOrderBook]);

  // Set up realtime subscriptions
  useEffect(() => {
    if (!offeringId) {
      setState(prev => ({ ...prev, isConnected: false }));
      return;
    }

    // Initial data fetch
    refresh();

    // Create realtime channel
    const channel = supabase.channel(`trading:${offeringId}`)
      // Subscribe to order changes
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'market_orders',
          filter: `offering_id=eq.${offeringId}`,
        },
        (payload) => {
          // Refresh order book on any order change
          refresh();
        }
      )
      // Subscribe to new trades
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'market_trades',
          filter: `offering_id=eq.${offeringId}`,
        },
        (payload) => {
          const newTrade = payload.new as any;
          setState(prev => {
            const trade: Trade = {
              id: newTrade.id,
              price: newTrade.price_per_share,
              shares: newTrade.shares_traded,
              side: newTrade.trade_type === 'market' ? 'buy' : 'sell',
              timestamp: new Date(newTrade.executed_at),
              buyerId: newTrade.buyer_id,
              sellerId: newTrade.seller_id,
            };
            return {
              ...prev,
              recentTrades: [trade, ...prev.recentTrades].slice(0, maxTrades),
              nbbo: {
                ...prev.nbbo,
                lastTradePrice: trade.price,
                lastTradeSize: trade.shares,
                lastTradeTime: trade.timestamp,
              },
              lastUpdate: new Date(),
            };
          });
        }
      )
      // Subscribe to NBBO updates
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'nbbo_cache',
          filter: `offering_id=eq.${offeringId}`,
        },
        (payload) => {
          const nbboData = payload.new as any;
          if (nbboData) {
            setState(prev => ({
              ...prev,
              nbbo: {
                bestBid: nbboData.best_bid,
                bestBidSize: nbboData.best_bid_size || 0,
                bestAsk: nbboData.best_ask,
                bestAskSize: nbboData.best_ask_size || 0,
                spread: nbboData.spread,
                spreadPct: nbboData.spread_pct,
                midPrice: nbboData.mid_price,
                lastTradePrice: nbboData.last_trade_price,
                lastTradeSize: nbboData.last_trade_size,
                lastTradeTime: nbboData.last_trade_time ? new Date(nbboData.last_trade_time) : null,
              },
              lastUpdate: new Date(),
            }));
          }
        }
      )
      .subscribe((status) => {
        setState(prev => ({
          ...prev,
          isConnected: status === 'SUBSCRIBED',
          error: status === 'CHANNEL_ERROR' ? 'Connection error' : null,
        }));
      });

    channelRef.current = channel;

    // Cleanup
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [offeringId, maxTrades, refresh]);

  return {
    ...state,
    refresh,
  };
}

export default useTradingWebSocket;
