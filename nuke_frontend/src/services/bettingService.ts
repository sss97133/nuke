/**
 * Betting/Speculation Service
 * Handles market predictions and bets on vehicle values
 */

import { supabase } from '../lib/supabase';

export type BetType = 'value_milestone' | 'completion_date' | 'next_mod_value' | 'auction_price';

export interface VehicleBet {
  id?: string;
  vehicle_id: string;
  user_id: string;
  bet_type: BetType;
  prediction: any;
  confidence_percent: number;
  stake_amount?: number;
  status?: 'active' | 'won' | 'lost' | 'cancelled';
  created_at?: string;
}

export interface MarketSentiment {
  vehicle_id: string;
  bet_type: BetType;
  total_bets: number;
  avg_confidence: number;
  avg_predicted_value: number;
  all_predictions: any[];
}

export class BettingService {
  /**
   * Create a new bet
   */
  static async createBet(bet: VehicleBet): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('vehicle_bets')
        .insert({
          vehicle_id: bet.vehicle_id,
          user_id: bet.user_id,
          bet_type: bet.bet_type,
          prediction: bet.prediction,
          confidence_percent: bet.confidence_percent,
          stake_amount: bet.stake_amount || 0
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Failed to create bet:', error);
      throw error;
    }
  }

  /**
   * Get user's bets for a vehicle
   */
  static async getUserBets(vehicleId: string, userId: string): Promise<VehicleBet[]> {
    try {
      const { data, error } = await supabase
        .from('vehicle_bets')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to get user bets:', error);
      return [];
    }
  }

  /**
   * Get all bets for a vehicle
   */
  static async getVehicleBets(vehicleId: string): Promise<VehicleBet[]> {
    try {
      const { data, error } = await supabase
        .from('vehicle_bets')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to get vehicle bets:', error);
      return [];
    }
  }

  /**
   * Get market sentiment for a vehicle
   */
  static async getMarketSentiment(vehicleId: string): Promise<MarketSentiment[]> {
    try {
      const { data, error } = await supabase
        .from('vehicle_market_sentiment')
        .select('*')
        .eq('vehicle_id', vehicleId);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to get market sentiment:', error);
      return [];
    }
  }

  /**
   * Update bet status (for resolving bets)
   */
  static async updateBetStatus(
    betId: string,
    status: 'won' | 'lost' | 'cancelled'
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('vehicle_bets')
        .update({
          status,
          resolved_at: new Date().toISOString()
        })
        .eq('id', betId);

      if (error) throw error;
    } catch (error) {
      console.error('Failed to update bet status:', error);
      throw error;
    }
  }

  /**
   * Get bet statistics for display
   */
  static async getBetStatistics(vehicleId: string): Promise<any> {
    try {
      const sentiment = await this.getMarketSentiment(vehicleId);
      const allBets = await this.getVehicleBets(vehicleId);

      // Find most common prediction
      const valueMilestoneBets = sentiment.find(s => s.bet_type === 'value_milestone');
      const completionBets = sentiment.find(s => s.bet_type === 'completion_date');
      const nextModBets = sentiment.find(s => s.bet_type === 'next_mod_value');

      return {
        total_bets: allBets.length,
        value_milestone: {
          avg_prediction: valueMilestoneBets?.avg_predicted_value || 0,
          confidence: valueMilestoneBets?.avg_confidence || 0,
          count: valueMilestoneBets?.total_bets || 0
        },
        completion_date: {
          count: completionBets?.total_bets || 0,
          avg_confidence: completionBets?.avg_confidence || 0
        },
        next_mod_value: {
          avg_prediction: nextModBets?.avg_predicted_value || 0,
          count: nextModBets?.total_bets || 0
        }
      };
    } catch (error) {
      console.error('Failed to get bet statistics:', error);
      return null;
    }
  }
}

