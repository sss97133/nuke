
import React from 'react';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DocContentDisplayProps {
  content: string;
  title: string;
  onBack: () => void;
}

export const DocContentDisplay = ({ content, title, onBack }: DocContentDisplayProps) => {
  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-blue-500" />
          <CardTitle>{title}</CardTitle>
        </div>
        <button 
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </button>
      </CardHeader>
      <CardContent>
        <div className="prose dark:prose-invert max-w-none">
          {content.split('\n').map((paragraph, index) => {
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
};
