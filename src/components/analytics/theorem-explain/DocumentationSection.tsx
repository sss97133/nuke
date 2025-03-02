
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { FileText, Database, Code } from "lucide-react";

const DocumentationSection = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="col-span-1">
        <CardHeader className="flex flex-row items-center gap-2">
          <FileText className="h-5 w-5 text-blue-500" />
          <CardTitle className="text-sm font-medium">Query Generator</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Processes natural language queries to extract theorem details from the TIGER-Lab/TheoremExplainBench dataset</p>
        </CardContent>
      </Card>
      
      <Card className="col-span-1">
        <CardHeader className="flex flex-row items-center gap-2">
          <Database className="h-5 w-5 text-blue-500" />
          <CardTitle className="text-sm font-medium">Core Documentation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Maintains structured knowledge base of fundamental theorems with detailed explanations</p>
        </CardContent>
      </Card>
      
      <Card className="col-span-1">
        <CardHeader className="flex flex-row items-center gap-2">
          <Code className="h-5 w-5 text-blue-500" />
          <CardTitle className="text-sm font-medium">Plugin Documentation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Extends core functionality with specialized visualizations and interactive demonstrations</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default DocumentationSection;
