import React from 'react';
import { Award } from 'lucide-react';
import { Achievement } from './types';

interface AchievementsListProps {
  achievements: Achievement[];
}

export const AchievementsList = ({ achievements }: AchievementsListProps) => {
  if (!achievements || achievements.length === 0) return null;

  return (
    <div className="bg-[#f3f3f3] p-4 border border-[#000066] shadow-sm">
      <h3 className="text-tiny font-mono text-[#333333] mb-3">RECENT_ACHIEVEMENTS</h3>
      <div className="space-y-2">
        {achievements.map((achievement) => (
          <div 
            key={achievement.id} 
            className="flex items-center gap-3 p-3 bg-white border border-[#999] hover:border-[#000066] transition-colors"
          >
            <Award className="w-4 h-4 text-[#000066]" />
            <div>
              <p className="text-tiny font-mono text-[#333333]">{achievement.achievement_type}</p>
              <p className="text-tiny font-mono text-[#555555]">
                {new Date(achievement.earned_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};