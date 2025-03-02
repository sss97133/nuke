
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, ArrowLeft } from 'lucide-react';

// Import technical documentation
const TECHNICAL_DOC = require('../../../../docs/TECHNICAL.md');

export const TechTab = () => {
  const [showTechDocs, setShowTechDocs] = useState(false);

  if (showTechDocs) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-blue-500" />
            <CardTitle>Technical Documentation</CardTitle>
          </div>
          <button 
            onClick={() => setShowTechDocs(false)}
            className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to overview
          </button>
        </CardHeader>
        <CardContent>
          <div className="prose dark:prose-invert max-w-none">
            {TECHNICAL_DOC.split('\n').map((paragraph, index) => {
              // Handle headers
              if (paragraph.startsWith('# ')) {
                return <h1 key={index} className="text-2xl font-bold mt-6 mb-4">{paragraph.replace('# ', '')}</h1>;
              }
              if (paragraph.startsWith('## ')) {
                return <h2 key={index} className="text-xl font-bold mt-5 mb-3">{paragraph.replace('## ', '')}</h2>;
              }
              if (paragraph.startsWith('### ')) {
                return <h3 key={index} className="text-lg font-bold mt-4 mb-2">{paragraph.replace('### ', '')}</h3>;
              }
              // Handle lists
              if (paragraph.startsWith('- ')) {
                return <li key={index} className="ml-6 mb-1">{paragraph.replace('- ', '')}</li>;
              }
              // Handle code blocks (simple version)
              if (paragraph.startsWith('```')) {
                return null; // Skip the code block delimiters
              }
              if (paragraph.trim() === '') {
                return <br key={index} />;
              }
              // Regular paragraphs
              return <p key={index} className="mb-4">{paragraph}</p>;
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center p-10">
          <Settings className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-medium mb-2">Technical Documentation</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Detailed technical specifications, architecture diagrams, and implementation guides
          </p>
          <div className="flex justify-center gap-4">
            <button 
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md"
              onClick={() => setShowTechDocs(true)}
            >
              System Architecture
            </button>
            <button className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 rounded-md">
              Integration Guides
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
