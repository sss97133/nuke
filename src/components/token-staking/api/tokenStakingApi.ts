
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Token, Vehicle, TokenStake, TokenStakeStats } from "@/types/token";

/**
 * Fetches all active tokens from the database
 */
export const fetchTokens = async (): Promise<Token[]> => {
  try {
    const { data, error } = await supabase
      .from('tokens')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching tokens:', error);
    toast("Failed to load tokens");
    return [];
  }
};

/**
 * Fetches all vehicles from the database
 */
export const fetchVehicles = async (): Promise<Vehicle[]> => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    toast("Failed to load vehicles");
    return [];
  }
};

/**
 * Fetches user stakes using the appropriate query method
 */
export const fetchUserStakes = async (): Promise<TokenStake[]> => {
  try {
    // Get the current authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return [];
    }
    
    // Try using the RPC function first
    try {
      const { data, error } = await supabase.rpc('get_user_stakes', { 
        user_uuid: user.id 
      }) as { data: any[], error: Error | null };

      if (error) throw error;
      
      // Process data from RPC call
      return (data || []).map((stake: any) => ({
        id: stake.id,
        user_id: stake.user_id,
        token_id: stake.token_id,
        vehicle_id: stake.vehicle_id,
        amount: stake.amount,
        start_date: stake.start_date,
        end_date: stake.end_date,
        status: stake.status,
        predicted_roi: stake.predicted_roi,
        actual_roi: stake.actual_roi,
        created_at: stake.created_at,
        vehicle_name: stake.vehicle_name,
        token: stake.token,
        vehicle: stake.vehicle
      }));
    } catch (rpcError) {
      console.error('Error in RPC call, falling back to direct query:', rpcError);
      
      // Fallback to direct query if RPC is not available
      const { data, error } = await supabase.from('token_stakes')
        .select(`
          *,
          tokens:token_id (id, name, symbol),
          vehicles:vehicle_id (id, make, model, year)
        `)
        .eq('user_id', user.id) as { data: any[], error: Error | null };
      
      if (error) throw error;
      
      // Process the data
      return (data || []).map((stake: any) => ({
        id: stake.id,
        user_id: stake.user_id,
        token_id: stake.token_id,
        vehicle_id: stake.vehicle_id,
        amount: stake.amount,
        start_date: stake.start_date,
        end_date: stake.end_date,
        status: stake.status,
        predicted_roi: stake.predicted_roi,
        actual_roi: stake.actual_roi,
        created_at: stake.created_at,
        vehicle_name: stake.vehicle_name,
        token: stake.tokens,
        vehicle: stake.vehicles
      }));
    }
  } catch (error) {
    console.error('Error fetching user stakes:', error);
    toast("Failed to load your stakes");
    return [];
  }
};

/**
 * Fetches staking statistics for the current user
 */
export const fetchStakingStats = async (userId: string): Promise<TokenStakeStats | null> => {
  try {
    // Try to use the get_user_staking_stats RPC function
    try {
      const { data, error } = await supabase.rpc('get_user_staking_stats', { 
        user_uuid: userId 
      }) as { data: TokenStakeStats, error: Error | null };
      
      if (error) throw error;
      return data as TokenStakeStats;
    } catch (rpcError) {
      console.error('RPC error:', rpcError);
      
      // Fallback to calculating stats manually using a direct query
      const { data, error } = await supabase
        .from('token_stakes')
        .select('amount, predicted_roi, status, vehicle_name')
        .eq('user_id', userId) as { data: any[], error: Error | null };
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        return null;
      }
      
      // Calculate stats manually
      const activeStakes = data.filter(stake => stake.status === 'active').length;
      const totalStaked = data.reduce((sum, stake) => sum + Number(stake.amount), 0);
      const totalPredictedRoi = data.reduce((sum, stake) => sum + Number(stake.predicted_roi), 0);
      
      // Get unique vehicle count
      const uniqueVehicles = new Set(data
        .filter(stake => stake.vehicle_name)
        .map(stake => stake.vehicle_name));
      
      // Calculate distribution by vehicle
      const vehicleMap = new Map<string, number>();
      data.forEach(stake => {
        if (stake.vehicle_name) {
          const current = vehicleMap.get(stake.vehicle_name) || 0;
          vehicleMap.set(stake.vehicle_name, current + Number(stake.amount));
        }
      });
      
      const distributionByVehicle = Array.from(vehicleMap.entries())
        .map(([vehicle_name, amount]) => ({
          vehicle_name,
          amount,
          percentage: (amount / totalStaked) * 100
        }))
        .sort((a, b) => b.amount - a.amount);
      
      return {
        total_staked: totalStaked,
        total_predicted_roi: totalPredictedRoi,
        active_stakes: activeStakes,
        completed_stakes: data.filter(stake => stake.status === 'completed').length,
        avg_roi_percent: totalStaked > 0 ? (totalPredictedRoi / totalStaked) * 100 : 0,
        vehicle_count: uniqueVehicles.size,
        distribution_by_vehicle: distributionByVehicle
      };
    }
  } catch (error) {
    console.error('Error fetching staking stats:', error);
    toast("Failed to load staking statistics");
    return null;
  }
};

/**
 * Unstakes tokens for a given stake ID
 */
export const unstakeTokens = async (stakeId: string): Promise<boolean> => {
  try {
    // Get the current authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      toast("You must be logged in to unstake tokens");
      return false;
    }
    
    // Get the stake details
    const { data: stakeData, error: stakeError } = await supabase
      .from('token_stakes')
      .select('*')
      .eq('id', stakeId)
      .single() as { data: any, error: Error | null };
    
    if (stakeError || !stakeData) {
      toast("Failed to find stake information");
      return false;
    }
    
    // Check if the stake is finished
    const currentDate = new Date();
    const endDate = new Date(stakeData.end_date);
    
    if (currentDate < endDate) {
      toast("Cannot unstake before the staking period ends");
      return false;
    }
    
    // Update stake status
    const { error: updateStakeError } = await supabase
      .from('token_stakes')
      .update({ status: 'completed' })
      .eq('id', stakeId) as { error: Error | null };
    
    if (updateStakeError) throw updateStakeError;
    
    // Return tokens to user's holdings with rewards
    const finalAmount = Number(stakeData.amount) + Number(stakeData.predicted_roi);
    
    // Get current balance
    const { data: holdings, error: holdingsError } = await supabase
      .from('token_holdings')
      .select('balance')
      .eq('user_id', user.id)
      .eq('token_id', stakeData.token_id)
      .single() as { data: any, error: Error | null };
    
    if (holdingsError) {
      toast("Failed to verify token balance");
      return false;
    }
    
    const currentBalance = holdings?.balance || 0;
    
    // Update balance
    const { error: updateBalanceError } = await supabase
      .from('token_holdings')
      .update({ balance: currentBalance + finalAmount })
      .eq('user_id', user.id)
      .eq('token_id', stakeData.token_id) as { error: Error | null };
    
    if (updateBalanceError) throw updateBalanceError;
    
    toast("Tokens unstaked successfully with rewards!");
    return true;
  } catch (error) {
    console.error('Error unstaking tokens:', error);
    toast("Failed to unstake tokens");
    return false;
  }
};
