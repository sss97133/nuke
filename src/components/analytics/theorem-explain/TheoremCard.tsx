
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, FileText } from "lucide-react";
import { TheoremData } from './types';

interface TheoremCardProps {
  onStartPlanning: () => void;
  planning: boolean;
  planCompleted: boolean;
  selectedTheorem?: TheoremData;
  isLoading?: boolean;
}

const TheoremCard = ({ 
  onStartPlanning, 
  planning, 
  planCompleted, 
  selectedTheorem,
  isLoading = false
}: TheoremCardProps) => {
  console.log("TheoremCard rendering with props:", { 
    planning, planCompleted, isLoading, 
    selectedTheoremName: selectedTheorem?.name 
  });

  return (
    <Card className="lg:col-span-1 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="bg-green-100 dark:bg-green-900 p-1 rounded">
            <FileText className="h-5 w-5 text-green-600 dark:text-green-500" />
          </div>
          Theorem
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <h3 className="font-medium">
                {selectedTheorem ? selectedTheorem.name : "IEEE Conversion"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {selectedTheorem 
                  ? selectedTheorem.definition
                  : "The IEEE-754 standard describes floating-point formats, a way to represent real numbers in hardware."}
              </p>
            </>
          )}
          
          <Button 
            onClick={onStartPlanning} 
            disabled={planning || planCompleted || isLoading}
            className="w-full mt-4"
          >
            {planning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Planning...
              </>
            ) : planCompleted ? "Plan Generated" : "Generate Plan"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default TheoremCard;
