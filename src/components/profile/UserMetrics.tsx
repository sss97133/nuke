
import React from 'react';
import { Trophy, Star, Award } from 'lucide-react';

interface UserMetricsProps {
  profile: any;
}

export const UserMetrics = ({ profile }: UserMetricsProps) => {
  const userType = profile?.user_type || 'N/A';
  const reputationScore = profile?.reputation_score || 0;
  const achievementsCount = 0; // This would come from achievements.length in a real implementation

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
      <div className="bg-[#FFFFFF] p-2 border border-[#403E43]">
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="w-3 h-3 text-[#222222]" />
          <span className="text-[10px] font-mono text-[#222222]">ROLE</span>
        </div>
        <p className="text-tiny font-mono text-[#403E43] uppercase">{userType}</p>
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
    </div>
  );
};
