
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { EnhancedQuantumSkillVis } from './visualization/EnhancedQuantumSkillVis';
import { LoadingState } from './LoadingState';
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardFooter, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Atom, ChevronDown, Info, Terminal, Zap } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skill, UserSkill } from '@/types/skills';
import { useToast } from '@/hooks/use-toast';

interface QuantumSkillPanelProps {
  skills?: Skill[];
  userSkills?: UserSkill[];
}

export const QuantumSkillPanel: React.FC<QuantumSkillPanelProps> = ({ 
  skills: propSkills, 
  userSkills: propUserSkills 
}) => {
  const { toast } = useToast();
  const [showHelp, setShowHelp] = useState(false);
  const [activeTab, setActiveTab] = useState("visualization");
  const [showLegacy, setShowLegacy] = useState(false);

  // Fetch skills and user skills if not provided as props
  const { data: fetchedSkills, isLoading: skillsLoading, error: skillsError } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => {
      const { data, error } = await supabase.from('skills').select('*');
      if (error) throw error;
      return data as Skill[];
    },
    enabled: !propSkills,
  });

  const { data: fetchedUserSkills, isLoading: userSkillsLoading, error: userSkillsError } = useQuery({
    queryKey: ['user-skills'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      
      const { data, error } = await supabase
        .from('user_skills')
        .select('*')
        .eq('user_id', user.id);
      
      if (error) throw error;
      return data as UserSkill[];
    },
    enabled: !propUserSkills,
  });

  // Handle errors
  React.useEffect(() => {
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

  // Handle help toggle
  const toggleHelp = () => {
    setShowHelp(!showHelp);
    if (!showHelp) {
      toast({
        title: 'Visualization Guide',
        description: 'Hover over elements to see details about your skills and their relationships.',
      });
    }
  };

  if (isLoading) {
    return <LoadingState />;
  }

  if (!skills?.length) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">No skills found. Please check back later.</p>
      </div>
    );
  }

  return (
    <Card className="w-full bg-background/80 backdrop-blur-sm border animate-fade-in">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-2xl font-semibold flex items-center gap-2">
            <Atom className="h-6 w-6 text-primary" />
            Quantum Skill Visualization
          </CardTitle>
          <CardDescription>
            Interactive visualization of your skill development in quantum space
          </CardDescription>
        </div>
        <div className="flex items-center gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={toggleHelp}>
                  <Info className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Toggle visualization guide</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div className="flex items-center space-x-2">
            <Switch
              id="legacy-mode"
              checked={showLegacy}
              onCheckedChange={setShowLegacy}
            />
            <label htmlFor="legacy-mode" className="text-sm cursor-pointer">Legacy View</label>
          </div>
        </div>
      </CardHeader>
      
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="px-6">
          <TabsList className="w-full">
            <TabsTrigger value="visualization" className="flex items-center">
              <Atom className="mr-2 h-4 w-4" />
              Visualization
            </TabsTrigger>
            <TabsTrigger value="quantum-data" className="flex items-center">
              <Terminal className="mr-2 h-4 w-4" />
              Quantum Data
            </TabsTrigger>
            <TabsTrigger value="energy-patterns" className="flex items-center">
              <Zap className="mr-2 h-4 w-4" />
              Energy Patterns
            </TabsTrigger>
          </TabsList>
        </div>
        
        <CardContent className="p-0 pt-4">
          <TabsContent value="visualization" className="m-0">
            {showLegacy ? (
              <div className="relative">
                {/* Import the legacy visualization component */}
                <div className="absolute top-2 right-2 z-10">
                  <div className="bg-background/80 backdrop-blur-sm p-2 rounded-md border text-xs text-muted-foreground">
                    Legacy Visualization Active
                  </div>
                </div>
                {React.createElement(require('./visualization/QuantumSkillVis').QuantumSkillVis, {
                  skills,
                  userSkills
                })}
              </div>
            ) : (
              <EnhancedQuantumSkillVis skills={skills} userSkills={userSkills} />
            )}
          </TabsContent>
          
          <TabsContent value="quantum-data" className="px-6 space-y-4 m-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-background/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Quantum Coherence</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {totalProgress.toFixed(1)}%
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Overall skill progression
                  </p>
                </CardContent>
              </Card>
              
              <Card className="bg-background/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Skill Entanglement</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {completedSkills} / {totalSkills}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Completed skills
                  </p>
                </CardContent>
              </Card>
              
              <Card className="bg-background/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Quantum Flux</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {inProgressSkills}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Skills in progress
                  </p>
                </CardContent>
              </Card>
            </div>
            
            <Card className="bg-background/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Quantum State Analysis</CardTitle>
                <CardDescription>
                  Detailed view of your skills in quantum space
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-[300px] flex items-center justify-center border rounded-md p-4">
                  <p className="text-muted-foreground">
                    Quantum state analysis will be available soon
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="energy-patterns" className="px-6 space-y-4 m-0">
            <Card className="bg-background/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Skill Energy Distribution</CardTitle>
                <CardDescription>
                  How your energy flows between different skill domains
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-[300px] flex items-center justify-center border rounded-md p-4">
                  <p className="text-muted-foreground">
                    Energy pattern visualization will be available soon
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </CardContent>
      </Tabs>
      
      <Collapsible open={showHelp}>
        <CollapsibleTrigger asChild>
          <CardFooter className="justify-between border-t p-4 py-2">
            <div className="text-sm font-medium">Visualization Guide</div>
            <Button variant="ghost" size="sm">
              <ChevronDown className={`h-4 w-4 ${showHelp ? 'rotate-180' : ''} transition-transform`} />
            </Button>
          </CardFooter>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-6 pb-4 text-sm space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <h4 className="font-medium">Orbits</h4>
                <p className="text-muted-foreground">
                  Each orbit represents a skill category. The size and color indicate different domains of expertise.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">Particles</h4>
                <p className="text-muted-foreground">
                  Particles represent individual skills. Their density and brightness increase with your skill level.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">Motion</h4>
                <p className="text-muted-foreground">
                  The orbit rotation speed and particle behavior reflect your overall career momentum and skill coherence.
                </p>
              </div>
            </div>
            <div className="pt-2 border-t space-y-2">
              <h4 className="font-medium">Interaction Tips</h4>
              <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                <li>Use mouse to rotate and zoom the visualization</li>
                <li>Filter by category or skill to focus on specific areas</li>
                <li>Toggle between 2D and 3D views for different perspectives</li>
                <li>Adjust interaction strength to see quantum effects</li>
                <li>Take screenshots to share your skill visualization</li>
              </ul>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};
