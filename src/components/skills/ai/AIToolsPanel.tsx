import React, { useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';

export const AIToolsPanel = () => {
  const { toast } = useToast();
  const [selectedTool, setSelectedTool] = useState<string | null>(null);

  const handleToolSelect = (tool: string) => {
    setSelectedTool(tool);
    toast({
      title: `${tool} Selected`,
      description: "Loading AI functionality...",
    });
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
              onClick={() => {
                toast({
                  title: "Processing Request",
                  description: `Starting ${selectedTool.toLowerCase()} analysis...`,
                });
              }}
            >
              Start Analysis
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};