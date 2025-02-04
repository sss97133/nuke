import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export const SkillGapAnalyzer = () => {
  const { toast } = useToast();

  const handleAnalyze = () => {
    toast({
      title: "Gap Analysis",
      description: "Analyzing your skill gaps...",
    });
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Skill Gap Analyzer</CardTitle>
        <Target className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Identify gaps in your skill set and get recommendations for improvement.
          </p>
          <Button 
            onClick={handleAnalyze}
            className="w-full"
            variant="outline"
          >
            <Search className="mr-2 h-4 w-4" />
            Analyze Gaps
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};