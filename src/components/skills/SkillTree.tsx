import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Gauge, Trophy, Star, Info, Award, ArrowUpCircle, Target } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

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
      <div className="flex items-center justify-center p-8 text-foreground">
        <Gauge className="w-6 h-6 animate-spin mr-2" />
        <span className="animate-pulse">Loading developometer...</span>
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
      {/* Header Section */}
      <div className="flex items-center justify-between mb-8 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Gauge className="w-8 h-8 text-primary animate-pulse" />
            <div className="absolute -top-1 -right-1">
              <div className="bg-primary rounded-full p-1">
                <Target className="w-3 h-3 text-primary-foreground" />
              </div>
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-foreground">Developometer</h2>
            <p className="text-muted-foreground text-sm">Track your development progress</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <div className="flex items-center gap-2">
                  <Progress value={calculateTotalProgress()} className="w-32" />
                  <span className="text-sm text-muted-foreground">{Math.round(calculateTotalProgress())}%</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Overall Progress</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      
      {/* Skills Grid */}
      <div className="space-y-12">
        {skillsByCategory && Object.entries(skillsByCategory).map(([category, categorySkills]: [string, any]) => (
          <div key={category} className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-medium text-foreground">{category}</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {categorySkills.map((skill: any) => {
                const status = getSkillStatus(skill.id);
                
                return (
                  <TooltipProvider key={skill.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "relative border rounded-lg p-4 transition-all duration-300 hover:shadow-lg cursor-pointer",
                            status.isComplete ? "bg-primary/10 border-primary" : 
                            status.hasStarted ? "bg-muted border-primary/50" : 
                            "hover:border-primary/50 border-border"
                          )}
                        >
                          <div className="flex justify-between items-start mb-3">
                            <h3 className="font-medium text-foreground flex items-center gap-2">
                              {skill.name}
                              {status.isComplete && (
                                <Trophy className="w-4 h-4 text-yellow-500" />
                              )}
                            </h3>
                            {status.hasStarted && !status.isComplete && (
                              <ArrowUpCircle className="w-4 h-4 text-primary animate-pulse" />
                            )}
                          </div>
                          
                          <p className="text-sm text-muted-foreground mb-3">{skill.description}</p>
                          
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Level {status.level}</span>
                              <span className="text-muted-foreground">{status.exp} XP</span>
                            </div>
                            <Progress 
                              value={status.progress} 
                              className={cn(
                                "h-1.5",
                                status.isComplete ? "bg-primary/20" : "bg-muted"
                              )}
                            />
                          </div>
                          
                          {/* Prerequisites Indicator */}
                          {skill.prerequisites?.length > 0 && (
                            <div className="absolute top-2 right-2">
                              <Info className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                          
                          {/* Achievement Badge */}
                          {status.level >= 3 && (
                            <div className="absolute -top-2 -right-2">
                              <Award className="w-5 h-5 text-primary" />
                            </div>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="p-3 space-y-2">
                        <div className="space-y-1">
                          <div className="font-medium flex items-center gap-2">
                            <Info className="w-4 h-4" />
                            <span>Skill Details</span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Level: {status.level} / 5
                          </p>
                          <p className="text-sm text-muted-foreground">
                            XP: {status.exp} / {(status.level + 1) * 1000}
                          </p>
                          {skill.prerequisites?.length > 0 && (
                            <p className="text-sm text-muted-foreground mt-2">
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