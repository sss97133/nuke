import React from 'react';
import { Award } from 'lucide-react';
import { Achievement } from './types';

interface AchievementsListProps {
  achievements: Achievement[];
}

export const AchievementsList = ({ achievements }: AchievementsListProps) => {
  if (!achievements || achievements.length === 0) return null;

  return (
    <div className="bg-[#C8C8C9] p-2 border border-[#403E43]">
      <h3 className="text-[10px] font-mono text-[#222222] mb-2">RECENT_ACHIEVEMENTS</h3>
      <div className="space-y-1">
        {achievements.map((achievement) => (
          <div 
            key={achievement.id} 
            className="flex items-center gap-2 p-2 bg-[#FFFFFF] border border-[#8A898C] hover:border-[#403E43] transition-colors"
          >
            <Award className="w-3 h-3 text-[#222222]" />
            <div>
              <p className="text-[10px] font-mono text-[#222222]">{achievement.achievement_type}</p>
              <p className="text-[10px] font-mono text-[#403E43]">
                {new Date(achievement.earned_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};