import React from 'react';
import { Gauge, Target } from 'lucide-react';
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SkillHeaderProps {
  totalProgress: number;
}

export const SkillHeader = ({ totalProgress }: SkillHeaderProps) => {
  return (
    <div className="flex items-center justify-between mb-8 border-b border-border pb-4">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Gauge className="w-8 h-8 text-primary animate-pulse" />
          <div className="absolute -top-1 -right-1">
            <div className="bg-primary rounded-full p-1">
              <Target className="w-3 h-3 text-primary-foreground" />
            </div>
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Developometer</h2>
          <p className="text-muted-foreground text-sm">Track your development progress</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-2">
                <Progress value={totalProgress} className="w-32" />
                <span className="text-sm text-muted-foreground">{Math.round(totalProgress)}%</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Overall Progress</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
};