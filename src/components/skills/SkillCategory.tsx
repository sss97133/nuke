
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skill, SkillStatus } from '@/types/skills';

interface SkillCategoryProps {
  category: string;
  skills: Skill[];
  getSkillStatus: (skillId: string) => SkillStatus;
}

export const SkillCategory: React.FC<SkillCategoryProps> = ({ 
  category, 
  skills, 
  getSkillStatus 
}) => {
  // Format category name for display
  const formatCategoryName = (cat: string) => {
    return cat.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold">{formatCategoryName(category)}</h3>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {skills.map(skill => {
          const status = getSkillStatus(skill.id);
          return (
            <Card key={skill.id} className={status.hasStarted ? "border-primary/30" : ""}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-base">{skill.name}</CardTitle>
                  <Badge variant={status.isComplete ? "default" : "outline"}>
                    Level {status.level}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-2">
                  {skill.description}
                </p>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>Progress to level {status.level + 1}</span>
                    <span className="text-muted-foreground">{status.progress.toFixed(0)}%</span>
                  </div>
                  <Progress value={status.progress} className="h-1.5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
