
import React from 'react';
import { Progress } from "@/components/ui/progress";

interface ProgressDisplayProps {
  completedSteps: number[];
  totalSteps: number;
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ 
  completedSteps, 
  totalSteps 
}) => {
  const progress = (completedSteps.length / totalSteps) * 100;
  
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium">Your progress</span>
        <span className="text-sm text-muted-foreground">
          {completedSteps.length} of {totalSteps} steps completed
        </span>
      </div>
      <Progress value={progress} className="h-2" />
    </div>
  );
};
