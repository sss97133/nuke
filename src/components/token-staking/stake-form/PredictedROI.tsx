
import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { motion } from "framer-motion";
import { calculatePredictedROI } from "../utils/stakingUtils";

interface PredictedROIProps {
  amount: string;
  duration: string;
}

const PredictedROI = ({ amount, duration }: PredictedROIProps) => {
  if (!amount || !duration) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="bg-muted/50 border-primary/10 hover:border-primary/30 transition-all duration-300">
        <CardContent className="pt-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Predicted ROI:</span>
            <motion.span 
              className="font-semibold flex items-center text-green-600"
              initial={{ scale: 1 }}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 0.5, repeat: 0 }}
            >
              <TrendingUp className="h-4 w-4 text-green-500 mr-1" />
              {calculatePredictedROI(Number(amount), Number(duration))}
            </motion.span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default PredictedROI;
