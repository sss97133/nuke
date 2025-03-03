
import React from 'react';
import { Trophy, Star, Award, Users, Car, Tools, CreditCard, TrendingUp } from 'lucide-react';
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger 
} from "@/components/ui/tooltip";
import { Button } from '@/components/ui/button';

interface UserMetricsProps {
  profile: {
    user_type?: string;
    reputation_score?: number;
    achievements_count?: number;
    viewer_percentile?: number;
    owner_percentile?: number;
    technician_percentile?: number;
    investor_percentile?: number;
    discovery_count?: number;
  };
}

export const UserMetrics = ({ profile }: UserMetricsProps) => {
  const userType = profile?.user_type || 'N/A';
  const reputationScore = profile?.reputation_score || 0;
  const achievementsCount = profile?.achievements_count || 0;
  const viewerPercentile = profile?.viewer_percentile;
  const ownerPercentile = profile?.owner_percentile;
  const technicianPercentile = profile?.technician_percentile;
  const investorPercentile = profile?.investor_percentile;
  const discoveryCount = profile?.discovery_count || 0;

  const renderPercentileBadge = (percentile?: number) => {
    if (percentile === undefined) return null;
    
    let bgColor = 'bg-gray-200';
    if (percentile <= 1) bgColor = 'bg-yellow-400';
    else if (percentile <= 5) bgColor = 'bg-blue-400';
    else if (percentile <= 10) bgColor = 'bg-green-400';
    else if (percentile <= 25) bgColor = 'bg-emerald-300';
    
    return (
      <span className={`text-[8px] ${bgColor} text-black px-1 py-0.5 rounded-sm ml-1`}>
        TOP {percentile}%
      </span>
    );
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
      <TooltipProvider>
        <div className="bg-[#FFFFFF] p-2 border border-[#403E43]">
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="w-3 h-3 text-[#222222]" />
            <span className="text-[10px] font-mono text-[#222222]">ROLE</span>
          </div>
          <p className="text-tiny font-mono text-[#403E43] uppercase flex items-center">
            {userType}
            {renderPercentileBadge(viewerPercentile)}
          </p>
        </div>
        
        <div className="bg-[#FFFFFF] p-2 border border-[#403E43]">
          <div className="flex items-center gap-2 mb-1">
            <Star className="w-3 h-3 text-[#222222]" />
            <span className="text-[10px] font-mono text-[#222222]">REPUTATION_PTS</span>
          </div>
          <p className="text-tiny font-mono text-[#403E43]">{reputationScore}</p>
        </div>
        
        <div className="bg-[#FFFFFF] p-2 border border-[#403E43]">
          <div className="flex items-center gap-2 mb-1">
            <Award className="w-3 h-3 text-[#222222]" />
            <span className="text-[10px] font-mono text-[#222222]">ACHIEVEMENTS</span>
          </div>
          <p className="text-tiny font-mono text-[#403E43]">{achievementsCount}_TOTAL</p>
        </div>

        <div className="bg-[#FFFFFF] p-2 border border-[#403E43]">
          <div className="flex items-center gap-2 mb-1">
            <Car className="w-3 h-3 text-[#222222]" />
            <span className="text-[10px] font-mono text-[#222222]">DISCOVERIES</span>
          </div>
          <p className="text-tiny font-mono text-[#403E43] flex items-center">
            {discoveryCount}_TOTAL
            {renderPercentileBadge(ownerPercentile)}
          </p>
        </div>
      </TooltipProvider>

      <div className="col-span-2 md:col-span-4 mt-2">
        <div className="flex flex-wrap gap-2 justify-between text-xs">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Viewer
                {viewerPercentile !== undefined && (
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded-sm">
                    TOP {viewerPercentile}%
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Your standing as a content viewer compared to other users</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Car className="h-3.5 w-3.5" />
                Owner
                {ownerPercentile !== undefined && (
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded-sm">
                    TOP {ownerPercentile}%
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Your standing as a vehicle owner compared to other users</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Tools className="h-3.5 w-3.5" />
                Technician
                {technicianPercentile !== undefined && (
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded-sm">
                    TOP {technicianPercentile}%
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Your standing as a vehicle technician compared to other users</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <CreditCard className="h-3.5 w-3.5" />
                Investor
                {investorPercentile !== undefined && (
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded-sm">
                    TOP {investorPercentile}%
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Your standing as a vehicle investor compared to other users</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
