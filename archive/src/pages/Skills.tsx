
import React, { useState } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wrench, Code, BookOpen, Speech, PenTool, Lightbulb } from 'lucide-react';
import { QuantumSkillPanel } from "@/components/skills/QuantumSkillPanel";
import { SkillTree } from "@/components/skills/SkillTree";
import { Skill, UserSkill, SkillCategory } from '@/types/skills';

interface SkillProps {
  id: string;
  icon: React.ReactNode;
  name: string;
  level: number;
  category: SkillCategory;
  description: string;
}

const SkillCard = ({ skill }: { skill: SkillProps }) => (
  <Card>
    <CardHeader className="pb-2">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          {skill.icon}
          <CardTitle className="text-base">{skill.name}</CardTitle>
        </div>
        <Badge variant="outline">Level {skill.level}</Badge>
      </div>
      <CardDescription>{skill.description}</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>Progress</span>
          <span className="text-muted-foreground">{skill.level * 20}%</span>
        </div>
        <Progress value={skill.level * 20} className="h-2" />
      </div>
    </CardContent>
  </Card>
);

const Skills = () => {
  const skillsData: SkillProps[] = [
    {
      id: "skill-1",
      icon: <Wrench className="h-4 w-4 text-blue-500" />,
      name: "Vehicle Repair",
      level: 4,
      category: "technical" as SkillCategory,
      description: "Ability to diagnose and repair vehicle mechanical issues"
    },
    {
      id: "skill-2",
      icon: <Code className="h-4 w-4 text-green-500" />,
      name: "Diagnostic Software",
      level: 3,
      category: "technical" as SkillCategory,
      description: "Using software tools to diagnose vehicle electronic systems"
    },
    {
      id: "skill-3",
      icon: <BookOpen className="h-4 w-4 text-yellow-500" />,
      name: "Technical Documentation",
      level: 5,
      category: "technical" as SkillCategory,
      description: "Creating and interpreting technical vehicle documentation"
    },
    {
      id: "skill-4",
      icon: <Speech className="h-4 w-4 text-purple-500" />,
      name: "Customer Communication",
      level: 2,
      category: "soft_skills" as SkillCategory,
      description: "Effectively communicating technical information to clients"
    },
    {
      id: "skill-5",
      icon: <PenTool className="h-4 w-4 text-red-500" />,
      name: "Detailing",
      level: 3,
      category: "technical" as SkillCategory,
      description: "Vehicle cleaning and aesthetic improvement techniques"
    },
    {
      id: "skill-6",
      icon: <Lightbulb className="h-4 w-4 text-orange-500" />,
      name: "Problem Solving",
      level: 4,
      category: "soft_skills" as SkillCategory,
      description: "Creative approaches to difficult mechanical problems"
    }
  ];

  const userSkills: UserSkill[] = skillsData.map(skill => ({
    id: `us-${skill.id}`,
    user_id: "current-user",
    skill_id: skill.id,
    level: skill.level,
    experience_points: skill.level * 100,
    completed_at: skill.level >= 5 ? new Date().toISOString() : undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  // Convert SkillProps to Skill for the visualization component
  const skills: Skill[] = skillsData.map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category
  }));

  const categories = ["all", "technical", "soft_skills"];

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Skills</h1>
          <p className="text-muted-foreground">
            Track and develop your professional capabilities
          </p>
        </div>

        <Tabs defaultValue="all">
          <TabsList className="mb-4">
            {categories.map(category => (
              <TabsTrigger key={category} value={category} className="capitalize">
                {category === "soft_skills" ? "Soft Skills" : category}
              </TabsTrigger>
            ))}
          </TabsList>
          
          {categories.map(category => (
            <TabsContent key={category} value={category}>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {skillsData
                  .filter(skill => category === "all" || skill.category === category)
                  .map((skill, index) => (
                    <SkillCard key={index} skill={skill} />
                  ))
                }
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Quantum Skill Visualization Panel moved below the skill boxes */}
        <div className="mt-8">
          <QuantumSkillPanel skills={skills} userSkills={userSkills} />
        </div>
      </div>
    </ScrollArea>
  );
};

export default Skills;
