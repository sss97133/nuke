import React from 'react';
import { Trophy, ArrowUpCircle, Info, Award } from 'lucide-react';
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SkillCategory = 'mechanical' | 'electrical' | 'bodywork' | 'diagnostics' | 'restoration' | 'customization';

interface SkillStatus {
  level: number;
  exp: number;
  progress: number;
  isComplete: boolean;
  hasStarted: boolean;
}

interface SkillCardProps {
  skill: {
    id: string;
    name: string;
    description: string;
    category: SkillCategory;
    prerequisites?: string[];
  };
  status: SkillStatus;
}

export const SkillCard = ({ skill, status }: SkillCardProps) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "relative border rounded-lg p-4 transition-all duration-300 hover:shadow-lg cursor-pointer",
              status.isComplete ? "bg-primary/10 border-primary" : 
              status.hasStarted ? "bg-muted border-primary/50" : 
              "hover:border-primary/50 border-border"
            )}
          >
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-medium text-foreground flex items-center gap-2">
                {skill.name}
                {status.isComplete && (
                  <Trophy className="w-4 h-4 text-yellow-500" />
                )}
              </h3>
              {status.hasStarted && !status.isComplete && (
                <ArrowUpCircle className="w-4 h-4 text-primary animate-pulse" />
              )}
            </div>
            
            <p className="text-sm text-muted-foreground mb-3">{skill.description}</p>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Level {status.level}</span>
                <span className="text-muted-foreground">{status.exp} XP</span>
              </div>
              <Progress 
                value={status.progress} 
                className={cn(
                  "h-1.5",
                  status.isComplete ? "bg-primary/20" : "bg-muted"
                )}
              />
            </div>
            
            {skill.prerequisites?.length > 0 && (
              <div className="absolute top-2 right-2">
                <Info className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            
            {status.level >= 3 && (
              <div className="absolute -top-2 -right-2">
                <Award className="w-5 h-5 text-primary" />
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="p-3 space-y-2">
          <div className="space-y-1">
            <div className="font-medium flex items-center gap-2">
              <Info className="w-4 h-4" />
              <span>Skill Details</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Level: {status.level} / 5
            </p>
            <p className="text-sm text-muted-foreground">
              XP: {status.exp} / {(status.level + 1) * 1000}
            </p>
            {skill.prerequisites?.length > 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                Prerequisites required
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};