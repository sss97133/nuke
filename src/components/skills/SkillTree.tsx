import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { LoadingState } from './LoadingState';
import { SkillHeader } from './SkillHeader';
import { SkillCategory } from './SkillCategory';
import { AIToolsPanel } from './ai/AIToolsPanel';
import { Skill, SkillStatus } from '@/types/skills';

export const SkillTree = () => {
  const { toast } = useToast();
  
  const { data: skills, isLoading, error } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      console.log('Fetching skills...');
      const { data, error } = await supabase
        .from('skills')
        .select('*')
        .order('category');
      
      if (error) {
        console.error('Error fetching skills:', error);
        toast({
          title: 'Error loading skills',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      console.log('Skills fetched:', data);
      return data as Skill[];
    },
  });

  const { data: userSkills, error: userSkillsError } = useQuery({
    queryKey: ['user-skills'],
    queryFn: async () => {
      console.log('Fetching user skills...');
      const { data, error } = await supabase
        .from('user_skills')
        .select('*');
      
      if (error) {
        console.error('Error fetching user skills:', error);
        toast({
          title: 'Error loading user skills',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      console.log('User skills fetched:', data);
      return data as UserSkill[];
    },
  });

  if (error || userSkillsError) {
    toast({
      title: 'Error',
      description: 'Failed to load skills data. Please try again.',
      variant: 'destructive',
    });
  }

  if (isLoading) {
    return <LoadingState />;
  }

  // Group skills by category
  const skillsByCategory = skills?.reduce((acc: Record<string, Skill[]>, skill) => {
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
    const nextLevelExp = (level + 1) * 1000;
    const progress = (exp / nextLevelExp) * 100;
    
    return {
      level,
      exp,
      progress,
      isComplete: level >= 5,
      hasStarted: level > 0
    };
  };

  if (!skills?.length) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">No skills found. Please check back later.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <SkillHeader totalProgress={calculateTotalProgress()} />
      
      <AIToolsPanel />
      
      <div className="space-y-12 mt-8">
        {skillsByCategory && Object.entries(skillsByCategory).map(([category, categorySkills]) => (
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
