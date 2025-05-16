
import React from 'react';
import { Progress } from "@/components/ui/progress";

interface CertificationProgressProps {
  progress: number;
}

export const CertificationProgress: React.FC<CertificationProgressProps> = ({ progress }) => {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span>Progress</span>
        <span>{progress}%</span>
      </div>
      <Progress value={progress} className="h-2" />
      <p className="text-xs text-muted-foreground text-center mt-1">
        Keep going! You're making great progress
      </p>
    </div>
  );
};
