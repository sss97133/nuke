
import React from 'react';
import { motion } from 'framer-motion';
import { PieChart } from 'lucide-react';
import VehicleDistributionBar from './VehicleDistributionBar';

interface VehicleDistribution {
  vehicle_name: string;
  amount: number;
  percentage: number;
}

interface VehicleDistributionProps {
  distribution: VehicleDistribution[];
}

const VehicleDistribution = ({ distribution }: VehicleDistributionProps) => {
  if (!distribution || distribution.length === 0) {
    return null;
  }

  return (
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
        {distribution.map((item, index) => (
          <VehicleDistributionBar 
            key={index}
            vehicleName={item.vehicle_name}
            amount={item.amount}
            percentage={item.percentage}
            index={index}
          />
        ))}
      </div>
    </motion.div>
  );
};

export default VehicleDistribution;
