/**
 * Auction Voting Service
 * Community voting to send vehicles to auction
 */

import { supabase } from '../lib/supabase';

export interface AuctionVote {
  id?: string;
  vehicle_id: string;
  user_id: string;
  vote: 'yes' | 'no';
  reason?: string;
  estimated_value?: number;
  created_at?: string;
}

export interface AuctionVoteSummary {
  vehicle_id: string;
  total_votes: number;
  yes_votes: number;
  no_votes: number;
  yes_percent: number;
  avg_estimated_value: number;
  last_vote_at: string;
}

export class AuctionVotingService {
  /**
   * Cast or update a vote
   */
  static async castVote(vote: AuctionVote): Promise<void> {
    try {
      const { error } = await supabase
        .from('auction_votes')
        .upsert({
          vehicle_id: vote.vehicle_id,
          user_id: vote.user_id,
          vote: vote.vote,
          reason: vote.reason,
          estimated_value: vote.estimated_value,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'vehicle_id,user_id'
        });

      if (error) throw error;
    } catch (error) {
      console.error('Failed to cast vote:', error);
      throw error;
    }
  }

  /**
   * Get user's vote for a vehicle
   */
  static async getUserVote(vehicleId: string, userId: string): Promise<AuctionVote | null> {
    try {
      const { data, error } = await supabase
        .from('auction_votes')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null; // No vote found
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Failed to get user vote:', error);
      return null;
    }
  }

  /**
   * Get vote summary for a vehicle
   */
  static async getVoteSummary(vehicleId: string): Promise<AuctionVoteSummary | null> {
    try {
      const { data, error } = await supabase
        .from('auction_vote_summary')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No votes yet
          return {
            vehicle_id: vehicleId,
            total_votes: 0,
            yes_votes: 0,
            no_votes: 0,
            yes_percent: 0,
            avg_estimated_value: 0,
            last_vote_at: new Date().toISOString()
          };
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Failed to get vote summary:', error);
      return null;
    }
  }

  /**
   * Get all votes for a vehicle (for admin/display)
   */
  static async getAllVotes(vehicleId: string): Promise<AuctionVote[]> {
    try {
      const { data, error } = await supabase
        .from('auction_votes')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Failed to get all votes:', error);
      return [];
    }
  }

  /**
   * Check if vehicle should go to auction (>50% yes votes with minimum threshold)
   */
  static async shouldGoToAuction(
    vehicleId: string,
    minimumVotes: number = 5
  ): Promise<boolean> {
    try {
      const summary = await this.getVoteSummary(vehicleId);
      
      if (!summary) return false;

      return (
        summary.total_votes >= minimumVotes &&
        summary.yes_percent > 50
      );
    } catch (error) {
      console.error('Failed to check auction eligibility:', error);
      return false;
    }
  }

  /**
   * Delete a vote
   */
  static async deleteVote(vehicleId: string, userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('auction_votes')
        .delete()
        .eq('vehicle_id', vehicleId)
        .eq('user_id', userId);

      if (error) throw error;
    } catch (error) {
      console.error('Failed to delete vote:', error);
      throw error;
    }
  }
}

