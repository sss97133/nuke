
import React, { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Volume2, Play, Download } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TheoremData } from './types';

interface OutputTabProps {
  theoremData?: TheoremData;
}

const OutputTab = ({ theoremData }: OutputTabProps) => {
  // Debug: Log when theoremData changes
  useEffect(() => {
    console.log("OutputTab received theoremData:", theoremData);
  }, [theoremData]);

  return (
    <div className="space-y-4">
      <Card className="border overflow-hidden">
        <div className="aspect-video relative bg-slate-100 dark:bg-slate-800 rounded-md overflow-hidden flex items-center justify-center">
          {/* Using a fallback message when no visualization is available */}
          <div className="p-8 text-center">
            <h3 className="text-xl font-semibold mb-2">Visualization Preview</h3>
            <p className="text-muted-foreground mb-4">
              {theoremData ? 
                `Interactive visualization for "${theoremData.name}" theorem` : 
                "Select a theorem and generate a visualization to see the preview here"}
            </p>
            <img 
              src="/lovable-uploads/4b9269d1-9638-4eb3-8139-c63f53e73d75.png" 
              alt="IEEE Floating Point Visualization" 
              className="w-full max-w-xl mx-auto h-auto object-contain"
            />
          </div>
          
          <div className="absolute bottom-4 right-4 flex gap-2">
            <Button size="icon" variant="secondary" className="rounded-full h-10 w-10 bg-black/70 backdrop-blur">
              <Volume2 className="h-5 w-5" />
            </Button>
            <Button size="icon" variant="secondary" className="rounded-full h-10 w-10 bg-black/70 backdrop-blur">
              <Play className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </Card>

      {theoremData ? (
        <Card>
          <CardHeader>
            <CardTitle>Theorem Details</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <TableRow>
                  <TableHead className="w-1/4">Name</TableHead>
                  <TableCell>{theoremData.name}</TableCell>
                </TableRow>
                <TableRow>
                  <TableHead>Definition</TableHead>
                  <TableCell>{theoremData.definition}</TableCell>
                </TableRow>
                {theoremData.explanation && (
                  <TableRow>
                    <TableHead>Explanation</TableHead>
                    <TableCell>{theoremData.explanation}</TableCell>
                  </TableRow>
                )}
                {theoremData.category && (
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableCell>{theoremData.category}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            
            <Button className="mt-4" variant="outline">
              <Download className="mr-2 h-4 w-4" />
              Download Full Data
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <CardContent>
            <p className="text-muted-foreground">
              No theorem selected. Please select a theorem and complete the planning process.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default OutputTab;
