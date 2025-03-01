
import { useState, useEffect } from "react";
import { Token, Vehicle, TokenStake, TokenStakeStats } from "@/types/token";
import { 
  fetchTokens, 
  fetchVehicles, 
  fetchUserStakes, 
  fetchStakingStats,
  unstakeTokens
} from "./api/tokenStakingApi";

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

  useEffect(() => {
    loadTokens();
    loadVehicles();
    loadUserStakes();
  }, []);

  const loadTokens = async () => {
    setIsLoadingTokens(true);
    setHasError(false);
    try {
      const data = await fetchTokens();
      setTokens(data);
    } catch (error) {
      console.error("Error loading tokens:", error);
      setHasError(true);
    } finally {
      setIsLoadingTokens(false);
    }
  };

  const loadVehicles = async () => {
    setIsLoadingVehicles(true);
    setHasError(false);
    try {
      const data = await fetchVehicles();
      setVehicles(data);
    } catch (error) {
      console.error("Error loading vehicles:", error);
      setHasError(true);
    } finally {
      setIsLoadingVehicles(false);
    }
  };

  const loadUserStakes = async () => {
    setIsLoadingStakes(true);
    setHasError(false);
    try {
      const data = await fetchUserStakes();
      setUserStakes(data);
      
      // After loading stakes, fetch stats if we have a user
      if (data.length > 0) {
        await loadStakingStats(data[0].user_id);
      } else {
        setStakingStats(null);
        setIsLoadingStats(false);
      }
    } catch (error) {
      console.error("Error loading user stakes:", error);
      setHasError(true);
      setIsLoadingStats(false);
    } finally {
      setIsLoadingStakes(false);
    }
  };

  const loadStakingStats = async (userId: string) => {
    setIsLoadingStats(true);
    setHasError(false);
    try {
      const stats = await fetchStakingStats(userId);
      setStakingStats(stats);
    } catch (error) {
      console.error("Error loading staking stats:", error);
      setHasError(true);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleUnstake = async (stakeId: string) => {
    try {
      const success = await unstakeTokens(stakeId);
      if (success) {
        // Refresh user stakes
        loadUserStakes();
      }
      return success;
    } catch (error) {
      console.error("Error unstaking tokens:", error);
      return false;
    }
  };

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
    fetchUserStakes: loadUserStakes,
    handleUnstake,
    retry
  };
};
