
import React from 'react';
import { motion } from 'framer-motion';
import { Car } from 'lucide-react';

interface VehicleDistributionBarProps {
  vehicleName: string;
  amount: number;
  percentage: number;
  index: number;
}

const VehicleDistributionBar = ({
  vehicleName,
  amount,
  percentage,
  index
}: VehicleDistributionBarProps) => {
  return (
    <motion.div 
      className="bg-muted/30 p-3 rounded-md hover:bg-muted/50 transition-colors duration-200"
      initial={{ x: -10, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay: 0.2 + index * 0.1, duration: 0.3 }}
    >
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center">
          <Car className="h-3 w-3 mr-2 text-primary" />
          <span className="text-sm font-medium">{vehicleName}</span>
        </div>
        <div className="text-sm">
          {amount.toFixed(2)} ({percentage.toFixed(1)}%)
        </div>
      </div>
      <div className="w-full bg-muted rounded-full h-1.5 mt-1">
        <motion.div 
          className="bg-primary h-1.5 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ delay: 0.5 + index * 0.1, duration: 0.5 }}
        />
      </div>
    </motion.div>
  );
};

export default VehicleDistributionBar;
