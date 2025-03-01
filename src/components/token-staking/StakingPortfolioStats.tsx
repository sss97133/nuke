
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TokenStakeStats } from '@/types/token';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, RefreshCw, TrendingUp, Car, PieChart } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
    return (
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load your staking statistics
            </AlertDescription>
          </Alert>
          {onRetry && (
            <Button onClick={onRetry} variant="outline" size="sm" className="mt-2">
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Skeleton className="h-24 rounded-md" />
            <Skeleton className="h-24 rounded-md" />
            <Skeleton className="h-24 rounded-md" />
            <Skeleton className="h-24 rounded-md" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!stats || (!stats.active_stakes && !stats.completed_stakes)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center p-6">
            <p className="text-muted-foreground">You don't have any staking activity yet.</p>
            <p className="text-sm text-muted-foreground mt-2">Stake tokens to see your portfolio statistics.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Statistics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/50 p-4 rounded-md">
            <div className="flex items-center text-muted-foreground mb-2">
              <PieChart className="h-4 w-4 mr-2" />
              <span className="text-sm">Total Staked</span>
            </div>
            <div className="text-xl font-bold">{stats.total_staked.toFixed(2)}</div>
          </div>
          <div className="bg-muted/50 p-4 rounded-md">
            <div className="flex items-center text-muted-foreground mb-2">
              <TrendingUp className="h-4 w-4 mr-2" />
              <span className="text-sm">Expected Returns</span>
            </div>
            <div className="text-xl font-bold text-green-600">+{stats.total_predicted_roi.toFixed(2)}</div>
          </div>
          <div className="bg-muted/50 p-4 rounded-md">
            <div className="flex items-center text-muted-foreground mb-2">
              <TrendingUp className="h-4 w-4 mr-2" />
              <span className="text-sm">Avg. ROI</span>
            </div>
            <div className="text-xl font-bold">{stats.avg_roi_percent.toFixed(2)}%</div>
          </div>
          <div className="bg-muted/50 p-4 rounded-md">
            <div className="flex items-center text-muted-foreground mb-2">
              <Car className="h-4 w-4 mr-2" />
              <span className="text-sm">Active Stakes</span>
            </div>
            <div className="text-xl font-bold">{stats.active_stakes}</div>
          </div>
        </div>

        {stats.distribution_by_vehicle && stats.distribution_by_vehicle.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-medium mb-3">Distribution by Vehicle</h3>
            <div className="space-y-2">
              {stats.distribution_by_vehicle.map((item, index) => (
                <div key={index} className="flex justify-between items-center">
                  <div className="flex items-center">
                    <Car className="h-3 w-3 mr-2" />
                    <span className="text-sm">{item.vehicle_name}</span>
                  </div>
                  <div className="text-sm">
                    {item.amount.toFixed(2)} ({item.percentage.toFixed(1)}%)
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StakingPortfolioStats;
