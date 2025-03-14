import type { Database } from '../types';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skill, UserSkill } from '@/types/skills';
import { useToast } from '@/hooks/use-toast';
import { useEffect } from 'react';

export const useSkillsData = (propSkills?: Skill[], propUserSkills?: UserSkill[]) => {
  const { toast } = useToast();

  // Fetch skills and user skills if not provided as props
  const { data: fetchedSkills, isLoading: skillsLoading, error: skillsError } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      const { data, error } = await supabase.from('skills').select('*');
  if (error) console.error("Database query error:", error);
      if (error) throw error;
      return data as Skill[];
    },
    enabled: !propSkills,
  });

  const { data: fetchedUserSkills, isLoading: userSkillsLoading, error: userSkillsError } = useQuery({
    queryKey: ['user-skills'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      if (!user) return [];
      
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        
        .select('*')
        .eq('user_id', user.id);
      
      if (error) throw error;
      return data as UserSkill[];
    },
    enabled: !propUserSkills,
  });

  // Handle errors
  useEffect(() => {
    if (skillsError || userSkillsError) {
      toast({
        title: 'Error Loading Data',
        description: 'Failed to load skill data. Please try refreshing the page.',
        variant: 'destructive',
      });
    }
  }, [skillsError, userSkillsError, toast]);

  // Determine final data to use (props or fetched)
  const skills = propSkills || fetchedSkills || [];
  const userSkills = propUserSkills || fetchedUserSkills || [];
  const isLoading = (!propSkills && skillsLoading) || (!propUserSkills && userSkillsLoading);

  // Calculate overall stats
  const totalSkills = skills.length;
  const completedSkills = userSkills.filter(us => us.level >= 5).length;
  const inProgressSkills = userSkills.filter(us => us.level > 0 && us.level < 5).length;
  const totalProgress = totalSkills > 0 ? (completedSkills / totalSkills) * 100 : 0;

  return {
    skills,
    userSkills,
    isLoading,
    totalSkills,
    completedSkills,
    inProgressSkills,
    totalProgress
  };
};
