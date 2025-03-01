
import { supabase } from "@/integrations/supabase/client";
import { Token, Vehicle, TokenStake, TokenStakeStats } from "@/types/token";

// Type assertion helper for token stakes table
const from = (table: string) => {
  return supabase.from(table) as any;
};

/**
 * Fetches available tokens for staking
 */
export const fetchTokens = async (): Promise<Token[]> => {
  try {
    const { data, error } = await supabase
      .from('tokens')
      .select('*')
      .order('name');
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching tokens:', error);
    throw error;
  }
};

/**
 * Fetches available vehicles for staking
 */
export const fetchVehicles = async (): Promise<Vehicle[]> => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .order('make');
    
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    throw error;
  }
};

/**
 * Fetches user's staked tokens with fallback mechanism
 */
export const fetchUserStakes = async (): Promise<TokenStake[]> => {
  try {
    // Get the current authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.warn("No authenticated user found");
      return [];
    }
    
    // First try to use the RPC function if it exists
    try {
      const { data, error } = await supabase.rpc('get_user_stakes', {
        user_id_param: user.id
      }) as { data: TokenStake[] | null, error: Error | null };
      
      if (error) throw error;
      if (data) return data;
    } catch (rpcError) {
      console.warn('RPC function get_user_stakes not available, falling back to direct query:', rpcError);
    }
    
    // Fallback to direct query if RPC fails
    try {
      // We need to use type assertion here because of TypeScript limitations with Supabase
      const { data, error } = await from('token_stakes')
        .select(`
          id, user_id, token_id, vehicle_id, amount, start_date, end_date, 
          status, predicted_roi, actual_roi, created_at, vehicle_name,
          tokens:token_id (id, name, symbol, description, total_supply, current_price, image_url),
          vehicles:vehicle_id (id, make, model, year, description, image_url)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return data.map(stake => ({
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
        // Handle nested objects
        token: stake.tokens,
        vehicle: stake.vehicles
      })) || [];
    } catch (queryError) {
      console.error('Error with direct query:', queryError);
      throw new Error('Failed to fetch user stakes: ' + queryError.message);
    }
  } catch (error) {
    console.error('Error fetching user stakes:', error);
    throw error;
  }
};

/**
 * Fetches user's staking statistics with fallback
 */
export const fetchStakingStats = async (userId: string): Promise<TokenStakeStats> => {
  try {
    // First try to use the RPC function if it exists
    try {
      const { data, error } = await supabase.rpc('get_user_staking_stats', {
        user_id_param: userId
      }) as { data: TokenStakeStats | null, error: Error | null };
      
      if (error) throw error;
      if (data) return data;
    } catch (rpcError) {
      console.warn('RPC function get_user_staking_stats not available, falling back to calculations:', rpcError);
    }
    
    // Fallback to manual calculation if RPC fails
    // Fetch user stakes
    const { data: stakesData, error: stakesError } = await from('token_stakes')
      .select('*')
      .eq('user_id', userId);
    
    if (stakesError) throw stakesError;
    
    if (!stakesData || stakesData.length === 0) {
      return {
        total_staked: 0,
        active_stakes: 0,
        completed_stakes: 0,
        total_predicted_roi: 0,
        avg_roi_percent: 0,
        distribution_by_vehicle: []
      };
    }
    
    // Calculate statistics from stakes data
    const stakes = stakesData as any[];
    const currentDate = new Date();
    
    const activeStakes = stakes.filter(stake => 
      stake.status === 'active' && new Date(stake.end_date) > currentDate
    );
    
    const completedStakes = stakes.filter(stake => 
      stake.status === 'completed' || new Date(stake.end_date) <= currentDate
    );
    
    const totalStaked = stakes.reduce((sum, stake) => sum + parseFloat(stake.amount), 0);
    const totalPredictedROI = stakes.reduce((sum, stake) => sum + parseFloat(stake.predicted_roi), 0);
    
    // Calculate average ROI
    const avgRoiPercent = totalStaked > 0 
      ? (totalPredictedROI / totalStaked) * 100 
      : 0;
    
    // Calculate distribution by vehicle
    const vehicleMap = new Map();
    
    stakes.forEach(stake => {
      const vehicleName = stake.vehicle_name || 'Unknown Vehicle';
      const amount = parseFloat(stake.amount);
      
      if (vehicleMap.has(vehicleName)) {
        vehicleMap.set(vehicleName, vehicleMap.get(vehicleName) + amount);
      } else {
        vehicleMap.set(vehicleName, amount);
      }
    });
    
    const distributionByVehicle = Array.from(vehicleMap.entries()).map(([vehicle_name, amount]) => ({
      vehicle_name,
      amount,
      percentage: (amount as number / totalStaked) * 100
    }));
    
    return {
      total_staked: totalStaked,
      active_stakes: activeStakes.length,
      completed_stakes: completedStakes.length,
      total_predicted_roi: totalPredictedROI,
      avg_roi_percent: avgRoiPercent,
      distribution_by_vehicle: distributionByVehicle
    };
  } catch (error) {
    console.error('Error fetching staking stats:', error);
    throw error;
  }
};

/**
 * Unstakes tokens with better error handling
 */
export const unstakeTokens = async (stakeId: string): Promise<boolean> => {
  try {
    // Get the stake details first
    const { data: stakeData, error: stakeError } = await from('token_stakes')
      .select('*')
      .eq('id', stakeId)
      .single();
    
    if (stakeError) throw new Error(`Failed to find stake: ${stakeError.message}`);
    if (!stakeData) throw new Error('Stake not found');
    
    const stake = stakeData as any;
    
    // Check if the stake end date is in the past
    const endDate = new Date(stake.end_date);
    const currentDate = new Date();
    
    if (currentDate < endDate && stake.status !== 'completed') {
      throw new Error('Stake is not yet ready to be claimed');
    }
    
    // Get the current authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');
    
    // Verify the user owns this stake
    if (stake.user_id !== user.id) {
      throw new Error('You do not own this stake');
    }
    
    // Update the stake status
    const { error: updateError } = await from('token_stakes')
      .update({ status: 'completed' })
      .eq('id', stakeId);
    
    if (updateError) throw updateError;
    
    // Update the user's token balance
    const { error: holdingsError } = await supabase
      .from('token_holdings')
      .upsert([
        {
          user_id: user.id,
          token_id: stake.token_id,
          balance: supabase.rpc('increment_balance', {
            row_token_id: stake.token_id,
            row_user_id: user.id,
            amount_to_add: stake.amount + stake.predicted_roi
          })
        }
      ]);
    
    if (holdingsError) throw holdingsError;
    
    return true;
  } catch (error) {
    console.error('Error unstaking tokens:', error);
    throw error;
  }
};
