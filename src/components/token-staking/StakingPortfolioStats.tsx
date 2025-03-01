
import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CircleCheck, CircleDollarSign, LineChart, TrendingUp } from "lucide-react";
import { TokenStakeStats } from "@/types/token";
import { Skeleton } from "@/components/ui/skeleton";

interface StakingPortfolioStatsProps {
  stats: TokenStakeStats | null;
  isLoading: boolean;
}

const StakingPortfolioStats: React.FC<StakingPortfolioStatsProps> = ({ stats, isLoading }) => {
  if (isLoading) {
    return (
      <Card className="bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl">Staking Portfolio</CardTitle>
          <CardDescription>Loading your stake statistics...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="bg-muted/30">
                <CardContent className="p-4">
                  <Skeleton className="h-4 w-8 mb-2" />
                  <Skeleton className="h-8 w-24 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // If no stats or no active stakes
  if (!stats || (stats.active_stakes === 0 && stats.completed_stakes === 0)) {
    return null;
  }

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-xl">Staking Portfolio</CardTitle>
        <CardDescription>Overview of your vehicle stake investments</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Total Staked</span>
              </div>
              <p className="text-2xl font-bold mt-1">{stats.total_staked.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">tokens</p>
            </CardContent>
          </Card>
          
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Expected Returns</span>
              </div>
              <p className="text-2xl font-bold mt-1">{stats.total_predicted_roi.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">tokens</p>
            </CardContent>
          </Card>
          
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <LineChart className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Avg. ROI</span>
              </div>
              <p className="text-2xl font-bold mt-1">{stats.avg_roi_percent.toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground">return on investment</p>
            </CardContent>
          </Card>
          
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CircleCheck className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Active Stakes</span>
              </div>
              <p className="text-2xl font-bold mt-1">{stats.active_stakes}</p>
              <p className="text-xs text-muted-foreground">across {stats.vehicle_count || 0} vehicles</p>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
};

export default StakingPortfolioStats;
