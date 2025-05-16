
import React from 'react';
import { Progress } from "@/components/ui/progress";

interface SkillHeaderProps {
  totalProgress: number;
}

export const SkillHeader: React.FC<SkillHeaderProps> = ({ totalProgress }) => {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">Skill Development</h2>
      <div className="flex items-center space-x-4">
        <div className="w-64">
          <Progress value={totalProgress} className="h-2" />
        </div>
        <span className="text-sm text-muted-foreground">
          {totalProgress.toFixed(1)}% Complete
        </span>
      </div>
    </div>
  );
};
