
import React from 'react';
import { TokenStakeStats } from '@/types/token';
import LoadingState from './portfolio-stats/LoadingState';
import ErrorState from './portfolio-stats/ErrorState';
import EmptyState from './portfolio-stats/EmptyState';
import PortfolioStatsContent from './portfolio-stats/PortfolioStatsContent';

interface StakingPortfolioStatsProps {
  stats: TokenStakeStats | null;
  isLoading: boolean;
  hasError?: boolean;
  onRetry?: () => void;
}

const StakingPortfolioStats = ({ 
  stats, 
  isLoading, 
  hasError = false,
  onRetry 
}: StakingPortfolioStatsProps) => {
  if (hasError) {
    return <ErrorState onRetry={onRetry} />;
  }

  if (isLoading) {
    return <LoadingState />;
  }

  if (!stats || (!stats.active_stakes && !stats.completed_stakes)) {
    return <EmptyState />;
  }

  return <PortfolioStatsContent stats={stats} />;
};

export default StakingPortfolioStats;
