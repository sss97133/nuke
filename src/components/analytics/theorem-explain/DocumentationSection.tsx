
import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const DocumentationSection = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="col-span-1">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Query Generator</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Processes natural language queries to extract theorem details</p>
        </CardContent>
      </Card>
      
      <Card className="col-span-1">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Core Documentation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Maintains structured knowledge base of fundamental theorems</p>
        </CardContent>
      </Card>
      
      <Card className="col-span-1">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Plugin Documentation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Extends core functionality with specialized visualizations</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default DocumentationSection;
