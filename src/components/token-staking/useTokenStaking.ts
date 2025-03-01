
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

  useEffect(() => {
    loadTokens();
    loadVehicles();
    loadUserStakes();
  }, []);

  const loadTokens = async () => {
    setIsLoadingTokens(true);
    const data = await fetchTokens();
    setTokens(data);
    setIsLoadingTokens(false);
  };

  const loadVehicles = async () => {
    setIsLoadingVehicles(true);
    const data = await fetchVehicles();
    setVehicles(data);
    setIsLoadingVehicles(false);
  };

  const loadUserStakes = async () => {
    setIsLoadingStakes(true);
    const data = await fetchUserStakes();
    setUserStakes(data);
    setIsLoadingStakes(false);
    
    // After loading stakes, fetch stats if we have a user
    if (data.length > 0) {
      await loadStakingStats(data[0].user_id);
    }
  };

  const loadStakingStats = async (userId: string) => {
    setIsLoadingStats(true);
    const stats = await fetchStakingStats(userId);
    setStakingStats(stats);
    setIsLoadingStats(false);
  };

  const handleUnstake = async (stakeId: string) => {
    const success = await unstakeTokens(stakeId);
    if (success) {
      // Refresh user stakes
      loadUserStakes();
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
    fetchUserStakes: loadUserStakes,
    handleUnstake
  };
};
