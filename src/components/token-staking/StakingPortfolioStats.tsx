
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TokenStakeStats } from '@/types/token';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, RefreshCw, TrendingUp, Car, PieChart, CircleDollarSign, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

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
      <Card className="border-2 border-red-200/20">
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
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button onClick={onRetry} variant="outline" size="sm" className="mt-2 group">
                <RefreshCw className="h-4 w-4 mr-2 group-hover:rotate-180 transition-transform duration-500" /> 
                Retry
              </Button>
            </motion.div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="border-2 hover:border-primary/20 transition-all duration-300">
        <CardHeader>
          <CardTitle>Portfolio Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-24 rounded-md pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!stats || (!stats.active_stakes && !stats.completed_stakes)) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="border-2 hover:border-primary/20 transition-all duration-300">
          <CardHeader>
            <CardTitle>Portfolio Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center p-6 bg-muted/20 rounded-md border border-dashed border-muted">
              <p className="text-muted-foreground">You don't have any staking activity yet.</p>
              <p className="text-sm text-muted-foreground mt-2">Stake tokens to see your portfolio statistics.</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-2 hover:border-primary/20 transition-all duration-300">
        <CardHeader>
          <CardTitle>Portfolio Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <motion.div 
              className="bg-muted/50 p-4 rounded-md border border-primary/10 hover:border-primary/30 transition-all duration-300 hover:shadow-md"
              whileHover={{ y: -5, transition: { duration: 0.2 } }}
            >
              <div className="flex items-center text-muted-foreground mb-2">
                <CircleDollarSign className="h-4 w-4 mr-2 text-primary" />
                <span className="text-sm">Total Staked</span>
              </div>
              <motion.div 
                className="text-xl font-bold"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.3 }}
              >
                {stats.total_staked.toFixed(2)}
              </motion.div>
            </motion.div>
            
            <motion.div 
              className="bg-muted/50 p-4 rounded-md border border-primary/10 hover:border-primary/30 transition-all duration-300 hover:shadow-md"
              whileHover={{ y: -5, transition: { duration: 0.2 } }}
            >
              <div className="flex items-center text-muted-foreground mb-2">
                <TrendingUp className="h-4 w-4 mr-2 text-green-500" />
                <span className="text-sm">Expected Returns</span>
              </div>
              <motion.div 
                className="text-xl font-bold text-green-600"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.3 }}
              >
                +{stats.total_predicted_roi.toFixed(2)}
              </motion.div>
            </motion.div>
            
            <motion.div 
              className="bg-muted/50 p-4 rounded-md border border-primary/10 hover:border-primary/30 transition-all duration-300 hover:shadow-md"
              whileHover={{ y: -5, transition: { duration: 0.2 } }}
            >
              <div className="flex items-center text-muted-foreground mb-2">
                <BarChart3 className="h-4 w-4 mr-2 text-blue-500" />
                <span className="text-sm">Avg. ROI</span>
              </div>
              <motion.div 
                className="text-xl font-bold"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.3 }}
              >
                {stats.avg_roi_percent.toFixed(2)}%
              </motion.div>
            </motion.div>
            
            <motion.div 
              className="bg-muted/50 p-4 rounded-md border border-primary/10 hover:border-primary/30 transition-all duration-300 hover:shadow-md"
              whileHover={{ y: -5, transition: { duration: 0.2 } }}
            >
              <div className="flex items-center text-muted-foreground mb-2">
                <Car className="h-4 w-4 mr-2 text-amber-500" />
                <span className="text-sm">Active Stakes</span>
              </div>
              <motion.div 
                className="text-xl font-bold"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.3 }}
              >
                {stats.active_stakes}
              </motion.div>
            </motion.div>
          </div>

          {stats.distribution_by_vehicle && stats.distribution_by_vehicle.length > 0 && (
            <motion.div 
              className="mt-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.3 }}
            >
              <h3 className="text-sm font-medium mb-3 flex items-center">
                <PieChart className="h-4 w-4 mr-2 text-primary" />
                Distribution by Vehicle
              </h3>
              <div className="space-y-3">
                {stats.distribution_by_vehicle.map((item, index) => (
                  <motion.div 
                    key={index} 
                    className="bg-muted/30 p-3 rounded-md hover:bg-muted/50 transition-colors duration-200"
                    initial={{ x: -10, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: 0.2 + index * 0.1, duration: 0.3 }}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center">
                        <Car className="h-3 w-3 mr-2 text-primary" />
                        <span className="text-sm font-medium">{item.vehicle_name}</span>
                      </div>
                      <div className="text-sm">
                        {item.amount.toFixed(2)} ({item.percentage.toFixed(1)}%)
                      </div>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                      <motion.div 
                        className="bg-primary h-1.5 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${item.percentage}%` }}
                        transition={{ delay: 0.5 + index * 0.1, duration: 0.5 }}
                      />
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default StakingPortfolioStats;
