/**
 * Trading Service
 * 
 * Frontend wrapper for fractional ownership trading API calls.
 * Handles order placement, cancellation, and portfolio management.
 */

import { supabase } from '../lib/supabase';

export interface PlaceOrderParams {
  offeringId: string;
  orderType: 'buy' | 'sell';
  sharesRequested: number;
  pricePerShare: number;
  timeInForce?: 'day' | 'gtc' | 'fok' | 'ioc';
}

export interface OrderResponse {
  success: boolean;
  orderId?: string;
  status: 'active' | 'filled' | 'partially_filled' | 'rejected';
  sharesFilled: number;
  averageFillPrice?: number;
  totalValue?: number;
  commission?: number;
  message?: string;
  error?: string;
}

export interface CashBalance {
  balanceCents: number;
  availableCents: number;
  reservedCents: number;
}

export interface ShareHolding {
  id: string;
  offeringId: string;
  sharesOwned: number;
  entryPrice: number;
  currentMark: number;
  unrealizedGainLoss: number;
  unrealizedGainLossPct: number;
}

export class TradingService {
  /**
   * Place a market order (buy or sell)
   */
  static async placeOrder(params: PlaceOrderParams): Promise<OrderResponse> {
    try {
      const { data, error } = await supabase.functions.invoke('place-market-order', {
        body: params
      });

      if (error) {
        console.error('[TradingService] Place order error:', error);
        return {
          success: false,
          status: 'rejected',
          sharesFilled: 0,
          error: error.message || 'Failed to place order'
        };
      }

      return data as OrderResponse;
    } catch (error) {
      console.error('[TradingService] Unexpected error:', error);
      return {
        success: false,
        status: 'rejected',
        sharesFilled: 0,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get user's cash balance
   */
  static async getCashBalance(userId: string): Promise<CashBalance | null> {
    try {
      const { data, error } = await supabase
        .from('user_cash_balances')
        .select('balance_cents, available_cents, reserved_cents')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('[TradingService] Get cash balance error:', error);
        return null;
      }

      return {
        balanceCents: data.balance_cents,
        availableCents: data.available_cents,
        reservedCents: data.reserved_cents
      };
    } catch (error) {
      console.error('[TradingService] Unexpected error:', error);
      return null;
    }
  }

  /**
   * Get user's share holdings for an offering
   */
  static async getShareHolding(userId: string, offeringId: string): Promise<ShareHolding | null> {
    try {
      const { data, error } = await supabase
        .from('share_holdings')
        .select('*')
        .eq('holder_id', userId)
        .eq('offering_id', offeringId)
        .single();

      if (error) {
        // No holdings is not an error
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('[TradingService] Get share holding error:', error);
        return null;
      }

      return {
        id: data.id,
        offeringId: data.offering_id,
        sharesOwned: data.shares_owned,
        entryPrice: parseFloat(data.entry_price),
        currentMark: parseFloat(data.current_mark),
        unrealizedGainLoss: parseFloat(data.unrealized_gain_loss || '0'),
        unrealizedGainLossPct: parseFloat(data.unrealized_gain_loss_pct || '0')
      };
    } catch (error) {
      console.error('[TradingService] Unexpected error:', error);
      return null;
    }
  }

  /**
   * Get all of user's share holdings
   */
  static async getAllShareHoldings(userId: string): Promise<ShareHolding[]> {
    try {
      const { data, error } = await supabase
        .from('share_holdings')
        .select('*')
        .eq('holder_id', userId)
        .order('unrealized_gain_loss', { ascending: false });

      if (error) {
        console.error('[TradingService] Get all holdings error:', error);
        return [];
      }

      return (data || []).map((h: any) => ({
        id: h.id,
        offeringId: h.offering_id,
        sharesOwned: h.shares_owned,
        entryPrice: parseFloat(h.entry_price),
        currentMark: parseFloat(h.current_mark),
        unrealizedGainLoss: parseFloat(h.unrealized_gain_loss || '0'),
        unrealizedGainLossPct: parseFloat(h.unrealized_gain_loss_pct || '0')
      }));
    } catch (error) {
      console.error('[TradingService] Unexpected error:', error);
      return [];
    }
  }

  /**
   * Cancel an active order
   */
  static async cancelOrder(orderId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('market_orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', orderId)
        .eq('status', 'active'); // Only cancel active orders

      if (error) {
        console.error('[TradingService] Cancel order error:', error);
        return false;
      }

      // TODO: Release reserved funds/shares

      return true;
    } catch (error) {
      console.error('[TradingService] Unexpected error:', error);
      return false;
    }
  }

  /**
   * Get user's active orders
   */
  static async getActiveOrders(userId: string, offeringId?: string): Promise<any[]> {
    try {
      let query = supabase
        .from('market_orders')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['active', 'partially_filled'])
        .order('created_at', { ascending: false });

      if (offeringId) {
        query = query.eq('offering_id', offeringId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[TradingService] Get active orders error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[TradingService] Unexpected error:', error);
      return [];
    }
  }

  /**
   * Calculate order cost including commission
   */
  static calculateOrderCost(shares: number, pricePerShare: number, orderType: 'buy' | 'sell'): {
    subtotal: number;
    commission: number;
    total: number;
  } {
    const COMMISSION_PCT = 2.0;
    const subtotal = shares * pricePerShare;
    const commission = orderType === 'buy' ? (subtotal * COMMISSION_PCT / 100) : 0;
    const total = orderType === 'buy' ? subtotal + commission : subtotal;

    return {
      subtotal,
      commission,
      total
    };
  }

  /**
   * Format currency (cents to dollars)
   */
  static formatCurrency(cents: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(cents / 100);
  }
}

