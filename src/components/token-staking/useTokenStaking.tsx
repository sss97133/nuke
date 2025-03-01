
import { useState, useEffect } from "react";
import { Token, Vehicle, TokenStake, TokenStakeStats } from "@/types/token";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const useTokenStaking = () => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(true);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true);
  const [userStakes, setUserStakes] = useState<TokenStake[]>([]);
  const [isLoadingStakes, setIsLoadingStakes] = useState(true);
  const [stakingStats, setStakingStats] = useState<TokenStakeStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [hasError, setHasError] = useState<boolean>(false);

  // Fetch tokens
  const loadTokens = async () => {
    setIsLoadingTokens(true);
    setHasError(false);
    try {
      const { data, error } = await supabase
        .from('tokens')
        .select('*');

      if (error) throw error;
      setTokens(data || []);
    } catch (error) {
      console.error("Error loading tokens:", error);
      setHasError(true);
    } finally {
      setIsLoadingTokens(false);
    }
  };

  // Fetch vehicles
  const loadVehicles = async () => {
    setIsLoadingVehicles(true);
    setHasError(false);
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*');

      if (error) throw error;
      setVehicles(data || []);
    } catch (error) {
      console.error("Error loading vehicles:", error);
      setHasError(true);
    } finally {
      setIsLoadingVehicles(false);
    }
  };

  // Fetch user stakes
  const loadUserStakes = async () => {
    setIsLoadingStakes(true);
    setHasError(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setUserStakes([]);
        setIsLoadingStakes(false);
        return;
      }

      const { data, error } = await supabase
        .from('token_stakes')
        .select(`
          *,
          token:token_id(*),
          vehicle:vehicle_id(*)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUserStakes(data || []);
      
      // After loading stakes, fetch stats
      await loadStakingStats(user.id);
    } catch (error) {
      console.error("Error loading user stakes:", error);
      setHasError(true);
      setIsLoadingStats(false);
    } finally {
      setIsLoadingStakes(false);
    }
  };

  // Fetch staking stats
  const loadStakingStats = async (userId: string) => {
    setIsLoadingStats(true);
    setHasError(false);
    try {
      // Get all active stakes for the user
      const { data: stakes, error: stakesError } = await supabase
        .from('token_stakes')
        .select(`
          *,
          vehicle:vehicle_id(make, model, year)
        `)
        .eq('user_id', userId);

      if (stakesError) throw stakesError;

      if (!stakes || stakes.length === 0) {
        setStakingStats(null);
        setIsLoadingStats(false);
        return;
      }

      // Calculate statistics
      const totalStaked = stakes.reduce((sum, stake) => sum + Number(stake.amount), 0);
      const totalPredictedRoi = stakes.reduce((sum, stake) => sum + Number(stake.predicted_roi || 0), 0);
      const activeStakes = stakes.filter(stake => stake.status === 'active').length;
      const completedStakes = stakes.filter(stake => stake.status === 'completed').length;
      
      // Calculate average ROI from completed stakes
      const completedStakesData = stakes.filter(stake => stake.status === 'completed');
      const avgRoiPercent = completedStakesData.length > 0
        ? completedStakesData.reduce((sum, stake) => sum + (Number(stake.actual_roi || stake.predicted_roi) / Number(stake.amount) * 100), 0) / completedStakesData.length
        : 0;

      // Calculate distribution by vehicle
      const vehicleMap = new Map<string, { amount: number, vehicle_name: string }>();
      
      stakes.forEach(stake => {
        const vehicle = stake.vehicle;
        const vehicleName = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : (stake.vehicle_name || 'Unknown Vehicle');
        
        if (!vehicleMap.has(stake.vehicle_id)) {
          vehicleMap.set(stake.vehicle_id, { 
            amount: Number(stake.amount), 
            vehicle_name: vehicleName 
          });
        } else {
          const existing = vehicleMap.get(stake.vehicle_id)!;
          vehicleMap.set(stake.vehicle_id, { 
            ...existing, 
            amount: existing.amount + Number(stake.amount) 
          });
        }
      });

      const distribution = Array.from(vehicleMap.entries()).map(([_, data]) => ({
        vehicle_name: data.vehicle_name,
        amount: data.amount,
        percentage: (data.amount / totalStaked) * 100
      }));

      setStakingStats({
        total_staked: totalStaked,
        total_predicted_roi: totalPredictedRoi,
        active_stakes: activeStakes,
        completed_stakes: completedStakes,
        avg_roi_percent: avgRoiPercent,
        vehicle_count: vehicleMap.size,
        distribution_by_vehicle: distribution
      });
    } catch (error) {
      console.error("Error loading staking stats:", error);
      setHasError(true);
    } finally {
      setIsLoadingStats(false);
    }
  };

  // Handle unstaking (claiming tokens)
  const handleUnstake = async (stakeId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Get the stake information
      const { data: stake, error: stakeError } = await supabase
        .from('token_stakes')
        .select('*')
        .eq('id', stakeId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (stakeError || !stake) {
        toast.error("Stake not found or access denied");
        return false;
      }

      // Update the stake status to completed
      const { error: updateError } = await supabase
        .from('token_stakes')
        .update({ status: 'completed' })
        .eq('id', stakeId)
        .eq('user_id', user.id);

      if (updateError) {
        toast.error("Failed to claim tokens");
        return false;
      }

      // Credit tokens back to user balance (with reward)
      const totalAmount = Number(stake.amount) + Number(stake.predicted_roi || 0);
      
      // Check if user already has holdings for this token
      const { data: holdings, error: holdingsError } = await supabase
        .from('token_holdings')
        .select('*')
        .eq('user_id', user.id)
        .eq('token_id', stake.token_id)
        .maybeSingle();

      if (holdingsError && !holdingsError.message.includes('No rows found')) {
        toast.error("Failed to verify token holdings");
        return false;
      }

      if (holdings) {
        // Update existing holdings
        const newBalance = Number(holdings.balance) + totalAmount;
        const { error } = await supabase
          .from('token_holdings')
          .update({ balance: newBalance })
          .eq('id', holdings.id);
          
        if (error) {
          toast.error("Failed to update token balance");
          return false;
        }
      } else {
        // Create new holdings
        const { error } = await supabase
          .from('token_holdings')
          .insert([{ 
            user_id: user.id, 
            token_id: stake.token_id,
            balance: totalAmount
          }]);
          
        if (error) {
          toast.error("Failed to add tokens to your balance");
          return false;
        }
      }

      toast.success(`Successfully claimed ${totalAmount} tokens`);
      
      // Refresh data
      await loadUserStakes();
      return true;
    } catch (error) {
      console.error("Error unstaking tokens:", error);
      toast.error("Failed to process the claim");
      return false;
    }
  };

  // Handle stake creation completion
  const handleStakeCreated = () => {
    loadUserStakes();
  };

  // Load initial data
  useEffect(() => {
    loadTokens();
    loadVehicles();
    loadUserStakes();
  }, []);

  // Handler for retrying data load on error
  const retry = () => {
    loadTokens();
    loadVehicles();
    loadUserStakes();
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
    hasError,
    handleUnstake,
    handleStakeCreated,
    retry
  };
};
