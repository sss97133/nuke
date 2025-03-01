
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Token, Vehicle, TokenStake, TokenStakeStats } from "@/types/token";

export const useTokenStaking = () => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(true);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true);
  const [userStakes, setUserStakes] = useState<TokenStake[]>([]);
  const [isLoadingStakes, setIsLoadingStakes] = useState(true);
  const [stakingStats, setStakingStats] = useState<TokenStakeStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  useEffect(() => {
    fetchTokens();
    fetchVehicles();
    fetchUserStakes();
  }, []);

  const fetchTokens = async () => {
    setIsLoadingTokens(true);
    try {
      const { data, error } = await supabase
        .from('tokens')
        .select('*')
        .eq('status', 'active');

      if (error) throw error;
      setTokens(data || []);
    } catch (error) {
      console.error('Error fetching tokens:', error);
      toast("Failed to load tokens");
    } finally {
      setIsLoadingTokens(false);
    }
  };

  const fetchVehicles = async () => {
    setIsLoadingVehicles(true);
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*');

      if (error) throw error;
      setVehicles(data || []);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      toast("Failed to load vehicles");
    } finally {
      setIsLoadingVehicles(false);
    }
  };

  const fetchUserStakes = async () => {
    setIsLoadingStakes(true);
    try {
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setUserStakes([]);
        return;
      }
      
      const { data, error } = await supabase
        .from('token_stakes')
        .select(`
          *,
          token:token_id(id, name, symbol),
          vehicle:vehicle_id(id, make, model, year)
        `)
        .eq('user_id', user.id);

      if (error) throw error;
      
      // Process data into TokenStake objects with referenced data
      const stakes: TokenStake[] = (data || []).map(stake => ({
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
        // Add the related objects
        token: stake.token,
        vehicle: stake.vehicle
      }));

      setUserStakes(stakes);
      
      // After loading stakes, fetch stats
      fetchStakingStats(user.id);
    } catch (error) {
      console.error('Error fetching user stakes:', error);
      toast("Failed to load your stakes");
    } finally {
      setIsLoadingStakes(false);
    }
  };

  const fetchStakingStats = async (userId: string) => {
    setIsLoadingStats(true);
    try {
      // Run a query to aggregate counts and totals
      const { data, error } = await supabase
        .from('token_stakes')
        .select(`
          amount,
          predicted_roi,
          status,
          vehicle_name
        `)
        .eq('user_id', userId);
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        setStakingStats(null);
        return;
      }
      
      // Calculate stats manually
      const activeStakes = data.filter(stake => stake.status === 'active');
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
      
      const stats: TokenStakeStats = {
        total_staked: totalStaked,
        total_predicted_roi: totalPredictedRoi,
        active_stakes: activeStakes.length,
        completed_stakes: data.filter(stake => stake.status === 'completed').length,
        avg_roi_percent: totalStaked > 0 ? (totalPredictedRoi / totalStaked) * 100 : 0,
        vehicle_count: uniqueVehicles.size,
        distribution_by_vehicle: distributionByVehicle
      };
      
      setStakingStats(stats);
    } catch (error) {
      console.error('Error fetching staking stats:', error);
      toast("Failed to load staking statistics");
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleUnstake = async (stakeId: string) => {
    try {
      // Get the current authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast("You must be logged in to unstake tokens");
        return;
      }
      
      // Get the stake details
      const { data: stakeData, error: stakeError } = await supabase
        .from('token_stakes')
        .select('*')
        .eq('id', stakeId)
        .single();
      
      if (stakeError || !stakeData) {
        toast("Failed to find stake information");
        return;
      }
      
      // Check if the stake is finished
      const currentDate = new Date();
      const endDate = new Date(stakeData.end_date);
      
      if (currentDate < endDate) {
        toast("Cannot unstake before the staking period ends");
        return;
      }
      
      // Update stake status
      const { error: updateStakeError } = await supabase
        .from('token_stakes')
        .update({ status: 'completed' })
        .eq('id', stakeId);
      
      if (updateStakeError) throw updateStakeError;
      
      // Return tokens to user's holdings with rewards
      const finalAmount = Number(stakeData.amount) + Number(stakeData.predicted_roi);
      
      // Get current balance
      const { data: holdings, error: holdingsError } = await supabase
        .from('token_holdings')
        .select('balance')
        .eq('user_id', user.id)
        .eq('token_id', stakeData.token_id)
        .single();
      
      if (holdingsError) {
        toast("Failed to verify token balance");
        return;
      }
      
      const currentBalance = holdings?.balance || 0;
      
      // Update balance
      const { error: updateBalanceError } = await supabase
        .from('token_holdings')
        .update({ balance: currentBalance + finalAmount })
        .eq('user_id', user.id)
        .eq('token_id', stakeData.token_id);
      
      if (updateBalanceError) throw updateBalanceError;
      
      toast("Tokens unstaked successfully with rewards!");
      
      // Refresh user stakes
      fetchUserStakes();
      
    } catch (error) {
      console.error('Error unstaking tokens:', error);
      toast("Failed to unstake tokens");
    }
  };

  return {
    tokens,
    vehicles,
    isLoadingTokens,
    isLoadingVehicles,
    userStakes,
    isLoadingStakes,
    stakingStats,
    isLoadingStats,
    fetchUserStakes,
    handleUnstake
  };
};
