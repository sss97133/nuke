/**
 * Cash Balance Service
 * Professional trading account management
 * Replaces the old "credits" system with proper USD cash balances
 */

import { supabase } from '../lib/supabase';

export interface CashBalance {
  balance_cents: number;
  available_cents: number;
  reserved_cents: number;
  balance_usd: number;
  available_usd: number;
  reserved_usd: number;
}

export interface CashTransaction {
  id: string;
  user_id: string;
  amount_cents: number;
  amount_usd: number;
  transaction_type: 'deposit' | 'withdrawal' | 'trade_buy' | 'trade_sell' | 'fee' | 'refund';
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  stripe_payment_id?: string;
  stripe_payout_id?: string;
  reference_id?: string;
  metadata?: any;
  created_at: string;
  completed_at?: string;
}

export class CashBalanceService {
  /**
   * Get user's cash balance
   */
  static async getUserBalance(userId: string): Promise<CashBalance | null> {
    try {
      const { data, error } = await supabase
        .from('user_cash_balances')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No balance record yet
          return {
            balance_cents: 0,
            available_cents: 0,
            reserved_cents: 0,
            balance_usd: 0,
            available_usd: 0,
            reserved_usd: 0
          };
        }
        throw error;
      }

      return {
        balance_cents: data.balance_cents,
        available_cents: data.available_cents,
        reserved_cents: data.reserved_cents,
        balance_usd: data.balance_cents / 100,
        available_usd: data.available_cents / 100,
        reserved_usd: data.reserved_cents / 100
      };
    } catch (error) {
      console.error('Failed to get cash balance:', error);
      return null;
    }
  }

  /**
   * Deposit cash (create Stripe checkout)
   */
  static async depositCash(amountUSD: number): Promise<string | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: {
          amount_usd: amountUSD,
          success_url: `${window.location.origin}/portfolio/success`,
          cancel_url: `${window.location.origin}/portfolio`
        }
      });

      if (error) throw error;
      return data.checkout_url;
    } catch (error) {
      console.error('Failed to create deposit:', error);
      return null;
    }
  }

  /**
   * Withdraw cash (create Stripe payout)
   */
  static async withdrawCash(amountUSD: number): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const amountCents = Math.floor(amountUSD * 100);

      // Check available balance first
      const balance = await this.getUserBalance(user.id);
      if (!balance || balance.available_cents < amountCents) {
        throw new Error('Insufficient available balance');
      }

      const { error } = await supabase.functions.invoke('create-payout', {
        body: {
          amount_cents: amountCents
        }
      });

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Failed to withdraw cash:', error);
      throw error;
    }
  }

  /**
   * Get transaction history
   */
  static async getTransactionHistory(userId: string, limit: number = 50): Promise<CashTransaction[]> {
    try {
      const { data, error } = await supabase
        .from('cash_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map(tx => ({
        ...tx,
        amount_usd: tx.amount_cents / 100
      }));
    } catch (error) {
      console.error('Failed to get transaction history:', error);
      return [];
    }
  }

  /**
   * Format currency for display
   */
  static formatCurrency(cents: number): string {
    const dollars = cents / 100;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(dollars);
  }

  /**
   * Format currency without symbol
   */
  static formatAmount(cents: number): string {
    const dollars = cents / 100;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(dollars);
  }

  /**
   * Get available balance (convenience method)
   */
  static async getAvailableBalance(userId: string): Promise<number> {
    const balance = await this.getUserBalance(userId);
    return balance?.available_cents || 0;
  }

  /**
   * Check if user has sufficient funds
   */
  static async hasSufficientFunds(userId: string, amountCents: number): Promise<boolean> {
    const available = await this.getAvailableBalance(userId);
    return available >= amountCents;
  }
}

