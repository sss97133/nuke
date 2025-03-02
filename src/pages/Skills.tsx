
import React, { useState } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Wrench, Code, BookOpen, Speech, PenTool, Lightbulb, Atom, ChevronDown, ChevronUp } from 'lucide-react';
import { QuantumSkillVis } from "@/components/skills/visualization/QuantumSkillVis";

interface SkillProps {
  icon: React.ReactNode;
  name: string;
  level: number;
  category: string;
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
  const [showQuantumView, setShowQuantumView] = useState(false);

  const skillsData: SkillProps[] = [
    {
      icon: <Wrench className="h-4 w-4 text-blue-500" />,
      name: "Vehicle Repair",
      level: 4,
      category: "technical",
      description: "Ability to diagnose and repair vehicle mechanical issues"
    },
    {
      icon: <Code className="h-4 w-4 text-green-500" />,
      name: "Diagnostic Software",
      level: 3,
      category: "technical",
      description: "Using software tools to diagnose vehicle electronic systems"
    },
    {
      icon: <BookOpen className="h-4 w-4 text-yellow-500" />,
      name: "Technical Documentation",
      level: 5,
      category: "knowledge",
      description: "Creating and interpreting technical vehicle documentation"
    },
    {
      icon: <Speech className="h-4 w-4 text-purple-500" />,
      name: "Customer Communication",
      level: 2,
      category: "soft",
      description: "Effectively communicating technical information to clients"
    },
    {
      icon: <PenTool className="h-4 w-4 text-red-500" />,
      name: "Detailing",
      level: 3,
      category: "technical",
      description: "Vehicle cleaning and aesthetic improvement techniques"
    },
    {
      icon: <Lightbulb className="h-4 w-4 text-orange-500" />,
      name: "Problem Solving",
      level: 4,
      category: "soft",
      description: "Creative approaches to difficult mechanical problems"
    }
  ];

  const categories = ["all", "technical", "knowledge", "soft"];

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Skills</h1>
          <p className="text-muted-foreground">
            Track and develop your professional capabilities
          </p>
        </div>

        <div className="border rounded-md p-3 mb-4">
          <Button 
            variant="ghost" 
            className="flex w-full justify-between items-center"
            onClick={() => setShowQuantumView(!showQuantumView)}
          >
            <div className="flex items-center gap-2">
              <Atom className="h-5 w-5 text-blue-500" />
              <span>Quantum Skill Visualization</span>
            </div>
            {showQuantumView ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>

          {showQuantumView && (
            <div className="mt-4 h-[300px] border rounded-md p-4 bg-black/5 dark:bg-white/5">
              <QuantumSkillVis skills={skillsData} />
            </div>
          )}
        </div>

        <Tabs defaultValue="all">
          <TabsList className="mb-4">
            {categories.map(category => (
              <TabsTrigger key={category} value={category} className="capitalize">
                {category}
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
      </div>
    </ScrollArea>
  );
};

export default Skills;
