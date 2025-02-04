import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Gauge, Trophy, Star, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
        <Gauge className="w-6 h-6 animate-spin mr-2" />
        Loading developometer...
      </div>
    );
  }

  // Group skills by category
  const skillsByCategory = skills?.reduce((acc: any, skill) => {
    if (!acc[skill.category]) {
      acc[skill.category] = [];
    }
    acc[skill.category].push(skill);
    return acc;
  }, {});

  return (
    <div className="bg-sidebar p-6 rounded-lg shadow-lg border border-sidebar-border">
      <div className="flex items-center gap-2 mb-6">
        <Gauge className="w-6 h-6 text-sidebar-primary animate-pulse" />
        <h2 className="text-xl font-semibold text-sidebar-foreground">Developometer</h2>
      </div>
      
      <div className="space-y-8">
        {skillsByCategory && Object.entries(skillsByCategory).map(([category, categorySkills]: [string, any]) => (
          <div key={category} className="space-y-4">
            <h3 className="text-lg font-medium text-sidebar-foreground flex items-center gap-2">
              <Star className="w-4 h-4 text-sidebar-primary" />
              {category}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {categorySkills.map((skill: any) => {
                const userSkill = userSkills?.find(us => us.skill_id === skill.id);
                const hasSkill = !!userSkill;
                const level = userSkill?.level || 0;
                const progress = (level / 5) * 100; // Assuming max level is 5
                
                return (
                  <TooltipProvider key={skill.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={`
                            relative border rounded-lg p-4 transition-all duration-300 cursor-pointer
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
                            <span>Level {level}</span>
                          </div>
                          
                          {/* Progress bar */}
                          <div className="absolute bottom-0 left-0 w-full h-1 bg-sidebar-border/30 rounded-b-lg overflow-hidden">
                            <div 
                              className="h-full bg-sidebar-primary transition-all duration-500"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-2 p-2">
                          <div className="flex items-center gap-2">
                            <Info className="w-4 h-4" />
                            <span className="font-medium">Skill Details</span>
                          </div>
                          <p className="text-sm">Experience: {userSkill?.experience_points || 0} XP</p>
                          {skill.prerequisites?.length > 0 && (
                            <p className="text-sm text-muted-foreground">
                              Prerequisites required
                            </p>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};