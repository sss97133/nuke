import React, { useState } from 'react';
import { Brain, ChevronDown, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

export const AIToolsPanel = () => {
  const { toast } = useToast();
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  // Fetch user's skills
  const { data: userSkills } = useQuery({
    queryKey: ['user-skills'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_skills')
        .select('*, skills(*)');
      
      if (error) throw error;
      return data;
    },
  });

  const handleToolSelect = (tool: string) => {
    setSelectedTool(tool);
    setAnalysisResult(null);
    toast({
      title: `${tool} Selected`,
      description: "Ready to analyze your skills.",
    });
  };

  const handleAnalysis = async () => {
    if (!selectedTool || !userSkills) return;

    setIsAnalyzing(true);
    setAnalysisResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('analyze-skills', {
        body: { toolType: selectedTool, userSkills },
      });

      if (error) throw error;

      setAnalysisResult(data);
      toast({
        title: "Analysis Complete",
        description: "Your results are ready to view.",
      });
    } catch (error) {
      console.error('Analysis error:', error);
      toast({
        title: "Analysis Failed",
        description: "There was an error analyzing your skills. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const renderAnalysisResult = () => {
    if (!analysisResult) return null;

    switch (selectedTool) {
      case "Skill Advisor":
        return (
          <div className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">Recommendations</h4>
              <ul className="list-disc pl-5 space-y-1">
                {analysisResult.recommendations.map((rec: string, i: number) => (
                  <li key={i} className="text-sm">{rec}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-1">Timeline</h4>
              <p className="text-sm">{analysisResult.timeline}</p>
            </div>
            <div>
              <h4 className="font-medium mb-1">Priority</h4>
              <p className="text-sm">{analysisResult.priority}</p>
            </div>
            <div>
              <h4 className="font-medium mb-1">Rationale</h4>
              <p className="text-sm">{analysisResult.rationale}</p>
            </div>
          </div>
        );

      case "Gap Analyzer":
        return (
          <div className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">Identified Gaps</h4>
              <ul className="list-disc pl-5 space-y-1">
                {analysisResult.gaps.map((gap: string, i: number) => (
                  <li key={i} className="text-sm">{gap}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-1">Impact</h4>
              <p className="text-sm">{analysisResult.impact}</p>
            </div>
            <div>
              <h4 className="font-medium mb-2">Suggested Actions</h4>
              <ul className="list-disc pl-5 space-y-1">
                {analysisResult.suggestions.map((suggestion: string, i: number) => (
                  <li key={i} className="text-sm">{suggestion}</li>
                ))}
              </ul>
            </div>
          </div>
        );

      case "Resource Curator":
        return (
          <div className="space-y-4">
            {analysisResult.resources.map((resource: any, i: number) => (
              <div key={i} className="p-3 bg-background rounded-lg">
                <h4 className="font-medium">{resource.title}</h4>
                <div className="text-sm space-y-1 mt-2">
                  <p>Type: {resource.type}</p>
                  <p>Difficulty: {resource.difficulty}</p>
                  <p>Focus: {resource.focus}</p>
                </div>
              </div>
            ))}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 p-4 bg-muted rounded-lg animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">AI Development Tools</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-[200px] justify-between">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4" />
                <span>{selectedTool || "Select Tool"}</span>
              </div>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuItem onClick={() => handleToolSelect("Skill Advisor")}>
              Skill Path Advisor
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleToolSelect("Gap Analyzer")}>
              Skill Gap Analyzer
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleToolSelect("Resource Curator")}>
              Learning Resource Curator
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {selectedTool && (
        <Card className="p-4 mt-4 animate-fade-in">
          <div className="space-y-4">
            <h3 className="font-medium">{selectedTool}</h3>
            <p className="text-sm text-muted-foreground">
              {selectedTool === "Skill Advisor" && "Get personalized recommendations for your skill development path."}
              {selectedTool === "Gap Analyzer" && "Identify gaps in your skill set and get recommendations for improvement."}
              {selectedTool === "Resource Curator" && "Discover curated learning resources tailored to your goals."}
            </p>
            
            <Button 
              className="w-full"
              onClick={handleAnalysis}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                'Start Analysis'
              )}
            </Button>

            {analysisResult && (
              <div className="mt-6 pt-6 border-t">
                <h4 className="font-medium mb-4">Analysis Results</h4>
                {renderAnalysisResult()}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};