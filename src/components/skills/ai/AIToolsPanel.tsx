import React from 'react';
import { SkillAdvisor } from './SkillAdvisor';
import { SkillGapAnalyzer } from './SkillGapAnalyzer';
import { ResourceCurator } from './ResourceCurator';

export const AIToolsPanel = () => {
  return (
    <div className="space-y-4 p-4 bg-muted rounded-lg animate-fade-in">
      <h2 className="text-lg font-semibold mb-4">AI Development Tools</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SkillAdvisor />
        <SkillGapAnalyzer />
        <ResourceCurator />
      </div>
    </div>
  );
};