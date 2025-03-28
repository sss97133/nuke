import { useState, useEffect } from "react";
import { StakingToken, StakingPosition, StakingStats, getStakingTokens, getStakingPositions, getStakingStats, unstakeTokens } from "./api/tokenStakingApi";

export const useTokenStaking = (address: string) => {
  const [tokens, setTokens] = useState<StakingToken[]>([]);
  const [positions, setPositions] = useState<StakingPosition[]>([]);
  const [stats, setStats] = useState<StakingStats>({
    totalStaked: '0',
    totalRewards: '0',
    stakersCount: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refreshData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [newTokens, newPositions, newStats] = await Promise.all([
        getStakingTokens(),
        getStakingPositions(address),
        getStakingStats()
      ]);
      setTokens(newTokens);
      setPositions(newPositions);
      setStats(newStats);
    } catch (err) {
      console.error("Error loading staking data:", err);
      setError(err instanceof Error ? err : new Error('Failed to fetch staking data'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnstake = async (positionId: string) => {
    try {
      const success = await unstakeTokens(positionId);
      if (success) {
        // Refresh data after successful unstake
        await refreshData();
      }
      return success;
    } catch (error) {
      console.error("Error unstaking tokens:", error);
      throw error;
    }
  };

  useEffect(() => {
    refreshData();
  }, [address]);

  return {
    tokens,
    positions,
    stats,
    isLoading,
    error,
    refreshData,
    handleUnstake
  };
}; 