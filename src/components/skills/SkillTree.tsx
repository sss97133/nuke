import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Trees, Trophy, Star } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
    return (
      <div className="flex items-center justify-center p-8 text-sidebar-foreground">
        <Trees className="w-6 h-6 animate-pulse mr-2" />
        Loading skill tree...
      </div>
    );
  }

  return (
    <div className="bg-sidebar p-6 rounded-lg shadow-lg border border-sidebar-border">
      <div className="flex items-center gap-2 mb-6">
        <Trees className="w-6 h-6 text-sidebar-primary" />
        <h2 className="text-xl font-semibold text-sidebar-foreground">Professional Development Tree</h2>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {skills?.map((skill) => {
          const userSkill = userSkills?.find(us => us.skill_id === skill.id);
          const hasSkill = !!userSkill;
          
          return (
            <div
              key={skill.id}
              className={`
                border rounded-lg p-4 transition-all duration-300
                ${hasSkill 
                  ? 'bg-sidebar-primary/10 border-sidebar-primary hover:bg-sidebar-primary/20' 
                  : 'hover:border-sidebar-primary/50 border-sidebar-border'
                }
              `}
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-medium text-sidebar-foreground">{skill.name}</h3>
                {hasSkill && (
                  <Trophy className="w-4 h-4 text-yellow-500" />
                )}
              </div>
              <p className="text-sm text-sidebar-foreground/80 mb-2">{skill.description}</p>
              <div className="flex items-center gap-2 text-sm text-sidebar-foreground/60">
                <Star className={`w-4 h-4 ${hasSkill ? 'text-sidebar-primary' : ''}`} />
                <span>Level {userSkill?.level || 0}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};