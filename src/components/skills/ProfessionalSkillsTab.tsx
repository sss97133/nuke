
import { BookOpen, Award, Certificate, GraduationCap, ChevronRight, User } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";

export const ProfessionalSkillsTab = () => {
  const [activeTab, setActiveTab] = useState("technical");

  const skillCategories = [
    {
      id: "technical",
      name: "Technical Skills",
      description: "Vehicle diagnostics and repair skills",
      progress: 68,
      skills: [
        { name: "Engine Diagnostics", level: 4, maxLevel: 5, progress: 80 },
        { name: "Transmission Service", level: 3, maxLevel: 5, progress: 60 },
        { name: "Electrical Systems", level: 4, maxLevel: 5, progress: 85 },
        { name: "Brake Systems", level: 5, maxLevel: 5, progress: 100 },
        { name: "Suspension & Steering", level: 3, maxLevel: 5, progress: 65 },
      ],
    },
    {
      id: "digital",
      name: "Digital Tools",
      description: "Software and digital diagnostic tools",
      progress: 52,
      skills: [
        { name: "OBD-II Scanning", level: 4, maxLevel: 5, progress: 82 },
        { name: "Digital Documentation", level: 3, maxLevel: 5, progress: 55 },
        { name: "Diagnostic Software", level: 2, maxLevel: 5, progress: 45 },
        { name: "Inventory Management", level: 3, maxLevel: 5, progress: 60 },
        { name: "Data Analysis", level: 1, maxLevel: 5, progress: 20 },
      ],
    },
    {
      id: "business",
      name: "Business Skills",
      description: "Customer service and business operations",
      progress: 75,
      skills: [
        { name: "Customer Communication", level: 4, maxLevel: 5, progress: 90 },
        { name: "Service Estimation", level: 4, maxLevel: 5, progress: 75 },
        { name: "Scheduling", level: 5, maxLevel: 5, progress: 100 },
        { name: "Quality Assurance", level: 3, maxLevel: 5, progress: 65 },
        { name: "Team Collaboration", level: 3, maxLevel: 5, progress: 60 },
      ],
    },
    {
      id: "certifications",
      name: "Certifications",
      description: "Professional certifications and credentials",
      progress: 40,
      skills: [
        { name: "ASE Master Technician", level: 1, maxLevel: 1, progress: 100, completed: true },
        { name: "Electric Vehicle Specialist", level: 1, maxLevel: 1, progress: 100, completed: true },
        { name: "Hybrid Systems Expert", level: 0, maxLevel: 1, progress: 60, inProgress: true },
        { name: "Advanced Diagnostics", level: 1, maxLevel: 1, progress: 100, completed: true },
        { name: "Service Management", level: 0, maxLevel: 1, progress: 0 },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {skillCategories.map((category) => (
          <Card key={category.id} className="cursor-pointer hover:border-primary/50" onClick={() => setActiveTab(category.id)}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{category.name}</CardTitle>
              <CardDescription>{category.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Overall Progress</span>
                  <span className="text-sm font-medium">{category.progress}%</span>
                </div>
                <Progress value={category.progress} className="h-2" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="technical" className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4" />
            <span>Technical Skills</span>
          </TabsTrigger>
          <TabsTrigger value="digital" className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            <span>Digital Tools</span>
          </TabsTrigger>
          <TabsTrigger value="business" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span>Business Skills</span>
          </TabsTrigger>
          <TabsTrigger value="certifications" className="flex items-center gap-2">
            <Certificate className="h-4 w-4" />
            <span>Certifications</span>
          </TabsTrigger>
        </TabsList>

        {skillCategories.map((category) => (
          <TabsContent key={category.id} value={category.id} className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{category.name}</CardTitle>
                <CardDescription>Your current progress in {category.name.toLowerCase()}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {category.skills.map((skill, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{skill.name}</span>
                          {skill.completed && (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              <Award className="h-3 w-3 mr-1" /> Completed
                            </Badge>
                          )}
                          {skill.inProgress && (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                              In Progress
                            </Badge>
                          )}
                        </div>
                        <span className="text-sm">
                          {category.id === "certifications" 
                            ? `${skill.progress}%` 
                            : `Level ${skill.level}/${skill.maxLevel}`}
                        </span>
                      </div>
                      <Progress value={skill.progress} className="h-2" />
                      {skill.inProgress && (
                        <p className="text-xs text-muted-foreground">
                          Next milestone: Complete practical assessment
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button variant="outline" className="mr-2">
                Professional Development Plan
              </Button>
              <Button>
                Improve Skills <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};
