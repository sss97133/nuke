import React from 'react';
import { Star } from 'lucide-react';
import { SkillCard } from './SkillCard';
import { Skill, SkillStatus } from '@/types/skills';

interface SkillCategoryProps {
  category: string;
  skills: Skill[];
  getSkillStatus: (skillId: string) => SkillStatus;
}

export const SkillCategory = ({ category, skills, getSkillStatus }: SkillCategoryProps) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Star className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-medium text-foreground capitalize">{category.replace('_', ' ')}</h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {skills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            status={getSkillStatus(skill.id)}
          />
        ))}
      </div>
    </div>
  );
};
