
import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  value: string | number;
  delay?: number;
}

const StatCard = ({ 
  icon: Icon, 
  iconColor, 
  label, 
  value, 
  delay = 0.1 
}: StatCardProps) => {
  return (
    <motion.div 
      className="bg-muted/50 p-4 rounded-md border border-primary/10 hover:border-primary/30 transition-all duration-300 hover:shadow-md"
      whileHover={{ y: -5, transition: { duration: 0.2 } }}
    >
      <div className="flex items-center text-muted-foreground mb-2">
        <Icon className={`h-4 w-4 mr-2 ${iconColor}`} />
        <span className="text-sm">{label}</span>
      </div>
      <motion.div 
        className="text-xl font-bold"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay, duration: 0.3 }}
      >
        {value}
      </motion.div>
    </motion.div>
  );
};

export default StatCard;
