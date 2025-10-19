/**
 * Credits Service
 * Handles buying credits, allocating to vehicles, and builder payouts
 */

import { supabase } from '../lib/supabase';

export interface UserCredits {
  balance: number; // In cents (100 = $1)
  user_id: string;
}

export interface VehicleSupport {
  vehicle_id: string;
  supporter_count: number;
  total_credits: number;
  top_supporters: string[];
}

export class CreditsService {
  /**
   * Get user's credit balance
   */
  static async getUserBalance(userId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .rpc('get_user_credit_balance', { p_user_id: userId });
      
      if (error) throw error;
      return data || 0;
    } catch (error) {
      console.error('Failed to get credit balance:', error);
      return 0;
    }
  }

  /**
   * Buy credits with Stripe
   */
  static async buyCredits(amountUSD: number): Promise<string | null> {
    try {
      // Create Stripe checkout session via edge function
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: {
          amount_usd: amountUSD,
          success_url: `${window.location.origin}/credits/success`,
          cancel_url: `${window.location.origin}/credits`
        }
      });

      if (error) throw error;

      // Redirect to Stripe checkout
      return data.checkout_url;
    } catch (error) {
      console.error('Failed to create checkout:', error);
      return null;
    }
  }

  /**
   * Allocate credits to a vehicle (support/stake)
   */
  static async supportVehicle(
    vehicleId: string,
    credits: number,
    message?: string,
    anonymous: boolean = false
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .rpc('allocate_credits_to_vehicle', {
          p_vehicle_id: vehicleId,
          p_credits: credits,
          p_message: message,
          p_anonymous: anonymous
        });

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Failed to support vehicle:', error);
      throw error;
    }
  }

  /**
   * Get vehicle support summary
   */
  static async getVehicleSupport(vehicleId: string): Promise<VehicleSupport | null> {
    try {
      const { data, error } = await supabase
        .from('vehicle_support_summary')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No support yet
          return {
            vehicle_id: vehicleId,
            supporter_count: 0,
            total_credits: 0,
            top_supporters: []
          };
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Failed to get vehicle support:', error);
      return null;
    }
  }

  /**
   * Get user's support allocations
   */
  static async getUserSupport(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('vehicle_support')
        .select('*')
        .eq('supporter_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to get user support:', error);
      return [];
    }
  }

  /**
   * Request payout (for builders)
   */
  static async requestPayout(vehicleId: string, credits: number): Promise<boolean> {
    try {
      // Calculate amount after 1% platform fee
      const platformFee = Math.floor(credits * 0.01);
      const netCredits = credits - platformFee;
      const amountUSD = netCredits / 100;

      const { data, error } = await supabase
        .from('builder_payouts')
        .insert({
          user_id: (await supabase.auth.getUser()).data.user?.id,
          vehicle_id: vehicleId,
          amount_credits: credits,
          amount_usd: amountUSD,
          platform_fee_credits: platformFee,
          status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;

      // Trigger payout processing via edge function
      await supabase.functions.invoke('process-payout', {
        body: { payout_id: data.id }
      });

      return true;
    } catch (error) {
      console.error('Failed to request payout:', error);
      return false;
    }
  }

  /**
   * Get credit transaction history
   */
  static async getTransactionHistory(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('credit_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to get transaction history:', error);
      return [];
    }
  }

  /**
   * Format credits for display
   */
  static formatCredits(credits: number): string {
    const dollars = credits / 100;
    return `$${dollars.toFixed(2)}`;
  }

  /**
   * Get builder earnings for a vehicle
   */
  static async getBuilderEarnings(vehicleId: string, userId: string): Promise<number> {
    try {
      // Get total support for builder's vehicles
      const { data, error } = await supabase
        .from('vehicle_support')
        .select('credits_allocated')
        .eq('vehicle_id', vehicleId);

      if (error) throw error;

      const total = data?.reduce((sum, s) => sum + s.credits_allocated, 0) || 0;
      return total;
    } catch (error) {
      console.error('Failed to get builder earnings:', error);
      return 0;
    }
  }
}

