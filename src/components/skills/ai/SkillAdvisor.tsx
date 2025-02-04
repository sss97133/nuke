import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export const SkillAdvisor = () => {
  const { toast } = useToast();

  const handleGetAdvice = () => {
    toast({
      title: "AI Advisor",
      description: "Generating personalized skill path advice...",
    });
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Skill Path Advisor</CardTitle>
        <Brain className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Get personalized recommendations for your skill development path.
          </p>
          <Button 
            onClick={handleGetAdvice}
            className="w-full"
            variant="outline"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Advice
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};