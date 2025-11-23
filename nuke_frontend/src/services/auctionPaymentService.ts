/**
 * Auction Payment Service
 * Handles bid deposits, payment holds, and auction settlement
 */

import { supabase } from '../lib/supabase';
import { loadStripe, Stripe, StripeElements } from '@stripe/stripe-js';

// Initialize Stripe (use your publishable key)
let stripePromise: Promise<Stripe | null> | null = null;

const getStripe = () => {
  if (!stripePromise) {
    const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    stripePromise = loadStripe(key);
  }
  return stripePromise;
};

export interface BidDepositResponse {
  success: boolean;
  bid_id?: string;
  deposit_amount_cents?: number;
  payment_intent_id?: string;
  error?: string;
}

export interface PaymentMethodSetup {
  success: boolean;
  payment_method_id?: string;
  customer_id?: string;
  error?: string;
}

export class AuctionPaymentService {
  /**
   * Setup payment method for user (first-time bidders)
   */
  static async setupPaymentMethod(
    cardElement: any
  ): Promise<PaymentMethodSetup> {
    try {
      const stripe = await getStripe();
      if (!stripe) {
        return { success: false, error: 'Stripe not initialized' };
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { success: false, error: 'Not authenticated' };
      }

      // Create payment method from card element
      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (pmError) {
        return { success: false, error: pmError.message };
      }

      // Attach payment method to customer via Edge Function
      const { data, error } = await supabase.functions.invoke('setup-payment-method', {
        body: {
          payment_method_id: paymentMethod!.id
        }
      });

      if (error) throw error;

      return {
        success: true,
        payment_method_id: paymentMethod!.id,
        customer_id: data.customer_id
      };
    } catch (error) {
      console.error('Error setting up payment method:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to setup payment'
      };
    }
  }

  /**
   * Place bid with deposit hold
   */
  static async placeBidWithDeposit(
    listingId: string,
    bidAmountCents: number,
    proxyMaxBidCents: number
  ): Promise<BidDepositResponse> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return { success: false, error: 'Not authenticated' };
      }

      // Call Edge Function to place bid and create deposit hold
      const { data, error } = await supabase.functions.invoke('place-bid-with-deposit', {
        body: {
          listing_id: listingId,
          bid_amount_cents: bidAmountCents,
          proxy_max_bid_cents: proxyMaxBidCents
        }
      });

      if (error) throw error;

      return {
        success: true,
        bid_id: data.bid_id,
        deposit_amount_cents: data.deposit_amount_cents,
        payment_intent_id: data.payment_intent_id
      };
    } catch (error) {
      console.error('Error placing bid with deposit:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to place bid'
      };
    }
  }

  /**
   * Get user's payment methods
   */
  static async getUserPaymentMethods(): Promise<any[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: profile } = await supabase
        .from('profiles')
        .select('payment_methods, default_payment_method')
        .eq('id', user.id)
        .single();

      return profile?.payment_methods || [];
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      return [];
    }
  }

  /**
   * Check if user has payment method on file
   */
  static async hasPaymentMethod(): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_customer_id, default_payment_method')
        .eq('id', user.id)
        .single();

      return !!(profile?.stripe_customer_id && profile?.default_payment_method);
    } catch (error) {
      console.error('Error checking payment method:', error);
      return false;
    }
  }

  /**
   * Get deposit amount for a bid
   */
  static async calculateDepositAmount(
    listingId: string,
    bidAmountCents: number
  ): Promise<number> {
    try {
      const { data, error } = await supabase
        .rpc('calculate_deposit_amount', {
          p_bid_amount_cents: bidAmountCents,
          p_listing_id: listingId
        });

      if (error) throw error;
      return data || Math.floor(bidAmountCents * 0.10); // Default 10%
    } catch (error) {
      console.error('Error calculating deposit:', error);
      return Math.floor(bidAmountCents * 0.10); // Default 10%
    }
  }

  /**
   * Get payment summary for a listing
   */
  static async getListingPaymentSummary(listingId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .rpc('get_listing_payment_summary', {
          p_listing_id: listingId
        });

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching payment summary:', error);
      return null;
    }
  }

  /**
   * Get user's active deposit holds
   */
  static async getActiveDeposits(): Promise<any[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from('auction_bids')
        .select(`
          id,
          listing_id,
          displayed_bid_cents,
          deposit_amount_cents,
          deposit_status,
          is_winning,
          created_at,
          vehicle_listings (
            id,
            vehicle_id,
            auction_end_time,
            status
          )
        `)
        .eq('bidder_id', user.id)
        .eq('deposit_status', 'authorized')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching active deposits:', error);
      return [];
    }
  }

  /**
   * Get payment transactions for a listing
   */
  static async getListingTransactions(listingId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('listing_id', listingId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching transactions:', error);
      return [];
    }
  }

  /**
   * Format currency for display
   */
  static formatCurrency(cents: number): string {
    return `$${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  /**
   * Calculate what percentage a deposit is
   */
  static calculateDepositPercentage(bidCents: number, depositCents: number): number {
    return Math.round((depositCents / bidCents) * 100);
  }
}

export default AuctionPaymentService;

