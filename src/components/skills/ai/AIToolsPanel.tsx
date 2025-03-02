
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, Brain, Lightbulb, Trophy } from 'lucide-react';

export const AIToolsPanel: React.FC = () => {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">AI Development Tools</h2>
      <p className="text-muted-foreground">
        Leverage AI to accelerate your skill development and learning journey.
      </p>
      
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Skill Path Generator
            </CardTitle>
            <CardDescription>
              AI-powered learning path based on your career goals
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Coming soon! Our AI will analyze your current skills and career aspirations
              to generate personalized learning paths and skill recommendations.
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-yellow-500" />
              Knowledge Assistant
            </CardTitle>
            <CardDescription>
              Ask questions and get instant explanations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Coming soon! Get detailed explanations, tutorials, and troubleshooting guidance
              tailored to your specific learning needs and knowledge gaps.
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-blue-500" />
              Skill Analyzer
            </CardTitle>
            <CardDescription>
              Identify gaps and opportunities in your skillset
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Coming soon! Our AI will analyze your current skills against industry benchmarks
              to identify key areas for improvement and growth opportunities.
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              Challenge Generator
            </CardTitle>
            <CardDescription>
              Practice with personalized skill challenges
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Coming soon! Get AI-generated practice challenges customized to your skill level
              and learning goals to accelerate your mastery through deliberate practice.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
