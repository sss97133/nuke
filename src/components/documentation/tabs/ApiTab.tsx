
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileCode, ArrowLeft } from 'lucide-react';

// Import API documentation
const API_DOC = require('../../../../API.md');

export const ApiTab = () => {
  const [showApiDocs, setShowApiDocs] = useState(false);

  if (showApiDocs) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode className="h-5 w-5 text-blue-500" />
            <CardTitle>API Documentation</CardTitle>
          </div>
          <button 
            onClick={() => setShowApiDocs(false)}
            className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to overview
          </button>
        </CardHeader>
        <CardContent>
          <div className="prose dark:prose-invert max-w-none">
            {API_DOC.split('\n').map((paragraph, index) => {
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
          <FileCode className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-xl font-medium mb-2">API Documentation</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Comprehensive API reference for developers integrating with our platform
          </p>
          <div className="flex justify-center gap-4">
            <button 
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md"
              onClick={() => setShowApiDocs(true)}
            >
              View API Reference
            </button>
            <button className="border border-input bg-background hover:bg-accent hover:text-accent-foreground px-4 py-2 rounded-md">
              Download OpenAPI Spec
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
