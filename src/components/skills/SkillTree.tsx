
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { LoadingState } from './LoadingState';
import { SkillHeader } from './SkillHeader';
import { SkillCategory } from './SkillCategory';
import { AIToolsPanel } from './ai/AIToolsPanel';
import { QuantumSkillPanel } from './QuantumSkillPanel';
import { Skill, UserSkill } from '@/types/skills';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const SkillTree = () => {
  const { toast } = useToast();
  const [visualizationMode, setVisualizationMode] = React.useState('enhanced'); // 'enhanced', 'legacy', or 'disabled'

  const { data: skills, isLoading: skillsLoading, error: skillsError } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('skills')
          .select('*');
        
        if (error) throw error;
        return data as Skill[];
      } catch (error) {
        console.error('Error fetching skills:', error);
        throw error;
      }
    },
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000)
  });

  const { data: userSkills, error: userSkillsError } = useQuery({
    queryKey: ['user-skills'],
    queryFn: async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          console.log('No authenticated user found');
          return [];
        }

        const { data, error } = await supabase
          .from('user_skills')
          .select('*')
          .eq('user_id', user.id);
        
        if (error) throw error;
        return data as UserSkill[];
      } catch (error) {
        console.error('Error fetching user skills:', error);
        throw error;
      }
    },
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 30000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000 // Keep in cache for 5 minutes (renamed from cacheTime)
  });

  // Handle errors more gracefully
  React.useEffect(() => {
    if (skillsError) {
      console.error('Skills error:', skillsError);
      toast({
        title: 'Error Loading Skills',
        description: 'Failed to load skills data. Please try refreshing the page.',
        variant: 'destructive',
      });
    }
    
    if (userSkillsError) {
      console.error('User skills error:', userSkillsError);
      toast({
        title: 'Error Loading Progress',
        description: 'Failed to load your skill progress. Please try refreshing the page.',
        variant: 'destructive',
      });
    }
  }, [skillsError, userSkillsError, toast]);

  if (skillsLoading) {
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
      <div className="flex justify-between items-center">
        <SkillHeader totalProgress={calculateTotalProgress()} />
        
        <div className="flex items-center space-x-2">
          <span className="text-sm text-muted-foreground">Visualization:</span>
          <Select 
            value={visualizationMode} 
            onValueChange={setVisualizationMode}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select visualization" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="enhanced">Enhanced Quantum</SelectItem>
              <SelectItem value="legacy">Legacy Quantum</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {/* Visualization Panel - Only show if not disabled */}
      {visualizationMode !== 'disabled' && (
        <div className="mb-8">
          <QuantumSkillPanel skills={skills} userSkills={userSkills || []} />
        </div>
      )}
      
      {/* AI Tools Panel */}
      <Tabs defaultValue="skills" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="skills">Skills Overview</TabsTrigger>
          <TabsTrigger value="ai-tools">AI Development Tools</TabsTrigger>
        </TabsList>

        <TabsContent value="skills" className="space-y-12">
          {skillsByCategory && Object.entries(skillsByCategory).map(([category, categorySkills]) => (
            <SkillCategory
              key={category}
              category={category}
              skills={categorySkills}
              getSkillStatus={getSkillStatus}
            />
          ))}
        </TabsContent>

        <TabsContent value="ai-tools">
          <AIToolsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
};
