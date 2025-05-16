
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TokenStakeStats } from '@/types/token';
import { motion } from 'framer-motion';
import { CircleDollarSign, TrendingUp, BarChart3, Car } from 'lucide-react';
import StatCard from './StatCard';
import VehicleDistribution from './VehicleDistribution';

interface PortfolioStatsContentProps {
  stats: TokenStakeStats;
}

const PortfolioStatsContent = ({ stats }: PortfolioStatsContentProps) => {
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
            <StatCard 
              icon={CircleDollarSign}
              iconColor="text-primary"
              label="Total Staked"
              value={stats.total_staked.toFixed(2)}
              delay={0.1}
            />
            
            <StatCard 
              icon={TrendingUp}
              iconColor="text-green-500"
              label="Expected Returns"
              value={`+${stats.total_predicted_roi.toFixed(2)}`}
              delay={0.2}
            />
            
            <StatCard 
              icon={BarChart3}
              iconColor="text-blue-500"
              label="Avg. ROI"
              value={`${stats.avg_roi_percent.toFixed(2)}%`}
              delay={0.3}
            />
            
            <StatCard 
              icon={Car}
              iconColor="text-amber-500"
              label="Active Stakes"
              value={stats.active_stakes}
              delay={0.4}
            />
          </div>

          {stats.distribution_by_vehicle && stats.distribution_by_vehicle.length > 0 && (
            <VehicleDistribution distribution={stats.distribution_by_vehicle} />
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default PortfolioStatsContent;
