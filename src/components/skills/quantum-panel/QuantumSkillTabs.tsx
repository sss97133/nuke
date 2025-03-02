
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Atom, Terminal, Zap } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EnhancedQuantumSkillVis } from '../visualization/EnhancedQuantumSkillVis';
import { Skill, UserSkill } from '@/types/skills';

interface QuantumSkillTabsProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  showLegacy: boolean;
  skills: Skill[];
  userSkills: UserSkill[];
  totalProgress: number;
  completedSkills: number;
  totalSkills: number;
  inProgressSkills: number;
}

export const QuantumSkillTabs: React.FC<QuantumSkillTabsProps> = ({
  activeTab,
  setActiveTab,
  showLegacy,
  skills,
  userSkills,
  totalProgress,
  completedSkills,
  totalSkills,
  inProgressSkills
}) => {
  return (
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
              <div className="absolute top-2 right-2 z-10">
                <div className="bg-background/80 backdrop-blur-sm p-2 rounded-md border text-xs text-muted-foreground">
                  Legacy Visualization Active
                </div>
              </div>
              {React.createElement(require('../visualization/QuantumSkillVis').QuantumSkillVis, {
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
  );
};
