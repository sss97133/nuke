
import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { LoadingState } from './LoadingState';
import { QuantumSkillPanelHeader } from './quantum-panel/QuantumSkillPanelHeader';
import { QuantumSkillTabs } from './quantum-panel/QuantumSkillTabs';
import { QuantumVisualizationGuide } from './quantum-panel/QuantumVisualizationGuide';
import { EmptySkillsState } from './quantum-panel/EmptySkillsState';
import { useSkillsData } from './quantum-panel/hooks/useSkillsData';
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

  // Use our custom hook to manage skills data
  const {
    skills,
    userSkills,
    isLoading,
    totalSkills,
    completedSkills,
    inProgressSkills,
    totalProgress
  } = useSkillsData(propSkills, propUserSkills);

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
    return <EmptySkillsState />;
  }

  return (
    <Card className="w-full bg-background/80 backdrop-blur-sm border animate-fade-in">
      <QuantumSkillPanelHeader 
        showLegacy={showLegacy}
        setShowLegacy={setShowLegacy}
        toggleHelp={toggleHelp}
      />
      
      <QuantumSkillTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        showLegacy={showLegacy}
        skills={skills}
        userSkills={userSkills}
        totalProgress={totalProgress}
        completedSkills={completedSkills}
        totalSkills={totalSkills}
        inProgressSkills={inProgressSkills}
      />
      
      <QuantumVisualizationGuide showHelp={showHelp} />
    </Card>
  );
};
