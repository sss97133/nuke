
import React from 'react';
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle, ChevronDown } from "lucide-react";
import { PlanStep } from './types';

interface PlannerTabProps {
  planSteps: PlanStep[];
  planCompleted: boolean;
  onProceedToCode: () => void;
}

const PlannerTab = ({ planSteps, planCompleted, onProceedToCode }: PlannerTabProps) => {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-md">
        <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-medium mb-2">
          <div className="bg-blue-100 dark:bg-blue-900 p-1 rounded">
            <FileText className="h-4 w-4" />
          </div>
          Planner Agent
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Creates a multi-step plan for visualizing the theorem
        </p>
        
        <div className="space-y-3">
          {planSteps.map((step, index) => (
            <div 
              key={index}
              className={`border p-3 rounded-md ${
                step.completed 
                  ? "bg-blue-100/50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800" 
                  : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
              }`}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  {step.completed ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                  )}
                  <span className={step.completed ? "font-medium" : "text-muted-foreground"}>
                    {step.title}
                  </span>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </div>
              {step.completed && (
                <p className="text-xs text-muted-foreground mt-2 ml-6">
                  {step.description}
                </p>
              )}
            </div>
          ))}
        </div>
        
        {planCompleted && (
          <Button 
            className="mt-4" 
            onClick={onProceedToCode}
          >
            Proceed to Code Generation
          </Button>
        )}
      </div>
    </div>
  );
};

export default PlannerTab;
