import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { LoadingState } from './LoadingState';
import { SkillHeader } from './SkillHeader';
import { SkillCategory } from './SkillCategory';
import { AIToolsPanel } from './ai/AIToolsPanel';
import { QuantumSkillVis } from './visualization/QuantumSkillVis';
import { Skill, SkillStatus, UserSkill } from '@/types/skills';

export const SkillTree = () => {
  const { toast } = useToast();
  
  // Mock data for demonstration
  const mockSkills: Skill[] = [
    { id: '1', name: 'Engine Repair', category: 'mechanical', description: 'Advanced engine repair techniques' },
    { id: '2', name: 'Transmission', category: 'mechanical', description: 'Transmission maintenance and repair' },
    { id: '3', name: 'Circuit Diagnosis', category: 'electrical', description: 'Electrical system diagnosis' },
    { id: '4', name: 'Battery Systems', category: 'electrical', description: 'Battery and charging systems' },
    { id: '5', name: 'Paint Finishing', category: 'bodywork', description: 'Professional paint finishing' },
    { id: '6', name: 'Panel Repair', category: 'bodywork', description: 'Body panel repair and alignment' },
    { id: '7', name: 'OBD Analysis', category: 'diagnostics', description: 'OBD system analysis' },
    { id: '8', name: 'Parts Restoration', category: 'restoration', description: 'Vintage parts restoration' },
    { id: '9', name: 'Custom Fabrication', category: 'customization', description: 'Custom parts fabrication' },
  ];

  const mockUserSkills: UserSkill[] = [
    { id: 'us1', user_id: 'mock-user-1', skill_id: '1', level: 4, experience_points: 3500, created_at: '2024-01-01', updated_at: '2024-01-01' },
    { id: 'us2', user_id: 'mock-user-1', skill_id: '2', level: 3, experience_points: 2500, created_at: '2024-01-01', updated_at: '2024-01-01' },
    { id: 'us3', user_id: 'mock-user-1', skill_id: '3', level: 5, experience_points: 5000, created_at: '2024-01-01', updated_at: '2024-01-01' },
    { id: 'us4', user_id: 'mock-user-1', skill_id: '4', level: 2, experience_points: 1500, created_at: '2024-01-01', updated_at: '2024-01-01' },
    { id: 'us5', user_id: 'mock-user-1', skill_id: '5', level: 4, experience_points: 3800, created_at: '2024-01-01', updated_at: '2024-01-01' },
    { id: 'us6', user_id: 'mock-user-1', skill_id: '6', level: 1, experience_points: 800, created_at: '2024-01-01', updated_at: '2024-01-01' },
    { id: 'us7', user_id: 'mock-user-1', skill_id: '7', level: 3, experience_points: 2700, created_at: '2024-01-01', updated_at: '2024-01-01' },
    { id: 'us8', user_id: 'mock-user-1', skill_id: '8', level: 2, experience_points: 1600, created_at: '2024-01-01', updated_at: '2024-01-01' },
    { id: 'us9', user_id: 'mock-user-1', skill_id: '9', level: 5, experience_points: 5000, created_at: '2024-01-01', updated_at: '2024-01-01' },
  ];

  const { data: skills, isLoading, error } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      // For demo, return mock data instead of fetching
      return mockSkills;
    },
  });

  const { data: userSkills, error: userSkillsError } = useQuery({
    queryKey: ['user-skills'],
    queryFn: async () => {
      // For demo, return mock data instead of fetching
      return mockUserSkills;
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
      
      {skills && userSkills && (
        <div className="mb-8">
          <h2 className="text-lg font-medium mb-4">Quantum Skill Visualization</h2>
          <QuantumSkillVis skills={skills} userSkills={userSkills} />
        </div>
      )}
      
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
