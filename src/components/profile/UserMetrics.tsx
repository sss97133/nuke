
import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { InfoIcon } from 'lucide-react';

interface ProfileData {
  user_type: string;
  reputation_score: number;
  achievements_count: number;
}

export const UserMetrics = ({ profile }: { profile: ProfileData }) => {
  console.log("UserMetrics rendering with profile:", profile);
  
  // Safely access profile properties with nullish checks
  const userType = profile?.user_type || 'viewer';
  const reputationScore = profile?.reputation_score || 0;
  const achievementsCount = profile?.achievements_count || 0;

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-3 mt-4">
      <div className="bg-card p-4 rounded-lg border shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Type</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="w-64">Your user type determines what features you can access and how you interact with the platform.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center">
          <Badge variant="outline" className="capitalize bg-primary/10 text-primary">
            {userType}
          </Badge>
        </div>
      </div>
      
      <div className="bg-card p-4 rounded-lg border shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Reputation</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="w-64">Reputation is earned by contributing quality content, helping others, and being active in the community.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center">
          <span className="text-2xl font-semibold">{reputationScore}</span>
          <span className="text-muted-foreground ml-1">/100</span>
        </div>
      </div>
      
      <div className="bg-card p-4 rounded-lg border shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Achievements</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="w-64">Achievements are unlocked by completing specific actions and milestones on the platform.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center">
          <span className="text-2xl font-semibold">{achievementsCount}</span>
        </div>
      </div>
    </div>
  );
};
