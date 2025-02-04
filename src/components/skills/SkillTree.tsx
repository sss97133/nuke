import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { LoadingState } from './LoadingState';
import { SkillHeader } from './SkillHeader';
import { SkillCategory } from './SkillCategory';

export const SkillTree = () => {
  const { toast } = useToast();
  
  const { data: skills, isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('skills')
        .select('*')
        .order('category');
      
      if (error) {
        toast({
          title: 'Error loading skills',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      return data;
    },
  });

  const { data: userSkills } = useQuery({
    queryKey: ['user-skills'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_skills')
        .select('*');
      
      if (error) {
        toast({
          title: 'Error loading user skills',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      return data;
    },
  });

  if (isLoading) {
    return <LoadingState />;
  }

  // Group skills by category
  const skillsByCategory = skills?.reduce((acc: any, skill) => {
    if (!acc[skill.category]) {
      acc[skill.category] = [];
    }
    acc[skill.category].push(skill);
    return acc;
  }, {});

  // Calculate total progress
  const calculateTotalProgress = () => {
    if (!userSkills || !skills) return 0;
    const totalSkills = skills.length;
    const completedSkills = userSkills.filter(us => us.level >= 5).length;
    return (completedSkills / totalSkills) * 100;
  };

  const getSkillStatus = (skillId: string) => {
    const userSkill = userSkills?.find(us => us.skill_id === skillId);
    const level = userSkill?.level || 0;
    const exp = userSkill?.experience_points || 0;
    const nextLevelExp = (level + 1) * 1000; // Example progression
    const progress = (exp / nextLevelExp) * 100;
    
    return {
      level,
      exp,
      progress,
      isComplete: level >= 5,
      hasStarted: level > 0
    };
  };

  return (
    <div className="bg-background p-6 rounded-lg shadow-lg border border-border animate-fade-in">
      <SkillHeader totalProgress={calculateTotalProgress()} />
      
      <div className="space-y-12">
        {skillsByCategory && Object.entries(skillsByCategory).map(([category, categorySkills]: [string, any]) => (
          <SkillCategory
            key={category}
            category={category}
            skills={categorySkills}
            getSkillStatus={getSkillStatus}
          />
        ))}
      </div>
    </div>
  );
};