import React from 'react';
import { Trophy, Star, Award } from 'lucide-react';

interface UserMetricsProps {
  userType: string | null;
  reputationScore: number | null;
  achievementsCount: number;
}

export const UserMetrics = ({ userType, reputationScore, achievementsCount }: UserMetricsProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
      <div className="bg-white p-3 border border-[#999]">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-4 h-4 text-[#000066]" />
          <span className="text-tiny font-mono text-[#333333]">ROLE</span>
        </div>
        <p className="text-tiny font-mono text-[#555555] uppercase">{userType || 'N/A'}</p>
      </div>
      
      <div className="bg-white p-3 border border-[#999]">
        <div className="flex items-center gap-2 mb-2">
          <Star className="w-4 h-4 text-[#000066]" />
          <span className="text-tiny font-mono text-[#333333]">REPUTATION_PTS</span>
        </div>
        <p className="text-tiny font-mono text-[#555555]">{reputationScore || '0'}</p>
      </div>
      
      <div className="bg-white p-3 border border-[#999]">
        <div className="flex items-center gap-2 mb-2">
          <Award className="w-4 h-4 text-[#000066]" />
          <span className="text-tiny font-mono text-[#333333]">ACHIEVEMENTS</span>
        </div>
        <p className="text-tiny font-mono text-[#555555]">{achievementsCount}_TOTAL</p>
      </div>
    </div>
  );
};